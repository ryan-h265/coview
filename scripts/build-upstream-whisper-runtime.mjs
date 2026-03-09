import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { stageRuntimeDirectory } from "./whisperRuntimeUtils.mjs";

const root = process.cwd();
const DEFAULT_UPSTREAM_VERSION = "v1.8.3";

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) {
      continue;
    }

    const [key, inlineValue] = arg.slice(2).split("=", 2);
    if (inlineValue) {
      parsed[key] = inlineValue;
      continue;
    }

    const next = argv[index + 1];
    if (typeof next === "string" && !next.startsWith("--")) {
      parsed[key] = next;
      index += 1;
      continue;
    }

    parsed[key] = "true";
  }
  return parsed;
}

function normalizeOptionalString(value) {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function resolvePath(value) {
  return path.isAbsolute(value) ? value : path.join(root, value);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? root,
    stdio: "inherit",
    env: options.env ?? process.env,
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`${command} exited with status ${result.status ?? "unknown"}`);
  }
}

async function download(url, destinationPath) {
  console.log(`[build-upstream-whisper-runtime] downloading ${url}`);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download ${url}: ${response.status} ${response.statusText}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  await writeFile(destinationPath, Buffer.from(arrayBuffer));
}

function inferRuntimeLabel() {
  if (process.platform === "darwin" && process.arch === "arm64") {
    return "darwin-arm64";
  }
  if (process.platform === "linux" && process.arch === "x64") {
    return "linux-x64";
  }
  return `${process.platform}-${process.arch}`;
}

function getCmakeConfigureArgs(sourceDir, buildDir, runtimeLabel) {
  const args = [
    "-S",
    sourceDir,
    "-B",
    buildDir,
    "-DCMAKE_BUILD_TYPE=Release",
    "-DBUILD_SHARED_LIBS=ON",
    "-DWHISPER_BUILD_TESTS=OFF",
    "-DWHISPER_BUILD_SERVER=OFF",
    "-DWHISPER_BUILD_EXAMPLES=ON",
    "-DWHISPER_SDL2=OFF",
    "-DWHISPER_CURL=OFF",
  ];

  if (runtimeLabel === "darwin-universal") {
    args.push("-DCMAKE_OSX_ARCHITECTURES=arm64;x86_64");
  }

  return args;
}

const args = parseArgs(process.argv.slice(2));
const runtimeLabel =
  normalizeOptionalString(args.label) ||
  normalizeOptionalString(process.env.COVIEW_WHISPER_RUNTIME_LABEL) ||
  inferRuntimeLabel();
const outputDir = resolvePath(
  normalizeOptionalString(args["out-dir"]) ||
    normalizeOptionalString(process.env.COVIEW_WHISPER_RUNTIME_OUT_DIR) ||
    path.join("build", "whisper-runtime", runtimeLabel),
);
const sourceArchiveUrl =
  normalizeOptionalString(args.url) ||
  normalizeOptionalString(process.env.COVIEW_WHISPER_CPP_SOURCE_URL) ||
  `https://codeload.github.com/ggml-org/whisper.cpp/tar.gz/refs/tags/${
    normalizeOptionalString(args.version) ||
    normalizeOptionalString(process.env.COVIEW_WHISPER_CPP_VERSION) ||
    DEFAULT_UPSTREAM_VERSION
  }`;

const tempDir = await mkdtemp(path.join(os.tmpdir(), "coview-upstream-whisper-runtime-"));

try {
  const archivePath = path.join(tempDir, "whisper.cpp.tar.gz");
  const extractDir = path.join(tempDir, "source");
  await download(sourceArchiveUrl, archivePath);
  run("tar", ["-xzf", archivePath, "-C", tempDir]);

  const extractedEntries = spawnSync("find", [tempDir, "-maxdepth", "1", "-mindepth", "1", "-type", "d"], {
    encoding: "utf8",
  });
  if (extractedEntries.status !== 0) {
    throw new Error("Failed to inspect extracted whisper.cpp source directory");
  }

  const sourceDir = extractedEntries.stdout
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .find((entry) => path.basename(entry).startsWith("whisper.cpp-"));

  if (!sourceDir || !existsSync(sourceDir)) {
    throw new Error("Could not locate extracted whisper.cpp source directory");
  }

  const buildDir = path.join(tempDir, "build");
  run("cmake", getCmakeConfigureArgs(sourceDir, buildDir, runtimeLabel));
  run("cmake", ["--build", buildDir, "--config", "Release", "--target", "whisper-cli"]);

  const result = await stageRuntimeDirectory({
    sourceDir: buildDir,
    targetDir: outputDir,
  });

  console.log(
    JSON.stringify(
      {
        runtimeLabel,
        outputDir,
        sourceArchiveUrl,
        fileCount: result.fileCount,
      },
      null,
      2,
    ),
  );
} finally {
  await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
}
