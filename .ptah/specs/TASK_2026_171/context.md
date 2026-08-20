# Context — TASK_2026_171

## Status re-verification (2026-08-10)

The carrier sat at `backlog` while most of the work had already shipped. Flipped
to `in_progress`. Below is what actually landed, with commit evidence, and the
one family that is left.

Re-verified against HEAD on `ak/license-server-validation-pipe`, not against the
original 2026-08-02 audit snapshot.

## Landed

### P1 — Profile + engine — DONE

`3ee823ecd refactor: replace per-app RPC duplication with manifest + host profiles`

The engine exists at `libs/backend/rpc-handlers/src/lib/host-profile/`:
`capabilities.ts`, `host-profile.ts`, `manifest.ts`, `register-rpc-surface.ts`
(`registerRpcSurface` at `register-rpc-surface.ts:132`), `index.ts`.

All three composition roots now call it, and no app owns a registration
orchestrator any more:

- `apps/ptah-extension-vscode/src/activation/bootstrap.ts:120`
- `apps/ptah-electron/src/activation/wire-runtime.ts:121`
- `libs/backend/cli-engine/src/lib/container.ts:693` (via
  `createCliRpcHostProfile`, `libs/backend/cli-engine/src/lib/rpc/cli-host-profile.ts`)

**Acceptance criterion 2 is met.** All four hand-maintained exclusion lists are
gone — a repo-wide grep for `ELECTRON_ONLY_METHODS`, `CLI_EXCLUDED_RPC_METHODS`
and `ELECTRON_EXCLUDED_METHODS` returns zero hits. The three per-app
`RpcMethodRegistrationService` orchestrators (290 / 177 / 131 LOC) are deleted;
`libs/backend/cli-engine/src/lib/rpc/` now holds only `cli-host-profile.ts`,
`expected-absent.ts` and `rpc-surface.spec.ts`.

### P2 — Negative tests + lint — DONE

`dff985506 feat: add negative RPC surface guards, handler boundary lint, TUI file:pick`

Expected-absent lists exist (`libs/backend/cli-engine/src/lib/rpc/expected-absent.ts`),
the handler-boundary lint rule is in place, and the TUI `file:pick` exclusion —
the first intentional profile correction called for by the plan — is fixed.

### P3 — Handler unification — MOSTLY DONE (4 of 5 families, plus 3 unplanned)

Planned families:

| Family               | State       | Evidence                                                                                                            |
| -------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------- |
| `AgentRpcHandlers`   | DONE        | `12d161462 refactor: unify the three AgentRpcHandlers copies into rpc-handlers`                                     |
| `FileRpcHandlers`    | PARTIAL     | `5b40eca61 refactor: unify the file-picker handlers behind an IFileDialog port` — picker moved, `file:open` did not |
| `CommandRpcHandlers` | DONE        | `e0c8e8584 refactor: unify command:execute and give Electron the missing allowlist`                                 |
| `EditorRpcHandlers`  | NOT STARTED | —                                                                                                                   |

Three families beyond the original P3 list were also unified, each behind a new
port exactly as the target architecture prescribes:

- `ed2778e7c refactor: move the layout RPC handlers into rpc-handlers`
- `7780261de refactor: move the terminal RPC handlers behind an IPtyHost port`
- `397132d52 refactor: move the update RPC handlers behind an IAppUpdater port`

## What remains

**Acceptance criterion 1 — "zero RPC handler classes under `apps/`" — is still
unmet.** Three `@injectable` handler classes remain, and they are all one
family: editor + `file:open`.

| File                                                                                | LOC | Methods                                                                                                                                                                                                                                                                                                        |
| ----------------------------------------------------------------------------------- | --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/ptah-extension-vscode/src/services/rpc/handlers/editor-rpc.handlers.ts:26-27` | 105 | `editor:revertFiles`                                                                                                                                                                                                                                                                                           |
| `apps/ptah-extension-vscode/src/services/rpc/handlers/file-rpc.handlers.ts:20-21`   | 91  | `file:open`                                                                                                                                                                                                                                                                                                    |
| `apps/ptah-electron/src/services/rpc/handlers/editor-rpc.handlers.ts:143-144`       | 901 | `editor:createFile`, `editor:createFolder`, `editor:deleteItem`, `editor:getDirectoryChildren`, `editor:getFileTree`, `editor:getSetting`, `editor:listAllFiles`, `editor:openFile`, `editor:renameItem`, `editor:revertFiles`, `editor:saveFile`, `editor:searchInFiles`, `editor:updateSetting`, `file:open` |

Note the correction to the original plan: the VS Code `FileRpcHandlers` survivor
is **not** a separate fifth family. Electron's 901-LOC `EditorRpcHandlers` also
owns `file:open`, so the two VS Code stragglers and the Electron superset are a
single unification unit and should be done in one pass, not two.

The approach is unchanged from the carrier: Electron's implementation becomes
the lib implementation, host I/O goes behind an `IEditorHost`-style port
implemented once per runtime in `platform-{vscode,electron,cli}`, the VS Code
twins are deleted, and VS Code's much smaller surface becomes profile-gated
capability data rather than a separate class.

Acceptance criteria 3, 4 and 5 are structurally satisfied by the P1/P2 engine
and should be re-confirmed at the final gate rather than re-litigated now.
