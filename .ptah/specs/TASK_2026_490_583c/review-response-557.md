# Review response — pull request 557

Response to the 9 CodeRabbit review comments on pull request 557
(`docs/task-519-521-defect-register`). All 9 were ACCEPT. Each entry below
gives the file, the comment ID, the fix, and the evidence.

## 1. Comment 4064163122 — `defect-register.md:38` — ACCEPT

**Claim:** Line 26-29 said all seven findings of the `TASK_2026_491_e0da` review
belong to that task and are not filed separately, but line 38 assigns finding 4
to `TASK_2026_519_4f1a`. Two ownership statements for one finding.

**Evidence:** Read of `defect-register.md` lines 24-41 confirmed both
statements as written, and confirmed finding 4's own row already said "Filed
as `TASK_2026_519_4f1a`" — the general statement and the specific row
disagreed.

**Fix:** Reworded the ownership paragraph: six of seven findings are fixed
inside `TASK_2026_491_e0da`; finding 4 is the stated exception, tracked
separately as `TASK_2026_519_4f1a`, because `TASK_2026_519_4f1a/task.md` itself
says the defect is independent of 491 and exists on `main` today. One
authoritative tracking location per finding now holds.

## 2. Comment 4064163141 — `TASK_2026_519_4f1a/context.md:57` — ACCEPT

**Claim:** Acceptance criterion 3 required "its own permission policy" without
naming the two Electron hooks a complete policy needs.

**Evidence:** Electron's own `session` API documentation states
`setPermissionCheckHandler` (synchronous checks) and
`setPermissionRequestHandler` (asynchronous requests) are separate hooks, and
that both must be implemented for complete permission handling.

**Fix:** Reworded criterion 3 to name both handlers explicitly and require
both paths be tested.

## 3. Comment 4064163204 — `TASK_2026_519_4f1a/task.md:12` (+ `context.md:35-38`) — ACCEPT

**Claim:** The unqualified claim that an untrusted automated page "shares
cookies, local storage... with the shell" overstates what a shared
`session.defaultSession` grants, since `webSecurity` stays enabled and direct
script access needs a matching origin.

**Evidence:** `context.md`'s own code block confirms `webSecurity: true` is
set on the automation window. Electron's origin model means a page cannot
directly read another origin's storage under that setting — the real risks
are shared cookies sent on matching-origin requests, shared cache and auth
state, and writes to application-owned origins, not a blanket cross-origin
read.

**Fix:** Reworded both `task.md` (description) and `context.md` (Why it
matters, item 1) to scope the claim to matching origins while keeping the
underlying risk intact.

## 4. Comment 4064163218 — `TASK_2026_520_9c2e/context.md:7` — ACCEPT

**Claim:** markdownlint MD040 — the fenced grep-command block has no language.

**Fix:** Added `text` as the fence language. Mechanical, no wording change.

## 5. Comment 4064163223 — `TASK_2026_520_9c2e/context.md:41` — ACCEPT

**Claim:** Acceptance criterion 1 said "choose one" guard, then said "with CI
as the backstop," leaving it unclear whether CI is a second mandatory gate.

**Evidence:** Re-read of the criterion confirmed the contradiction between
"choose one" and the trailing CI clause.

**Fix:** Reworded: the pre-commit hook (or lint rule) is mandatory, because a
CI-only check still lets a path reach a public branch before the check runs;
a CI check in addition is recommended, not required, to catch anything that
reaches the branch by a route the hook does not cover (for example, a direct
push).

## 6. Comment 4064163237 — `TASK_2026_520_9c2e/context.md:46` — ACCEPT

**Claim:** Acceptance criterion 3's exemption for the `win.ini` fixture token
had no defined scope, so a global exemption for that token would satisfy the
wording while leaving the same token undetected everywhere else under
`.ptah/specs/`.

**Fix:** Reworded criterion 3 to scope the exemption to the
`TASK_2026_497_debb` fixture path, require documentation of the reason, and
require a negative test proving the token is still caught outside that
fixture.

## 7. Comment 4064163251 — `TASK_2026_521_3d8b/context.md:19` — ACCEPT

**Claim:** markdownlint MD040 — the fenced `strictMcpConfig` grep block has no
language.

**Fix:** Added `text` as the fence language. Mechanical, no wording change.

## 8. Comment 4064163263 — `TASK_2026_521_3d8b/context.md:59` — ACCEPT

**Claim:** Acceptance criterion 2 said to "set `strictMcpConfig`" without
pinning the value, so setting it to `false` would technically satisfy the
wording while leaving the collision behavior unchanged.

**Fix:** Reworded criterion 2 to require the exact value `strictMcpConfig:
true`, and required the collision test in criterion 4 to exercise that exact
value, not merely check that the option is set.

## 9. Comment 4064163271 — `TASK_2026_521_3d8b/task.md:14` — ACCEPT

**Claim:** `task.md`'s description said `strictMcpConfig` "appears nowhere in
the repository," which is inaccurate — the string appears in these very spec
files, and the underlying search (`context.md`, `grep --include=*.ts libs
apps`) covers only TypeScript source under `libs` and `apps`, not the whole
repository or every configuration source.

**Fix:** Reworded the description to scope the claim: absent from runtime
source and supported configuration files, per that `*.ts` grep. This did
**not** touch `context.md` acceptance criterion 1, which already hedges
whether the collision is reachable on `main` today — per the task brief, that
hedge is deliberate and load-bearing, and weakening it further would make the
task useless. It was left unchanged.

## Carrier verification

All three touched `task.md` carriers were parsed after the edits (js-yaml
frontmatter parse, since `gray-matter` was not present locally) and confirmed
intact:

| File | status | type | title |
| --- | --- | --- | --- |
| `TASK_2026_519_4f1a/task.md` | `backlog` | `BUGFIX` | `Give the CDP automation window its own session partition` |
| `TASK_2026_520_9c2e/task.md` | `backlog` | `BUGFIX` | `Stop workstation paths reaching .ptah/specs, and add a guard that keeps them out` |
| `TASK_2026_521_3d8b/task.md` | `backlog` | `BUGFIX` | `Set strictMcpConfig so a settings-file server cannot start a second process` |

`description` and `title` remain `>-` block scalars in all three carriers.
`TASK_2026_520_9c2e/task.md` frontmatter was not edited (only its `context.md`
was); it is included in the table because it is one of the three carriers in
scope for this branch.

## Reply count

9 of 9 replies posted to the review threads on pull request 557. No comment
skipped.
