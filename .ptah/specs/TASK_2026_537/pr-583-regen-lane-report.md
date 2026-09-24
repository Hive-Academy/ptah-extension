# PR 583 Review Lane — regen-agents.mjs Fixes

Scope: `scripts/regen-agents.mjs` only. Both CodeRabbit comments were verified against the code before the fix.

## Changes

1. Read error handling (comment 1, confirmed valid). `scripts/regen-agents.mjs:20` — the catch swallowed every read error, so an existing unreadable file read as `null` and skipped the `isPtahOutput` guard. The catch now rethrows unless `error?.code === 'ENOENT'`.
2. Atomic write (comment 2, confirmed valid). `scripts/regen-agents.mjs:10` imports `atomicWriteWithRetry` from `libs/backend/harness-sync/src/lib/fs/atomic-write.ts` through the same `jiti.import(...)` pattern the script already uses for the transformers. `scripts/regen-agents.mjs:26` calls it in place of `writeFileSync`. The unused `writeFileSync` import was removed from the `node:fs` import on line 3.

Pre-check of the imported module: `atomicWriteWithRetry(path, content): void` is synchronous (temp file + `renameSync` + retry via `withWindowsRetrySync`). Its only imports are `node:fs`, `node:path` and the sibling `./windows-retry`, which also has only Node built-in imports and uses `Atomics.wait` for the sync sleep. jiti loads both.

The `isPtahOutput` guard, the skipped/changed logic and the output text are unchanged.

## Verification

Run from the worktree root `D:\projects\ptah-extension\.claude-worktrees\skills-no-prototype`:

```
> node scripts/regen-agents.mjs
WOULD CHANGE 0

> node scripts/regen-agents.mjs --write
WROTE 0

> git status --short
 M scripts/regen-agents.mjs
```

No `SKIPPED` line appeared. After `--write`, only `scripts/regen-agents.mjs` is modified. Git was not mutated.

## Lane-introduced constraints

none