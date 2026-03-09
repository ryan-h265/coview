import { existsSync } from "node:fs";
import { chmod, copyFile, mkdir, readdir, rm } from "node:fs/promises";
import path from "node:path";

export function getExecutableName(platform = process.platform) {
  return platform === "win32" ? "whisper-cli.exe" : "whisper-cli";
}

export function getLibraryMatcher(platform = process.platform) {
  if (platform === "linux") {
    return (name) => /^lib(?:whisper|ggml(?:-base|-cpu)?).*\.so(?:\..+)?$/.test(name);
  }
  if (platform === "darwin") {
    return (name) => /^lib(?:whisper|ggml(?:-base|-cpu)?).*\.dylib$/.test(name);
  }
  if (platform === "win32") {
    return (name) => /^(?:lib)?(?:whisper|ggml(?:-base|-cpu)?).*\.dll$/i.test(name);
  }
  return () => false;
}

export async function collectMatchingFiles(dirPath, predicate, results = []) {
  if (!existsSync(dirPath)) {
    return results;
  }

  const entries = await readdir(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      await collectMatchingFiles(entryPath, predicate, results);
      continue;
    }
    if (predicate(entry.name)) {
      results.push(entryPath);
    }
  }

  return results;
}

export function dedupeByBasename(filePaths) {
  const byBasename = new Map();
  for (const filePath of filePaths) {
    byBasename.set(path.basename(filePath), filePath);
  }
  return [...byBasename.values()];
}

function rankExecutablePath(filePath) {
  const normalized = filePath.replace(/\\/g, "/").toLowerCase();
  if (normalized.includes("/bin/release/")) {
    return 0;
  }
  if (normalized.includes("/bin/")) {
    return 1;
  }
  if (normalized.includes("/release/")) {
    return 2;
  }
  return 3;
}

export async function findRuntimeExecutable(sourceDir, platform = process.platform) {
  const executableName = getExecutableName(platform);
  const candidates = await collectMatchingFiles(sourceDir, (name) => name === executableName);
  if (candidates.length === 0) {
    throw new Error(`Could not find ${executableName} under ${sourceDir}`);
  }

  candidates.sort((left, right) => {
    const rankDelta = rankExecutablePath(left) - rankExecutablePath(right);
    if (rankDelta !== 0) {
      return rankDelta;
    }
    return left.localeCompare(right);
  });

  return candidates[0];
}

export async function stageRuntimeDirectory({
  sourceDir,
  targetDir,
  platform = process.platform,
}) {
  if (!existsSync(sourceDir)) {
    throw new Error(`Runtime source directory was not found: ${sourceDir}`);
  }

  const executableName = getExecutableName(platform);
  const executablePath = await findRuntimeExecutable(sourceDir, platform);
  const libraryFiles = dedupeByBasename(
    await collectMatchingFiles(sourceDir, getLibraryMatcher(platform)),
  );

  await rm(targetDir, { recursive: true, force: true });
  await mkdir(targetDir, { recursive: true });

  const stagedExecutablePath = path.join(targetDir, executableName);
  await copyFile(executablePath, stagedExecutablePath);
  if (platform !== "win32") {
    await chmod(stagedExecutablePath, 0o755);
  }

  for (const libraryPath of libraryFiles) {
    await copyFile(libraryPath, path.join(targetDir, path.basename(libraryPath)));
  }

  return {
    executablePath: stagedExecutablePath,
    fileCount: 1 + libraryFiles.length,
    libraryFiles: libraryFiles.map((filePath) => path.basename(filePath)),
  };
}
