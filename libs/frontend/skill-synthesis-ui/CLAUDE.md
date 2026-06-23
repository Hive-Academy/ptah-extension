# Skill Synthesis UI

↩️ [Back to Main](../../../CLAUDE.md)

## Purpose

"Skills" tab inside the Thoth shell. Primary surface is **Recommended** (cluster-distilled, judge-gated suggestions) — each opens a detail panel that renders the SKILL.md body via `@ptah-extension/markdown` and supports inline edit of title/description/body before Accept. Secondary sub-views: **Sessions** (raw per-session candidate log with status filter + promote/reject), **Library** (the clone registry: active skills/agents/commands, status legend, enhance/revert/rebase), **Activity** (diagnostics), **Settings** (read-only). Default sub-view is Recommended.

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

- `src/lib/components/skill-synthesis-tab.component.ts:52` — tab UI; OnPush; candidate table, promote/reject modals (DaisyUI), invocation history drill-down, stats card, settings panel listing `skillSynthesis.*` keys.
- `src/lib/services/skill-synthesis-state.service.ts` — signal state for candidates, invocations, filter, settings.
- `src/lib/services/skill-synthesis-rpc.service.ts` — typed wrappers around skill synthesis RPC methods, including `getSuggestion` (fetch body) and `updateSuggestion` (edit a pending suggestion's name/description/body before accept).
- Jest: `ngx-markdown` is ESM — mocked via `src/__mocks__/ngx-markdown.ts` + `moduleNameMapper` in `jest.config.ts` (same pattern as `setup-wizard`).
- Library (clones) tab shows a per-row auto-enhance eligibility tag (`enhanceHint`): `N/M runs`, `cooldown Xh`, or `ready` — computed from `CloneSummary.invocationCount / enhanceMinInvocations / enhanceCooldownUntil`. The manual "Enhance now" button works regardless of eligibility.

## State Management

Signals + `computed`. Filter is a `SkillStatusFilter` discriminated union. Action dialogs are local component state (`ActionDialogState` shape).

## Dependencies

**Internal**: `@ptah-extension/core` (`VSCodeService`), `@ptah-extension/shared` (`SkillSynthesisCandidateSummary`, `SkillSynthesisInvocationEntry`, `SkillSynthesisRunCuratorResult`, `SkillSynthesisSettingsDto`).
**External**: `@angular/common`, `@angular/forms`, `ReactiveFormsModule`.

## Angular Conventions Observed

Standalone, OnPush, signals + `inject()`, DaisyUI for modals, reactive + template forms.

## Guidelines

- Do not Electron-gate this tab — skills work on VS Code too.
- Promote/reject actions must always allow an optional reason input.
- The settings panel is intentionally read-only — edit via the Settings view.
