# TASK_2026_423 — Context

## Origin

Found while fixing TASK_2026_421 (Codex agents never reached `completed`).

## Evidence

- Measured 2026-09-11: every Ptah-spawned `codex.exe` had a `powershell.exe`
  child started a few seconds after it, whose encoded command is the
  "Long-lived PowerShell AST parser used by the Rust command-safety layer on
  Windows" (it reads JSON requests over stdin).
- TASK_2026_421 now leaves the SDK event loop on `turn.completed` /
  `turn.failed`; the SDK `CodexExec.run` `finally`
  (`node_modules/@openai/codex-sdk/dist/index.js` ~296-303) calls
  `child.kill()`, which on Windows terminates `codex.exe` only.
- When `ptah_agent_stop` stopped agent `bc4db206`, both `codex.exe` (15900) and
  the PowerShell child (26632) exited — so a full stop cleans up; whether the
  turn-end `child.kill()` does is NOT yet measured.

## To do

1. Measure: after a Codex turn ends through the TASK_2026_421 path, does the
   PowerShell child outlive `codex.exe`?
2. If yes: kill the process tree for the Codex child. The SDK does not expose
   the child pid, so options include the SDK's `codexPathOverride` wrapper,
   a Job Object, or a post-turn sweep by parent pid. Follow the
   `cli-agent-runtime` rule that tree kills await a known pid.
