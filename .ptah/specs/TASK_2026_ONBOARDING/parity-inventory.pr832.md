# Parity inventory — PR #832 delta (TASK_2026_ONBOARDING)

Scope: every user-visible capability, and every contract the onboarding plan consumes, that draft
PR #832 (`feat/wizard-library-alignment`, head `65499f2c`, ref `refs/remotes/pr/832`) adds or
changes in the setup-wizard flow. It extends `parity-inventory.md`, which was written against
`main` (`0e17912e3`) and stays authoritative for everything not listed here.

All `file:line` citations are at `65499f2c` and were read with `git show refs/remotes/pr/832:<path>`,
unless marked `main`. Paths are abbreviated:

- `W/` = `libs/frontend/setup-wizard/src/lib/`
- `S/` = `libs/shared/src/lib/types/`
- `B/` = `libs/backend/rpc-handlers/src/lib/handlers/` (read-only context; this task changes no backend)

Plan steps: A1-A5 are the analyze pages (`implementation-plan.md` A2 route table). B-numbers are the
batch that first consumes the capability, per `implementation-plan.addendum-pr832.md`.

Fates:

- **Reuse**: onboarding imports the PR component, store or helper through `@ptah-extension/setup-wizard`
  (already exported, or exported by the named batch), or consumes the shared contract as-is.
- **Move**: the behaviour is re-hosted in onboarding (or in a reused setup-wizard owner) and the old
  host file is deleted.
- **Proposed Removal**: the capability is not carried. Needs user approval (see the addendum).

Barrel fact: PR 832 does not change `W/../index.ts` (`git diff main...refs/remotes/pr/832 --
libs/frontend/setup-wizard/src/index.ts` is empty). None of the 31 files it adds under `W/` is
exported. Already exported and reused by the plan: `CommunityPacksPanelComponent` (`index.ts:17`),
`AgentPreviewDialogComponent` (`:18`), `AgentNextStepsComponent` (`:22`).

## Capabilities

