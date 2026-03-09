import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  cleanupLibraryDirectory,
  copyLibraryContents,
  ensureLibraryManifest,
  getLibraryManifestPath,
  isDirectoryEmpty,
  verifyLibraryCopy,
} from "../../src/libraryStorage";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dirPath) => rm(dirPath, { recursive: true, force: true })));
});

describe("library storage migration helpers", () => {
  it("repairs an unreadable library manifest", async () => {
    const libraryDir = await mkdtemp(path.join(os.tmpdir(), "coview-library-manifest-"));
    tempDirs.push(libraryDir);

    const manifestPath = getLibraryManifestPath(libraryDir);
    await writeFile(manifestPath, "{not-json", "utf8");

    const manifest = await ensureLibraryManifest(libraryDir);
    const storedManifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
      version: number;
      libraryId: string;
      createdAt: string;
      updatedAt: string;
    };

    expect(storedManifest).toEqual(manifest);
    expect(manifest.version).toBe(1);
    expect(manifest.libraryId).toHaveLength(26);
    expect(manifest.createdAt).toBeTruthy();
    expect(manifest.updatedAt).toBeTruthy();
  });

  it("reuses a valid manifest and treats missing directories as empty", async () => {
    const libraryDir = await mkdtemp(path.join(os.tmpdir(), "coview-library-manifest-"));
    tempDirs.push(libraryDir);

    const manifestPath = getLibraryManifestPath(libraryDir);
    await writeFile(
      manifestPath,
      JSON.stringify({
        version: 2,
        libraryId: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
        createdAt: "2026-03-09T09:00:00.000Z",
        updatedAt: "2026-03-09T09:30:00.000Z",
      }),
      "utf8",
    );

    expect(await ensureLibraryManifest(libraryDir)).toEqual({
      version: 2,
      libraryId: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
      createdAt: "2026-03-09T09:00:00.000Z",
      updatedAt: "2026-03-09T09:30:00.000Z",
    });
    expect(await isDirectoryEmpty(path.join(libraryDir, "missing"))).toBe(true);
  });

  it("copies and verifies a flat-file library", async () => {
    const sourceDir = await mkdtemp(path.join(os.tmpdir(), "coview-library-source-"));
    const targetDir = await mkdtemp(path.join(os.tmpdir(), "coview-library-target-"));
    tempDirs.push(sourceDir, targetDir);

    await ensureLibraryManifest(sourceDir);
    await writeFile(path.join(sourceDir, "session.json"), JSON.stringify({ id: "session-1" }), "utf8");
    await writeFile(path.join(sourceDir, "session.webm"), Buffer.alloc(256, 3));
    await mkdir(path.join(sourceDir, "exports"), { recursive: true });
    await writeFile(path.join(sourceDir, "exports", "session.md"), "# session\n", "utf8");

    const copyResult = await copyLibraryContents(sourceDir, targetDir);
    expect(copyResult.copiedEntries).toBeGreaterThan(0);

    const verification = await verifyLibraryCopy(sourceDir, targetDir);
    expect(verification.expectedFiles).toBe(4);
    expect(verification.verifiedFiles).toBe(4);
    expect(verification.mismatchedFiles).toEqual([]);
  });

  it("reports mismatched copied files", async () => {
    const sourceDir = await mkdtemp(path.join(os.tmpdir(), "coview-library-source-"));
    const targetDir = await mkdtemp(path.join(os.tmpdir(), "coview-library-target-"));
    tempDirs.push(sourceDir, targetDir);

    await ensureLibraryManifest(sourceDir);
    await writeFile(path.join(sourceDir, "session.webm"), Buffer.alloc(256, 3));

    await copyLibraryContents(sourceDir, targetDir);
    await writeFile(path.join(targetDir, "session.webm"), Buffer.alloc(12, 9));

    const verification = await verifyLibraryCopy(sourceDir, targetDir);
    expect(verification.expectedFiles).toBe(2);
    expect(verification.verifiedFiles).toBe(1);
    expect(verification.mismatchedFiles).toEqual(["session.webm"]);
  });

  it("reports empty directories and cleans them up", async () => {
    const libraryDir = await mkdtemp(path.join(os.tmpdir(), "coview-library-empty-"));
    tempDirs.push(libraryDir);

    expect(await isDirectoryEmpty(libraryDir)).toBe(true);
    await writeFile(path.join(libraryDir, "session.json"), "{}", "utf8");
    expect(await isDirectoryEmpty(libraryDir)).toBe(false);

    await cleanupLibraryDirectory(libraryDir);
    expect(existsSync(libraryDir)).toBe(false);
  });
});
