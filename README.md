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
- A prebuilt `whisper-cli` runtime directory or archive for each platform you package
- Optional `ffmpeg` on `PATH` for better media-to-WAV conversion before transcription
- Optional `whisper` on `PATH` if you want the Python fallback provider

Node and npm are pinned in `.nvmrc`, `package.json#engines`, `package.json#packageManager`, and `package.json#volta`.

## Install and run

```bash
npm install
npm start
```

`npm start` runs `npm run build` and then launches Electron.

On first launch, Coview creates the default active library at:

- macOS: `~/Movies/Coview/recordings`
- Linux: `~/Documents/Coview/recordings`

## Local transcription setup

Coview checks transcription providers in this order:

1. `whisper-cli`
2. `whisper`

For `whisper-cli`, the app looks for a usable runtime in these places:

1. A packaged runtime under the app's bundled `whisper-runtime/<label>/` resources
2. A staged development runtime under `build/whisper-runtime/<label>/`
3. A system `whisper-cli` on `PATH`

This repository no longer vendors `whisper.cpp` source. `npm run prepare:whisper-runtime` now stages a prebuilt runtime from one of these inputs:

1. `COVIEW_WHISPER_RUNTIME_DIR=/path/to/runtime-directory`
2. `COVIEW_WHISPER_RUNTIME_ARCHIVE=/path/or/url/to/runtime.tar.gz`
3. `COVIEW_WHISPER_RUNTIME_MANIFEST=/path/to/whisper-runtime.manifest.json`
4. `./whisper-runtime.manifest.json` in the repo root

Manifest format is shown in `whisper-runtime.manifest.example.json`.

If you need to build a runtime transiently from upstream without checking its source into this repository, use:

```bash
npm run build:whisper-runtime:upstream -- --label linux-x64 --out-dir .runtime-build/linux-x64
```

To turn a locally built runtime directory into a portable archive plus SHA-256 digest:

```bash
npm run package:whisper-runtime -- --source-dir /path/to/runtime --label linux-x64
```

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
COVIEW_WHISPER_MODEL=$HOME/Models/ggml-small.en.bin npm start
```

## macOS recording save troubleshooting (fresh installs)

If recordings are not being saved on macOS, run the built-in diagnostics script:

```bash
npm run doctor:mac-recording
```

The script checks:

- Node/npm versions against the pinned project versions
- Whether `ffmpeg` is installed and exposes macOS `avfoundation` devices
- Writability of the default Coview recording library directories
- Presence of `library.json` manifests in likely library paths
- Active `storageDir` from Coview `settings.json` (including writability for custom library paths)
- Coview `settings.json` and telemetry log tails under `~/Library/Application Support/*coview*`
- TCC permission rows (screen capture, microphone, files) when the macOS privacy DB is readable

For fresh installs, also verify these macOS permissions manually in **System Settings → Privacy & Security**:

- **Screen Recording**: Coview (and Terminal if launching from Terminal)
- **Microphone**: Coview
- **Files and Folders**: Coview access to `Movies`/`Documents`

Note: Coview defaults to `~/Movies/Coview/recordings` on macOS. If that location is blocked, the app can fall back from the legacy `Documents` location and will surface a writable-library error in logs/UI.

If telemetry contains `recording.session_dropped_empty` with `bytesWritten: 0`, Coview started a session but no media chunks were persisted. In practice this usually points to Screen Recording permission issues, an invalid/ended capture source, or a custom library path that is not writable.

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

`.github/workflows/release-packages.yml` builds `whisper-cli` transiently from upstream `whisper.cpp`, packages a runtime archive, and then builds release artifacts with that runtime bundled for macOS universal and Linux x64.

## Storage and generated files

Coview stores sessions as flat files in a single active library directory.

- Default library: macOS `~/Movies/Coview/recordings`; Linux `~/Documents/Coview/recordings`
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

Package commands still stage `build/whisper-runtime/<label>/` automatically, but they now expect prebuilt runtime inputs instead of a vendored source checkout.

macOS:

```bash
npm run package:mac
npm run package:mac:universal
npm run package:mac:dir
```

`package:mac` and `package:mac:dir` target Apple Silicon (`--arm64`). `package:mac:universal` expects a `darwin-universal` runtime label.

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
- `scripts/` contains build, runtime staging, runtime packaging, icon, and notarization helpers.
- `postinstall` runs `patch-package` to apply `patches/app-builder-lib+26.8.1.patch`.
- The app is single-instance. Launching it again focuses the existing window.
- Closing the window hides Coview instead of quitting; reopen it from the tray icon or quit from the tray menu.
- Source icons live in `icons/`; `npm run build` stages them into `build/` for packaging and `dist/assets/icons/` for runtime use.
- Run `npm run icon:trim` after replacing `icons/coview_master.png` to crop transparent padding and regenerate the app icon set.
