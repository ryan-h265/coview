import { existsSync } from "node:fs";
import { appendFile, mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

export const IN_PROGRESS_RECORDINGS_DIRNAME = ".tmp-recordings";
export const IN_PROGRESS_RECORDING_MANIFEST = "recording-session.json";
export const EMPTY_CAPTURE_MAX_DURATION_MS = 2_000;
export const EMPTY_CAPTURE_MAX_BYTES = 128 * 1024;

export type InProgressRecordingState = "recording" | "cancelled";

export interface RecordingSessionManifest {
  id: string;
  createdAt: string;
  updatedAt: string;
  startedAt: string;
  state: InProgressRecordingState;
  mimeType: string;
  mediaFilename: string;
  byteLength: number;
  chunkCount: number;
  aiProcessingEnabled: boolean;
  metadata: Record<string, unknown>;
}

export interface RecoverableRecordingSession {
  id: string;
  dirPath: string;
  manifest: RecordingSessionManifest | null;
  mediaPath: string | null;
  mediaFilename: string | null;
  byteLength: number;
  chunkCount: number;
  startedAt: string;
  updatedAt: string;
  aiProcessingEnabled: boolean;
  metadata: Record<string, unknown>;
}

export interface CreateInProgressRecordingSessionParams {
  storageDir: string;
  recordingId: string;
  mimeType: string;
  startedAt: string;
  aiProcessingEnabled: boolean;
  metadata: Record<string, unknown>;
  createdAt?: string;
}

export interface FinalizeInProgressRecordingSessionParams {
  storageDir: string;
  recordingId: string;
  mediaFilename: string;
  metadataFilename: string;
  finalMetadata: Record<string, unknown>;
}

export interface FinalizedRecordingSessionResult {
  mediaPath: string;
  metadataPath: string;
  bytesWritten: number;
  chunkCount: number;
}

function nowIso(): string {
  return new Date().toISOString();
}

function getExtensionForMimeType(mimeType: string): string {
  if (mimeType.includes("webm")) {
    return "webm";
  }
  if (mimeType.includes("mp4")) {
    return "mp4";
  }
  if (mimeType.includes("wav")) {
    return "wav";
  }
  if (mimeType.includes("audio/mp4") || mimeType.includes("m4a")) {
    return "m4a";
  }
  return "bin";
}

function inferMimeTypeFromFilename(filename: string): string {
  const extension = path.extname(filename).toLowerCase();
  if (extension === ".webm") {
    return "video/webm";
  }
  if (extension === ".mp4") {
    return "video/mp4";
  }
  if (extension === ".wav") {
    return "audio/wav";
  }
  if (extension === ".m4a") {
    return "audio/mp4";
  }
  return "application/octet-stream";
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

function toManifest(value: Record<string, unknown>): RecordingSessionManifest | null {
  if (typeof value.id !== "string" || typeof value.mediaFilename !== "string") {
    return null;
  }

  return {
    id: value.id,
    createdAt: typeof value.createdAt === "string" ? value.createdAt : nowIso(),
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : nowIso(),
    startedAt: typeof value.startedAt === "string" ? value.startedAt : nowIso(),
    state: value.state === "cancelled" ? "cancelled" : "recording",
    mimeType: typeof value.mimeType === "string" ? value.mimeType : inferMimeTypeFromFilename(value.mediaFilename),
    mediaFilename: value.mediaFilename,
    byteLength: typeof value.byteLength === "number" ? value.byteLength : 0,
    chunkCount: typeof value.chunkCount === "number" ? value.chunkCount : 0,
    aiProcessingEnabled: value.aiProcessingEnabled !== false,
    metadata:
      value.metadata && typeof value.metadata === "object" && !Array.isArray(value.metadata)
        ? (value.metadata as Record<string, unknown>)
        : {},
  };
}

function toBuffer(data: ArrayBuffer | Uint8Array | Buffer): Buffer {
  if (Buffer.isBuffer(data)) {
    return data;
  }
  if (data instanceof ArrayBuffer) {
    return Buffer.from(data);
  }
  return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
}

export function getInProgressRecordingsDir(storageDir: string): string {
  return path.join(storageDir, IN_PROGRESS_RECORDINGS_DIRNAME);
}

export function getInProgressRecordingDir(storageDir: string, recordingId: string): string {
  return path.join(getInProgressRecordingsDir(storageDir), recordingId);
}

export function getInProgressRecordingManifestPath(storageDir: string, recordingId: string): string {
  return path.join(getInProgressRecordingDir(storageDir, recordingId), IN_PROGRESS_RECORDING_MANIFEST);
}

async function writeManifest(storageDir: string, recordingId: string, manifest: RecordingSessionManifest): Promise<void> {
  const manifestPath = getInProgressRecordingManifestPath(storageDir, recordingId);
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
}

export async function getRecoverableRecordingSession(
  storageDir: string,
  recordingId: string,
): Promise<RecoverableRecordingSession | null> {
  const sessions = await listRecoverableRecordingSessions(storageDir);
  return sessions.find((session) => session.id === recordingId) ?? null;
}

export async function readInProgressRecordingManifest(
  storageDir: string,
  recordingId: string,
): Promise<RecordingSessionManifest | null> {
  const manifestPath = getInProgressRecordingManifestPath(storageDir, recordingId);
  if (!existsSync(manifestPath)) {
    return null;
  }

  try {
    const raw = await readFile(manifestPath, "utf8");
    return toManifest(safeReadJsonObject(raw));
  } catch {
    return null;
  }
}

export async function createInProgressRecordingSession(
  params: CreateInProgressRecordingSessionParams,
): Promise<RecordingSessionManifest> {
  const dirPath = getInProgressRecordingDir(params.storageDir, params.recordingId);
  await mkdir(dirPath, { recursive: true });

  const extension = getExtensionForMimeType(params.mimeType);
  const mediaFilename = `recording.${extension}`;
  const mediaPath = path.join(dirPath, mediaFilename);
  const createdAt = params.createdAt ?? nowIso();

  await writeFile(mediaPath, Buffer.alloc(0));

  const manifest: RecordingSessionManifest = {
    id: params.recordingId,
    createdAt,
    updatedAt: createdAt,
    startedAt: params.startedAt,
    state: "recording",
    mimeType: params.mimeType,
    mediaFilename,
    byteLength: 0,
    chunkCount: 0,
    aiProcessingEnabled: params.aiProcessingEnabled,
    metadata: params.metadata,
  };

  await writeManifest(params.storageDir, params.recordingId, manifest);
  return manifest;
}

export async function appendInProgressRecordingChunk(params: {
  storageDir: string;
  recordingId: string;
  data: ArrayBuffer | Uint8Array | Buffer;
  receivedAt?: string;
}): Promise<RecordingSessionManifest> {
  const manifest = await readInProgressRecordingManifest(params.storageDir, params.recordingId);
  if (!manifest) {
    throw new Error("In-progress recording session was not found.");
  }

  if (manifest.state !== "recording") {
    throw new Error("Cannot append to an inactive recording session.");
  }

  const buffer = toBuffer(params.data);
  const mediaPath = path.join(
    getInProgressRecordingDir(params.storageDir, params.recordingId),
    manifest.mediaFilename,
  );

  await appendFile(mediaPath, buffer);

  manifest.byteLength += buffer.byteLength;
  manifest.chunkCount += 1;
  manifest.updatedAt = params.receivedAt ?? nowIso();
  await writeManifest(params.storageDir, params.recordingId, manifest);
  return manifest;
}

export async function discardInProgressRecordingSession(storageDir: string, recordingId: string): Promise<void> {
  const dirPath = getInProgressRecordingDir(storageDir, recordingId);
  await rm(dirPath, { recursive: true, force: true });
}

export async function listRecoverableRecordingSessions(
  storageDir: string,
): Promise<RecoverableRecordingSession[]> {
  const rootDir = getInProgressRecordingsDir(storageDir);
  if (!existsSync(rootDir)) {
    return [];
  }

  const entries = await readdir(rootDir, { withFileTypes: true });
  const sessions: RecoverableRecordingSession[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const recordingId = entry.name;
    const dirPath = getInProgressRecordingDir(storageDir, recordingId);
    const manifest = await readInProgressRecordingManifest(storageDir, recordingId);
    const dirEntries = await readdir(dirPath, { withFileTypes: true }).catch(() => []);

    const candidateMediaFilenames = dirEntries
      .filter((child) => child.isFile())
      .map((child) => child.name)
      .filter((filename) => filename !== IN_PROGRESS_RECORDING_MANIFEST)
      .sort((left, right) => {
        if (left === manifest?.mediaFilename) {
          return -1;
        }
        if (right === manifest?.mediaFilename) {
          return 1;
        }
        return left.localeCompare(right);
      });

    const mediaFilename = candidateMediaFilenames[0] ?? null;
    const mediaPath = mediaFilename ? path.join(dirPath, mediaFilename) : null;
    let byteLength = manifest?.byteLength ?? 0;
    if (mediaPath && existsSync(mediaPath)) {
      byteLength = (await stat(mediaPath)).size;
    }

    const dirStats = await stat(dirPath).catch(() => null);
    const timestampFallback = dirStats?.mtime ? dirStats.mtime.toISOString() : nowIso();

    sessions.push({
      id: recordingId,
      dirPath,
      manifest,
      mediaPath,
      mediaFilename,
      byteLength,
      chunkCount: manifest?.chunkCount ?? 0,
      startedAt: manifest?.startedAt ?? timestampFallback,
      updatedAt: manifest?.updatedAt ?? timestampFallback,
      aiProcessingEnabled: manifest?.aiProcessingEnabled ?? true,
      metadata: manifest?.metadata ?? {},
    });
  }

  sessions.sort((left, right) => left.startedAt.localeCompare(right.startedAt));
  return sessions;
}

export async function finalizeInProgressRecordingSession(
  params: FinalizeInProgressRecordingSessionParams,
): Promise<FinalizedRecordingSessionResult> {
  const session = await getRecoverableRecordingSession(params.storageDir, params.recordingId);
  if (!session || !session.mediaPath) {
    throw new Error("In-progress recording media was not found.");
  }

  const mediaPath = path.join(params.storageDir, params.mediaFilename);
  const metadataPath = path.join(params.storageDir, params.metadataFilename);

  await rename(session.mediaPath, mediaPath);
  await writeFile(metadataPath, JSON.stringify(params.finalMetadata, null, 2), "utf8");
  await rm(session.dirPath, { recursive: true, force: true });

  return {
    mediaPath,
    metadataPath,
    bytesWritten: session.byteLength,
    chunkCount: session.chunkCount,
  };
}

export function isMeaningfulCapture(params: { byteLength: number; durationMs: number }): boolean {
  if (params.byteLength <= 0) {
    return false;
  }

  if (
    params.durationMs <= EMPTY_CAPTURE_MAX_DURATION_MS &&
    params.byteLength <= EMPTY_CAPTURE_MAX_BYTES
  ) {
    return false;
  }

  return true;
}
