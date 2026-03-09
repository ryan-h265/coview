import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { stageRuntimeDirectory } from "./whisperRuntimeUtils.mjs";

const root = process.cwd();
const runtimeLabel =
  process.env.COVIEW_WHISPER_RUNTIME_LABEL || `${process.platform}-${process.arch}`;
const runtimeDir = path.join(root, "build", "whisper-runtime", runtimeLabel);

function log(message) {
  console.log(`[prepare-whisper-runtime] ${message}`);
}

function resolvePath(value) {
  return path.isAbsolute(value) ? value : path.join(root, value);
}

function normalizeOptionalString(value) {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function isHttpUrl(value) {
  return /^https?:\/\//i.test(value);
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: "inherit",
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`${command} exited with status ${result.status ?? "unknown"}`);
  }
}

async function sha256ForFile(filePath) {
  const hash = createHash("sha256");
  hash.update(await readFile(filePath));
  return hash.digest("hex");
}

async function verifyArchiveHash(filePath, expectedHash) {
  if (!expectedHash) {
    return;
  }

  const actualHash = await sha256ForFile(filePath);
  if (actualHash !== expectedHash.toLowerCase()) {
    throw new Error(
      `Runtime archive hash mismatch for ${filePath}. Expected ${expectedHash}, got ${actualHash}.`,
    );
  }
}

async function maybeReadManifest() {
  const configuredPath = normalizeOptionalString(process.env.COVIEW_WHISPER_RUNTIME_MANIFEST);
  const manifestPath = configuredPath
    ? resolvePath(configuredPath)
    : path.join(root, "whisper-runtime.manifest.json");

  if (!existsSync(manifestPath)) {
    return null;
  }

  const parsed = JSON.parse(await readFile(manifestPath, "utf8"));
  const runtimes =
    parsed && typeof parsed === "object" && parsed.runtimes && typeof parsed.runtimes === "object"
      ? parsed.runtimes
      : {};

  return {
    path: manifestPath,
    runtimes,
  };
}

async function resolveRuntimeSource() {
  const runtimeDirOverride = normalizeOptionalString(process.env.COVIEW_WHISPER_RUNTIME_DIR);
  if (runtimeDirOverride) {
    const directory = resolvePath(runtimeDirOverride);
    return {
      kind: "directory",
      directory,
      description: `directory ${directory}`,
    };
  }

  const archiveOverride = normalizeOptionalString(process.env.COVIEW_WHISPER_RUNTIME_ARCHIVE);
  if (archiveOverride) {
    return {
      kind: "archive",
      archiveLocation: archiveOverride,
      sha256: normalizeOptionalString(process.env.COVIEW_WHISPER_RUNTIME_SHA256)?.toLowerCase(),
      description: `archive ${archiveOverride}`,
    };
  }

  const manifest = await maybeReadManifest();
  if (!manifest) {
    throw new Error(
      [
        `No prebuilt whisper runtime is configured for ${runtimeLabel}.`,
        "Set one of these before running prepare:whisper-runtime:",
        "- COVIEW_WHISPER_RUNTIME_DIR=/path/to/runtime-directory",
        "- COVIEW_WHISPER_RUNTIME_ARCHIVE=/path/or/url/to/runtime.tar.gz",
        "- COVIEW_WHISPER_RUNTIME_MANIFEST=/path/to/whisper-runtime.manifest.json",
      ].join("\n"),
    );
  }

  const entry =
    manifest.runtimes && typeof manifest.runtimes === "object"
      ? manifest.runtimes[runtimeLabel]
      : undefined;
  if (!entry || typeof entry !== "object") {
    throw new Error(
      `No runtime entry for ${runtimeLabel} was found in ${manifest.path}.`,
    );
  }

  const directory = normalizeOptionalString(entry.directory);
  if (directory) {
    const resolvedDirectory = resolvePath(directory);
    return {
      kind: "directory",
      directory: resolvedDirectory,
      description: `directory ${resolvedDirectory} from ${manifest.path}`,
    };
  }

  const archivePath = normalizeOptionalString(entry.archivePath);
  if (archivePath) {
    const resolvedArchivePath = resolvePath(archivePath);
    return {
      kind: "archive",
      archiveLocation: resolvedArchivePath,
      sha256: normalizeOptionalString(entry.sha256)?.toLowerCase(),
      description: `archive ${resolvedArchivePath} from ${manifest.path}`,
    };
  }

  const url = normalizeOptionalString(entry.url);
  if (url) {
    return {
      kind: "archive",
      archiveLocation: url,
      sha256: normalizeOptionalString(entry.sha256)?.toLowerCase(),
      description: `archive ${url} from ${manifest.path}`,
    };
  }

  throw new Error(
    `Runtime entry for ${runtimeLabel} in ${manifest.path} must define directory, archivePath, or url.`,
  );
}

async function downloadArchive(url, destinationPath) {
  log(`downloading ${url}`);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download ${url}: ${response.status} ${response.statusText}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  await writeFile(destinationPath, Buffer.from(arrayBuffer));
}

async function prepareArchiveSource(archiveLocation, tempDir) {
  if (isHttpUrl(archiveLocation)) {
    const downloadedArchivePath = path.join(tempDir, "runtime.tar.gz");
    await downloadArchive(archiveLocation, downloadedArchivePath);
    return downloadedArchivePath;
  }

  const resolvedArchivePath = resolvePath(archiveLocation);
  if (!existsSync(resolvedArchivePath)) {
    throw new Error(`Runtime archive was not found: ${resolvedArchivePath}`);
  }
  return resolvedArchivePath;
}

async function stageArchive(archivePath, tempDir) {
  const extractedDir = path.join(tempDir, "archive");
  await rm(extractedDir, { recursive: true, force: true });
  run("tar", ["-xzf", archivePath, "-C", tempDir]);

  const candidateDir = existsSync(extractedDir)
    ? extractedDir
    : tempDir;
  return stageRuntimeDirectory({
    sourceDir: candidateDir,
    targetDir: runtimeDir,
  });
}

async function main() {
  const source = await resolveRuntimeSource();
  log(`staging ${runtimeLabel} from ${source.description}`);

  if (source.kind === "directory") {
    const result = await stageRuntimeDirectory({
      sourceDir: source.directory,
      targetDir: runtimeDir,
    });
    log(`staged ${result.fileCount} file(s) into ${runtimeDir}`);
    return;
  }

  const tempDir = await mkdtemp(path.join(os.tmpdir(), "coview-whisper-runtime-"));
  try {
    const archivePath = await prepareArchiveSource(source.archiveLocation, tempDir);
    await verifyArchiveHash(archivePath, source.sha256);
    const result = await stageArchive(archivePath, tempDir);
    log(`staged ${result.fileCount} file(s) into ${runtimeDir}`);
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

await main();
