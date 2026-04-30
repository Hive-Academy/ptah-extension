#!/usr/bin/env bash
#
# smoke-pre-publish.sh — pre-publish smoke gate for @hive-academy/ptah-cli
#
# TASK_2026_108 T4 (Tasks 4.1, 4.2). Six scenarios that exercise the dist
# binary end-to-end before any npm publish:
#
#   Smoke 1 — `--version` / `--help` boot smoke
#   Smoke 2 — `task.submit` JSON-RPC roundtrip via `ptah interact`
#   Smoke 3 — proxy permission-gate fail-fast
#   Smoke 4 — proxy SIGTERM teardown + registry cleanup
#   Smoke 5 — REAL Anthropic API roundtrip (stream:true + stream:false)
#   Smoke 6 — embedded proxy `proxy.shutdown` JSON-RPC RPC roundtrip
#
# Smoke 5 talks to the live Anthropic API and uses
# `claude-3-5-haiku-20241022` with `max_tokens: 16` to keep cost negligible.
# Behaviour gated on env vars:
#
#   ANTHROPIC_API_KEY      — required for Smoke 5 to run.
#   SMOKE_REQUIRE_API_KEY  — when `1`, Smoke 5 FAILS if the key is missing
#                            (CI fail-closed). When unset, Smoke 5 SKIPs
#                            with a stderr warning (local dev convenience).
#
# 429 contract: HTTP 429 from Anthropic triggers a single 5s sleep and one
# retry. A second 429 fails the smoke.
#
# Compatibility: POSIX bash + Git Bash on Windows. All paths use forward
# slashes; SIGTERM exit code is platform-conditional (143 POSIX / 1 win32).
# Q4=B locked: NO mock-anthropic-upstream.mjs fixture file exists in repo —
# Smoke 5 always exercises the real upstream.

set -euo pipefail

# -----------------------------------------------------------------------------
# Setup
# -----------------------------------------------------------------------------

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
DIST_BIN="$REPO_ROOT/dist/apps/ptah-cli/main.mjs"
NODE_BIN="${NODE_BIN:-node}"

# Detect platform once; SIGTERM exit code differs (POSIX 143 vs win32 1).
case "$(uname -s 2>/dev/null || echo unknown)" in
  MINGW*|MSYS*|CYGWIN*) IS_WINDOWS=1 ;;
  *) IS_WINDOWS=0 ;;
esac

if [ ! -f "$DIST_BIN" ]; then
  echo "[smoke] FAIL: dist binary missing at $DIST_BIN — run 'nx build ptah-cli' first" >&2
  exit 1
fi

# Resolve the user data root so we can scrub registry / token files.
USER_DATA_ROOT="${HOME:-$USERPROFILE}/.ptah"
SMOKE_REGISTRY_4="$USER_DATA_ROOT/proxies/18765.json"
SMOKE_REGISTRY_5="$USER_DATA_ROOT/proxies/18766.json"
SMOKE_REGISTRY_6="$USER_DATA_ROOT/proxies/18767.json"
SMOKE_TOKEN_5="$USER_DATA_ROOT/proxy/18766.token"

failures=0
warnings=0

# Track spawned background pids so the trap can clean them up on any exit.
SPAWNED_PIDS=()

cleanup() {
  set +e
  for pid in "${SPAWNED_PIDS[@]:-}"; do
    if [ -n "${pid:-}" ] && kill -0 "$pid" 2>/dev/null; then
      kill -TERM "$pid" 2>/dev/null || true
      sleep 1
      kill -KILL "$pid" 2>/dev/null || true
    fi
  done
  rm -f "$SMOKE_REGISTRY_4" "$SMOKE_REGISTRY_5" "$SMOKE_REGISTRY_6" 2>/dev/null || true
  rm -f "$SMOKE_TOKEN_5" 2>/dev/null || true
  set -e
}
trap cleanup EXIT INT TERM

