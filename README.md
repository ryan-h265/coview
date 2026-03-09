# Coview

Coview is an Electron desktop recorder for capturing a screen or window, storing local session media on disk, and turning finished recordings into searchable, editable notes. The app is currently a local-first MVP: capture, storage, transcription, summaries, search, exports, and telemetry all stay on the machine.

## Current app behavior

- Record a screen or window with system audio, microphone audio, or both.
- Stream recording chunks to disk while capture is running, then recover interrupted sessions automatically on next launch.
- Store sessions in a flat-file library with a manifest, exports directory, and temporary in-progress recording folders.
- Transcribe completed sessions locally with `whisper-cli`, then fall back to Python `whisper` if needed.
- Persist transcript timing data in `*.transcript.segments.json` artifacts when a provider returns usable segment offsets.
- Generate summaries, topics, and keywords locally from transcript text using simple heuristics.
- Browse a date-sorted session timeline, edit session metadata, replay media, re-transcribe, export, and delete.
- Search sessions with keyword and similarity scoring based on token overlap, token frequency, and a small synonym map.
- Inspect processing jobs, transcription diagnostics, managed Whisper models, and local telemetry logs inside the app.
- Move the active library to a new empty directory with copy verification, then optionally clean up the old library.

## Platform support

- macOS has the fullest feature set. It supports manual capture, tray behavior, global hotkeys, Slack huddle detection through process and window-title heuristics, automatic start after sustained audio, automatic stop on silence, and packaging/notarization flows.
- Linux is supported with reduced functionality. Manual capture, storage, processing, search, export, playback, and library migration work, but Slack auto-detection returns no signal there, so Slack-triggered auto-recording is effectively unavailable. System audio availability also depends on the capture source and desktop environment; when system audio is unavailable, the renderer falls back to microphone capture when possible.
- This repository only includes packaging commands for macOS and Linux.

## Requirements

- Node `22.22.0`
- npm `10.9.4`
- macOS or Linux for the documented runtime and packaging flows
- CMake plus a working C/C++ toolchain if you want to build the bundled `whisper-cli` runtime locally
- Optional `ffmpeg` on `PATH` for better media-to-WAV conversion before transcription
- Optional `whisper` on `PATH` if you want the Python fallback provider

Node and npm are pinned in `.nvmrc`, `package.json#engines`, `package.json#packageManager`, and `package.json#volta`.

## Install and run

```bash
npm install
npm start
```

`npm start` runs `npm run build` and then launches Electron.

On first launch, Coview creates the default active library at `~/Documents/Coview/recordings`.

## Local transcription setup

Coview checks transcription providers in this order:

1. `whisper-cli`
2. `whisper`

For `whisper-cli`, the app looks for a usable runtime in these places:

1. A packaged or staged runtime under `build/whisper-runtime/<label>/`
2. A local `tools/whisper.cpp/build/bin/` build
3. A system `whisper-cli` on `PATH`

For a development setup that uses the bundled runtime path, build and stage it with:

```bash
npm run prepare:whisper-runtime
```

That command compiles `tools/whisper.cpp` and stages `whisper-cli` plus matching shared libraries into `build/whisper-runtime/<label>/`.

After the app starts, open `Settings -> Guided Setup` to install, switch, or remove supported local Whisper models, or point Coview at an existing local `.bin` model file. Fresh installs keep local processing disabled until setup completes successfully.

Current managed model catalog:

- `tiny.en`
- `base.en` (recommended first install)
- `small.en`
- `medium.en`
- `base`
- `small`

`COVIEW_WHISPER_MODEL` still works as a fallback override for the local `whisper-cli` model path.

Example:

```bash
COVIEW_WHISPER_MODEL=tools/whisper.cpp/models/ggml-small.en.bin npm start
```

## Testing and CI

Build and test commands:

```bash
npm run build
npm test
npm run test:unit
npm run test:integration
npm run test:coverage
```

The GitHub Actions workflow in `.github/workflows/test.yml` runs `npm ci`, `npm run build`, and `npm run test:coverage` on pushes to `main` and `master`, plus pull requests.

## Storage and generated files

Coview stores sessions as flat files in a single active library directory.

- Default library: `~/Documents/Coview/recordings`
- Library manifest: `library.json`
- In-progress recordings: `.tmp-recordings/<recording-id>/`
- Session media and metadata JSON: stored side-by-side in the library root
- Transcript text artifacts: `*.transcript.txt`
- Transcript segment artifacts: `*.transcript.segments.json`
- Analysis artifacts: `*.analysis.json`
- Exports: `<library>/exports/`

Outside the active library, Coview also stores app state under Electron `userData`:

- Settings: `settings.json`
- Processing job queue/history: `processing-jobs.json`
- Managed Whisper models: `models/`
- Telemetry logs: `logs/coview.log` with `.1` to `.3` rotation

## Privacy and data flow

Recordings, transcription, search, summaries, topics, keywords, and telemetry stay local. The current app does not offer cloud transcription or participant-consent workflows.

## Packaging

Build on the target platform. Cross-compilation is not supported. Output goes to `release/`.

Package commands automatically run `npm run prepare:whisper-runtime` before packaging.

macOS:

```bash
npm run package:mac
npm run package:mac:universal
npm run package:mac:dir
```

`package:mac` and `package:mac:dir` target Apple Silicon (`--arm64`). `package:mac:universal` stages a universal Whisper runtime by setting `COVIEW_WHISPER_RUNTIME_LABEL=darwin-universal` and `COVIEW_WHISPER_RUNTIME_ARCHS='arm64;x86_64'`.

Linux:

```bash
npm run package:linux
npm run package:linux:dir
```

The configured Linux targets are `AppImage` and `deb`.

## macOS signing and notarization

Set these environment variables to enable notarization during `npm run package:mac`:

- `APPLE_ID`
- `APPLE_APP_SPECIFIC_PASSWORD`
- `APPLE_TEAM_ID`

Skip notarization with `COVIEW_SKIP_NOTARIZE=1`. Entitlements live in `build/entitlements.mac.plist`.

## Repository notes

- `src/` contains the Electron main, preload, renderer, and shared helper code.
- `test/` contains Vitest unit and integration coverage for the current MVP behavior.
- `scripts/` contains build, runtime staging, icon, and notarization helpers.
- `tools/whisper.cpp/` is the vendored upstream source used to build `whisper-cli`.
- `postinstall` runs `patch-package` to apply `patches/app-builder-lib+26.8.1.patch`.
- The app is single-instance. Launching it again focuses the existing window.
- Closing the window hides Coview instead of quitting; reopen it from the tray icon or quit from the tray menu.
- Regenerate the icon with `npm run icon:generate`.
