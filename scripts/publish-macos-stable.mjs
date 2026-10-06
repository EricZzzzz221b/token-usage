/** Only run after explicit release authorization. No clobber, no latest lookups. */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import {
  ROOT,
  REPOSITORY,
  PLATFORM,
  versionFromFiles,
  names,
  validateManifest,
  verifyArtifact,
  assertUnusedRelease,
  assertPublishedRelease,
  newer,
  releaseMode,
  requireModeAcknowledgement,
} from "./stable-release.mjs";

function requireThat(condition, message) {
  if (!condition) throw new Error(message);
}
function gh(args) {
  return execFileSync("gh", args, {
    cwd: ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}
function api(path, nullable = false) {
  try {
    return JSON.parse(gh(["api", `repos/${REPOSITORY}/${path}`]));
  } catch (error) {
    // Only a confirmed HTTP 404 means absent; permission/network failures are fatal.
    if (nullable && error.stderr?.toString().includes("(HTTP 404)")) return null;
    throw new Error("GitHub read failed; no publication allowed");
  }
}
async function verifiedDownload(url, expected) {
  let current = new URL(url);
  const deadline = AbortSignal.timeout(10 * 60 * 1000);
  for (let hop = 0; hop < 6; hop++) {
    requireThat(
      current.protocol === "https:" && !current.username && !current.password,
      "Insecure download redirect",
    );
    const response = await fetch(current, { signal: deadline, redirect: "manual" });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      requireThat(location, "Redirect missing location");
      await response.body?.cancel();
      current = new URL(location, current);
      continue;
    }
    requireThat(response.ok, "Published asset download failed");
    const chunks = [];
    let length = 0;
    for await (const chunk of response.body) {
      length += chunk.length;
      requireThat(length <= expected.length + 1, "Downloaded asset too large");
      chunks.push(chunk);
    }
    const bytes = Buffer.concat(chunks);
    requireThat(
      bytes.length === expected.length &&
        createHash("sha256").update(bytes).digest("hex") ===
          createHash("sha256").update(expected).digest("hex"),
      "Published asset checksum mismatch",
    );
    return bytes;
  }
  throw new Error("Too many asset redirects");
}
async function main() {
  requireThat(
    process.env.CONFIRM_STABLE_PUBLISH === "yes",
    "Explicit stable publish authorization required",
  );
  const version = versionFromFiles();
  requireThat(process.env.RELEASE_TAG === `v${version}`, "Release tag/version mismatch");
  requireThat(
    gh(["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"]).trim() === REPOSITORY,
    "Unexpected repository",
  );
  const directory = resolve(process.argv[2]);
  const n = names(version);
  const manifest = validateManifest(
    JSON.parse(readFileSync(resolve(directory, "stable.json"), "utf8")),
  );
  requireThat(manifest.version === version, "Manifest/source mismatch");
  const mode = releaseMode();
  requireModeAcknowledgement(mode);
  requireThat(
    (manifest.macos_signing || "notarized") === mode,
    "Artifact/publish release mode mismatch",
  );
  const notesPath = resolve(directory, "release-notes.md");
  requireThat(
    readFileSync(notesPath, "utf8").trim() === manifest.notes.trim(),
    "Published release notes must disclose the artifact mode",
  );
  const files = [n.archive, `${n.archive}.sig`, n.dmg, n.checksum];
  const contents = new Map(files.map((name) => [name, readFileSync(resolve(directory, name))]));
  requireThat(
    contents.get(`${n.archive}.sig`).toString().trim() === manifest.platforms[PLATFORM].signature,
    "Signature asset/manifest mismatch",
  );
  verifyArtifact(
    process.env.TOKEN_USAGE_UPDATER_PUBLIC_KEY,
    manifest.platforms[PLATFORM].signature,
    version,
    contents.get(n.archive),
  );
  const expectedChecksums =
    files
      .slice(0, 3)
      .map((name) => `${createHash("sha256").update(contents.get(name)).digest("hex")}  ${name}`)
      .join("\n") + "\n";
  requireThat(
    contents.get(n.checksum).toString() === expectedChecksums,
    "Local release checksums mismatch",
  );
  const existing = api(`releases/tags/v${version}`, true);
  assertUnusedRelease(existing, version);
  const branch = api("git/ref/heads/macos-stable", true);
  const previous = branch ? api("contents/updates/macos/stable.json?ref=macos-stable", true) : null;
  if (previous) {
    const previousManifest = validateManifest(
      JSON.parse(Buffer.from(previous.content, "base64").toString()),
    );
    requireThat(
      newer(version, previousManifest.version),
      "Stable must advance; rollback/republication forbidden",
    );
  }
  // Create a draft without assets, then upload without --clobber. On partial failure
  // the draft stays unadvertised; future runs refuse existing assets.
  if (!existing)
    gh([
      "release",
      "create",
      `v${version}`,
      "--verify-tag",
      "--draft",
      "--title",
      `Token用量 v${version}`,
      "--notes-file",
      notesPath,
    ]);
  gh(["release", "upload", `v${version}`, ...files.map((name) => resolve(directory, name))]);
  gh(["release", "edit", `v${version}`, "--draft=false", "--prerelease=false", "--latest=false"]);
  const published = api(`releases/tags/v${version}`);
  assertPublishedRelease(published, version);
  for (const name of files) {
    const assets = published.assets.filter((asset) => asset.name === name);
    requireThat(
      assets.length === 1 && assets[0].state === "uploaded",
      "Missing/non-unique published asset",
    );
    const expectedUrl = `https://github.com/${REPOSITORY}/releases/download/v${version}/${name}`;
    requireThat(assets[0].browser_download_url === expectedUrl, "Unexpected asset URL");
    const downloaded = await verifiedDownload(expectedUrl, contents.get(name));
    if (name === n.archive)
      verifyArtifact(
        process.env.TOKEN_USAGE_UPDATER_PUBLIC_KEY,
        manifest.platforms[PLATFORM].signature,
        version,
        downloaded,
      );
  }
  // Final operation only: immutable package verified, then atomically move the
  // dedicated channel's Git ref to a commit containing the single static manifest.
  if (branch) {
    const now = api("git/ref/heads/macos-stable");
    requireThat(now.object.sha === branch.object.sha, "Stable branch changed concurrently");
  }
  const parent =
    branch?.object.sha ||
    execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();
  const commit = api(`git/commits/${parent}`);
  const manifestContent = Buffer.from(JSON.stringify(manifest, null, 2) + "\n").toString("base64");
  const blob = JSON.parse(
    execFileSync(
      "gh",
      ["api", `repos/${REPOSITORY}/git/blobs`, "--method", "POST", "--input", "-"],
      {
        input: JSON.stringify({ content: manifestContent, encoding: "base64" }),
        encoding: "utf8",
        stdio: ["pipe", "pipe", "pipe"],
      },
    ),
  );
  const tree = JSON.parse(
    execFileSync(
      "gh",
      ["api", `repos/${REPOSITORY}/git/trees`, "--method", "POST", "--input", "-"],
      {
        input: JSON.stringify({
          base_tree: commit.tree.sha,
          tree: [
            { path: "updates/macos/stable.json", mode: "100644", type: "blob", sha: blob.sha },
          ],
        }),
        encoding: "utf8",
        stdio: ["pipe", "pipe", "pipe"],
      },
    ),
  );
  const next = JSON.parse(
    execFileSync(
      "gh",
      ["api", `repos/${REPOSITORY}/git/commits`, "--method", "POST", "--input", "-"],
      {
        input: JSON.stringify({
          message: `advance macOS stable to ${version}`,
          tree: tree.sha,
          parents: [parent],
        }),
        encoding: "utf8",
        stdio: ["pipe", "pipe", "pipe"],
      },
    ),
  );
  // force:false rejects any concurrently advanced ref; an orphan commit is harmless.
  const payload = branch
    ? { sha: next.sha, force: false }
    : { ref: "refs/heads/macos-stable", sha: next.sha };
  execFileSync(
    "gh",
    [
      "api",
      `repos/${REPOSITORY}/git/${branch ? "refs/heads/macos-stable" : "refs"}`,
      "--method",
      branch ? "PATCH" : "POST",
      "--input",
      "-",
    ],
    { input: JSON.stringify(payload), stdio: ["pipe", "pipe", "pipe"] },
  );
  console.log(`macOS stable advanced to ${version}; immutable assets verified`);
}
main().catch(() => {
  console.error(
    "Stable publication failed. No overwrite allowed. Inspect the release/channel before retrying; secrets are not logged.",
  );
  process.exitCode = 1;
});