# Helper: pass marker → stderr (one line per smoke scenario, machine-parseable).
pass() { echo "[smoke $1] PASS" >&2; }
fail() {
  echo "[smoke $1] FAIL: $2" >&2
  failures=$((failures + 1))
}
warn() {
  echo "[smoke $1] SKIP: $2" >&2
  warnings=$((warnings + 1))
}

# Helper: run a command with a timeout. Falls back to `&` + `wait` when
# `timeout` is unavailable (Git Bash usually ships GNU coreutils, but we
# stay defensive).
run_with_timeout() {
  local secs="$1"
  shift
  if command -v timeout >/dev/null 2>&1; then
    timeout --preserve-status "${secs}s" "$@"
  else
    "$@" &
    local pid=$!
    local elapsed=0
    while kill -0 "$pid" 2>/dev/null; do
      if [ "$elapsed" -ge "$secs" ]; then
        kill -TERM "$pid" 2>/dev/null || true
        sleep 1
        kill -KILL "$pid" 2>/dev/null || true
        return 124
      fi
      sleep 1
      elapsed=$((elapsed + 1))
    done
    wait "$pid"
  fi
}

# Helper: portable cross-platform process-alive check.
is_alive() { kill -0 "$1" 2>/dev/null; }

# Helper: send SIGTERM to a pid (Windows uses taskkill under the hood —
# Git Bash maps `kill -TERM` to a graceful close on Node processes).
send_sigterm() {
  local pid="$1"
  if [ "$IS_WINDOWS" = "1" ]; then
    # On Git Bash, `kill -TERM` to a Node child triggers the same graceful
    # path as POSIX SIGTERM (Node's signal-handler shim). Fallback to
    # taskkill if the soft kill is rejected.
    if ! kill -TERM "$pid" 2>/dev/null; then
      taskkill //PID "$pid" //F >/dev/null 2>&1 || true
    fi
  else
    kill -TERM "$pid" 2>/dev/null || true
  fi
}

# -----------------------------------------------------------------------------
# Smoke 1 — `--version` and `--help` boot smoke (timeout 30s).
# -----------------------------------------------------------------------------

smoke_1() {
  local out
  if ! out="$(run_with_timeout 30 "$NODE_BIN" "$DIST_BIN" --version 2>/dev/null)"; then
    fail 1 "--version exited non-zero"
    return
  fi
  # Strip trailing whitespace/newlines for the regex match.
  local trimmed
  trimmed="$(printf '%s' "$out" | tr -d '\r\n[:space:]')"
  if ! printf '%s' "$trimmed" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$'; then
    fail 1 "--version stdout did not match semver: '$out'"
    return
  fi
  if ! out="$(run_with_timeout 30 "$NODE_BIN" "$DIST_BIN" --help 2>/dev/null)"; then
    fail 1 "--help exited non-zero"
    return
  fi
  if ! printf '%s' "$out" | grep -q 'Usage:'; then
    fail 1 "--help missing 'Usage:'"
    return
  fi
  if ! printf '%s' "$out" | grep -q 'session'; then
    fail 1 "--help missing 'session' subcommand"
    return
  fi
  pass 1
}

# -----------------------------------------------------------------------------
# Smoke 2 — task.submit JSON-RPC roundtrip (timeout 60s).
# -----------------------------------------------------------------------------

