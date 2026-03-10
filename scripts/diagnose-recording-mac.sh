#!/usr/bin/env bash
set -euo pipefail

EXPECTED_NODE="22.22.0"
EXPECTED_NPM="10.9.4"

say() {
  printf "%s\n" "$*"
}

section() {
  printf "\n=== %s ===\n" "$*"
}

ok() {
  printf "[OK] %s\n" "$*"
}

warn() {
  printf "[WARN] %s\n" "$*"
}

err() {
  printf "[ERROR] %s\n" "$*"
}

check_command() {
  local name="$1"
  if command -v "$name" >/dev/null 2>&1; then
    ok "Found $name at $(command -v "$name")"
    return 0
  fi
  err "Missing command: $name"
  return 1
}

check_writable_dir() {
  local target_dir="$1"
  mkdir -p "$target_dir"
  local probe="$target_dir/.coview-write-test-$$"
  if ( : > "$probe" ) 2>/dev/null; then
    rm -f "$probe"
    ok "Writable: $target_dir"
  else
    err "Not writable: $target_dir"
  fi
}

print_tail_if_exists() {
  local file_path="$1"
  local lines="${2:-40}"
  if [[ -f "$file_path" ]]; then
    ok "Found $file_path"
    say "--- tail -n $lines $file_path ---"
    tail -n "$lines" "$file_path" || true
  else
    warn "Not found: $file_path"
  fi
}

find_coview_userdata_dir() {
  local candidates=(
    "$HOME/Library/Application Support/coview"
    "$HOME/Library/Application Support/Coview"
  )

  for candidate in "${candidates[@]}"; do
    if [[ -d "$candidate" ]]; then
      printf "%s\n" "$candidate"
      return 0
    fi
  done

  local discovered
  discovered="$(find "$HOME/Library/Application Support" -maxdepth 1 -type d \( -iname 'coview' \) 2>/dev/null | head -n 1 || true)"
  if [[ -n "$discovered" ]]; then
    printf "%s\n" "$discovered"
    return 0
  fi

  return 1
}

get_storage_dir_from_settings() {
  local settings_path="$1"
  if [[ ! -f "$settings_path" ]]; then
    return 1
  fi
  node -e 'const fs=require("fs");const p=process.argv[1];try{const raw=fs.readFileSync(p,"utf8");const parsed=JSON.parse(raw);if(parsed&&typeof parsed.storageDir==="string"&&parsed.storageDir.trim().length>0){process.stdout.write(parsed.storageDir.trim())}}catch{}' "$settings_path"
}

analyze_telemetry_log() {
  local log_path="$1"
  if [[ ! -f "$log_path" ]]; then
    warn "No telemetry log to analyze: $log_path"
    return 0
  fi

  node <<'NODE' "$log_path"
const fs = require("fs");
const p = process.argv[1];
const lines = fs.readFileSync(p, "utf8").split(/\r?\n/).filter(Boolean);
let dropped = [];
let saved = 0;
let started = 0;
for (const line of lines) {
  try {
    const row = JSON.parse(line);
    if (row.event === "recording.session_started") started += 1;
    if (row.event === "recording.session_saved") saved += 1;
    if (row.event === "recording.session_dropped_empty") dropped.push(row);
  } catch {}
}
console.log(`recording.session_started count: ${started}`);
console.log(`recording.session_saved count: ${saved}`);
console.log(`recording.session_dropped_empty count: ${dropped.length}`);
if (dropped.length > 0) {
  const last = dropped[dropped.length - 1];
  const ctx = last.context || {};
  console.log("Latest dropped-empty event:");
  console.log(`  at: ${last.at || "unknown"}`);
  console.log(`  recordingSessionId: ${ctx.recordingSessionId || "unknown"}`);
  console.log(`  storageDir: ${ctx.storageDir || "unknown"}`);
  console.log(`  bytesWritten: ${typeof ctx.bytesWritten === "number" ? ctx.bytesWritten : "unknown"}`);
  console.log(`  durationMs: ${typeof ctx.durationMs === "number" ? ctx.durationMs : "unknown"}`);
  if (ctx.bytesWritten === 0) {
    console.log("  hint: MediaRecorder produced no persisted chunks for this session.");
  }
}
NODE
}

section "Platform"
if [[ "$(uname -s)" != "Darwin" ]]; then
  warn "This script is intended for macOS. Current platform: $(uname -s)"
  warn "Run this on the Mac where recordings are failing to save."
  exit 0
fi
ok "Running on macOS $(sw_vers -productVersion)"

section "Runtime prerequisites"
check_command node || true
check_command npm || true
check_command ffmpeg || true

