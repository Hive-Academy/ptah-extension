# P1-A review fixes

All three findings addressed within the six assigned source/spec files. No task state changed.

## Finding 1 — status reservation and revision stability

- `libs/backend/auth-providers/src/lib/accounts/provider-account-actions.service.ts:86`: status uses `reserveStatus`, after the unchanged authorization short-circuit (D7).
- `libs/backend/auth-providers/src/lib/accounts/provider-account.store.ts:222`: status inserts its own operation exclusion using the existing epoch/revision; it never sets pending or increments the epoch. Cross-connection auth remains excluded while status runs.
- `libs/backend/auth-providers/src/lib/accounts/provider-account.store.ts:240`: completion compares owner, operation, epoch and revision; only a changed persisted state increments revision. Unproved termination retains the operation.
- Sign-in/sign-out reservation and completion behavior remains unchanged.
- Specs: `idle signed-in status preserves epoch, state and revision and never makes sign-in busy by pending`; `status reservation keeps row unchanged and excludes auth across connections until completion`. The existing disposal parameterized spec now expects status to preserve not-signed-in rather than pending.

## Finding 2 — observed status mapping

- `libs/backend/auth-providers/src/lib/accounts/provider-account-actions.service.ts:102`: terminated ok claude.ai maps to signed-in; terminated ok none maps to signed-out. Non-ok or unproved status of a signed-in profile maps to disconnected, without changing the epoch. Logout retains its existing mapping.
- Specs: `status %s with exit %s persists %s without changing epoch` (four cases: none/ok, claude.ai/ok, nonzero exit, invalid proof); `unproved status termination marks signed-in disconnected and retains exclusion`.

## Finding 3 — Add ownership verification

- `libs/backend/auth-providers/src/lib/accounts/provider-account-route.ts:69`: retain the post-mkdir lstat identity. Validate directory type, absence of a link, and dev/ino/birthtime equality; verify the realpath-resolved canonical stat has the owned dev/ino. Refuse with typed route-changed errors.
- `libs/backend/auth-providers/src/lib/accounts/provider-account.store.ts:115` and `:126`: pass the ownership check into insertion and invoke it inside the transaction immediately before INSERT.
- Cleanup remains non-recursive rmdir restricted to the owned empty inode; replacement links and their targets are preserved.
- Specs: `Add refuses a directory swapped for a link after mkdir and never stores the link target`; `Add rechecks ownership inside the insertion transaction before storing a route`; `rechecks owned identity at commit and preserves a replacement link and its target`. These use directory symlinks on Unix and junctions on Windows, matching existing specs. No skips added.

## Decisions

- Reuse the existing operations table with kind status, rather than add storage/schema or process-local exclusion. Evidence: migration 0058 permits status kind, and existing store unoccupied checks already arbitrate operations across connections. Reversible without a migration.
- Retain status exclusion when termination is unproved, while persisting disconnected for a formerly signed-in row. Evidence: explicit finding 2 and existing uncertain-process ownership behavior. Reversible implementation choice; no authorization policy changed.

## Verification and anything not done

- Scoped ptah_get_diagnostics on all six changed files returned zero errors and zero warnings (typescript-compiler, coverage clean).
- The final additional store regression also passed scoped ptah_get_diagnostics: zero errors and zero warnings, coverage clean.
- No nx, Jest, tsc, lint, build, real provider binary, network/sign-in, or git commands were run. Specs were written but not executed, per assignment; CI must execute them.