smoke_2() {
  # task.submit drives a full chat turn through the SDK adapter. Without an
  # Anthropic API key the chain settles via auth_required / license_required
  # rather than task.completed, which is environmental, not a regression.
  # Match the Smoke 5 contract: SKIP locally when the key is absent, FAIL
  # in CI (SMOKE_REQUIRE_API_KEY=1).
  if [ -z "${ANTHROPIC_API_KEY:-}" ]; then
    if [ "${SMOKE_REQUIRE_API_KEY:-0}" = "1" ]; then
      fail 2 "ANTHROPIC_API_KEY required in CI (SMOKE_REQUIRE_API_KEY=1)"
      return
    fi
    warn 2 "ANTHROPIC_API_KEY not set — skipping task.submit roundtrip"
    return
  fi

  local request='{"jsonrpc":"2.0","id":"smoke2","method":"task.submit","params":{"task":"hi"}}'
  local stdout
  set +e
  stdout="$(printf '%s\n' "$request" | run_with_timeout 60 "$NODE_BIN" "$DIST_BIN" interact 2>/dev/null)"
  local rc=$?
  set -e
  if [ "$rc" -ne 0 ] && [ "$rc" -ne 124 ]; then
    fail 2 "interact exited rc=$rc"
    return
  fi
  if ! printf '%s' "$stdout" | grep -q '"method":"task.completed"'; then
    fail 2 "no task.completed notification observed in stdout"
    return
  fi
  if printf '%s' "$stdout" | grep -q '"ptah_code":"sdk_init_failed"'; then
    fail 2 "task.error{ptah_code:sdk_init_failed} appeared on stdout"
    return
  fi
  pass 2
}

# -----------------------------------------------------------------------------
# Smoke 3 — proxy permission-gate fail-fast (timeout 10s).
# -----------------------------------------------------------------------------

smoke_3() {
  local stderr_out rc
  set +e
  # Drop PTAH_INTERACT_ACTIVE if the parent set it; we want to assert that
  # the gate trips when neither --auto-approve nor the embedded marker exist.
  stderr_out="$(unset PTAH_INTERACT_ACTIVE; run_with_timeout 10 "$NODE_BIN" "$DIST_BIN" proxy start --port 0 2>&1 >/dev/null)"
  rc=$?
  set -e
  if [ "$rc" -ne 3 ]; then
    fail 3 "expected exit 3, got $rc"
    return
  fi
  if ! printf '%s' "$stderr_out" | grep -q '"error":"permission_gate_unavailable"'; then
    fail 3 "stderr NDJSON missing permission_gate_unavailable code"
    return
  fi
  pass 3
}

# -----------------------------------------------------------------------------
# Smoke 4 — proxy SIGTERM teardown + registry cleanup (timeout 15s).
# -----------------------------------------------------------------------------

smoke_4() {
  local port=18765
  rm -f "$SMOKE_REGISTRY_4" 2>/dev/null || true
  "$NODE_BIN" "$DIST_BIN" proxy start --port "$port" --auto-approve >/dev/null 2>&1 &
  local pid=$!
  SPAWNED_PIDS+=("$pid")

  local elapsed=0
  local healthy=0
  while [ "$elapsed" -lt 10 ]; do
    if curl -fsS "http://127.0.0.1:${port}/healthz" >/dev/null 2>&1; then
      healthy=1
      break
    fi
    if ! is_alive "$pid"; then
      break
    fi
    sleep 1
    elapsed=$((elapsed + 1))
  done

  if [ "$healthy" -ne 1 ]; then
    fail 4 "proxy never answered /healthz on port $port"
    return
  fi

  send_sigterm "$pid"

  # Wait up to 5s for the process to exit.
  local wait_elapsed=0
  while [ "$wait_elapsed" -lt 5 ] && is_alive "$pid"; do
    sleep 1
    wait_elapsed=$((wait_elapsed + 1))
  done
  if is_alive "$pid"; then
    fail 4 "proxy did not exit within 5s after SIGTERM"
    return
  fi

  # Reap and capture exit code.
  set +e
  wait "$pid" 2>/dev/null
  local exit_code=$?
  set -e

  # POSIX: SIGTERM yields 128 + 15 = 143. Win32 / Git Bash: Node maps to 1
  # (and `kill -TERM` over a pipe sometimes lands as 130).
  if [ "$IS_WINDOWS" = "1" ]; then
    case "$exit_code" in
      0|1|130|143) ;;
      *) fail 4 "unexpected windows exit code $exit_code (expected 0|1|130|143)"; return ;;
    esac
  else
    if [ "$exit_code" -ne 143 ]; then
      fail 4 "expected exit 143, got $exit_code"
      return
    fi
  fi

  if [ -f "$SMOKE_REGISTRY_4" ]; then
    fail 4 "registry entry $SMOKE_REGISTRY_4 still exists after shutdown"
    return
  fi

  pass 4
}