| # | Capability (user-visible unless marked contract) | Source at 65499f2c | Plan step | Fate | New location / owner batch |
| --- | --- | --- | --- | --- | --- |
| P1 | Keep/replace control per existing agent file. Every row starts on **Keep**; an unreadable file is forced Keep; state badges "New", "Exists — may be replaced", "Could not read file" | `W/components/preview-decisions/keep-replace-control.component.ts:22-31`, `:96`; `file-decision-row.component.ts:102`; `preview-decisions.state.ts:135-148` (badges), `:180-201` (`buildWizardRows`, `decision: 'keep'` at `:193`, `forcedKeep` at `:194`) | A2 preview | Reuse, through `AgentPreviewDialogComponent` (renders `<ptah-file-decision-row>` at `W/components/agent-preview-dialog.component.ts:193`) | `ChooseAgentsPage`, B3a |
| P2 | Bulk "Keep all" / "Replace all" above the file list | `W/components/preview-decisions/bulk-decision-bar.component.ts:18`, `:60`; dialog `:176` | A2 preview | Reuse (via dialog) | B3a |
| P3 | "What changes" diff disclosure. Wizard rows say the content is unknown until generation; pack rows show incoming vs local text | `W/components/preview-decisions/diff-disclosure.component.ts:39`, `:94-104`; `preview-decisions.state.ts:77-80` | A2 preview, A2 packs | Reuse (via dialog and pack prompt) | B3a |
| P4 | Target root: "Target:" line, a "Change" disclosure, project root vs opened folder (warning on opened folder), the comparison re-runs, every choice resets to Keep with a status line | `W/components/agent-preview-dialog.component.ts:98-145`; `preview-decisions/target-root-choice.component.ts:15-22` (doc), `:126`; `preview-decisions.state.ts:87-88` (`TARGET_CHANGED_STATUS`); owner `W/services/generation-preview.store.ts:118-128` | A2 preview | Reuse (dialog + `GenerationPreviewStore.changeTarget`) | B3a |
| P5 | "Writing model: X (writes the content)" line and a per-agent "Agent model:" origin note (Electron names the Library setting, VS Code the saved setting) | dialog `:89-96`, `:200-205`; `W/components/preview-decisions/model-origin-note.component.ts:30-35` (doc), `:42`; contract `S/rpc/rpc-setup.types.ts:432` | A2 preview | Reuse (via dialog) | B3a |
| P6 | Per-row notes "Library copy has edits…" and "Unchanged since the setup wizard wrote it" | `W/components/preview-decisions/preview-decisions.state.ts:83-86`, `:196-197`; contract `S/rpc/rpc-setup.types.ts:434-436` | A2 preview | Reuse (via dialog) | B3a |
| P7 | Footer "k kept, r to replace" and a derived confirm label ("Confirm and generate", "…, replace n files") | `W/components/preview-decisions/preview-decisions.state.ts:101-105`, `:300-330`; dialog `:239-262`, `:344-347` | A2 preview | Reuse (via dialog). Supersedes design-spec §3.2 "Generate n agents (m overwrite)" and the "Will overwrite" tag (addendum AD1) | B3a |
| P8 | Preview owner: fresh comparison on open, confirm-time re-preview, "Targets changed. Review the new list and confirm again.", `preview-required` re-opens the preview keeping the chosen root ("Targets need another review."), stale replies dropped | bound copy `W/components/agent-selection-list.component.ts:161-162`, `:319-415`, `:421-444`; reusable copy `W/services/generation-preview.store.ts:39-172`, `:180-204`; dialog banner `:146-150` | A2 preview | Reuse `GenerationPreviewStore`, extended with a tab binding (addendum C-A2). The inline copy in `agent-selection-list` is deleted with ledger rows 14-15 | `ChooseAgentsPage` provides the store, B3a |
| P9 | Bound submit carries `previewToken`, `fileDecisions` (Replace entries only) and `target` | `W/services/wizard-rpc.service.ts:55-58` (`BoundAgentDecisions`), `:71-83`, `:166-196` (`startBoundAgents`); `W/services/generation-workflow.store.ts:104-143` (`startAgents(ids, decisions?)`); contract `S/rpc/rpc-setup.types.ts:338-342` | A2 → A3 | Reuse (`AnalysisStepStore.submit` passes the confirmed decisions) | B3a |
| P10 | Contract: a bound submit needs a preview recorded for its tab; otherwise the server refuses with `preview-required` | `B/wizard-generation-rpc.handlers.ts:479-490` (`requirePreview: !!tabBinding`), `:1107-1117` (preview keyed by `tabId`); `B/wizard-generation/generation-preview.service.ts:364-365`; rejection union `S/rpc/rpc-setup.types.ts:65-74` | A2 | Reuse (contract; the page handles the rejection) | B3a |
| P11 | Legacy wizard-page modal "Preview agent generation" (native modal focus trap; hides the opened-folder rival warning unless that root is chosen) | `W/components/generation-preview-modal.component.ts:45-55`, `:249`, `:280-293`; host `W/components/agent-selection.component.ts:92`, `:610-624` | legacy selection → A2 | Reuse (carried by P1-P8 in the dialog). The modal and its spec lose their only consumer with ledger 12-13 and are deleted (new ledger rows 52-53). The dialog shows every backend `warning` (`:171-175`), so the opened-folder warning also shows on the project root; no capability is lost | B5b |
| P12 | "Generate without preview": after a failed preview, confirm submits create-only (no token, no Replace; missing files only) and still honours a chosen root | `W/services/generation-preview.store.ts:84-100`; `W/components/generation-preview-modal.component.ts:120-133`, `:254-255`, `:320-323` | legacy selection | **Removed: PR-R1 approved by the user 2026-10-27** (the bound flow retries the comparison instead) | B3a decides the branch, B5b removes the unbound path |
| P13 | Community-pack install prompt: read-only plan (`wizard:plan-pack-install`), target choice always shown, keep/replace for differing files, diff, "Install pack" confirm; nothing written before Confirm | `W/components/pack-install-prompt.component.ts:47-58`, `:196`; `W/services/wizard-rpc.service.ts:693-720`; contract `S/rpc.types.ts:1103-1106`, `S/rpc/rpc-setup-decisions.types.ts:123-148` | A2 community packs | Reuse via `CommunityPacksPanelComponent` (`index.ts:17`, prompt at `W/components/community-packs-panel.component.ts:194`) | B3a (no new import) |
| P14 | Pack install state that survives navigation: per file installing / installed / kept / failed, last target | `W/services/pack-install.store.ts:21`, `:60-69` (root, `providedIn: 'root'` at `:68`), `:83-118` | A2 community packs | Reuse (panel uses scope `'sidebar'`, `community-packs-panel.component.ts:220-244`) | B3a |
| P15 | Pack per-file results, Kept note, Retry failed, "Install to:" label, Library pass | `W/components/pack-install/pack-install-result.ts:19-90`; `W/components/community-packs-panel.component.ts:89`, `:115-190` | A2 community packs | Reuse (via panel) | B3a |
| P16 | Legacy wizard inline community packs (scope `'wizard'`) | `W/components/agent-selection.component.ts:379`, `:421`, `:625`, `:662`, `:698`, `:930-959` | legacy selection → A2 | Reuse (carried by P13-P15 in the panel's `'sidebar'` scope); the legacy copy is deleted with ledger 12-13 | B5b |
| P17 | Outcome summary: five counters (Written, Kept (your file), Already current, Changed since preview (kept), Failed), per-file list, failure alerts in safe copy, opened-folder notice, diverged Library copies with "Open the Library" | `W/components/completion/outcome-summary.component.ts:24-30`, `:54-160`, `:162-247` | A3 terminal, A5 | Reuse. A3: inside `AgentNextStepsComponent` (`W/components/agent-next-steps.component.ts:58-73`). A5 and A3 non-handoff terminal states: `OutcomeSummaryComponent` exported in B3b | B3b |
| P18 | Grade expectation ("About grades…" / "Nothing new was written") | `W/components/completion/grade-expectation.component.ts:10-17`, `:24-61` | A3, A5 | Reuse (same as P17) | B3b |
| P19 | Library-stale notice when the Library pass failed | `W/components/completion/library-stale-notice.component.ts:10-28` | A3, A5 | Reuse (same as P17) | B3b |
| P20 | Library copy only in Electron and only for the harness-root target | `W/components/completion/outcome-summary.component.ts:39-48` (`libraryReachable`); `agent-next-steps.component.ts:157`, `:189-191` | A3, A5 | Reuse (`libraryReachable` exported in B3b) | B3b |
| P21 | Next steps renders the bound run's verified outcomes above the guidance handoff | `W/components/agent-next-steps.component.ts:32-39` (`fileOutcomeOf`), `:58-73`, `:160-207`; inputs unchanged in name and type `:193-203` | A3 | Reuse (`index.ts:22`; already in the plan's B3b import audit) | B3b |
| P22 | Legacy completion page shows P17-P19 from `CompletionData.result`; host close message | `W/components/completion.component.ts:135-147`, `:356-388`, `:455-459` (`SETUP_WIZARD_COMPLETE`); `W/services/setup-wizard-state.types.ts:134`; `W/services/setup-wizard/wizard-phase-generation.ts:100` | A5 | Move: A5 composes P17-P19 from the agent run's result facts; `completion.component.ts` (+spec) stays deleted (ledger 31-32); the close message stays on A5 Open chat (plan L7). `CompletionData.result` and its handler stay (message handling) | B3b, B5b |
| P23 | Safe failure copy: raw backend or exception text is never shown; known kinds map to fixed copy | `W/utils/safe-failure-copy.ts:1-7` (doc), `:54-73` | A3 cards, A2 packs, A5 | Reuse (`safeFailureCopy` exported in B2) | B2 |
| P24 | Contract: agent outcome status widened with `kept` and `changed-since-preview` | `S/rpc/rpc-setup-decisions.types.ts:89-94`; `S/rpc/rpc-setup.types.ts:352` (checkpoint agent), `:86-91` (result `agentOutcomes`); `S/wizard/phase.ts:203-206` | A3 cards, A5 | Reuse (contract; `ItemStatusCard` map, B2) | B2 |
| P25 | Contract: result facts `counts.kept`, `counts.changedSincePreview`, `target`, `libraryPass`, `libraryDiverged` | `S/rpc/rpc-setup.types.ts:92-103`, `:111-119` | A3, A5 | Reuse (contract) | B3b |
| P26 | Resume treats `kept` and `changed-since-preview` agents as settled (not re-run) | `W/services/wizard-analysis-runner.service.ts:34-35`, `:45` | A1 resume, A3 | Reuse (runner already reused by A1) | B3a |
| P27 | Contract: generation-complete push gains `keptCount`, `changedSincePreviewCount` | `S/wizard/phase.ts:230-239` | none (legacy unbound push; its handler is kept) | Reuse (no consumer change) | — |
| P28 | Contract: preview request `target`; preview response `previewToken`, `target`, `rivalStatus`; agent `agentModel`, `libraryCopyEdited`, `unchangedSinceWizardWrite`; file `localState`, `revision` | `S/rpc/rpc-setup.types.ts:392`, `:419-436`, `:452-456`; types `S/rpc/rpc-setup-decisions.types.ts:21-77`, `:116-120` | A2 | Reuse (contract, via dialog and store) | B3a |
| P29 | Contract: pack install params `planToken`, `decisions`, `target`; result `files`, `libraryPass` | `S/rpc/rpc-setup.types.ts:701-705`, `:715-717`; `S/rpc/rpc-setup-decisions.types.ts:123-154` | A2 packs | Reuse (contract, via panel) | B3a |

