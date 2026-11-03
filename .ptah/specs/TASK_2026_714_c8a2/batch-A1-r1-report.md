# Batch A1-r1 report

## Fix

Chat admission now requires the shared chat gate, a chat-covering `PTAH_CODEX_RUNTIME_DEV` route, or packaged Electron win32/x64. Lane admission retains its existing unpackaged/gate/packaged-win32-x64 rule. The Electron chat resolver uses `resolveGatedCodexRuntime` for unpackaged runs, so the dev-route check and warning execute; the raw session runtime remains limited to packaged win32/x64 with the shared gate closed. The resolver consistently uses `input.platform`. Gateway admission and MCP wiring are unchanged.

## Files written in this revision

- `apps/ptah-electron/src/di/codex-electron-admission.ts` — consumer-specific chat and lane predicates.
- `apps/ptah-electron/src/di/codex-runtime-composition.ts` — pass the parsed dev route to chat admission and restore the gated resolver for unpackaged chat.
- `apps/ptah-electron/src/di/codex-runtime-composition.spec.ts` — restore unpackaged no-env expectations; add gateway-only route admission, no-env resolver refusal, and chat dev-route resolver/warning cases.
- `.ptah/specs/TASK_2026_714_c8a2/batch-A1-r1-report.md` — this report.

## Checks

All four files written in this revision have zero CR bytes and no UTF-8 BOM. `git diff --check` reported no whitespace errors. Tests, typecheck, lint, build, Nx, npm, verify, and diagnostics were not run because this lane's first rules reserve them for the coordinator. Skill invocation was unavailable in this CLI; no matching skill was loaded.