if command -v node >/dev/null 2>&1; then
  node_version="$(node -v | sed 's/^v//')"
  if [[ "$node_version" == "$EXPECTED_NODE" ]]; then
    ok "Node version matches expected: $node_version"
  else
    warn "Node version is $node_version (expected $EXPECTED_NODE)"
  fi
fi

if command -v npm >/dev/null 2>&1; then
  npm_version="$(npm -v)"
  if [[ "$npm_version" == "$EXPECTED_NPM" ]]; then
    ok "npm version matches expected: $npm_version"
  else
    warn "npm version is $npm_version (expected $EXPECTED_NPM)"
  fi
fi

if command -v ffmpeg >/dev/null 2>&1; then
  if ffmpeg -hide_banner -devices 2>/dev/null | grep -qi "avfoundation"; then
    ok "ffmpeg reports avfoundation support"
  else
    warn "ffmpeg did not report avfoundation device support"
  fi
fi

section "Library storage checks"
movies_library="$HOME/Movies/Coview/recordings"
documents_library="$HOME/Documents/Coview/recordings"

say "Default library on macOS should be: $movies_library"
check_writable_dir "$movies_library"
check_writable_dir "$documents_library"

for dir in "$movies_library" "$documents_library"; do
  if [[ -f "$dir/library.json" ]]; then
    ok "Found library manifest: $dir/library.json"
  else
    warn "No library manifest yet: $dir/library.json"
  fi

done

section "macOS permissions hints"
say "Check these in System Settings -> Privacy & Security:"
say "  - Screen Recording (Coview and Terminal if launching from Terminal)"
say "  - Microphone (Coview)"
say "  - Files and Folders (Coview access to Movies/Documents/custom library path)"

if command -v sqlite3 >/dev/null 2>&1; then
  tcc_db="$HOME/Library/Application Support/com.apple.TCC/TCC.db"
  if [[ -f "$tcc_db" ]]; then
    say "\nRecent TCC rows for screen/microphone/files (if readable):"
    sqlite3 "$tcc_db" "SELECT service, client, auth_value, datetime(last_modified, 'unixepoch') FROM access WHERE service IN ('kTCCServiceScreenCapture','kTCCServiceMicrophone','kTCCServiceSystemPolicyDocumentsFolder','kTCCServiceSystemPolicyAllFiles') ORDER BY last_modified DESC LIMIT 20;" 2>/dev/null \
      || warn "Could not read TCC DB (Full Disk Access may be required for Terminal)."
  else
    warn "TCC database not found at expected path: $tcc_db"
  fi
else
  warn "sqlite3 is not installed; skipping TCC database check"
fi

section "Coview app state and logs"
active_storage_dir=""
if userdata_dir="$(find_coview_userdata_dir)"; then
  ok "Detected Coview userData directory: $userdata_dir"
  settings_path="$userdata_dir/settings.json"
  telemetry_path="$userdata_dir/logs/coview.log"

  print_tail_if_exists "$settings_path" 80
  print_tail_if_exists "$telemetry_path" 120

  active_storage_dir="$(get_storage_dir_from_settings "$settings_path" || true)"
  if [[ -n "$active_storage_dir" ]]; then
    ok "Active storageDir from settings.json: $active_storage_dir"
    check_writable_dir "$active_storage_dir"
    if [[ -d "$active_storage_dir/.tmp-recordings" ]]; then
      ok "Found in-progress recordings dir: $active_storage_dir/.tmp-recordings"
      find "$active_storage_dir/.tmp-recordings" -maxdepth 2 -type f | head -n 20 || true
    else
      warn "No in-progress recordings dir at $active_storage_dir/.tmp-recordings"
    fi
  else
    warn "No explicit storageDir in settings.json (Coview may be using default path)."
  fi

  say "\nTelemetry recording-event summary:"
  analyze_telemetry_log "$telemetry_path"
else
  warn "Could not locate Coview userData directory under ~/Library/Application Support"
fi

section "Interpreting recording.session_dropped_empty"
say "If you see recording.session_dropped_empty with bytesWritten=0 (like your example),"
say "Coview started the session but no media chunks were persisted."
say "Common causes to check next:"
say "  1) Screen Recording permission is missing/denied for Coview or Terminal."
say "  2) The selected capture source produced no track data (window/source ended immediately)."
say "  3) Active storageDir is custom and not writable by Coview."
say "  4) You are running an old Electron build; run npm install && npm run build again."

section "Quick next steps"
say "1) Launch Coview from Terminal (npm start) so runtime errors are visible."
say "2) Start a short recording, stop it, then rerun this script."
say "3) Share this script output + latest telemetry lines around session_started/session_dropped_empty."