Totals: 29 rows. Reuse 27 (P1-P11, P13-P21, P23-P29), Move 1 (P22), Proposed Removal 1 (P12).

## Not in scope of the setup-wizard flow

- `library:changed` push (`S/messages/message-constants.ts`, `payload-map.ts`) and
  `library-provenance.ts`: no setup-wizard consumer at `65499f2c`; PR batches 21-25 consume them in
  `skill-synthesis-ui` / `marketplace`. Onboarding does not subscribe.
- Backend services `generation-preview.service.ts`, `generation-library-pass.service.ts`,
  `pack-install.service.ts`, the agent run supervisor's result facts for untabbed runs: consumed
  only through the contracts above.

## Existing parity rows whose sources moved (re-cite at 65499f2c)

| `parity-inventory.md` row | Old citation (main) | At 65499f2c |
| --- | --- | --- |
| Agent/file preview, definite/conditional, refresh-before-confirm (`:50`) | `agent-preview-dialog.component.ts:79` | class `:270`, owner `agent-selection-list.component.ts:319-415`; now also P1-P8 |
| Completion facts, agent outcomes… next steps (`:53`) | `completion.component.ts:149`, `:164` | `completion.component.ts:135-147`, `:356-388`; next steps `agent-next-steps.component.ts:58-73` |
| Combined countdown, Start now, Skip, manual recovery (`:54`) | `agent-next-steps.component.ts:27`, `:34`, `:51` | `:86` (Start now), `:93`, `:118` (Skip guidance), class `:153` |
| Community packs (`:55`) | `agent-selection-list.component.ts:125` | `:141`; panel prompt `community-packs-panel.component.ts:194`; now also P13-P15 |
| Exit / adjacent surfaces, host close message (`:28`) | `completion.component.ts:512-516` (main) | `:455-459` |
