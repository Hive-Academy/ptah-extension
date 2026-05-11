# Skill Synthesis UI

↩️ [Back to Main](../../../CLAUDE.md)

## Purpose

"Skills" tab inside the Thoth shell. Displays AI-generated skill candidates with filter by status (`pending | promoted | rejected | all`), per-row promote/reject actions (each with optional reason modal), invocation history drill-down, aggregate stats, and a read-only settings panel.

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
- `src/lib/services/skill-synthesis-rpc.service.ts` — typed wrappers around skill synthesis RPC methods.

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
