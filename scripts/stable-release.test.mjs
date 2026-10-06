import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign, createHash } from "node:crypto";
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import {
  stableVersion,
  newer,
  buildManifest,
  validateManifest,
  verifyArtifact,
  parsePublicKey,
  assertUnusedRelease,
  assertPublishedRelease,
  PLATFORM,
  ROOT,
  names,
  versionFromFiles,
  releaseMode,
  requireModeAcknowledgement,
  updaterConfig,
  AD_HOC_WARNING,
} from "./stable-release.mjs";

// Ephemeral TEST keys only; never exported to release config or saved to disk.
function fixture(version = "1.3.0") {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const keyId = Buffer.from("TESTONLY");
  const key = Buffer.concat([
    Buffer.from("Ed"),
    keyId,
    publicKey.export({ type: "spki", format: "der" }).subarray(-32),
  ]);
  const publicEncoded = Buffer.from(
    `untrusted comment: TEST ONLY\n${key.toString("base64")}\n`,
  ).toString("base64");
  const payload = Buffer.from("MOCK updater archive; not an installable app");
  const rawSignature = sign(null, createHash("blake2b512").update(payload).digest(), privateKey);
  const comment = `timestamp:0\tfile:mock\tversion:${version}`;
  const bytes = Buffer.concat([Buffer.from("ED"), keyId, rawSignature]);
  const global = sign(null, Buffer.concat([rawSignature, Buffer.from(comment)]), privateKey);
  const signature = Buffer.from(
    `untrusted comment: TEST ONLY\n${bytes.toString("base64")}\ntrusted comment: ${comment}\n${global.toString("base64")}\n`,
  ).toString("base64");
  return { publicEncoded, signature, payload, version };
}
describe("macOS stable release gates", () => {
  it("rejects prerelease, malformed, same/lower and ambiguous versions", () => {
    for (const value of ["1.2.7-beta.1", "1.2.7+meta", "v1.2.7", "01.2.7", "latest", "1.2"])
      assert.throws(() => stableVersion(value));
    assert.equal(newer("1.2.7", "1.2.7"), false);
    assert.equal(newer("1.2.6", "1.2.7"), false);
    assert.equal(newer("1.3.0", "1.2.7"), true);
  });
  it("requires arm64 package, signature, stable tag and version-specific HTTPS", () => {
    const f = fixture();
    const manifest = buildManifest({ version: f.version, signature: f.signature });
    assert.equal(validateManifest(manifest), manifest);
    assert.throws(() => validateManifest({ ...manifest, platforms: {} }));
    assert.throws(() =>
      validateManifest({
        ...manifest,
        platforms: {
          [PLATFORM]: {
            url: "https://github.com/x/releases/latest/download/app.tar.gz",
            signature: f.signature,
          },
        },
      }),
    );
    assert.throws(() =>
      validateManifest({
        ...manifest,
        platforms: { [PLATFORM]: { ...manifest.platforms[PLATFORM], signature: "" } },
      }),
    );
    assert.throws(() => validateManifest({ ...manifest, version: "1.3.0-beta.1" }));
    assert.throws(() => parsePublicKey("placeholder"));
  });
  it("verifies actual cryptographic signatures and rejects tamper, wrong key, altered comment/version", () => {
    const f = fixture();
    verifyArtifact(f.publicEncoded, f.signature, f.version, f.payload);
    assert.throws(() =>
      verifyArtifact(f.publicEncoded, f.signature, f.version, Buffer.from("tampered")),
    );
    assert.throws(() => verifyArtifact(fixture().publicEncoded, f.signature, f.version, f.payload));
    assert.throws(() => verifyArtifact(f.publicEncoded, f.signature, "1.4.0", f.payload));
    const altered = Buffer.from(
      Buffer.from(f.signature, "base64").toString().replace("file:mock", "file:evil"),
    ).toString("base64");
    assert.throws(() => verifyArtifact(f.publicEncoded, altered, f.version, f.payload));
  });
  it("refuses published versions and partially uploaded drafts", () => {
    const existing = {
      tag_name: "v1.3.0",
      draft: false,
      prerelease: false,
      assets: [],
      published_at: "2026-10-06T00:00:00Z",
    };
    assert.throws(() => assertUnusedRelease(existing, "1.3.0"));
    assert.throws(() => assertUnusedRelease({ ...existing, draft: true, assets: [{}] }, "1.3.0"));
    assertUnusedRelease(null, "1.3.0");
    assertUnusedRelease({ ...existing, draft: true }, "1.3.0");
    assertPublishedRelease(existing, "1.3.0");
    assert.throws(() => assertPublishedRelease({ ...existing, prerelease: true }, "1.3.0"));
    assert.throws(() => assertPublishedRelease({ ...existing, draft: true }, "1.3.0"));
  });
  it("release DMG refuses bad signing without ad-hoc fallback, attribute stripping or DMG creation", () => {
    const temp = mkdtempSync(join(tmpdir(), "token-updater-test-"));
    try {
      const bin = join(temp, "bin");
      mkdirSync(bin);
      const app = join(temp, "Mock.app");
      mkdirSync(app);
      const log = join(temp, "commands");
      writeFileSync(
        join(bin, "codesign"),
        '#!/bin/bash\nprintf "%s\\n" "$*" >> "$MOCK_LOG"\nexit 1\n',
        { mode: 0o755 },
      );
      for (const name of ["hdiutil", "xattr"])
        writeFileSync(join(bin, name), `#!/bin/bash\necho ${name} >> "$MOCK_LOG"\nexit 1\n`, {
          mode: 0o755,
        });
      const run = spawnSync("/bin/zsh", [join(ROOT, "scripts/build-dmg.sh")], {
        env: {
          ...process.env,
          PATH: `${bin}:${process.env.PATH}`,
          APP_BUNDLE: app,
          BUILD_MODE: "release",
          OUTPUT_DIR: join(temp, "out"),
          APPLE_TEAM_ID: "TEST_ONLY",
          MOCK_LOG: log,
        },
        encoding: "utf8",
      });
      assert.notEqual(run.status, 0);
      const commands = readFileSync(log, "utf8");
      assert.match(commands, /--verify/);
      assert.doesNotMatch(commands, /--sign|hdiutil|xattr/);
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });
  it("packages a single Unicode .app root, preserves symlinks and refuses overwrite", () => {
    const temp = mkdtempSync(join(tmpdir(), "token-update-tar-"));
    try {
      const app = join(temp, "Token用量.app");
      mkdirSync(join(app, "Contents"), { recursive: true });
      writeFileSync(join(app, "Contents", "CodeResources"), "MOCK Apple signature bytes");
      symlinkSync("CodeResources", join(app, "Contents", "signature-link"));
      const archive = join(temp, "update.app.tar.gz");
      const run = spawnSync(
        "python3",
        [join(ROOT, "scripts/package-macos-update.py"), app, archive],
        { encoding: "utf8" },
      );
      assert.equal(run.status, 0, run.stderr);
      const inspect = spawnSync(
        "python3",
        [
          "-c",
          "import tarfile,sys; t=tarfile.open(sys.argv[1]); assert all(m.name.split('/')[0]=='Token用量.app' for m in t.getmembers()); assert t.getmember('Token用量.app/Contents/signature-link').issym(); assert t.extractfile('Token用量.app/Contents/CodeResources').read()==b'MOCK Apple signature bytes'",
          archive,
        ],
        { encoding: "utf8" },
      );
      assert.equal(inspect.status, 0, inspect.stderr);
      const again = spawnSync(
        "python3",
        [join(ROOT, "scripts/package-macos-update.py"), app, archive],
        { encoding: "utf8" },
      );
      assert.notEqual(again.status, 0);
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });
  it("GitHub ad-hoc mode requires explicit acknowledgement and a real updater public key", () => {
    const f = fixture();
    assert.equal(releaseMode("notarized"), "notarized");
    assert.equal(releaseMode("github-ad-hoc"), "github-ad-hoc");
    assert.throws(() => releaseMode("auto"));
    assert.throws(() => requireModeAcknowledgement("github-ad-hoc", "no"));
    requireModeAcknowledgement("github-ad-hoc", "yes");
    const previous = process.env.ALLOW_UNNOTARIZED_RELEASE;
    try {
      process.env.ALLOW_UNNOTARIZED_RELEASE = "yes";
      const config = updaterConfig(f.publicEncoded, "github-ad-hoc");
      assert.equal(config.bundle.macOS.signingIdentity, "-");
      assert.equal(config.plugins.updater.requireSignedVersion, true);
      assert.equal(config.plugins.updater.allowDowngrades, false);
      assert.throws(() => updaterConfig("", "github-ad-hoc"));
      assert.throws(() => updaterConfig(f.publicEncoded, "notarized", "-"));
    } finally {
      if (previous === undefined) delete process.env.ALLOW_UNNOTARIZED_RELEASE;
      else process.env.ALLOW_UNNOTARIZED_RELEASE = previous;
    }
    const manifest = buildManifest({
      version: f.version,
      signature: f.signature,
      mode: "github-ad-hoc",
      notes: "change notes",
    });
    assert.equal(manifest.macos_signing, "github-ad-hoc");
    assert.ok(manifest.notes.startsWith(AD_HOC_WARNING));
    assert.throws(() => validateManifest({ ...manifest, notes: "no disclosure" }));
    assert.throws(() => validateManifest({ ...manifest, macos_signing: "auto" }));
    verifyArtifact(f.publicEncoded, manifest.platforms[PLATFORM].signature, f.version, f.payload);
  });
  it("explicit GitHub policy needs no Apple credentials while notarized failures never downgrade", () => {
    const policy = join(ROOT, "scripts/macos-release-policy.sh");
    const script = 'source "$1"; validate_macos_release_policy';
    const env = {
      PATH: process.env.PATH,
      MACOS_RELEASE_MODE: "github-ad-hoc",
      ALLOW_UNNOTARIZED_RELEASE: "yes",
    };
    assert.equal(spawnSync("bash", ["-c", script, "policy", policy], { env }).status, 0);
    assert.notEqual(
      spawnSync("bash", ["-c", script, "policy", policy], {
        env: { ...env, ALLOW_UNNOTARIZED_RELEASE: "no" },
      }).status,
      0,
    );
    assert.notEqual(
      spawnSync("bash", ["-c", script, "policy", policy], {
        env: { PATH: process.env.PATH, MACOS_RELEASE_MODE: "notarized" },
      }).status,
      0,
    );
  });
  it("GitHub verifier checks ad-hoc integrity without invoking notarization tools", () => {
    const temp = mkdtempSync(join(tmpdir(), "token-adhoc-verify-"));
    try {
      const bin = join(temp, "bin");
      mkdirSync(bin);
      const app = join(temp, "Mock.app");
      mkdirSync(join(app, "Contents", "MacOS"), { recursive: true });
      const version = versionFromFiles();
      writeFileSync(
        join(app, "Contents", "Info.plist"),
        `<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>app.tokenusage.desktop</string><key>CFBundleShortVersionString</key><string>${version}</string><key>CFBundleExecutable</key><string>token-usage</string></dict></plist>`,
      );
      const log = join(temp, "calls");
      writeFileSync(
        join(bin, "codesign"),
        '#!/bin/bash\nprintf "codesign %s\\n" "$*" >> "$MOCK_LOG"\nif [[ "$*" == *--verify* ]]; then exit "${MOCK_VERIFY_STATUS:-0}"; fi\necho Signature=adhoc >&2\n',
        { mode: 0o755 },
      );
      writeFileSync(join(bin, "lipo"), "#!/bin/bash\necho arm64\n", { mode: 0o755 });
      for (const name of ["xattr", "xcrun", "spctl"])
        writeFileSync(join(bin, name), `#!/bin/bash\necho ${name} >> "$MOCK_LOG"\nexit 1\n`, {
          mode: 0o755,
        });
      const env = {
        PATH: `${bin}:${process.env.PATH}`,
        MACOS_RELEASE_MODE: "github-ad-hoc",
        ALLOW_UNNOTARIZED_RELEASE: "yes",
        MOCK_LOG: log,
      };
      const verified = spawnSync("bash", [join(ROOT, "scripts/verify-macos-app.sh"), app], {
        env,
        encoding: "utf8",
      });
      assert.equal(verified.status, 0, verified.stderr);
      assert.doesNotMatch(readFileSync(log, "utf8"), /xcrun|spctl|xattr|--sign/);
      const failed = spawnSync("bash", [join(ROOT, "scripts/verify-macos-app.sh"), app], {
        env: { ...env, MOCK_VERIFY_STATUS: "1" },
        encoding: "utf8",
      });
      assert.notEqual(failed.status, 0);
      assert.doesNotMatch(readFileSync(log, "utf8"), /--sign/);
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });
  it("uploads/download failures and tampering never promote stable; success promotes last (mock gh/fetch)", () => {
    for (const mode of [
      "upload-failed",
      "download-failed",
      "tampered",
      "missing-file",
      "no-authorization",
      "success",
      "unnotarized-success",
      "unnotarized-no-ack",
      "unnotarized-mode-mismatch",
    ]) {
      const temp = mkdtempSync(join(tmpdir(), "token-stable-mock-"));
      try {
        const bin = join(temp, "bin");
        mkdirSync(bin);
        const out = join(temp, "out");
        mkdirSync(out);
        const version = versionFromFiles();
        const n = names(version);
        const f = fixture(version);
        const unnotarized = mode.startsWith("unnotarized-");
        const manifest = buildManifest({
          version,
          signature: f.signature,
          mode: unnotarized ? "github-ad-hoc" : "notarized",
        });
        writeFileSync(join(out, "stable.json"), JSON.stringify(manifest));
        writeFileSync(join(out, "release-notes.md"), manifest.notes + "\n");
        const contents = new Map([
          [n.archive, f.payload],
          [`${n.archive}.sig`, Buffer.from(f.signature)],
          [n.dmg, Buffer.from("MOCK DMG")],
        ]);
        const checksums =
          [...contents]
            .map(([name, bytes]) => `${createHash("sha256").update(bytes).digest("hex")}  ${name}`)
            .join("\n") + "\n";
        contents.set(n.checksum, Buffer.from(checksums));
        for (const [name, bytes] of contents) {
          if (mode !== "missing-file" || name !== n.archive) writeFileSync(join(out, name), bytes);
        }
        const published = {
          tag_name: `v${version}`,
          draft: false,
          prerelease: false,
          published_at: "2026-10-06T00:00:00Z",
          assets: [...contents.keys()].map((name) => ({
            name,
            state: "uploaded",
            browser_download_url: `https://github.com/EricZzzzz221b/token-usage/releases/download/v${version}/${name}`,
          })),
        };
        writeFileSync(join(temp, "release.json"), JSON.stringify(published));
        const mockGh = `#!/usr/bin/env node
import {readFileSync,writeFileSync,appendFileSync,existsSync} from 'node:fs';
const root=process.env.MOCK_ROOT; const args=process.argv.slice(2);
appendFileSync(root+'/calls',JSON.stringify(args)+'\\n');
const output=(value)=>console.log(JSON.stringify(value));
const missing=()=>{ console.error('(HTTP 404)'); process.exit(1); };
if(args[0]==='repo') {console.log('EricZzzzz221b/token-usage');}
else if(args[0]==='release') {
 if(args[1]==='upload' && process.env.MOCK_MODE==='upload-failed') process.exit(1);
 if(args[1]==='edit') writeFileSync(root+'/published','yes');
} else if(args[0]==='api') {
 const path=args[1];
 if(path.includes('releases/tags/')) {if(existsSync(root+'/published')) output(JSON.parse(readFileSync(root+'/release.json'))); else missing();}
 else if(path.includes('contents/')) missing();
 else if(path.includes('git/ref/heads/')) output({object:{sha:'channel-parent'}});
 else if(path.endsWith('git/commits/channel-parent')) output({tree:{sha:'base-tree'}});
 else if(path.endsWith('git/blobs')) output({sha:'new-blob'});
 else if(path.endsWith('git/trees')) output({sha:'new-tree'});
 else if(path.endsWith('git/commits')) output({sha:'new-commit'});
 else if(path.includes('git/refs/')) output({ok:true});
 else {console.error('Unexpected mock GitHub request');process.exit(1);}
} else {process.exit(1);}
`;
        writeFileSync(join(bin, "gh"), mockGh, { mode: 0o755 });
        // Executable without a package.json: .mjs symlink target keeps ES module syntax.
        writeFileSync(join(bin, "gh.mjs"), mockGh, { mode: 0o755 });
        writeFileSync(
          join(bin, "gh"),
          `#!/bin/sh\nexec "${process.execPath}" "${join(bin, "gh.mjs")}" "$@"\n`,
          { mode: 0o755 },
        );
        const mockFetch = `import {readFileSync,appendFileSync} from 'node:fs';
globalThis.fetch=async(url)=>{
 const root=process.env.MOCK_ROOT; appendFileSync(root+'/calls','FETCH '+url+'\\n');
 if(process.env.MOCK_MODE==='download-failed') return new Response('failed',{status:503});
 const name=new URL(url).pathname.split('/').at(-1);
 return new Response(process.env.MOCK_MODE==='tampered' && name.endsWith('.tar.gz') ? Buffer.from('tampered') : readFileSync(root+'/out/'+name));
};`;
        const fetchPath = join(temp, "fetch.mjs");
        writeFileSync(fetchPath, mockFetch);
        const run = spawnSync(
          process.execPath,
          ["--import", fetchPath, join(ROOT, "scripts/publish-macos-stable.mjs"), out],
          {
            env: {
              PATH: `${bin}:${process.env.PATH}`,
              HOME: process.env.HOME,
              MOCK_ROOT: temp,
              MOCK_MODE: mode,
              RELEASE_TAG: `v${version}`,
              MACOS_RELEASE_MODE:
                unnotarized && mode !== "unnotarized-mode-mismatch" ? "github-ad-hoc" : "notarized",
              ALLOW_UNNOTARIZED_RELEASE: mode === "unnotarized-no-ack" ? "no" : "yes",
              TOKEN_USAGE_UPDATER_PUBLIC_KEY: f.publicEncoded,
              CONFIRM_STABLE_PUBLISH: mode === "no-authorization" ? "no" : "yes",
            },
            encoding: "utf8",
          },
        );
        const calls = (() => {
          try {
            return readFileSync(join(temp, "calls"), "utf8");
          } catch {
            return "";
          }
        })();
        if (mode === "success" || mode === "unnotarized-success") {
          assert.equal(run.status, 0, run.stderr);
          assert.match(calls, /git\/refs\/heads\/macos-stable/);
          assert.ok(calls.lastIndexOf("FETCH ") < calls.indexOf("git/blobs"));
          assert.ok(calls.indexOf('["release","upload"') < calls.indexOf("FETCH "));
        } else {
          assert.notEqual(run.status, 0);
          assert.doesNotMatch(calls, /git\/blobs|git\/trees|git\/refs/);
          if (mode === "upload-failed") assert.doesNotMatch(calls, /FETCH /);
          if (["missing-file", "no-authorization"].includes(mode))
            assert.doesNotMatch(calls, /release","create|release","upload/);
        }
      } finally {
        rmSync(temp, { recursive: true, force: true });
      }
    }
  });
});
