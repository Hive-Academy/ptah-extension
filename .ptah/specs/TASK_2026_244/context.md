# Context — the Skills tab is Electron-only, and the doc said otherwise

**RESOLVED 2026-08-15. Doc corrected; no code change. The gates were right.**

## How this surfaced, and how it was filed wrong

TASK_2026_180 batch B1.11 was writing cross-host e2e for the provider/model
picker extracted into `libs/frontend/ui`, driven by that task's global invariant
#5:

> Extract `CuratorModelPickerComponent` into `libs/frontend/ui` and DELETE the
> local copy. Do not fork it — `skill-synthesis-ui` ships to VS Code AND
> Electron, and a fork strands VS Code users.

B1.11 could not reach the surface in the VS Code host and correctly reported
that. This task was then filed as "which side is wrong — the gates or the doc?",
treating it as an open question.

**It was not an open question.** The user had already decided this, and the
codebase already encodes it. Filing it as undecided was the error.

## The answer: Electron-only, structurally

Three independent places in the code say so:

1. **`apps/ptah-extension-vscode/src/di/expected-absent.ts`** —
   `SkillsSynthesisRpcHandlers` is in `EXPECTED_ABSENT_HANDLERS`, the list of
   "handler classes the VS Code host must never construct", alongside
   `MemoryRpcHandlers`, `CronRpcHandlers`, `GatewayRpcHandlers` and
   `PersistenceRpcHandlers`. A spec pins it. **The entire backend for this tab is
   absent in VS Code** — so the UI gate is not the binding constraint, it is
   downstream of a subsystem that isn't there.
2. `libs/frontend/thoth-shell/.../thoth-shell.component.ts` — `skills` carries
   `electronOnly: true`, alongside the other three Thoth tabs.
3. `libs/frontend/skill-synthesis-ui/.../skill-synthesis-tab.component.ts` —
   renders a desktop-only placeholder when `!isElectron()`.

**Why**: the subsystem needs `SqliteConnectionService` (better-sqlite3) and the
embedder worker. Neither exists in the VS Code extension host. That file's own
header states the failure it guards: _"a subsystem added for Electron gets
switched on everywhere, and VS Code crashes at activation resolving a class its
DI phases never registered."_

## What was actually fixed

`libs/frontend/skill-synthesis-ui/CLAUDE.md` — the "VS Code Parity" section
became a "Runtime: ELECTRON-ONLY" section that states the rule, names the three
enforcement points, and says why. It also explicitly tells a future reader not
to "restore parity".

## What this means for TASK_2026_180's invariant #5

The extraction into `libs/frontend/ui` remains correct — one definition, and
that lib has other consumers. But the invariant's stated **rationale** ("a fork
strands VS Code users") is **false**, because this tab has no VS Code users. Do
not cite it as evidence a cross-host path works.

B1.11's webview e2e is still worth having, and its header already scopes itself
honestly: it proves the extracted component survives being bundled into
`ptah-extension-webview` and driven over the generic `postMessage` transport. It
never claimed to prove navigation.

## Note on why the doc drifted

The workspace memory store contains **contradictory** entries — several older
ones assert "skill-synthesis-ui works on both VS Code and Electron", while newer
ones correctly record all four Thoth tabs as Electron-only and list
`SkillsSynthesisRpcHandlers` among the Electron-only RPC handlers. The stale
CLAUDE.md line is consistent with the older, wrong entries. Worth a memory
cleanup pass; the code is the ground truth and `expected-absent.ts` is the
cheapest place to check it.
