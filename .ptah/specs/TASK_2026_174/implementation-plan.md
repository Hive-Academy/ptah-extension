# Implementation Plan — TASK_2026_174 (P2: Allowlist + Schema Design)

**Phase**: P2 only — design the `shell` allowlist, the `cwd` containment, the
`terminal-rpc.schema.ts` boundary, and the spawn-site assertion seam. No code is
changed by this document; it is the blueprint the team-leader decomposes.

**Ground truth**: `research-report.md` (P1). Not re-derived here. Every fact this
plan builds on is cited there.

**Scope guardrails carried forward from P1 (do not violate):**

- Electron is the only host that serves `terminal:*`. The one `pty: true` is
  `apps/ptah-electron/src/rpc-host-profile.ts:40`. Do **not** add `pty` to any
  other profile.
- Preserve the exact-set tripwire at
  `libs/backend/cli-engine/src/lib/rpc/rpc-surface.spec.ts:67-69` — it stays
  green untouched because the registered surface does not change.
- Nothing upstream validates `params` (P1 §3). The schema must live at the
  handler.
- `shell` and `cwd` have zero first-party callers (P1 §5). Narrowing breaks no
  user today. The sole caller sends `{ name }`.
- The sink is `apps/ptah-electron/src/services/pty-manager.service.ts:90` —
  `pty.spawn(shell, [], { cwd, ... })`, args literally `[]`.

---

## 1. Codebase investigation summary (verified for P2)

| Fact                                                                      | Source (verified)                                                                                    |
| ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Handler passes `shell`/`cwd` through unvalidated                          | `libs/backend/rpc-handlers/src/lib/handlers/terminal-rpc.handlers.ts:62,71-75`                       |
| Reject-convention schema shape to copy                                    | `libs/backend/rpc-handlers/src/lib/handlers/git-rpc.schema.ts:16-34` (`safeParse` → `null`)          |
| Schema validates shape; handler does the context check separately         | `git-rpc.schema.ts:9-12` (path traversal handled by handler, not schema) — direct precedent          |
| Workspace containment predicate to reuse                                  | `libs/backend/rpc-handlers/src/lib/utils/workspace-authorization.ts:13-35` (`isAuthorizedWorkspace`) |
| Its normalization + separator-boundary check                              | `workspace-authorization.ts:20-25,29-34`                                                             |
| Denylist alternative evaluated and rejected                               | `libs/backend/platform-core/src/utils/workspace-path-guards.ts:25-59` (`isUnsafeWorkspacePath`)      |
| `process.platform` is used directly in platform-core utils already        | `workspace-path-guards.ts:11`                                                                        |
| Sink defaults + spawn call                                                | `pty-manager.service.ts:82,90,244-249`                                                               |
| Port stays `shell?: string` — no shared-type change                       | `libs/backend/platform-core/src/interfaces/pty-host.interface.ts:10-17`                              |
| `IWorkspaceProvider` gives `getWorkspaceRoot()` + `getWorkspaceFolders()` | `libs/backend/platform-core/src/interfaces/workspace-provider.interface.ts:16,24`                    |
| `terminal:` already in the runtime prefix guard                           | P1 §3 (`rpc-handler.ts:68`) — dual-registration NOT triggered                                        |

---

## 2. Decision 1 — the `shell` allowlist

### Decision

A **per-platform basename allowlist**, evaluated by a pure predicate
`isAllowedShell(shell, platform?)`, with **path separators rejected outright**.

```
isAllowedShell(shell, platform = process.platform):
  shell === undefined            -> true      # absent = host default (the only common case)
  contains '/' or '\'            -> false      # no attacker-chosen absolute path
  platform === 'win32'           -> WIN_SHELLS.has(shell.toLowerCase())
  otherwise                      -> POSIX_SHELLS.has(shell)
```

- `WIN_SHELLS = ['cmd.exe','powershell.exe','pwsh.exe','wsl.exe','bash.exe']`
  (compared case-insensitively).
- `POSIX_SHELLS = ['bash','sh','zsh','fish','dash','ksh']`.

Bare basenames only. A permitted `shell` reaches `pty.spawn('bash', [], …)` and
node-pty resolves it through the OS `PATH` — the standard trusted resolution.

