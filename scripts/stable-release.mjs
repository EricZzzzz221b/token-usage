/** Offline preparation and release gates. No key generation, uploads or releases here. */
import { createHash, createPublicKey, verify } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const ENDPOINT =
  "https://raw.githubusercontent.com/EricZzzzz221b/token-usage/macos-stable/updates/macos/stable.json";
export const REPOSITORY = "EricZzzzz221b/token-usage";
export const PLATFORM = "darwin-aarch64";
function requireThat(condition, message) {
  if (!condition) throw new Error(message);
}
export const AD_HOC_WARNING =
  "重要 / Important: 此 GitHub 发行未经 Apple 公证（ad-hoc）。macOS 可能阻止首次安装或更新后启动，系统权限可能需要重新批准。This GitHub release is not Apple-notarized; launch and permission approval may be required.";
export function releaseMode(value = process.env.MACOS_RELEASE_MODE || "notarized") {
  requireThat(["notarized", "github-ad-hoc"].includes(value), "Unknown macOS release mode");
  return value;
}
export function requireModeAcknowledgement(
  mode,
  acknowledgement = process.env.ALLOW_UNNOTARIZED_RELEASE,
) {
  releaseMode(mode);
  requireThat(
    mode !== "github-ad-hoc" || acknowledgement === "yes",
    "Explicit unnotarized release acknowledgement required",
  );
}
export function updaterConfig(publicKey, mode, identity) {
  parsePublicKey(publicKey);
  requireModeAcknowledgement(mode);
  if (mode === "notarized")
    requireThat(
      typeof identity === "string" && identity.length > 0 && identity !== "-",
      "Developer ID required; no fallback",
    );
  return {
    bundle: {
      createUpdaterArtifacts: false,
      macOS: { signingIdentity: mode === "github-ad-hoc" ? "-" : identity, hardenedRuntime: true },
    },
    plugins: {
      updater: {
        pubkey: publicKey,
        endpoints: [ENDPOINT],
        requireSignedVersion: true,
        allowDowngrades: false,
      },
    },
  };
}
export function stableVersion(version) {
  requireThat(
    typeof version === "string" && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version),
    "stable requires plain major.minor.patch; prereleases/build metadata forbidden",
  );
  return version;
}
export function newer(version, previous) {
  const a = stableVersion(version).split(".").map(BigInt);
  const b = stableVersion(previous).split(".").map(BigInt);
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  return false;
}
export function versionFromFiles() {
  const version = stableVersion(
    JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf8")).version,
  );
  requireThat(
    JSON.parse(readFileSync(resolve(ROOT, "src-tauri/tauri.conf.json"), "utf8")).version ===
      version,
    "Tauri/package version mismatch",
  );
  requireThat(
    readFileSync(resolve(ROOT, "src-tauri/Cargo.toml"), "utf8").match(
      /^version = "([^"]+)"/m,
    )?.[1] === version,
    "Cargo/package version mismatch",
  );
  return version;
}
export function names(version) {
  stableVersion(version);
  return {
    archive: `TokenUsage_${version}_arm64.app.tar.gz`,
    dmg: `TokenUsage_${version}_arm64.dmg`,
    checksum: `SHA256SUMS-${version}.txt`,
  };
}
export function archiveUrl(version) {
  return `https://github.com/${REPOSITORY}/releases/download/v${stableVersion(version)}/${names(version).archive}`;
}
function decodedBase64(value) {
  requireThat(
    typeof value === "string" &&
      value.length > 0 &&
      value.length < 20000 &&
      /^[A-Za-z0-9+/]+={0,2}$/.test(value),
    "Invalid signature/key encoding",
  );
  const bytes = Buffer.from(value, "base64");
  requireThat(bytes.toString("base64") === value, "Noncanonical base64");
  return bytes;
}
export function parsePublicKey(encoded) {
  const text = decodedBase64(encoded).toString("utf8").trim().split(/\r?\n/);
  requireThat(
    text.length === 2 && text[0].startsWith("untrusted comment: "),
    "A real Tauri public key is required",
  );
  const bytes = decodedBase64(text[1]);
  requireThat(
    bytes.length === 42 && ["Ed", "ED"].includes(bytes.subarray(0, 2).toString()),
    "Invalid minisign public key",
  );
  return bytes;
}
export function parseSignature(encoded, version) {
  const lines = decodedBase64(encoded).toString("utf8").trim().split(/\r?\n/);
  requireThat(
    lines.length === 4 &&
      lines[0].startsWith("untrusted comment: ") &&
      lines[2].startsWith("trusted comment: "),
    "Malformed Tauri signature",
  );
  const bytes = decodedBase64(lines[1]);
  const global = decodedBase64(lines[3]);
  requireThat(
    bytes.length === 74 &&
      global.length === 64 &&
      ["Ed", "ED"].includes(bytes.subarray(0, 2).toString()),
    "Malformed minisign signature",
  );
  const comment = lines[2].slice("trusted comment: ".length);
  const versions = comment
    .split("\t")
    .filter((f) => f.startsWith("version:"))
    .map((f) => f.slice(8));
  requireThat(
    versions.length === 1 && versions[0] === version,
    "Signature missing/mismatched signed version; use current Tauri CLI --app-version",
  );
  return { bytes, global, comment };
}
/** Verify both minisign Ed25519 signatures, including its authenticated version. */
export function verifyArtifact(publicKey, signature, version, artifact) {
  const key = parsePublicKey(publicKey);
  const sig = parseSignature(signature, stableVersion(version));
  requireThat(key.subarray(2, 10).equals(sig.bytes.subarray(2, 10)), "Signing key mismatch");
  const edKey = createPublicKey({
    key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), key.subarray(10)]),
    format: "der",
    type: "spki",
  });
  const message =
    sig.bytes.subarray(0, 2).toString() === "ED"
      ? createHash("blake2b512").update(artifact).digest()
      : artifact;
  requireThat(verify(null, message, edKey, sig.bytes.subarray(10)), "Artifact signature mismatch");
  requireThat(
    verify(
      null,
      Buffer.concat([sig.bytes.subarray(10), Buffer.from(sig.comment)]),
      edKey,
      sig.global,
    ),
    "Trusted comment signature mismatch",
  );
}
export function validateManifest(manifest) {
  const version = stableVersion(manifest.version);
  requireThat(
    typeof manifest.notes === "string" && manifest.notes.length <= 4000,
    "Invalid release notes",
  );
  requireThat(
    typeof manifest.pub_date === "string" &&
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(
        manifest.pub_date,
      ) &&
      Number.isFinite(Date.parse(manifest.pub_date)),
    "RFC3339 publication date required",
  );
  requireThat(
    manifest.platforms &&
      Object.keys(manifest.platforms).length === 1 &&
      manifest.platforms[PLATFORM],
    "Missing/wrong platform package",
  );
  const platform = manifest.platforms[PLATFORM];
  requireThat(
    platform.url === archiveUrl(version),
    "Immutable concrete-version HTTPS URL required",
  );
  parseSignature(platform.signature, version);
  const mode = releaseMode(manifest.macos_signing || "notarized");
  if (mode === "github-ad-hoc")
    requireThat(
      manifest.notes.startsWith(AD_HOC_WARNING),
      "Unnotarized release disclosure required",
    );
  return manifest;
}
export function buildManifest({
  version,
  signature,
  notes = "",
  date = new Date().toISOString(),
  mode = "notarized",
}) {
  releaseMode(mode);
  if (mode === "github-ad-hoc") notes = `${AD_HOC_WARNING}\n\n${notes}`;
  notes = notes.slice(0, 4000);
  return validateManifest({
    version,
    notes,
    pub_date: date,
    macos_signing: mode,
    platforms: { [PLATFORM]: { url: archiveUrl(version), signature } },
  });
}
function writeExclusive(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, { flag: "wx", mode: 0o600 });
}
export function assertPublishedRelease(release, version) {
  requireThat(
    release.tag_name === `v${version}` &&
      release.draft === false &&
      release.prerelease === false &&
      !!release.published_at,
    "Only published non-prerelease macOS version tags can enter stable",
  );
}
export function assertUnusedRelease(existing, version) {
  if (!existing) return;
  requireThat(
    existing.tag_name === `v${version}` &&
      existing.draft === true &&
      existing.prerelease === false &&
      existing.assets.length === 0,
    "Existing released version/assets are immutable; choose a new version",
  );
}
async function main() {
  const [command, argument, artifact] = process.argv.slice(2);
  if (command === "version") {
    console.log(versionFromFiles());
    return;
  }
  if (command === "config") {
    const config = updaterConfig(
      process.env.TOKEN_USAGE_UPDATER_PUBLIC_KEY,
      releaseMode(),
      process.env.APPLE_SIGNING_IDENTITY,
    );
    writeExclusive(resolve(argument), JSON.stringify(config, null, 2));
    return;
  }
  if (command === "manifest") {
    const mode = releaseMode();
    requireModeAcknowledgement(mode);
    const version = versionFromFiles();
    const n = names(version);
    const directory = resolve(argument);
    for (const file of [n.archive, `${n.archive}.sig`, n.dmg])
      requireThat(existsSync(resolve(directory, file)), `Missing ${file}`);
    const signature = readFileSync(resolve(directory, `${n.archive}.sig`), "utf8").trim();
    const notesPath = resolve(ROOT, `docs/release-notes-v${version}.md`);
    requireThat(existsSync(notesPath), "Release notes required");
    const manifest = buildManifest({
      version,
      signature,
      notes: readFileSync(notesPath, "utf8").slice(0, 4000),
      mode,
    });
    verifyArtifact(
      process.env.TOKEN_USAGE_UPDATER_PUBLIC_KEY,
      signature,
      version,
      readFileSync(resolve(directory, n.archive)),
    );
    writeExclusive(resolve(directory, "stable.json"), JSON.stringify(manifest, null, 2) + "\n");
    writeExclusive(resolve(directory, "release-notes.md"), manifest.notes + "\n");
    const checksums =
      [n.archive, `${n.archive}.sig`, n.dmg]
        .map(
          (name) =>
            `${createHash("sha256")
              .update(readFileSync(resolve(directory, name)))
              .digest("hex")}  ${name}`,
        )
        .join("\n") + "\n";
    writeExclusive(resolve(directory, n.checksum), checksums);
    return;
  }
  if (command === "verify-signature") {
    const manifest = validateManifest(JSON.parse(readFileSync(resolve(argument), "utf8")));
    verifyArtifact(
      process.env.TOKEN_USAGE_UPDATER_PUBLIC_KEY,
      manifest.platforms[PLATFORM].signature,
      manifest.version,
      readFileSync(resolve(artifact)),
    );
    return;
  }
  throw new Error("Unknown stable-release command");
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => {
    console.error(
      "Stable release gate failed. Check versions, required files, public key and signatures; secrets are not logged.",
    );
    process.exitCode = 1;
  });
}
