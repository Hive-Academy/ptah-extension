# Code logic re-review — TASK_2026_712_5d7c phase P1-A fixes

Verdict: REVISE

Commit `2ef3b39a1`. Scope: the six files in that commit, read in full for the three account sources and the new or still-binding specs. No nx, jest, tsc, lint, or build. Findings 1–3 from `code-logic-review-phase-p1-a.md` are fixed. One new moderate regression remains.

| Metric | Value |
| --- | --- |
| Blocking | 0 |
| Serious | 0 |
| Moderate | 1 |
| Failure modes | 1 |

## Five logic questions

1. Silent failure: an in-flight status read no longer writes `pending` or a new `auth_epoch`. A proved non-ok status still returns a non-ok action code, but the stored row stays `not-signed-in` (or whatever it already was), so a later reader sees an idle account.
2. User action: status whose stdout exceeds 16,384 bytes, or any other proved non-ok status, on a row that is not `signed-in`.
3. Wrong answer: that row used to become `failed`. It now stays `not-signed-in`. `signed-in` plus a proved failure still becomes `disconnected`.
4. Dependency failure: a link swapped in before resolve or inside the insert transaction is `route-changed`, the target is not inserted, and cleanup does not `rmdir` the link. An unproved status (`terminated: false`) keeps the operation row, so a later sign-in is `busy`. A thrown store error still rolls back that transaction.
5. Missing: proved status no longer has a `failed` or `cancelled` state. Only ok `claude.ai` / ok `none`, or `signed-in` → `disconnected`, change the row.

## Findings 1–3

### 1. RESOLVED — status no longer reserves as sign-in

`readStatus` still refuses a `pending` row (`provider-account-actions.service.ts:46`) and `run` still refuses `pending` or a live handle (`:81`) before any reserve. Kind `status` calls `reserveStatus` (`:86-87`). `reserveAuth` is only the login/logout branch (`:88-89`) and is unchanged: it still sets `state = 'pending'`, `auth_epoch + 1`, and `revision + 1` (`provider-account.store.ts:271-273`).

`reserveStatus` (`:222-236`) inserts a `status` operation using the current `auth_epoch` and `revision` and does not update the profile. `completeStatus` (`:252-257`) increments `revision` only when `profile.state !== state`, and deletes the operation only when `terminated` is true. The in-memory handle adds `0` to the revision for status and `1` for sign-in/sign-out (`provider-account-actions.service.ts:123-124`). Login/logout completion is still the block at `:110-119`.

Cross-connection exclusion: `unoccupied` rejects any row in `provider_account_operations` for that fingerprint (`provider-account.store.ts:344-348`). `reserveAuth` calls it with runs included (`:270`) before inserting, so a held status operation makes sign-in `busy` without writing `pending`. The spec at `provider-account.store.spec.ts:78-90` matches that, and `provider-account-actions.service.spec.ts:109-122` keeps epoch, state, and revision equal across an idle signed-in `claude.ai` status.

### 2. RESOLVED — ok `none` / `claude.ai`, and failed or unproved signed-in

`provider-account-actions.service.ts:103-105`: terminated ok `claude.ai` → `signed-in`; terminated ok `none` → `signed-out`; every other outcome on a `signed-in` snapshot → `disconnected`; every other outcome otherwise keeps `profile.state`. `completeStatus` never writes `auth_epoch` (`provider-account.store.ts:252-258`).

Proved non-zero exit and invalid proof are terminated non-ok (`claude-account-command.ts:206` and `:211-212`), so a signed-in row becomes `disconnected` and the operation is removed. Unproved timeout (`terminated: false`) takes the same `disconnected` mapping and `completeStatus` leaves the operation (`provider-account.store.ts:255-258`), so the next sign-in hits `unoccupied` and returns `busy`. Specs: `provider-account-actions.service.spec.ts:126-150`.

### 3. RESOLVED — link swap is not stored

`withNewProviderAccountDirectory` lstats the mkdir inode (`provider-account-route.ts:69`), resolves, then `validateOwned` (`:72-86`) before `commit`. The check requires both the captured inode and the current lstat to be a non-link directory with the same `dev`, `ino`, and `birthtimeNs`, and the realpath stat to be that same directory inode, then `revalidateProviderAccountRoute`. `insert` calls that function again inside `BEGIN IMMEDIATE`, after the duplicate and `unoccupied` checks and before `INSERT` (`provider-account.store.ts:120-129`).

On throw, cleanup `rmdir`s only when the path is still not a symlink and still that inode (`provider-account-route.ts:89-93`). A symlink or junction fails the lstat test, so the link and its target stay, and the profile insert does not run. A different target inode cannot pass even if `isSymbolicLink()` were false, because `current.ino` would not equal `owned.ino`. Specs: `provider-account-route.spec.ts:61-72`, `provider-account.store.spec.ts:93-125`.

## New findings

### 1. Moderate — proved non-ok status of a non-signed-in row no longer persists `failed`

- File: `libs/backend/auth-providers/src/lib/accounts/provider-account-actions.service.ts:102-108`
- Defect: the status branch returns before the shared completion at `:112-116`. That older block still maps a non-ok, non-cancelled result to `failed` when the snapshot is not `signed-in`, and maps `cancelled` to `cancelled`. Status never reaches it. For any outcome that is not terminated ok `claude.ai` or terminated ok `none`, a row that is not `signed-in` is written back as `profile.state` (`:105`). `completeStatus` then sees no state change, so it also does not bump `revision` (`provider-account.store.ts:252-258`).
- Failure scenario: a new account is `not-signed-in` (`0058_provider_accounts.ts:21`). Status stdout exceeds 16,384 bytes, the child closes, and the command finishes `{ code: 'unsupported-source', terminated: true }` (`claude-account-command.ts:200-205`). The caller receives `unsupported-source`, and the row stays `not-signed-in` with the same revision. The same hole applies to a proved non-zero exit or invalid proof on `signed-out` or `disconnected`: the action code is the failure, and the stored state is unchanged, so the account still looks like the last good observation. `provider-account-actions.service.spec.ts:221-229` still expects `failed` after that overflow. Disposal of an unproved status correctly keeps `not-signed-in` and the operation (`provider-account.store.spec.ts:156-158`); this finding is the proved path, where the operation is deleted and the failure is dropped from the row.
- Fix: for proved status that is not ok `claude.ai` or ok `none`, keep `signed-in` → `disconnected`, and keep the previous non-ok mapping for every other state (`failed`, and `cancelled` when the code is `cancelled`). Do not let that mapping increment `auth_epoch` or set `pending`.

## Checked, not filed

- Sign-in and sign-out reservation and completion were not edited. Cancel still requires kind `login` and the post-reserve revision (`provider-account-actions.service.ts:66-68`, `:123-124`).
- Status does not re-run a second status on ok (`:96`). Login and logout still do, and still use `:110-119`.
- `provider_account_operations.kind` has no check that would reject `status` (`0058_provider_accounts.ts:43-54`). `route_fingerprint` is unique, so a second operation on that route conflicts.
- Unproved status exclusion without `pending` matches the requested retain. It is visible as `busy` from `unoccupied`, not as `pending`.
- Residual: specs were not executed in this pass. Junction behavior was traced from the lstat/inode checks and the specs, not run here. A swap after the in-transaction `validateOwned` and before `INSERT` can still change the directory under a route object that was already resolved to the owned inode; that window does not store the link target's identity.
