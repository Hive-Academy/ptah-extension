# TASK_2025_202: Fix Remaining Electron App Issues

## Task Type: BUGFIX

## Complexity: Medium

## Workflow: Minimal (Team-Leader -> Developer)

## User Request

Fix all remaining issues found in the Electron app audit. Includes 2 blocking issues (TypeScript types, API mismatch), 6 important issues (window persistence, IPC wiring, platform detection, DI verification, file dialogs, auto-updater).

## Issues

### BLOCKING

1. TypeScript `electron` types not resolving in tsconfig.app.json (tsc --noEmit fails)
2. SubagentRegistryService API mismatch - getSubagent()/getResumableSubagents() should be get()/getResumable()/getResumableBySession()

### IMPORTANT

3. Window state persistence - saves bounds on close but never restores on restart
4. IPC broadcastMessage wiring verification
5. Angular platform detection for isElectron flag
6. DI container verification at startup
7. Native file save dialog for quality:export
8. Auto-updater not configured

## Dependencies

- TASK_2025_200 (Electron Application) — COMPLETE
- TASK_2025_201 (RPC Methods and DI Gaps) — COMPLETE
