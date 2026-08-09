---
id: TASK_2026_191
status: done
type: BUGFIX
title: Defence-in-depth cwd containment at the PtyManager spawn sink
description: TASK_2026_174 contains terminal cwd to workspace-or-home at the RPC handler, but PtyManagerService.create (the actual pty.spawn site) does not re-validate it. A future second caller of IPtyHost.create would bypass containment. Not exploitable today (single caller). Also folds two inherited, low-severity containment weaknesses (lexical vs realpath; case-fold over-acceptance) found in the same review.
assignee:
depends_on: [TASK_2026_174]
executor:
claim:
created: 2026-08-09T00:00:00.000Z
updated: 2026-08-09T00:00:00.000Z
---

## Description

### Origin

Deferred follow-up F4 from the TASK_2026_174 code-logic (security) review
(`code-logic-review.md`). Deferred deliberately at implementation time rather
than force-fit, because closing it cleanly needs a small design decision, not a
quick patch. F1 and F2 from the same review (inherited, low severity) are folded
in here because they live in the same cwd-containment area.

### F4 — the asymmetry (primary)

`libs/backend/rpc-handlers/src/lib/handlers/terminal-rpc.handlers.ts:81-88`
enforces cwd containment (`isAuthorizedTerminalCwd`) at the RPC boundary. But the
actual spawn site, `apps/ptah-electron/src/services/pty-manager.service.ts:66`
(`create` → `pty.spawn(shell, [], { cwd })`), does **not** re-validate cwd — it
has only a `logger` injected. 174 added the equivalent defence-in-depth for
`shell` at this sink (`pty-manager.service.ts:75`), but not for `cwd`.

Today there is exactly one production caller of `IPtyHost.create` (the RPC
handler, which already contains cwd), so this is a **latent asymmetry, not a live
bug** — a future second caller of the port would inherit the shell guard yet get
unbounded cwd.

The design tension (why it was deferred): a genuine guard at the sink needs the
authorized-root set (open workspace folders + home), which lives behind
`IWorkspaceProvider` in `rpc-handlers`. Closing it requires one of:

1. injecting `IWorkspaceProvider` into the Electron main-process spawn service —
   couples the sink to workspace state (the explicit anti-goal); or
2. changing the `IPtyHost.create` port signature (in `platform-core`) to carry
   the authorized roots down from the handler — a shared-port change for a
   single-caller case.
   A shallow `path.isAbsolute(cwd)` check is NOT acceptable — it is security theatre
   (an absolute path outside the workspace still passes). Pick option 2 or an
   equivalent that keeps the sink decoupled from workspace discovery.

### F1 — lexical containment, not realpath (inherited, low)

`libs/backend/rpc-handlers/src/lib/utils/workspace-authorization.ts` `normalize`
uses `path.resolve`, not `fs.realpath`. A junction/symlink inside the workspace
pointing outward passes containment lexically. Severity is low: the policy
already permits the entire home dir as cwd, so this is strictly weaker than an
already-allowed primitive, and it costs an FS call (the reason 174 excluded it).
Decide: add `fs.realpathSync.native` before compare, or document the lexical-only
guarantee.

### F2 — case-fold over-acceptance on case-sensitive FS (inherited, low)

`normalize` lowercases paths, so `/WORKSPACE/x` folds to match `/workspace` on a
case-sensitive filesystem. Negligible (needs the variant path to exist; `..` is
collapsed first), but the fix is cheap: fold case only on win32.

### Scope

Primary: close F4 without coupling the sink to workspace discovery (favour the
port-signature / pass-authorized-roots approach). Secondary: address F1 and F2
in `workspace-authorization.ts` or explicitly accept them with a documented note.

### Acceptance criteria

1. `PtyManagerService.create` rejects a cwd outside the authorized roots, asserted
   at the `pty.spawn` call site (node-pty mocked), without injecting workspace
   discovery into the sink.
2. F1 addressed (realpath) or explicitly accepted with a rationale in the review
   trail.
3. F2 addressed (win32-only case fold) or explicitly accepted.
4. `rpc-handlers` and `ptah-electron` suites green; no regression to the 174
   assertions.

### Related

- `TASK_2026_174` — origin (review findings F1, F2, F4); shares the
  `shell`-guard-at-sink pattern this extends to `cwd`.
