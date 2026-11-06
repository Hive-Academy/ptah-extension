# Revise round 2 (a) — kernel-arbitrated worker file lock

## Problem

`file-lock.ts` used a `<file>.lock` directory with an owner record and a
read-then-rename steal (`stealAbandoned`). Because POSIX has no conditional
rename, a process that read a dead owner could later rename away a lock a
third process had just acquired, breaking mutual exclusion.

## What changed

- `libs/backend/worker-runtime/src/lib/file-lock.ts` (rewritten)
  - `:61` `fileLockEndpoint(file)` (module-private): name
    `ptah-worker-lock-<userKey>-<sha256(path.resolve(file)) hex[0..32]>`;
    Linux `\0<name>` (abstract Unix socket), Windows `\\.\pipe\<name>`,
    otherwise throws `Worker file locks need Linux or Windows`.
  - `:109` `bind()`: `net.createServer(socket => socket.destroy())` then
    `listen(endpoint)`. Success → `server.unref()` and return it;
    `EADDRINUSE` → `undefined` (busy); any other listen error propagates.
  - `:95` `acquireBefore()`: retries `bind` every `POLL_MS` (25 ms) until the
    deadline, then throws `FileLockBusyError(file)`.
  - `:72` `locked()`: runs the operation, then `closeServer()` (`:129`,
    awaited `server.close`). A close failure goes to `onReleaseError` or a
    process warning (`reportRelease`, `:145`); the operation's own result or
    error is still what the caller gets.
  - `:136` `userKey()`: UID on POSIX; on Windows a sha256 of the
    NFKC-lowercased username (same idea as platform-core's
    `endpoint-names.ts`, reimplemented locally because that helper is not on
    platform-core's public entry and platform-core is not a worker-runtime
    dependency).
  - Unchanged public API: `withFileLock`, `FileLockOptions { timeoutMs?,
    onReleaseError? }`, `FileLockBusyError` (`code: 'FILE_LOCK_BUSY'`,
    `.file`), and the in-process `tails` per-file queue (`:29`, `:39`).
  - Removed: `LockOwner`, owner file, `acquire` (staging/rename), `release`
    by nonce, `stealAbandoned`, `abandoned`, `sameOwner`, `readOwner`,
    `parseOwner` (legacy parsing, and its degradation-audit comment),
    `exists`, `hasCode`.
- `libs/backend/worker-runtime/src/lib/process-state.ts`: removed
  `processStartTime` and the `readFile` import. Grep over `libs/`, `apps/`,
  `tools/`, `docs/` found no other user. `processState` kept (used by
  `libs/backend/worker-host/src/lib/commands/status.ts:62`).
- `libs/backend/worker-runtime/src/lib/file-lock.spec.ts` (rewritten, all
  Linux-gated with `process.platform === 'linux' ? it : it.skip`):
  - `:69` child process (`process.execPath -e`, binds the same abstract name
    passed via argv) holds the lock → `FileLockBusyError` with
    `code`/`file` after `timeoutMs`; operation never called.
  - `:88` after `SIGKILL` of the holder the lock is acquired with
    `timeoutMs: 0` (no takeover delay).
  - `:101` after release, another process can bind the name.
  - `:112` in-process callers serialize.
  - `:132` operation error propagates and the lock is free afterwards.
  - `:144` `net.Server.prototype.close` spied to really close then report an
    error → `onReleaseError` receives it for both success and failure paths;
    result/error still returned.
  - `:175` a legacy `<file>.lock` directory with an `owner.json` naming a
    live PID does not block acquisition (`timeoutMs: 0`).
  - The spec spells out the Linux name formula (`linuxLockName`), so a naming
    change that would split one file into two locks fails the tests.
- `libs/backend/worker-host/docs/worker.md:55`: paragraph now describes an
  OS-held lock per file, automatic release on exit or crash, the two-second
  "Worker file is busy" failure, and that old `*.lock` directories are
  ignored.
- `token-store.spec.ts` / `workspace-registry.spec.ts`: no dependency on lock
  internals; unchanged.

## Decisions

- Lock name hashing over `path.resolve(file)`, not `realpath`: the file may
  not exist yet at first write and the spec mandated `path.resolve`.
  Reversible.
- `fileLockEndpoint` kept module-private so the package's public surface
  (`export *` from `index.ts`) is unchanged. Reversible.
- Windows user key uses sha256 instead of platform-core's FNV-1a; both are
  local naming choices, worker is Linux-only today. Reversible.
- Legacy `.lock` directories are left on disk (no deletion of user files);
  the doc tells the operator they may delete them.

## Verification (real results)

- `npx ts-node --transpile-only tools/degradation-audit/check-degradation.ts`
  → exit 0 (`TOTAL 218 unsuppressed site(s)`).
- `npm run verify -- -p @ptah-extension/worker-runtime` →
  `NX 3 tasks: 3 succeeded` (lint, test, typecheck; 0/3 cache hit),
  `lock released after 296.1s, exit code 0`.
- `node scripts/verify.mjs --exec --task file-lock-spec -- npx jest -c
  libs/backend/worker-runtime/jest.config.ts .../file-lock.spec.ts
  --maxWorkers=1 --verbose` → `Tests: 7 passed, 7 total` (none skipped on
  this Linux host).
- `npx prettier --write` on the four changed files.
- worker-host lint not run (only `worker.md` changed there).

## Remaining limits

- Two spellings of one file through a symlink resolve to different lock
  names (same as the directory lock before, which was also path-based).
- Abstract Unix sockets are scoped to the network namespace: processes in
  different network namespaces (e.g. one in a container with its own netns)
  do not exclude each other. The old directory lock did work across
  namespaces sharing a filesystem. The worker is documented as a single-host
  user service, so this is acceptable but worth knowing.
- macOS and other platforms throw on use; the worker is Linux-only
  (docs/worker.md line 5). Windows path is implemented but untested here.
- Abstract sockets have no file permissions, so any local process (even of
  another user) that knows the UID and path hash could pre-bind a name and
  make our commands fail with "Worker file is busy". That is a
  denial-of-service only, never a false acquisition; the old directory under
  `~/.ptah/worker` was protected by directory permissions instead. The same
  property already applies to the session driver locks in platform-core.