### Rationale

- **Rejecting path separators eliminates the exact primitive P1 §4 names**:
  "launch any binary that already exists … in a directory of your choosing"
  plus "cwd control + a no-arg spawn is the classic DLL-sideloading setup on
  Windows". If the caller cannot supply a path, they cannot point the spawn at a
  binary in a directory they control (`/tmp/evil/bash`, a UNC path). What remains
  is "run a well-known shell by name, resolved by the OS" — the intended feature.
- **Basename allowlist is durable** where a path-literal list is not: P1 §5 lists
  Homebrew (`/opt/homebrew/bin/fish`), Nix (`/nix/store/<hash>/bin/…`), and
  per-user installs. Those all resolve by name on `PATH`; enumerating their
  absolute paths is impossible and ages badly.

### Trade-off rejected

- **Path-literal allowlist** (enumerate full absolute paths): rejected — cannot
  cover Nix store hashes or Homebrew/per-user prefixes; breaks legitimate exotic
  shells the moment they live somewhere unusual (P1 §5).
- **Basename allowlist that still permits full paths** (check `basename(shell)`
  against the set, allow the path through): rejected — re-introduces the
  sideload primitive, because `basename('/tmp/evil/bash') === 'bash'` passes the
  set check while still handing an attacker-controlled absolute path to
  `pty.spawn`. Basename-with-separators-forbidden is strictly safer at no real
  cost.
- **Resolve-and-verify** (canonicalize the supplied path, stat it, confirm it is
  a known shell): rejected for P2 — needs filesystem access, which
  `rpc-handlers` must not do directly (platform-agnostic lib). It buys nothing
  over "reject separators + resolve by name via PATH" while adding an
  injected-port dependency. Left as a possible follow-up if a shell-picker ever
  needs absolute paths.

### Where the allow-set lives

**`libs/backend/platform-core/src/utils/shell-allowlist.ts`** (new), exported
from `libs/backend/platform-core/src/index.ts`. It exports `WIN_SHELLS`,
`POSIX_SHELLS`, and `isAllowedShell`.

**Rationale**: `platform-core` is the shared leaf that **both** consumers already
import — `rpc-handlers` (for the Zod refine) and `apps/ptah-electron` (for the
spawn-site defence in Decision 4). Co-locating it there gives a **single source
of truth** consumed on both sides, so the two guards cannot drift. It sits beside
the existing `workspace-path-guards.ts`, which is the established home for
exactly this kind of pure, `process.platform`-aware guard (platform-core CLAUDE.md:
"a few tiny logic-light … platform-shared" helpers). It is a pure function, not a
port, so it does not need a `PLATFORM_TOKENS` entry or an adapter.

**Rejected alternative**: defining the allowlist inside `terminal-rpc.schema.ts`
and importing it into `pty-manager.service.ts`. That would couple an Electron
main-process service to a lib's boundary-validation file and invert the natural
dependency (schema files are per-namespace boundary validators, not shared
vocabularies).

### Platform selection without importing an adapter

`isAllowedShell` reads `process.platform` (a Node runtime global present in all
three hosts), exactly as `workspace-path-guards.ts:11` already does. No
`platform-{electron,vscode,cli}` adapter is imported anywhere in this change.

### Before / after accepted-values delta (AC 5 — put this in the PR body)

| Field   | Accepted **before**                                                    | Accepted **after**                                                                                                                                                                                                                                                                                                                  |
| ------- | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `shell` | `undefined` **or any string whatsoever** (`shell?: string`, no schema) | `undefined` (→ host default) **or** one bare basename, no path separators: win32 ∈ {`cmd.exe`,`powershell.exe`,`pwsh.exe`,`wsl.exe`,`bash.exe`} (case-insensitive); posix ∈ {`bash`,`sh`,`zsh`,`fish`,`dash`,`ksh`}. Any other value, and any value containing `/` or `\` (including `/bin/bash`, `C:\…\cmd.exe`), is **rejected**. |
| `cwd`   | `undefined` or any string, used verbatim                               | `undefined` (→ `workspaceRoot \|\| homedir()`) **or** a path contained within an open workspace folder **or** the home directory. Anything else is **rejected** (Decision 2).                                                                                                                                                       |

**Impact bound to state honestly in the PR (P1 §4)**: before the fix the caller
controls the executable path, the cwd, and inherits the full parent env — **not**
argv (args are `[]`). After the fix, `shell` cannot express a path at all and
`cwd` is contained.

---

## 3. Decision 2 — `cwd` containment (AC 3)

### Decision

Add a **composed sibling predicate** in `workspace-authorization.ts` and call it
from the handler **only when `cwd` is explicitly supplied**:

```
isWithinHomeDir(candidate):            # new, same normalization as isAuthorizedWorkspace
  home = normalize(homedir())
  target = normalize(candidate)
  return target === home || target.startsWith(home + '/')

