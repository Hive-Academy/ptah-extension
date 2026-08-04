# Skill Synthesis UI

↩️ [Back to Main](../../../CLAUDE.md)

## Purpose

"Skills" tab inside the Thoth shell. Primary surface is **Recommended** (cluster-distilled, judge-gated suggestions) — each opens a detail panel that renders the SKILL.md body via `@ptah-extension/markdown` and supports inline edit of title/description/body before Accept. Secondary sub-views: **Sessions** (raw per-session candidate log with status filter + promote/reject), **Library** (the clone registry as a `Skills / Agents / Commands` tab strip of cards, with contextual enhance/revert/rebase/keep actions and a detail drawer), **Activity** (diagnostics), **Settings** (read-only). Default sub-view is Recommended.

## Boundaries

**Belongs here**: skills tab UI, candidate filtering, promote/reject dialogs.
**Does NOT belong**: skill curation logic (backend), SKILL.md file writing (backend writes on promote), settings editing (handled elsewhere).

## VS Code Parity

Unlike memory/cron/gateway tabs, this tab **works in both Electron and VS Code** — skills are not desktop-only.

## Public API

From `src/index.ts`: `SkillSynthesisTabComponent`, `SkillSynthesisRpcService`, `SkillSynthesisStateService`, plus `SkillStatusFilter` type.

## Internal Structure

- `src/lib/components/` — `skill-synthesis-tab.component.ts` (single composite tab)
- `src/lib/services/` — `skill-synthesis-state.service.ts`, `skill-synthesis-rpc.service.ts`

## Key Files

- `src/lib/components/skill-synthesis-tab.component.ts:52` — tab UI; OnPush; candidate list, promote/reject modals (DaisyUI), invocation history drill-down, stats card, settings panel listing `skillSynthesis.*` keys.
- `src/lib/components/skill-candidates-table.component.ts` — despite the name (kept because it is exported from `src/index.ts`), this is a `NativeCardComponent` LIST, not a table. Its DOM is bound by `apps/ptah-electron-e2e`: exactly one `[data-testid="skills-candidate-row"]` per candidate, on the `<li>` wrapper; `[data-testid="skills-candidate-status"]` holds the raw backend word (`candidate` / `promoted` / `rejected`) and nothing else; a click on a row's centre must open the detail modal, so actions live in the card footer. `selectable` / `selected` are wired to `selectedCandidateId` (the OPEN candidate) so `aria-pressed` is truthful — bulk selection is the nested checkbox, which `NativeCardComponent` excludes from activation.
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