# -----------------------------------------------------------------------------
# Smoke 5 — REAL Anthropic API roundtrip (timeout 30s per sub-scenario).
# -----------------------------------------------------------------------------

smoke_5() {
  if [ -z "${ANTHROPIC_API_KEY:-}" ]; then
    if [ "${SMOKE_REQUIRE_API_KEY:-0}" = "1" ]; then
      fail 5 "ANTHROPIC_API_KEY required in CI (SMOKE_REQUIRE_API_KEY=1)"
      return
    fi
    warn 5 "ANTHROPIC_API_KEY not set — skipping live upstream test"
    return
  fi

  local port=18766
  rm -f "$SMOKE_REGISTRY_5" "$SMOKE_TOKEN_5" 2>/dev/null || true

  ANTHROPIC_API_KEY="$ANTHROPIC_API_KEY" \
    "$NODE_BIN" "$DIST_BIN" proxy start --port "$port" --auto-approve >/dev/null 2>&1 &
  local pid=$!
  SPAWNED_PIDS+=("$pid")

  # Wait for /healthz before issuing the request.
  local elapsed=0
  local healthy=0
  while [ "$elapsed" -lt 15 ]; do
    if curl -fsS "http://127.0.0.1:${port}/healthz" >/dev/null 2>&1; then
      healthy=1
      break
    fi
    if ! is_alive "$pid"; then
      break
    fi
    sleep 1
    elapsed=$((elapsed + 1))
  done

  if [ "$healthy" -ne 1 ]; then
    send_sigterm "$pid"
    fail 5 "proxy never answered /healthz on port $port"
    return
  fi

  # Read token (proxy-auth writes immediately on bind).
  if [ ! -f "$SMOKE_TOKEN_5" ]; then
    send_sigterm "$pid"
    fail 5 "token file $SMOKE_TOKEN_5 missing after bind"
    return
  fi
  local token
  token="$(cat "$SMOKE_TOKEN_5")"

  local body='{"model":"claude-3-5-haiku-20241022","max_tokens":16,"messages":[{"role":"user","content":"say hi"}]}'

  # ---------------------------------------------------------------------------
  # Sub 5a: stream:true — assert SSE event order.
  # ---------------------------------------------------------------------------
  local stream_body='{"model":"claude-3-5-haiku-20241022","stream":true,"max_tokens":16,"messages":[{"role":"user","content":"say hi"}]}'

  local sse_out attempt
  attempt=0
  while [ "$attempt" -lt 2 ]; do
    set +e
    sse_out="$(run_with_timeout 30 curl -sS -N \
      -H "Authorization: Bearer ${token}" \
      -H "Content-Type: application/json" \
      -H "Accept: text/event-stream" \
      -X POST "http://127.0.0.1:${port}/v1/messages" \
      --data "$stream_body" 2>&1)"
    local sse_rc=$?
    set -e
    # Detect 429 in the response body — the proxy passes upstream status.
    if printf '%s' "$sse_out" | grep -qiE '"type":"error".*"type":"rate_limit_error"|HTTP/1\.[01] 429'; then
      attempt=$((attempt + 1))
      if [ "$attempt" -ge 2 ]; then
        send_sigterm "$pid"
        fail 5 "stream sub-scenario got 429 twice (after 5s backoff)"
        return
      fi
      sleep 5
      continue
    fi
    if [ "$sse_rc" -ne 0 ]; then
      send_sigterm "$pid"
      fail 5 "stream curl failed rc=$sse_rc"
      return
    fi
    break
  done

  # Validate SSE event order: message_start → content_block_delta (≥1) →
  # message_stop. We use `awk` to record line numbers of each marker and
  # then assert ordering.
  local msg_start_line msg_delta_line msg_stop_line
  msg_start_line="$(printf '%s\n' "$sse_out" | grep -n '^event: message_start' | head -1 | cut -d: -f1 || true)"
  msg_delta_line="$(printf '%s\n' "$sse_out" | grep -n '^event: content_block_delta' | head -1 | cut -d: -f1 || true)"
  msg_stop_line="$(printf '%s\n' "$sse_out" | grep -n '^event: message_stop' | head -1 | cut -d: -f1 || true)"

  if [ -z "$msg_start_line" ] || [ -z "$msg_delta_line" ] || [ -z "$msg_stop_line" ]; then
    send_sigterm "$pid"
    fail 5 "SSE missing required events (start=$msg_start_line delta=$msg_delta_line stop=$msg_stop_line)"
    return
  fi
  if [ "$msg_start_line" -ge "$msg_delta_line" ] || [ "$msg_delta_line" -ge "$msg_stop_line" ]; then
    send_sigterm "$pid"
    fail 5 "SSE event order violated (start=$msg_start_line delta=$msg_delta_line stop=$msg_stop_line)"
    return
  fi

  # ---------------------------------------------------------------------------
  # Sub 5b: stream:false — assert content[0].text non-empty.
  # ---------------------------------------------------------------------------
  local nostream_out attempt2
  attempt2=0
  while [ "$attempt2" -lt 2 ]; do
    set +e
    nostream_out="$(run_with_timeout 30 curl -sS \
      -H "Authorization: Bearer ${token}" \
      -H "Content-Type: application/json" \
      -X POST "http://127.0.0.1:${port}/v1/messages" \
      --data "$body" 2>&1)"
    local nostream_rc=$?
    set -e
    if printf '%s' "$nostream_out" | grep -qE '"type":"error".*"type":"rate_limit_error"'; then
      attempt2=$((attempt2 + 1))
      if [ "$attempt2" -ge 2 ]; then
        send_sigterm "$pid"
        fail 5 "non-stream sub-scenario got 429 twice (after 5s backoff)"
        return
      fi
      sleep 5
      continue
    fi
    if [ "$nostream_rc" -ne 0 ]; then
      send_sigterm "$pid"
      fail 5 "non-stream curl failed rc=$nostream_rc"
      return
    fi
    break
  done

  # Validate `content[0].text` is non-empty. We use Node since `jq` is not
  # universally available on Windows runners.
  local validate_rc
  set +e
  printf '%s' "$nostream_out" | "$NODE_BIN" -e '
    let buf = "";
    process.stdin.on("data", (c) => { buf += c; });
    process.stdin.on("end", () => {
      try {
        const j = JSON.parse(buf);
        const t = j && j.content && j.content[0] && j.content[0].text;
        if (typeof t !== "string" || t.length === 0) {
          process.stderr.write("content[0].text empty or missing\n");
          process.exit(1);
        }
      } catch (e) {
        process.stderr.write("JSON parse failed: " + (e && e.message) + "\n");
        process.exit(1);
      }
    });
  ' >/dev/null 2>&1
  validate_rc=$?
  set -e
  if [ "$validate_rc" -ne 0 ]; then
    send_sigterm "$pid"
    fail 5 "non-stream response validation failed"
    return
  fi

  # Tear down and confirm.
  send_sigterm "$pid"
  local wait_elapsed=0
  while [ "$wait_elapsed" -lt 5 ] && is_alive "$pid"; do
    sleep 1
    wait_elapsed=$((wait_elapsed + 1))
  done

  pass 5
}

