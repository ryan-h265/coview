import { existsSync } from "node:fs";
import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { createMonotonicUlid } from "./ulid";

export const LIBRARY_MANIFEST_FILENAME = "library.json";

export interface LibraryManifest {
  version: number;
  libraryId: string;
  createdAt: string;
  updatedAt: string;
}

export interface LibraryCopyVerification {
  expectedFiles: number;
  verifiedFiles: number;
  mismatchedFiles: string[];
}

function nowIso(): string {
  return new Date().toISOString();
}

function safeReadJsonObject(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return {};
  }
  return {};
}

export function getLibraryManifestPath(storageDir: string): string {
  return path.join(storageDir, LIBRARY_MANIFEST_FILENAME);
}

export async function ensureLibraryManifest(storageDir: string): Promise<LibraryManifest> {
  await mkdir(storageDir, { recursive: true });
  const manifestPath = getLibraryManifestPath(storageDir);
  if (existsSync(manifestPath)) {
    try {
      const raw = await readFile(manifestPath, "utf8");
      const parsed = safeReadJsonObject(raw);
      if (
        typeof parsed.libraryId === "string" &&
        typeof parsed.createdAt === "string" &&
        typeof parsed.updatedAt === "string"
      ) {
        return {
          version: typeof parsed.version === "number" ? parsed.version : 1,
          libraryId: parsed.libraryId,
          createdAt: parsed.createdAt,
          updatedAt: parsed.updatedAt,
        };
      }
    } catch {
      // Fall through to rewrite the manifest
    }
  }

  const timestamp = nowIso();
  const manifest: LibraryManifest = {
    version: 1,
    libraryId: createMonotonicUlid(),
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
  return manifest;
}

export async function isDirectoryEmpty(directoryPath: string): Promise<boolean> {
  if (!existsSync(directoryPath)) {
    return true;
  }
  const entries = await readdir(directoryPath);
  return entries.length === 0;
}

async function collectLibraryFiles(
  storageDir: string,
  currentDir = storageDir,
): Promise<Array<{ relativePath: string; size: number }>> {
  const entries = await readdir(currentDir, { withFileTypes: true });
  const files: Array<{ relativePath: string; size: number }> = [];

  for (const entry of entries) {
    const absolutePath = path.join(currentDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectLibraryFiles(storageDir, absolutePath)));
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }
    const fileStats = await stat(absolutePath);
    files.push({
      relativePath: path.relative(storageDir, absolutePath),
      size: fileStats.size,
    });
  }

  files.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
  return files;
}

export async function copyLibraryContents(
  sourceDir: string,
  targetDir: string,
): Promise<{ copiedEntries: number }> {
  await mkdir(targetDir, { recursive: true });
  const entries = await readdir(sourceDir, { withFileTypes: true });
  for (const entry of entries) {
    await cp(path.join(sourceDir, entry.name), path.join(targetDir, entry.name), {
      recursive: true,
      force: false,
      errorOnExist: true,
    });
  }
  return { copiedEntries: entries.length };
}

export async function verifyLibraryCopy(
  sourceDir: string,
  targetDir: string,
): Promise<LibraryCopyVerification> {
  const sourceFiles = await collectLibraryFiles(sourceDir);
  const targetFiles = await collectLibraryFiles(targetDir);
  const targetMap = new Map(targetFiles.map((entry) => [entry.relativePath, entry.size]));
  const mismatchedFiles: string[] = [];

  for (const sourceFile of sourceFiles) {
    const targetSize = targetMap.get(sourceFile.relativePath);
    if (typeof targetSize !== "number" || targetSize !== sourceFile.size) {
      mismatchedFiles.push(sourceFile.relativePath);
    }
  }

  return {
    expectedFiles: sourceFiles.length,
    verifiedFiles: sourceFiles.length - mismatchedFiles.length,
    mismatchedFiles,
  };
}

export async function cleanupLibraryDirectory(storageDir: string): Promise<void> {
  await rm(storageDir, { recursive: true, force: true });
}
