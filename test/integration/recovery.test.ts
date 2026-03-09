import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  EMPTY_CAPTURE_MAX_BYTES,
  EMPTY_CAPTURE_MAX_DURATION_MS,
  appendInProgressRecordingChunk,
  createInProgressRecordingSession,
  discardInProgressRecordingSession,
  finalizeInProgressRecordingSession,
  getRecoverableRecordingSession,
  getInProgressRecordingDir,
  getInProgressRecordingManifestPath,
  isMeaningfulCapture,
  listRecoverableRecordingSessions,
  readInProgressRecordingManifest,
} from "../../src/recordingSessions";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dirPath) => rm(dirPath, { recursive: true, force: true })));
});

describe("recording session recovery", () => {
  it("recovers orphaned media files even when the manifest is unreadable", async () => {
    const storageDir = await mkdtemp(path.join(os.tmpdir(), "coview-recovery-"));
    tempDirs.push(storageDir);

    const recordingDir = getInProgressRecordingDir(storageDir, "legacy-recording");
    await mkdir(recordingDir, { recursive: true });
    await writeFile(path.join(recordingDir, "recording-session.json"), "{broken", "utf8");
    await writeFile(path.join(recordingDir, "recording.m4a"), Buffer.alloc(32, 5));

    const recoverableSessions = await listRecoverableRecordingSessions(storageDir);
    expect(recoverableSessions).toHaveLength(1);
    expect(recoverableSessions[0].manifest).toBeNull();
    expect(recoverableSessions[0].mediaFilename).toBe("recording.m4a");
    expect(recoverableSessions[0].byteLength).toBe(32);
    expect(recoverableSessions[0].aiProcessingEnabled).toBe(true);
    expect(recoverableSessions[0].metadata).toEqual({});
  });

  it("lists and finalizes a recoverable in-progress recording session", async () => {
    const storageDir = await mkdtemp(path.join(os.tmpdir(), "coview-recovery-"));
    tempDirs.push(storageDir);

    await createInProgressRecordingSession({
      storageDir,
      recordingId: "recording-1",
      mimeType: "video/webm",
      startedAt: "2026-03-07T10:00:00.000Z",
      aiProcessingEnabled: true,
      metadata: {
        title: "Recovery Session",
        sourceName: "Slack Huddle",
      },
    });
    await appendInProgressRecordingChunk({
      storageDir,
      recordingId: "recording-1",
      data: Buffer.alloc(EMPTY_CAPTURE_MAX_BYTES + 1, 7),
    });

    const recoverableSessions = await listRecoverableRecordingSessions(storageDir);
    expect(recoverableSessions).toHaveLength(1);
    expect(recoverableSessions[0].byteLength).toBe(EMPTY_CAPTURE_MAX_BYTES + 1);
    expect(isMeaningfulCapture({ byteLength: recoverableSessions[0].byteLength, durationMs: 1000 })).toBe(true);

    const finalized = await finalizeInProgressRecordingSession({
      storageDir,
      recordingId: "recording-1",
      mediaFilename: "2026-03-07_100000_Recovery_Session_ABC12345.webm",
      metadataFilename: "2026-03-07_100000_Recovery_Session_ABC12345.json",
      finalMetadata: {
        id: "01JSESSIONRECOVERY",
        title: "Recovery Session",
        mediaFilename: "2026-03-07_100000_Recovery_Session_ABC12345.webm",
      },
    });

    expect(finalized.bytesWritten).toBe(EMPTY_CAPTURE_MAX_BYTES + 1);
    expect(existsSync(finalized.mediaPath)).toBe(true);
    expect(existsSync(finalized.metadataPath)).toBe(true);
    expect(existsSync(getInProgressRecordingDir(storageDir, "recording-1"))).toBe(false);

    const metadata = JSON.parse(await readFile(finalized.metadataPath, "utf8")) as {
      id: string;
      title: string;
    };
    expect(metadata.id).toBe("01JSESSIONRECOVERY");
    expect(metadata.title).toBe("Recovery Session");
  });

  it("supports typed-array appends and reads partial manifest defaults", async () => {
    const storageDir = await mkdtemp(path.join(os.tmpdir(), "coview-recovery-"));
    tempDirs.push(storageDir);

    await createInProgressRecordingSession({
      storageDir,
      recordingId: "recording-typed",
      mimeType: "audio/mp4",
      startedAt: "2026-03-07T12:00:00.000Z",
      aiProcessingEnabled: false,
      metadata: {},
    });

    const firstAppend = await appendInProgressRecordingChunk({
      storageDir,
      recordingId: "recording-typed",
      data: new Uint8Array([1, 2, 3, 4]),
      receivedAt: "2026-03-07T12:00:01.000Z",
    });
    const secondAppend = await appendInProgressRecordingChunk({
      storageDir,
      recordingId: "recording-typed",
      data: new Uint8Array([5, 6]).buffer,
      receivedAt: "2026-03-07T12:00:02.000Z",
    });

    expect(firstAppend.byteLength).toBe(4);
    expect(secondAppend.byteLength).toBe(6);
    expect(secondAppend.chunkCount).toBe(2);

    const legacyRecordingDir = getInProgressRecordingDir(storageDir, "legacy-ordered");
    await mkdir(legacyRecordingDir, { recursive: true });
    await writeFile(
      getInProgressRecordingManifestPath(storageDir, "legacy-ordered"),
      JSON.stringify({
        id: "legacy-ordered",
        mediaFilename: "preferred.webm",
      }),
      "utf8",
    );
    await writeFile(path.join(legacyRecordingDir, "alternate.webm"), Buffer.alloc(1, 7));
    await writeFile(path.join(legacyRecordingDir, "preferred.webm"), Buffer.alloc(2, 8));

    const legacyManifest = await readInProgressRecordingManifest(storageDir, "legacy-ordered");
    expect(legacyManifest?.mimeType).toBe("video/webm");
    expect(legacyManifest?.state).toBe("recording");
    expect(legacyManifest?.aiProcessingEnabled).toBe(true);
    expect(legacyManifest?.metadata).toEqual({});

    const recoverable = await getRecoverableRecordingSession(storageDir, "legacy-ordered");
    expect(recoverable?.mediaFilename).toBe("preferred.webm");
    expect(recoverable?.byteLength).toBe(2);
  });

  it("rejects appends to missing or cancelled recording sessions", async () => {
    const storageDir = await mkdtemp(path.join(os.tmpdir(), "coview-recovery-"));
    tempDirs.push(storageDir);

    await expect(
      appendInProgressRecordingChunk({
        storageDir,
        recordingId: "missing-recording",
        data: Buffer.alloc(8, 1),
      }),
    ).rejects.toThrow("In-progress recording session was not found.");

    await createInProgressRecordingSession({
      storageDir,
      recordingId: "recording-2",
      mimeType: "video/webm",
      startedAt: "2026-03-07T11:00:00.000Z",
      aiProcessingEnabled: false,
      metadata: {},
    });

    const manifestPath = getInProgressRecordingManifestPath(storageDir, "recording-2");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Record<string, unknown>;
    await writeFile(
      manifestPath,
      JSON.stringify({
        ...manifest,
        state: "cancelled",
      }),
      "utf8",
    );

    await expect(
      appendInProgressRecordingChunk({
        storageDir,
        recordingId: "recording-2",
        data: Buffer.alloc(8, 2),
      }),
    ).rejects.toThrow("Cannot append to an inactive recording session.");
  });

  it("can discard sessions and rejects finalization when media is missing", async () => {
    const storageDir = await mkdtemp(path.join(os.tmpdir(), "coview-recovery-"));
    tempDirs.push(storageDir);

    await createInProgressRecordingSession({
      storageDir,
      recordingId: "recording-discard",
      mimeType: "video/webm",
      startedAt: "2026-03-07T13:00:00.000Z",
      aiProcessingEnabled: true,
      metadata: {},
    });
    await discardInProgressRecordingSession(storageDir, "recording-discard");

    expect(await getRecoverableRecordingSession(storageDir, "recording-discard")).toBeNull();
    await expect(
      finalizeInProgressRecordingSession({
        storageDir,
        recordingId: "recording-discard",
        mediaFilename: "discarded.webm",
        metadataFilename: "discarded.json",
        finalMetadata: {},
      }),
    ).rejects.toThrow("In-progress recording media was not found.");

    expect(isMeaningfulCapture({ byteLength: 0, durationMs: EMPTY_CAPTURE_MAX_DURATION_MS + 10 })).toBe(
      false,
    );
  });

  it("drops obviously empty captures by policy", () => {
    expect(
      isMeaningfulCapture({
        byteLength: EMPTY_CAPTURE_MAX_BYTES,
        durationMs: EMPTY_CAPTURE_MAX_DURATION_MS,
      }),
    ).toBe(false);
    expect(
      isMeaningfulCapture({
        byteLength: EMPTY_CAPTURE_MAX_BYTES + 1,
        durationMs: 1000,
      }),
    ).toBe(true);
    expect(
      isMeaningfulCapture({
        byteLength: 64,
        durationMs: EMPTY_CAPTURE_MAX_DURATION_MS + 1,
      }),
    ).toBe(true);
  });
});