# -----------------------------------------------------------------------------
# Smoke 6 — embedded proxy `proxy.shutdown` JSON-RPC roundtrip (timeout 15s).
# -----------------------------------------------------------------------------

smoke_6() {
  local port=18767
  rm -f "$SMOKE_REGISTRY_6" 2>/dev/null || true

  # Export DIST_BIN so the inline Node script can resolve it via env.
  export DIST_BIN

  # Drive `ptah interact --proxy-start` via Node so we can read JSON-RPC
  # NDJSON deterministically and inject a request once `session.ready` is
  # observed. Doing this with raw bash + named pipes is tractable but
  # fragile under Git Bash; Node keeps it portable.
  set +e
  "$NODE_BIN" -e "
    const { spawn } = require('node:child_process');
    const net = require('node:net');
    const child = spawn(process.execPath, [process.env.DIST_BIN, 'interact', '--proxy-start', '--proxy-port', '$port'], {
      stdio: ['pipe', 'pipe', 'inherit'],
    });
    let stdoutBuf = '';
    let sentShutdown = false;
    let receivedResp = false;
    let timer = setTimeout(() => {
      console.error('smoke6: timeout waiting for session.ready or shutdown response');
      child.kill('SIGTERM');
      process.exit(1);
    }, 15000);
    child.stdout.on('data', (chunk) => {
      stdoutBuf += chunk.toString('utf8');
      let nl;
      while ((nl = stdoutBuf.indexOf('\n')) >= 0) {
        const line = stdoutBuf.slice(0, nl);
        stdoutBuf = stdoutBuf.slice(nl + 1);
        if (!line.trim()) continue;
        let msg;
        try { msg = JSON.parse(line); } catch { continue; }
        if (!sentShutdown && msg.method === 'session.ready') {
          sentShutdown = true;
          const req = JSON.stringify({ jsonrpc: '2.0', id: 'smoke6-shutdown', method: 'proxy.shutdown' }) + '\n';
          child.stdin.write(req);
        } else if (msg.id === 'smoke6-shutdown') {
          receivedResp = true;
          if (!msg.result || msg.result.stopped !== true || msg.result.port !== $port || msg.result.reason !== 'rpc') {
            console.error('smoke6: bad shutdown response: ' + JSON.stringify(msg));
            child.kill('SIGTERM');
            process.exit(1);
          }
          // Confirm port is no longer reachable (TCP connect should fail).
          const sock = net.createConnection({ port: $port, host: '127.0.0.1' }, () => {
            sock.destroy();
            // Port still open — give it ~500ms to close, then re-probe.
            setTimeout(() => {
              const sock2 = net.createConnection({ port: $port, host: '127.0.0.1' }, () => {
                sock2.destroy();
                console.error('smoke6: port $port still accepting connections after shutdown');
                child.kill('SIGTERM');
                process.exit(1);
              });
              sock2.on('error', () => {
                clearTimeout(timer);
                child.stdin.end();
                process.exit(0);
              });
            }, 500);
          });
          sock.on('error', () => {
            clearTimeout(timer);
            child.stdin.end();
            process.exit(0);
          });
        }
      }
    });
    child.on('exit', (code) => {
      if (!receivedResp) {
        console.error('smoke6: child exited rc=' + code + ' before shutdown response arrived');
        process.exit(1);
      }
    });
  " 2>/dev/null
  local rc=$?
  set -e
  if [ "$rc" -ne 0 ]; then
    fail 6 "embedded proxy.shutdown roundtrip rc=$rc"
    return
  fi
  pass 6
}

# -----------------------------------------------------------------------------
# Run all scenarios
# -----------------------------------------------------------------------------

smoke_1
smoke_2
smoke_3
smoke_4
smoke_5
smoke_6

if [ "$failures" -gt 0 ]; then
  echo "[smoke] $failures scenario(s) FAILED, $warnings skipped" >&2
else
  echo "[smoke] all scenarios PASS ($warnings skipped)" >&2
fi
exit "$failures"
