import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { chmod, copyFile, mkdir, readdir, rm } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const whisperRoot = path.join(root, "tools", "whisper.cpp");
const whisperBuildDir = path.join(whisperRoot, "build");
const runtimeLabel = process.env.COVIEW_WHISPER_RUNTIME_LABEL || `${process.platform}-${process.arch}`;
const runtimeDir = path.join(root, "build", "whisper-runtime", runtimeLabel);
const executableName = process.platform === "win32" ? "whisper-cli.exe" : "whisper-cli";

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

function findWhisperExecutable() {
  const candidates = [
    path.join(whisperBuildDir, "bin", executableName),
    path.join(whisperBuildDir, "bin", "Release", executableName),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

async function collectMatchingFiles(dirPath, predicate, results = []) {
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

function getLibraryMatcher() {
  if (process.platform === "linux") {
    return (name) => /^lib(?:whisper|ggml(?:-base|-cpu)?).*\.so(?:\..+)?$/.test(name);
  }
  if (process.platform === "darwin") {
    return (name) => /^lib(?:whisper|ggml(?:-base|-cpu)?).*\.dylib$/.test(name);
  }
  if (process.platform === "win32") {
    return (name) => /^(?:lib)?(?:whisper|ggml(?:-base|-cpu)?).*\.dll$/i.test(name);
  }
  return () => false;
}

function dedupeByBasename(filePaths) {
  const byBasename = new Map();
  for (const filePath of filePaths) {
    byBasename.set(path.basename(filePath), filePath);
  }
  return [...byBasename.values()];
}

function ensureWhisperBuild() {
  if (findWhisperExecutable() && !process.env.COVIEW_WHISPER_RUNTIME_ARCHS) {
    return;
  }

  console.log("[prepare-whisper-runtime] building whisper-cli");
  const configureArgs = [
    "-S",
    whisperRoot,
    "-B",
    whisperBuildDir,
    "-DCMAKE_BUILD_TYPE=Release",
    "-DWHISPER_BUILD_TESTS=OFF",
    "-DWHISPER_BUILD_SERVER=OFF",
    "-DWHISPER_BUILD_EXAMPLES=ON",
  ];
  if (process.env.COVIEW_WHISPER_RUNTIME_ARCHS) {
    configureArgs.push(
      `-DCMAKE_OSX_ARCHITECTURES=${process.env.COVIEW_WHISPER_RUNTIME_ARCHS}`,
    );
  }
  run("cmake", configureArgs);
  run("cmake", [
    "--build",
    whisperBuildDir,
    "--config",
    "Release",
    "--target",
    "whisper-cli",
  ]);

  if (!findWhisperExecutable()) {
    throw new Error("whisper-cli was not produced by the build step");
  }
}

async function stageRuntime() {
  ensureWhisperBuild();

  const executablePath = findWhisperExecutable();
  if (!executablePath) {
    throw new Error("whisper-cli executable is missing");
  }

  const libraryMatcher = getLibraryMatcher();
  const libraryFiles = dedupeByBasename(await collectMatchingFiles(whisperBuildDir, libraryMatcher));

  await rm(runtimeDir, { recursive: true, force: true });
  await mkdir(runtimeDir, { recursive: true });

  const stagedExecutablePath = path.join(runtimeDir, executableName);
  await copyFile(executablePath, stagedExecutablePath);
  if (process.platform !== "win32") {
    await chmod(stagedExecutablePath, 0o755);
  }

  for (const libraryPath of libraryFiles) {
    await copyFile(libraryPath, path.join(runtimeDir, path.basename(libraryPath)));
  }

  console.log(
    `[prepare-whisper-runtime] staged ${1 + libraryFiles.length} file(s) into ${runtimeDir}`,
  );
}

await stageRuntime();
