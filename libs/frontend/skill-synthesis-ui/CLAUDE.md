# Skill Synthesis UI

↩️ [Back to Main](../../../CLAUDE.md)

## Purpose

"Skills" tab inside the Thoth shell. Primary surface is **Recommended** (cluster-distilled, judge-gated suggestions) — each opens a detail panel that renders the SKILL.md body via `@ptah-extension/markdown` and supports inline edit of title/description/body before Accept. Secondary sub-views: **Sessions** (raw per-session candidate log with status filter + promote/reject), **Library** (the clone registry as a `Skills / Agents / Commands` tab strip of cards, with contextual enhance/revert/rebase/keep actions and a detail drawer), **Activity** (diagnostics), **Settings** (read-only). Default sub-view is Recommended.

## Boundaries

**Belongs here**: skills tab UI, candidate filtering, promote/reject dialogs.
**Does NOT belong**: skill curation logic (backend), SKILL.md file writing (backend writes on promote), settings editing (handled elsewhere).

## Runtime: ELECTRON-ONLY

This tab is **Electron-only, exactly like Memory / Schedules / Gateway.** All four
Thoth tabs are desktop-only by design.

An earlier version of this file claimed the opposite ("works in both Electron and
VS Code — skills are not desktop-only"). That was **wrong**, and it is contradicted
by the code in three independent places:

- `apps/ptah-extension-vscode/src/di/expected-absent.ts` lists
  `SkillsSynthesisRpcHandlers` in `EXPECTED_ABSENT_HANDLERS` — the VS Code host
  **must never construct it**, and a spec enforces that. The whole backend for this
  tab is absent there.
- `thoth-shell.component.ts` marks the `skills` tab `electronOnly: true`.
- `skill-synthesis-tab.component.ts` renders a desktop-only placeholder when
  `!isElectron()`.

**The reason is structural, not a policy choice**: the subsystem needs
`SqliteConnectionService` (better-sqlite3) and the embedder worker, neither of
which exists in the VS Code extension host. `expected-absent.ts` exists precisely
because "a subsystem added for Electron gets switched on everywhere" was a
recurring activation crash.

So: do not "restore parity" here, and do not cite this tab as evidence that a
shared component has a VS Code consumer. Extracting shared components into
`libs/frontend/ui` is still right — for single-definition reasons — but this tab
is not the cross-runtime consumer.

## Public API

From `src/index.ts`: `SkillSynthesisTabComponent`, `SkillSynthesisRpcService`, `SkillSynthesisStateService`, plus `SkillStatusFilter` type.

## Internal Structure

- `src/lib/components/` — `skill-synthesis-tab.component.ts` (single composite tab)
- `src/lib/services/` — `skill-synthesis-state.service.ts`, `skill-synthesis-rpc.service.ts`

## Key Files

- `src/lib/components/skill-synthesis-tab.component.ts:52` — tab UI; OnPush; candidate list, promote/reject modals (DaisyUI), invocation history drill-down, stats card, settings panel listing `skillSynthesis.*` keys.
- `src/lib/components/skill-candidates-table.component.ts` — despite the name (kept because it is exported from `src/index.ts`), this is a `NativeCardComponent` LIST, not a table. Its DOM is bound by `apps/ptah-electron-e2e`: exactly one `[data-testid="skills-candidate-row"]` per candidate, on the `<li>` wrapper; `[data-testid="skills-candidate-status"]` holds the raw backend word (`candidate` / `promoted` / `rejected`) and nothing else; a click on a row's centre must open the detail modal, so actions live in the card footer. `selectable` / `selected` are wired to `selectedCandidateId` (the OPEN candidate) so `aria-pressed` is truthful — bulk selection is the nested checkbox, which `NativeCardComponent` excludes from activation.
- **The Sessions sub-view carries TWO filters, and the second one is a correctness fix** (TASK_2026_322). Beside the status chips (`skills-filter-*`) sits a project scope pair (`skills-scope-workspace` / `skills-scope-all`), defaulting to **this project**. Every workspace on the machine shares one `~/.ptah/state/ptah.sqlite`, and before this the list was unscoped — a freshly opened project's review queue was every other project's backlog. `scopeFilter` lives on `SkillSynthesisStateService` beside `statusFilter` and travels on EVERY `listCandidates` call, so changing the status does not silently widen the scope. `showOrigin` on `SkillCandidatesTableComponent` is bound to `scopeFilter() === 'all'`: with one project selected the line would repeat the same path on every card. A candidate whose `workspaceRoot` is `null` renders the words `project not recorded`, italic and in the muted text tier (`text-base-content-muted`, never an alpha-modified `text-base-content/NN` — the `no-alpha-base-content` ratchet) — never an empty path and never "all projects". Same rule as `NOT_MEASURED`: the state being described is the absence of a value, and a path-shaped blank reads as a value.
- `src/lib/components/skill-invocations-panel.component.ts` — one compact card per run, outcome carried by tone + spine, notes only when present. Deliberately has NO filters: the list is already scoped to one candidate.
- `eslint.config.mjs` — the fourth flat-config block turns the lazy `@ptah-extension/editor` boundary into a lint error (`no-restricted-imports`), exempting only `lazy-diff-view.component.ts`.
- `src/lib/services/skill-synthesis-state.service.ts` — signal state for candidates, invocations, filter, settings.
- `src/lib/services/skill-synthesis-rpc.service.ts` — typed wrappers around skill synthesis RPC methods, including `getSuggestion` (fetch body) and `updateSuggestion` (edit a pending suggestion's name/description/body before accept).
- Jest: `ngx-markdown` is ESM — mocked via `src/__mocks__/ngx-markdown.ts` + `moduleNameMapper` in `jest.config.ts` (same pattern as `setup-wizard`).

### Library (clones) surface

- `src/lib/components/clones/skill-clones-view.component.ts` — smart shell. `NativeTabGroupComponent` splits entries by `CloneSummary.kind` with live counts; each entry renders as a `CloneCardComponent`; clicking one opens `CloneDetailDrawerComponent`.
- `src/lib/components/clones/clone-action-gating.ts` — **the correctness layer**, pure and framework-free. `cloneActionModel(clone, now)` decides which actions may be offered:
  - `Enhance now` is DISABLED below `enhanceMinInvocations` and during the `enhanceCooldownUntil` window, with the threshold / remaining time stated on the control. (It used to fire regardless.)
  - `Revert` is disabled when `historyCount === 0`.
  - `Rebase to upstream` is NEVER rendered for `authored` / `synth` entries. `resolveUpstreamSourceDir` needs `originPluginId`, which is null for both (`skill-registry-catalog.service.ts#deriveStatus`), so `skillSynthesis:rebaseClone` throws `Cannot resolve upstream source`. The card shows `upstreamNote` instead.
  - `KEEP_MINE_EXPLANATION` is the canonical sentence: Keep mine changes NO file content, it only marks the divergence resolved. Both the card tooltip, the drawer and the confirm modal render it verbatim.
- `Enhance now` is a preview, not a write: `skillSynthesis:previewEnhancement` → `EnhancePreviewDrawerComponent` (Monaco diff + judge score + judge reason) → `skillSynthesis:applyProposal` on Apply. Nothing is written until Apply.
- `src/lib/components/clones/lazy-diff-view.component.ts` — the ONLY route to `DiffViewComponent`. It uses a runtime `import('@ptah-extension/editor')` + `ViewContainerRef.createComponent`, deliberately NOT a static import or `@defer`, so the Skills tab never inherits the Monaco/xterm bundle. Jest maps `@ptah-extension/editor` to `src/__mocks__/ptah-editor.ts` for the same reason.
- Divergence resolution (`Rebase` / `Keep mine`) always goes through a confirm modal that states what the chosen action does.

## State Management

Signals + `computed`. Filter is a `SkillStatusFilter` discriminated union. Action dialogs are local component state (`ActionDialogState` shape).

## Dependencies

**Internal**: `@ptah-extension/core` (`VSCodeService`), `@ptah-extension/shared` (`SkillSynthesisCandidateSummary`, `SkillSynthesisInvocationEntry`, `SkillSynthesisRunCuratorResult`, `SkillSynthesisSettingsDto`, `CloneSummary`), `@ptah-extension/markdown` (`MarkdownBlockComponent`), `@ptah-extension/ui` (`NativeCardComponent`, `NativeTabGroupComponent`, `NativeDrawerComponent`), and `@ptah-extension/editor` **lazily only** (runtime `import()` inside `lazy-diff-view.component.ts` — never a static import).
**External**: `@angular/common`, `@angular/forms`, `ReactiveFormsModule`, `lucide-angular`.

## Angular Conventions Observed

Standalone, OnPush, signals + `inject()`, DaisyUI for modals, reactive + template forms.

## Guidelines

- Do not Electron-gate this tab — skills work on VS Code too.
- Promote/reject actions must always allow an optional reason input.
- The settings panel is intentionally read-only — edit via the Settings view.
