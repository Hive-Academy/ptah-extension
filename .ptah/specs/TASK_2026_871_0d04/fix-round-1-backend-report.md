# Backend fix round 1

## Findings

1. `libs/backend/task-specs/src/lib/task-index.service.ts:382-392`: `readArtifact` now uses `readFolderMarkdown` for canonical containment, regular-file checks, a 1 MiB no-follow read, and binary/UTF-8 checks. Missing returns `null`; other states are logged and thrown through the existing sanitized RPC error path. The RPC shape is unchanged. Tests: `task-index.service.spec.ts:741,759` (linked and oversized documents).
2. `libs/backend/task-specs/src/lib/task-index.service.ts:347-352`: `getDetail` reads `task.md` through the same safe path before parsing. Missing remains `null`; link, decode, oversize, and read failures are logged and thrown. Test: `task-index.service.spec.ts:741` (linked carrier).
4. `libs/backend/task-specs/src/lib/task-index.service.ts:450-459`: listing captures directory metadata and canonical path before enumeration and checks them again before returning. It rejects changed identity or containment. The 200-entry cap runs immediately after `readDirectory`; this port has no bounded enumeration operation. Test: `task-index.service.spec.ts:771` (directory swap).
5. `libs/shared/src/lib/cli-version-label.ts:23-29`: only full-line numeric versions or numbers following CLI/version context become version labels; a full-line calendar date is excluded. Tests: `cli-version-label.spec.ts:9-14` (date, build date, `codex-cli 0.50.1`, `1.2.3`).

## Verification

- `npm run verify -- -t typecheck,lint -p @ptah-extension/task-specs,@ptah-extension/shared,@ptah-extension/rpc-handlers`: exit 1 before checks; Nx default, ESLint, and Jest plugin subprocesses failed with `spawn EPERM`.
- `npm run verify -- -t test -p @ptah-extension/task-specs -- --testPathPatterns=task-index`: exit 1 before Jest; Nx plugins failed with `spawn EPERM`.
- `npm run verify -- -t test -p @ptah-extension/shared -- --testPathPatterns=cli-version-label`: exit 1 before Jest; Nx plugins failed with `spawn EPERM`.
- `npx tsc --noEmit --project libs/backend/task-specs/tsconfig.spec.json`: exit 0.
- `npx tsc --noEmit --project libs/shared/tsconfig.spec.json`: exit 0.
- Direct Jest task-index spec: 1 suite, 33 tests passed, exit 0.
- Direct Jest cli-version-label spec: 1 suite, 21 tests passed, exit 0.
- Scoped Ptah diagnostics unavailable: TypeScript check still running after 45 seconds, four files unchecked.

## Decisions

- Kept `tasks:getArtifact` as `content: string | null` and surfaced non-missing failures through its existing sanitized error path. Options: optional response states or thrown errors. Evidence: existing handler catches and sanitizes errors. Reversible: yes.
- Reused `readFolderMarkdown` for carrier and recognized documents. Options: duplicate safety code or reuse. Evidence: it already implements the required bounded no-follow read. Reversible: yes.
- Used the current `readDirectory` port with an immediate identity recheck. Options: new handle-based port or recheck. Evidence: review permits recheck; assigned scope excludes platform ports. Reversible: yes.
