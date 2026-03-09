import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  buildMarkdownExport,
  buildPreviewText,
  buildRecordingFileStem,
  buildSearchText,
  buildSummary,
  buildTextExport,
  computeArtifacts,
  expandQueryTokens,
  extractKeywords,
  extractTopics,
  formatExportTimestamp,
  formatTranscriptTimestamp,
  getDisambiguatedPathIfNeeded,
  getMimeTypeForFile,
  getRecordingDurationMs,
  getTranscriptSnippet,
  keywordScore,
  sanitizeSessionTitle,
  sanitizeTranscriptText,
  semanticScore,
  toSearchTokens,
  toTokenFrequency,
} from "../../src/sessionUtils";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dirPath) => rm(dirPath, { recursive: true, force: true })));
});

describe("sessionUtils", () => {
  it("scores keyword and semantic matches for search", () => {
    const session = {
      title: "API setup guide",
      sourceName: "Slack Huddle",
      summary: "Discussed api rollout and auth setup",
      topics: ["API Setup"],
      keywords: ["auth", "deploy"],
      transcriptText: "The api setup and auth rollout are blocked.",
      searchTokenFrequency: toTokenFrequency(["api", "setup", "auth"]),
    };

    expect(keywordScore(session, ["setup", "auth"])).toBe(28);
    expect(semanticScore(session, toTokenFrequency(["api", "setup", "auth"]))).toBeCloseTo(1, 5);
  });

  it("builds markdown and text exports from transcript segments", () => {
    const detail = {
      id: "session-1",
      title: "Weekly Sync",
      sourceName: "Slack",
      startedAt: "2026-03-09T09:00:00.000Z",
      endedAt: "2026-03-09T09:30:00.000Z",
      processingStatus: "done",
      summary: "Covered release work.",
      topics: ["Release Planning"],
      keywords: ["release", "auth"],
      transcriptText: "Fallback transcript",
      transcriptSegments: [
        {
          startMs: 0,
          endMs: 1200,
          text: "Intro",
        },
        {
          startMs: 62000,
          endMs: 64000,
          text: "Decision made",
        },
      ],
    };

    const markdown = buildMarkdownExport(detail);
    const text = buildTextExport(detail);

    expect(markdown).toContain("# Weekly Sync");
    expect(markdown).toContain("[00:00] Intro");
    expect(markdown).toContain("[01:02] Decision made");
    expect(text).toContain("Title: Weekly Sync");
    expect(text).toContain("Transcript:");
    expect(text).toContain("[01:02] Decision made");
  });

  it("extracts keywords, topics, and a summary from transcript text", () => {
    const transcript = [
      "API auth rollout is blocked.",
      "API auth rollout needs a decision today.",
      "Deployment planning continues tomorrow.",
    ].join(" ");

    expect(extractKeywords(transcript, 3)).toEqual(["api", "auth", "rollout"]);
    expect(extractTopics(transcript, 3)).toContain("Api Auth");
    expect(buildSummary(transcript, ["Api Auth", "Deployment Planning"])).toBe(
      "API auth rollout is blocked. API auth rollout needs a decision today.",
    );
  });

  it("normalizes transcript and query text helpers", () => {
    expect(sanitizeTranscriptText("  Hello\u0000\r\nworld  ")).toBe("Hello\nworld");
    expect(sanitizeSessionTitle("   ", "Fallback Title")).toBe("Fallback Title");
    expect(toSearchTokens("Fix the API setup bug in auth flows")).toEqual([
      "fix",
      "api",
      "setup",
      "bug",
      "auth",
      "flows",
    ]);
    expect(expandQueryTokens(["setup", "bug"])).toEqual(
      expect.arrayContaining(["setup", "configure", "installation", "bug", "issue", "defect"]),
    );
    expect(buildSearchText([" Weekly sync ", "", " API auth "])).toBe("Weekly sync \nAPI auth");
    expect(getTranscriptSnippet("a".repeat(240), 10)).toBe(`${"a".repeat(10)}...`);
    expect(buildPreviewText("b".repeat(240), 12)).toBe(`${"b".repeat(12)}...`);
  });

  it("builds recording and artifact file paths", () => {
    const sessionId = "01ARZ3NDEKTSV4RRFFQ69G5FAV";

    expect(buildRecordingFileStem("2026-03-09T09:15:30.000Z", "Team / Sync", sessionId)).toBe(
      "2026-03-09_091530_Team_Sync_Q69G5FAV",
    );
    expect(formatTranscriptTimestamp(3723000)).toBe("01:02:03");
    expect(getRecordingDurationMs("2026-03-09T09:00:00.000Z", "2026-03-09T09:01:30.000Z")).toBe(
      90000,
    );
    expect(formatExportTimestamp("2026-03-09T09:15:30.000Z")).toBe("2026-03-09_0915");
    expect(computeArtifacts("/tmp/meeting.webm", ".transcript.segments.json")).toEqual({
      transcriptPath: "/tmp/meeting.transcript.txt",
      transcriptSegmentsPath: "/tmp/meeting.transcript.segments.json",
      analysisPath: "/tmp/meeting.analysis.json",
    });
    expect(getMimeTypeForFile("/tmp/audio.m4a")).toBe("audio/mp4");
  });

  it("covers empty-state branches for exports and summaries", () => {
    expect(keywordScore(
      {
        title: "No match",
        sourceName: undefined,
        summary: "",
        topics: [],
        keywords: [],
        transcriptText: "",
        searchTokenFrequency: new Map(),
      },
      [],
    )).toBe(0);
    expect(
      semanticScore(
        {
          searchTokenFrequency: new Map(),
        },
        new Map(),
      ),
    ).toBe(0);
    expect(buildSummary("", ["Auth"])).toBe("The call covered Auth.");
    expect(buildSummary("", [])).toBe("No meaningful speech content was detected in this recording.");
    expect(
      buildMarkdownExport({
        id: "session-empty",
        title: "Empty Session",
        sourceName: undefined,
        startedAt: "2026-03-09T09:00:00.000Z",
        endedAt: undefined,
        processingStatus: "done",
        summary: "No summary yet.",
        topics: [],
        keywords: [],
        transcriptText: "",
        transcriptSegments: [],
      }),
    ).toContain("(No transcript)");
    expect(getMimeTypeForFile("/tmp/file.bin")).toBe("application/octet-stream");
    expect(getRecordingDurationMs("bad", "2026-03-09T09:01:30.000Z")).toBe(0);
    expect(buildPreviewText("short", 12)).toBe("short");
  });

  it("disambiguates export paths when a file already exists", async () => {
    const exportDir = await mkdtemp(path.join(os.tmpdir(), "coview-export-"));
    tempDirs.push(exportDir);

    const existingPath = path.join(exportDir, "session.md");
    await writeFile(existingPath, "# existing\n", "utf8");
    await writeFile(path.join(exportDir, "session-2.md"), "# existing 2\n", "utf8");

    expect(getDisambiguatedPathIfNeeded(existingPath)).toBe(path.join(exportDir, "session-3.md"));
    expect(getDisambiguatedPathIfNeeded(path.join(exportDir, "fresh.md"))).toBe(
      path.join(exportDir, "fresh.md"),
    );
  });
});