isAuthorizedTerminalCwd(cwd, workspaceProvider):   # new, composes the two
  return isAuthorizedWorkspace(cwd, workspaceProvider) || isWithinHomeDir(cwd)
```

Handler logic:

```
if (parsed.cwd && !isAuthorizedTerminalCwd(parsed.cwd, this.workspace))
  -> reject (structured error, Decision 3)
const cwd = parsed.cwd || wsRoot || homedir();   # unchanged fallback
```

### Rationale

- **Reuses the verified `isAuthorizedWorkspace`** (its resolve → forward-slashes
  → lowercase → strip-trailing-slash normalization and the `folder + '/'`
  separator-boundary check that stops `/foo/bar` matching `/foo/barbaz`,
  `workspace-authorization.ts:29-34`) rather than re-implementing containment.
- **Adds the home arm AC 3 requires** without mutating `isAuthorizedWorkspace`.
  That function is shared with the session handlers, where "authorized" means
  "an open workspace folder" and home is deliberately **not** included.
  Broadening it in place would silently widen every other caller's authorization
  surface.
- **Extract the shared `normalize` helper** in that file so `isWithinHomeDir`
  uses byte-identical normalization to `isAuthorizedWorkspace`.

### Trade-offs rejected

- **Extend `isAuthorizedWorkspace` to also accept home**: rejected — changes the
  meaning of a shared predicate for every existing caller (session handlers),
  turning a workspace check into a workspace-or-home check they did not ask for.
- **Use `isUnsafeWorkspacePath`** (`platform-core` `src/index.ts:67`): evaluated
  and rejected. It is a **denylist** (rejects filesystem root, app install dir,
  global storage) and needs `IPlatformInfo` injected. AC 3 wants an **allowlist**
  ("outside workspace root and home → reject"). A denylist would wave through
  `/tmp`, `/etc`, `C:\Windows` — none of which is on its deny set but all of
  which are outside workspace+home. Wrong tool. `isAuthorizedWorkspace` + home is
  the containment the AC actually specifies, and it already excludes the
  filesystem root by construction (nothing is contained in it). No
  `IPlatformInfo` injection is added.

### Absent-`cwd` case (must remain valid)

Containment runs **only when `parsed.cwd` is truthy**. When `cwd` is absent the
handler keeps today's `wsRoot || homedir()` fallback, both of which are
authorized by construction. This keeps the two characterization tests that pin
the fallback green: `terminal-rpc.handlers.spec.ts:129-142` (homedir fallback)
and the wsRoot-default assertion.

---

## 4. Decision 3 — the schema file (AC 4)

### Decision

New file **`libs/backend/rpc-handlers/src/lib/handlers/terminal-rpc.schema.ts`**,
sibling to the handler, following the **`git-rpc.schema.ts` null-returning
`safeParse` convention** (reject; never substitute — the config.ts fallback
convention is for values read from disk, not the renderer, per P1 §7).

```ts
import { z } from 'zod';
import { isAllowedShell } from '@ptah-extension/platform-core';
import type { TerminalCreateParams, TerminalKillParams } from '@ptah-extension/shared';

// Header docblock: scope (terminal:create + terminal:kill only), rationale
// (renderer-supplied params reach node-pty's spawn — validate before the sink),
// and the partial-adoption note (layout:* is intentionally NOT retrofitted here),
// mirroring git-rpc.schema.ts:1-12.

