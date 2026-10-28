# P2 fix round — backend report (TASK_2026_701_9e4b)

Scope: D32 backend share: A1, A2, A3, A4 (`reviews/p2-code-logic-review-a.md`) and S1-backend, S2
(`reviews/p2-code-style-review.md`). Deferred B3/B6/B7/B8 not touched. `libs/frontend/**` not touched.

I audited the edits the earlier executor left uncommitted against each finding. All six findings were
already implemented with specs. I made one completion fix (A2, see below), then ran the scoped verify.

## Per-finding status

| ID | Status | Evidence |
| --- | --- | --- |
| A1 | Complete | `apps/ptah-cli/src/cli/commands/agent.ts:390` `applyCreateOnly`. An absent destination is created with `wx` (`:326`). Identical bytes give `unchanged`. A destination that differs, is not a regular file, gives a non-ENOENT/ENOTDIR stat error, fails to read, or collides with EEXIST gives `kept` plus a reason. `agent.applied` now carries `status`, `changed`, and `reason`. Specs in `agent.spec.ts` cover differing, unreadable, read-after-stat failure, ENOTDIR, EEXIST collision, and non-regular-file cases. |
| A2 | Complete (one gap closed in this round) | Port: `platform-core/src/interfaces/file-system-provider.interface.ts:50` `writeFileExclusive` (`wx`, EEXIST contract). Implemented in cli `:45`, electron `:43`, and vscode `:75`. The vscode version is local `file:` only and rejects virtual schemes, matching `createDirectoryExclusive`. Shared mock `testing/mocks/file-system-provider.mock.ts:104`; contract test `run-file-system-contract.ts:133`. Wizard writer: `agent-generation/.../file-writer.service.ts:233` `createContent` maps EEXIST to `kept` or `changed-since-preview`; `:271` `replaceContent` re-reads and re-checks the guard just before the replace. Pack writer: `platform-core/src/agent-pack-download.service.ts:355` creates absent targets with no-clobber; `:524` `replaceIfBaseline` re-checks the baseline hash before the rename. **Fix this round:** `replaceIfBaseline`'s absent branch called `link` with no fallback for filesystems without hard links, so EPERM/EXDEV/… became `failed`. I extracted `commitNoClobber` (`:487`: link, then fall back to `wx` create). `createExclusively` and the absent branch of `replaceIfBaseline` now share it. Interleaving specs: `file-writer.service.spec.ts` "two writers paused after their initial read" and "re-checks the baseline right before a replace"; `agent-pack-download.service.spec.ts` "two create-only installers paused after their read", "a replace of a file deleted since the plan does not clobber a concurrent create", and "a replace re-checks the baseline right before its rename". The remaining guarantee is stated in the code doc comments: for replacement only, a write landing between the re-check and the write/rename is still replaced. There is no lock shared with editors or other processes. |
| A3 | Complete | `agent.ts:225` `packInstallChanged`: derived from `files.some(outcome === 'written')`. It falls back to `!fromCache` only when `files` is absent (documented). Used at `:212`. Specs cover all-kept, all-unchanged, and mixed written/kept cases. |
| A4 | Complete | Supervisor `wizard-generation-run.supervisor.ts:328-339`: `result` and `terminalStatus` are built for every run; only `tabBinding` is conditional. Handler `wizard-generation-rpc.handlers.ts:974/984`: Library pass and `recordPropagation` run for every settled summary, not only bound runs. `:1010`: `resultDetails` is reloaded from the committed manifest for every run. `:888`: completed/no-work replay emits `result` without a tab binding. `bound` now only drives the failed-agent lifecycle. Specs in `wizard-generation-rpc.handlers.spec.ts` "untabbed runs carry the same Library facts (A4)" cover the normal, failed-refresh (file success kept, `libraryPass:'failed'`), diverged, resumed, and resumed-no-work cases. A supervisor spec covers result facts without a tab binding. |
| S1 (backend) | Complete | The post-run Library orchestration moved out of the handler into `wizard-generation/generation-library-pass.service.ts:95` `GenerationLibraryPassService` (279 lines; spec 193 lines). It covers consent grant, propagation, the `libraryPass` decision, and diverged-copy reads. The handler delegates through `libraryPass.afterRun` (`:984`, `:1463`). It is registered as a singleton at `register-shared-rpc-handlers.ts:78`. The handler shrank (net -265 lines in its diff). |
| S2 | Complete | `pack-install.service.ts` and `generation-preview.service.ts` no longer inject `PLATFORM_TOKENS.DI_CONTAINER`, and the generic `lookup<T>` / `isRegistered` helpers are gone (0 `container` references left in either file or in the new library-pass service). Collaborators are injected with their existing tokens and explicit types. Host capabilities that may be missing use `@inject(TOKEN, { isOptional: true })`: pack-install `:155`, `:158`; preview `:250-266`; library-pass `:102-109`. The absent-capability behaviour is unchanged. The repo already uses this pattern in agent-generation and agent-sdk. Harness-sync tokens are registered in phase 2 before the RPC handlers resolve (`apps/ptah-electron/src/di/phase-2-libraries.ts:233`), so a singleton does not cache `undefined` on hosts that have harness sync. |

## Files changed in this round

- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\wizard-library-alignment\libs\backend\platform-core\src\agent-pack-download.service.ts`: extracted `commitNoClobber`, which `createExclusively` and the absent branch of `replaceIfBaseline` both use.

All other files in `git diff --stat -- apps libs/backend` (29 modified plus 2 new under `wizard-generation/generation-library-pass.service*.ts`) come from the earlier executor. I audited them and left them as they were. I checked every `IFileSystemProvider` implementer: cli, electron, vscode, and the lane-routing spec class all have `writeFileExclusive`. Every other spec that mocks the port uses the shared `createMockFileSystemProvider`.

## Verification

Command (one foreground run, holding the verify lock):

```
npm run verify -- -p @ptah-extension/platform-core,@ptah-extension/platform-cli,@ptah-extension/platform-electron,@ptah-extension/platform-vscode,@ptah-extension/agent-generation,@ptah-extension/lane-routing,@ptah-extension/vscode-lm-tools,@ptah-extension/workspace-intelligence,@ptah-extension/rpc-handlers,ptah-cli,di-lint
```

Result: `NX   70 tasks: 70 succeeded, 4 cached`, `lock released after 1261.1s, exit code 0`. This covers lint, test, and typecheck for the 11 projects plus their dependency tasks, and includes `di-lint:lint`.

## Open items

- I did not run the typecheck or test targets for host apps `ptah-electron`, `ptah-extension-vscode`, and `ptah-tui` (not in my scope; the orchestrator runs the combined verify). Each host's `container.smoke.spec.ts` resolves the RPC handlers. `GenerationLibraryPassService` needs only `TOKENS.LOGGER` and `AGENT_ORIGIN_STORE`, which the smoke specs already register; its other dependencies are optional. Its constructor dependencies are therefore satisfied there, but I have not run those suites.
- `wizard-generation-rpc.handlers.ts` is still 1,768 physical lines (pre-existing oversize; S1 only required that the new responsibility move out).
- Remaining A2 limit, by design: replacement (not creation) has a one-read window against external editors and processes, because the port has no compare-and-swap. This is documented at `file-writer.service.ts:271` and on `replaceIfBaseline`.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Share the hard-link-or-`wx` fallback between create and replace-of-deleted-file | Leave link-only in replace (fails on FAT/network shares); duplicate the fallback; extract one helper | `createExclusively` already had the fallback; `NO_HARD_LINK_CODES` exists for this purpose | yes |
