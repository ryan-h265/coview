import { describe, expect, it } from "vitest";

import {
  buildTranscriptTextFromSegments,
  createTranscriptSegmentsArtifact,
  parseWhisperCliTranscriptJson,
  parseWhisperPythonTranscriptJson,
  readTranscriptSegmentsArtifact,
} from "../../src/transcriptSegments";

describe("transcriptSegments", () => {
  it("parses whisper-cli JSON transcript segments with millisecond offsets", () => {
    const result = parseWhisperCliTranscriptJson(
      JSON.stringify({
        result: {
          language: "en",
        },
        transcription: [
          {
            offsets: {
              from: 0,
              to: 1240,
            },
            text: " Hello there",
          },
          {
            timestamps: {
              from: "00:01.240",
              to: "00:02.800",
            },
            text: " general Kenobi",
          },
        ],
      }),
    );

    expect(result.language).toBe("en");
    expect(result.segments).toEqual([
      {
        startMs: 0,
        endMs: 1240,
        text: "Hello there",
      },
      {
        startMs: 1240,
        endMs: 2800,
        text: "general Kenobi",
      },
    ]);
    expect(result.text).toBe("Hello there\ngeneral Kenobi");
  });

  it("falls back to transcript text lines when whisper-cli timing data is unusable", () => {
    const result = parseWhisperCliTranscriptJson(
      JSON.stringify({
        params: {
          language: "en",
        },
        transcription: [
          {
            offsets: {
              from: "n/a",
              to: "later",
            },
            text: "  First line  ",
          },
          {
            timestamps: {
              from: "",
              to: "",
            },
            text: "Second line\r\n",
          },
        ],
      }),
    );

    expect(result.language).toBe("en");
    expect(result.segments).toEqual([]);
    expect(result.text).toBe("First line\nSecond line");
  });

  it("parses python whisper JSON transcript segments with second offsets", () => {
    const result = parseWhisperPythonTranscriptJson(
      JSON.stringify({
        language: "fr",
        segments: [
          {
            start: 0.12,
            end: 1.8,
            text: " Bonjour",
          },
          {
            start: "1.8",
            end: "3.05",
            text: " le monde",
          },
        ],
      }),
    );

    expect(result.language).toBe("fr");
    expect(result.segments).toEqual([
      {
        startMs: 120,
        endMs: 1800,
        text: "Bonjour",
      },
      {
        startMs: 1800,
        endMs: 3050,
        text: "le monde",
      },
    ]);
    expect(result.text).toBe("Bonjour\nle monde");
  });

  it("normalizes legacy transcript segment artifacts", () => {
    const parsed = readTranscriptSegmentsArtifact(
      JSON.stringify([
        {
          startMs: "42",
          endMs: "12",
          text: " Intro\r\n",
        },
        {
          startMs: "nope",
          endMs: 90,
          text: "ignored",
        },
      ]),
    );

    expect(parsed.version).toBe(1);
    expect(parsed.segments).toEqual([
      {
        startMs: 42,
        endMs: 42,
        text: "Intro",
      },
    ]);
  });

  it("round-trips stored transcript segment artifacts", () => {
    const artifact = createTranscriptSegmentsArtifact({
      generatedAt: "2026-03-08T10:11:12.000Z",
      provider: "local-whisper-cli",
      model: "ggml-small.en.bin",
      language: "en",
      segments: [
        {
          startMs: 0,
          endMs: 930,
          text: "Intro",
        },
        {
          startMs: 930,
          endMs: 2200,
          text: "Decision point",
        },
      ],
    });

    const parsed = readTranscriptSegmentsArtifact(JSON.stringify(artifact));

    expect(parsed.version).toBe(1);
    expect(parsed.provider).toBe("local-whisper-cli");
    expect(parsed.model).toBe("ggml-small.en.bin");
    expect(parsed.language).toBe("en");
    expect(buildTranscriptTextFromSegments(parsed.segments)).toBe("Intro\nDecision point");
  });

  it("rejects empty transcript payloads", () => {
    expect(() =>
      parseWhisperCliTranscriptJson(
        JSON.stringify({
          transcription: [
            {
              text: "   ",
            },
          ],
        }),
      ),
    ).toThrow("whisper-cli produced empty transcript");

    expect(() =>
      parseWhisperPythonTranscriptJson(
        JSON.stringify({
          text: " \n ",
          segments: [],
        }),
      ),
    ).toThrow("python whisper produced empty transcript");
  });
});