export const TerminalCreateParamsSchema = z.object({
  cwd: z.string().optional(),
  shell: z
    .string()
    .optional()
    .refine((s) => isAllowedShell(s), { message: 'shell not in allowlist' }),
  name: z.string().optional(),
});

export const TerminalKillParamsSchema = z.object({
  id: z.string().min(1),
});

export function parseTerminalCreateParams(raw: unknown): TerminalCreateParams | null {
  const result = TerminalCreateParamsSchema.safeParse(raw ?? {});
  return result.success ? result.data : null;
}

export function parseTerminalKillParams(raw: unknown): TerminalKillParams | null {
  const result = TerminalKillParamsSchema.safeParse(raw);
  return result.success ? result.data : null;
}
```

Notes:

- **`shell` allowlist lives in the schema refine** — so the schema is the single
  authoritative narrowing point AC 4 asks for, and it needs no injected
  dependency (`isAllowedShell` reads only `process.platform`).
- **`cwd` shape is validated in the schema; `cwd` containment is validated in the
  handler** (Decision 2), because containment needs the injected
  `IWorkspaceProvider` and cannot be expressed in a static Zod schema. This is
  the exact split `git-rpc.schema.ts` uses: schema validates shape, the handler
  runs the context-dependent path check (`git-rpc.schema.ts:9-12`).
- Plain `z.object` (not `.strict()`), matching `git-rpc.schema.ts:18`. `cwd`
  uses `.optional()` without `.min(1)` so today's falsy-means-absent semantics
  (`params?.cwd || …`) are preserved.
- `parseTerminalCreateParams` accepts `raw ?? {}` so an absent `params` (the
  homedir-fallback path) parses to `{}` and stays valid.

### Handler behaviour on parse/containment failure

Both failures **reject via a structured error, not a raw throw that crosses the
boundary uninspected**. The established mechanism (proved by the characterization
test at `terminal-rpc.handlers.spec.ts:144-165`): the handler throws a plain
`Error` with a fixed, non-reflecting message; `RpcHandler.handleMessage` catches
it and returns `{ success:false, error }`. That is the structured path — the
throw never escapes the transport.

```
private async handleCreate(rawParams) {
  const parsed = parseTerminalCreateParams(rawParams);
  if (!parsed) throw new Error('terminal:create: invalid or disallowed parameters');

  if (parsed.cwd && !isAuthorizedTerminalCwd(parsed.cwd, this.workspace))
    throw new Error('terminal:create: cwd outside workspace root and home');

  const wsRoot = this.workspace.getWorkspaceRoot();
  const cwd = parsed.cwd || wsRoot || homedir();
  try {
    return this.ptyManager.create({ cwd, shell: parsed.shell, name: parsed.name });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    this.logger.error('[TerminalRpc] Failed to create terminal', { error: message } as unknown as Error);
    throw new Error(message);
  }
}
```

- Messages are **fixed strings**; they do not echo the rejected `shell`/`cwd`
  back to the caller (the raw values are already logged host-side, and the reject
  reason is distinguishable: "invalid or disallowed parameters" vs "cwd outside
  workspace root and home").
- `terminal:kill` routes through `parseTerminalKillParams`; on `null` it returns
  the existing `{ success:false, error:'id is required' }` shape (kill returns a
  success envelope, unlike create). Both methods now validate through the schema
  file — AC 4 satisfied.
- `catch (error: unknown)` + `instanceof Error` narrowing throughout (carrier).

---

## 5. Decision 4 — the `pty.spawn` assertion seam (AC 2)

### The constraint being reconciled

AC 2 requires the rejection asserted **at the `pty.spawn` call site**, not only
at the RPC return. But `rpc-handlers` is platform-agnostic and **cannot import
`node-pty`** — the current unit spec mocks `IPtyHost`, so it stops at the port
(`terminal-rpc.handlers.spec.ts:63-68`) and can never observe `pty.spawn`. The
e2e suite that does reach the real sink is unconditionally skipped
(`apps/ptah-electron-e2e/src/specs/pty-manager.spec.ts:35-38`) and cannot serve
as the seam.

### Decision — defence in depth, validation on both sides

1. **Handler (RPC boundary)** validates via the schema. A disallowed `shell`
   makes `parseTerminalCreateParams` return `null` → the handler throws before
   calling `ptyManager.create`. Asserted in `terminal-rpc.handlers.spec.ts`:
   **`ptyManager.create` is never called** and the RPC returns
   `{ success:false }`.

2. **`PtyManagerService.create` (the spawn owner)** re-validates the **supplied**
   `shell` and throws **before** `pty.spawn`. This is the seam AC 2 wants: it
   lives in `apps/ptah-electron`, the one place that owns `node-pty`, so a unit
   test that mocks `node-pty` can assert `pty.spawn` was never reached.

```
// apps/ptah-electron/src/services/pty-manager.service.ts, top of create():
if (!isAllowedShell(params.shell)) {          // validate the SUPPLIED override, before defaulting
  throw new Error('PtyManager: shell not permitted');
}
// ... existing session-limit checks ...
const shell = params.shell || this.getDefaultShell();   // default (a full path) is host-trusted, never validated
const proc = pty.spawn(shell, [], { ... });
```

- Validate `params.shell` (the caller's override) **before** the `|| default`.
  The host default (`COMSPEC` / `SHELL`, a full path — `pty-manager.service.ts:244-249`)
  is trusted and must **not** be run through `isAllowedShell` (its separators
  would fail the predicate). `isAllowedShell(undefined) === true` handles the
  absent case; when `params.shell` is defined it must be a bare allowlisted
  basename.
- Same `isAllowedShell` import from `platform-core` as the schema — one source of
  truth, no drift.

### Rationale

The handler guard closes the boundary (structured reject, no spawn attempt). The
`PtyManagerService` guard is the **provable spawn-site assertion** AC 2 names and
is genuine defence in depth: even if a future second dispatcher ever reached the
port (P1 §8's "one flag deep" containment), the sink still refuses a non-allowlisted
shell. The cost is one predicate call and one new unit spec.

### Trade-off rejected

- **Validate only in the handler**: rejected — the assertion would sit at the
  `IPtyHost` port (`ptyManager.create` not called), which is _not_ the
  `pty.spawn` call site AC 2 explicitly distinguishes ("not only at the RPC
  return"). It also leaves the sink itself unguarded against any future caller.
- **Validate only in `PtyManagerService`**: rejected — leaves the RPC boundary
  passing malformed params down one layer before rejecting, and gives no
  structured RPC-level error. Boundary validation belongs at the boundary (lib
  CLAUDE.md: "every handler method validates params via its schema file").

### Which assertion lives where

| Assertion                                                                                  | File                                                                       |
| ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| Disallowed `shell` → `ptyManager.create` NOT called; RPC returns `success:false`           | `libs/backend/rpc-handlers/src/lib/handlers/terminal-rpc.handlers.spec.ts` |
| `cwd` outside workspace+home → `ptyManager.create` NOT called; RPC returns `success:false` | same file                                                                  |
| Disallowed `shell` → **`pty.spawn` NOT called** (node-pty mocked)                          | new `apps/ptah-electron/src/services/pty-manager.service.spec.ts`          |
| Allowlisted `shell` (platform-appropriate) → reaches `pty.spawn`                           | same new spec                                                              |

---

## 6. Dual-registration check (confirm, then skip)

**RPC dual-registration is NOT triggered by this task.** `terminal:create` /
`terminal:kill` are already registered:

- Compile-time: present in `RpcMethodName` and in
  `TerminalRpcHandlers.METHODS` (`terminal-rpc.handlers.ts:32-35`).
- Runtime: `'terminal:'` is already in `ALLOWED_METHOD_PREFIXES`
  (`libs/backend/vscode-core/src/messaging/rpc-handler.ts`, P1 §3).
- Manifest / host profile: `terminal` already requires `pty`
  (`manifest.ts:357-362`), enabled only on Electron.

The implementer must **not** add a manifest entry, a prefix, a `RpcMethodName`
member, or a host-profile capability. The only new _exports_ are `isAllowedShell`
(platform-core barrel) and the schema/predicate functions — none is an RPC
method.

---

## 7. Batch breakdown for team-leader

Dependency order: **B1 → (B2, B4 in parallel) → B3 → B5.** CLI delegation is
DISABLED for this task; every batch defaults to the **backend-developer**
sub-agent.

### Batch 1 — shared shell allowlist (platform-core)

- **Create** `libs/backend/platform-core/src/utils/shell-allowlist.ts` —
  `WIN_SHELLS`, `POSIX_SHELLS`, `isAllowedShell(shell?, platform?)`.
- **Modify** `libs/backend/platform-core/src/index.ts` — export the above.
- **Create** `libs/backend/platform-core/src/utils/shell-allowlist.spec.ts` —
  absent → true; allowlisted basename per platform → true; unknown basename →
  false; any value with `/` or `\` → false (incl. `/bin/bash`, `C:\…\cmd.exe`);
  win32 case-insensitivity. Drive `platform` via the function arg so the test is
  OS-independent.
- Additive only; no existing dependents change.
- **Executor**: backend-developer.

### Batch 2 — schema + cwd containment helper (rpc-handlers) _(depends on B1)_

- **Create** `libs/backend/rpc-handlers/src/lib/handlers/terminal-rpc.schema.ts`
  (Decision 3) — imports `isAllowedShell` from `platform-core`.
- **Modify** `libs/backend/rpc-handlers/src/lib/utils/workspace-authorization.ts`
  — extract shared `normalize`; add `isWithinHomeDir` and `isAuthorizedTerminalCwd`
  (Decision 2).
- **Modify** `libs/backend/rpc-handlers/src/index.ts` / handler barrel only if
  the new predicate needs to be exported for tests (otherwise import by relative
  path). Do not broaden the public surface unnecessarily.
- **Create** `terminal-rpc.schema.spec.ts` — parse success/`null` for both
  methods; shell refine accept/reject; `raw ?? {}` handling.
- **Executor**: backend-developer.

### Batch 3 — handler wiring (rpc-handlers) _(depends on B2)_

- **Modify** `libs/backend/rpc-handlers/src/lib/handlers/terminal-rpc.handlers.ts`
  — route `terminal:create` and `terminal:kill` through the schema; add the
  `cwd` containment gate; structured-error rejects (Decision 3). Keep the
  existing re-throw-on-`ptyManager.create`-failure behaviour and `catch (error:
unknown)` narrowing.
- **Executor**: backend-developer.

### Batch 4 — pty-manager defence-in-depth (ptah-electron) _(depends on B1; parallel with B2/B3)_

- **Modify** `apps/ptah-electron/src/services/pty-manager.service.ts` — import
  `isAllowedShell` from `platform-core`; guard `params.shell` and throw before
  `pty.spawn` (Decision 4). Do not validate the host default.
- **Executor**: backend-developer.

### Batch 5 — test updates + spawn-site test _(depends on B3 and B4)_

- **Modify** `libs/backend/rpc-handlers/src/lib/handlers/terminal-rpc.handlers.spec.ts`:
  - **Update `:93-110`** (`:99` passes `shell:'bash'`, `:103-107` asserts it
    reaches `ptyManager.create` verbatim): decouple from shell — assert the
    wsRoot-default cwd with **no `shell`** (or a platform-appropriate allowlisted
    shell), since a raw `'bash'` fails the win32 allowlist. This assertion
    encodes the defect and must be updated (carrier; P1 §6).
  - **Update `:112-127`** (`:118` passes `cwd:'/explicit'`, `:122-126` asserts it
    reaches `ptyManager.create` verbatim): `/explicit` is outside every workspace
    root and outside home, so P2 containment **rejects** it — flip this to assert
    `ptyManager.create` is NOT called and the RPC returns `success:false`. This
    assertion encodes the defect and must be updated (carrier; P1 §6).
  - **Keep `:129-142`** (homedir fallback) and `:144-181` (re-throw
    characterization) green.
  - **Add**: disallowed `shell` (e.g. `'rm'`, or a value containing a separator)
    → `ptyManager.create` NOT called, `success:false`; disallowed `cwd` →
    same; allowlisted `shell`
    (`process.platform === 'win32' ? 'cmd.exe' : 'bash'`) → reaches
    `ptyManager.create`.
- **Create** `apps/ptah-electron/src/services/pty-manager.service.spec.ts` —
  `jest.mock('node-pty')`; disallowed `shell` → `create` throws AND
  `pty.spawn` NOT called (**the AC 2 spawn-site assertion**); allowlisted /
  absent `shell` → `pty.spawn` called once.
- **Executor**: backend-developer (senior-tester acceptable if preferred).

---

## 8. Files affected (summary)

**CREATE**

- `libs/backend/platform-core/src/utils/shell-allowlist.ts`
- `libs/backend/platform-core/src/utils/shell-allowlist.spec.ts`
- `libs/backend/rpc-handlers/src/lib/handlers/terminal-rpc.schema.ts`
- `libs/backend/rpc-handlers/src/lib/handlers/terminal-rpc.schema.spec.ts`
- `apps/ptah-electron/src/services/pty-manager.service.spec.ts`

**MODIFY**

- `libs/backend/platform-core/src/index.ts`
- `libs/backend/rpc-handlers/src/lib/utils/workspace-authorization.ts`
- `libs/backend/rpc-handlers/src/lib/handlers/terminal-rpc.handlers.ts`
- `apps/ptah-electron/src/services/pty-manager.service.ts`
- `libs/backend/rpc-handlers/src/lib/handlers/terminal-rpc.handlers.spec.ts`

**MUST NOT TOUCH**

- Any `rpc-host-profile.ts` / `cli-host-profile.ts` / `expected-absent.ts` (no
  `pty` capability changes).
- `libs/backend/cli-engine/src/lib/rpc/rpc-surface.spec.ts` (the `:67-69`
  tripwire stays green untouched).
- `RpcMethodName`, `ALLOWED_METHOD_PREFIXES`, `manifest.ts` (dual-registration
  not triggered).
- `libs/shared/.../rpc-terminal.types.ts` and `pty-host.interface.ts` — `shell`
  stays `?: string`; the narrowing is a runtime allowlist, not a type change.

---

## 9. Complexity, executor, verification

- **Complexity**: MEDIUM. Small, well-bounded diffs across two projects; the only
  subtlety is the platform-dependent test values and the "validate the supplied
  shell, not the default" ordering in `PtyManagerService`.
- **Recommended executor**: backend-developer sub-agent for all five batches (CLI
  delegation disabled).
- **Critical verification points for the team-leader to enforce**:
  1. `isAllowedShell` imported from `@ptah-extension/platform-core` on **both**
     sides — no duplicated allowlist literal.
  2. `PtyManagerService` validates `params.shell` (the override), **before** the
     `|| getDefaultShell()` default — never the default itself.
  3. The two defect-encoding assertions
     (`terminal-rpc.handlers.spec.ts:99/103-107` and `:118/122-126`) are
     **updated, not preserved**; the homedir-fallback (`:129-142`) and re-throw
     (`:144-181`) tests stay green.
  4. The new `pty-manager.service.spec.ts` asserts against **`pty.spawn`** (mocked
     node-pty), not against the port — that is the AC 2 requirement.
  5. No host profile gains `pty`; the `rpc-surface.spec.ts:67-69` exact-set
     assertion is left untouched.

## 10. Compliance restatement (carrier constraints)

- `catch (error: unknown)` + `instanceof Error` narrowing in the handler and
  `PtyManagerService` — preserved.
- Zod at the boundary — `terminal-rpc.schema.ts`; both methods validate through
  it (AC 4).
- No `@ts-ignore` — the existing `as unknown as Error` logger casts are the lib's
  logging idiom and are out of scope (a separate TASK_2026_171 follow-up); do not
  add new suppressions.
- The allowlist is **not** weakened to preserve a test; the three defect-encoding
  assertions are updated (P1 §6).
- No `pty` capability added to any other host profile.
- Windows-absolute paths used for every file reference above.
- Acceptance criteria coverage: AC 2 (Decision 4 + Batch 5), AC 3 (Decision 2),
  AC 4 (Decision 3), AC 5 (Decision 1 delta table). AC 1 (reachability) is P1,
  already delivered. AC 6 (suites green) is enforced by Batch 5 keeping the
  fallback/re-throw tests green and the skipped e2e suite untouched.

**No clarifications needed** — the carrier pinned scope and the P1 report
resolved the design space; every decision above is made on that evidence.
