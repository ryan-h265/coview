import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { stageRuntimeDirectory } from "./whisperRuntimeUtils.mjs";

const root = process.cwd();

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

const args = parseArgs(process.argv.slice(2));
const runtimeLabel =
  normalizeOptionalString(args.label) ||
  normalizeOptionalString(process.env.COVIEW_WHISPER_RUNTIME_LABEL) ||
  `${process.platform}-${process.arch}`;
const sourceDirValue =
  normalizeOptionalString(args["source-dir"]) ||
  normalizeOptionalString(process.env.COVIEW_WHISPER_RUNTIME_SOURCE_DIR);

if (!sourceDirValue) {
  throw new Error(
    "Provide --source-dir or COVIEW_WHISPER_RUNTIME_SOURCE_DIR when packaging a runtime archive.",
  );
}

const sourceDir = resolvePath(sourceDirValue);
if (!existsSync(sourceDir)) {
  throw new Error(`Runtime source directory was not found: ${sourceDir}`);
}

const outputDir = resolvePath(
  normalizeOptionalString(args["out-dir"]) ||
    normalizeOptionalString(process.env.COVIEW_WHISPER_RUNTIME_OUT_DIR) ||
    path.join("build", "whisper-runtime-artifacts"),
);

await mkdir(outputDir, { recursive: true });

const tempDir = await mkdtemp(path.join(os.tmpdir(), "coview-package-whisper-runtime-"));
const normalizedDir = path.join(tempDir, "runtime");
const archivePath = path.join(outputDir, `whisper-runtime-${runtimeLabel}.tar.gz`);

try {
  const result = await stageRuntimeDirectory({
    sourceDir,
    targetDir: normalizedDir,
  });
  run("tar", ["-czf", archivePath, "-C", normalizedDir, "."]);
  const sha256 = await sha256ForFile(archivePath);

  console.log(
    JSON.stringify(
      {
        label: runtimeLabel,
        archivePath,
        sha256,
        fileCount: result.fileCount,
      },
      null,
      2,
    ),
  );
} finally {
  await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
}
