# Batch 29 report

Removed the skill-synthesis push message from `BackOfficeActivityService`, including its handler declaration, mapper, formatter, imports, and the helper used only by that formatter. Updated the ring comment and eight-message description. Removed the related spec fixtures and assertions, updated the handled-message list, and added `skillSynthesis:event` to the existing unhandled-message test.

Acceptance `rg -n 'SKILL_SYNTHESIS|SkillSynthesis|skillSynthesis|mapSkillSynthesis' libs/frontend/core/src/lib/services -g 'back-office-activity.service*.ts'`: one hit, solely the allowed negative assertion at `back-office-activity.service.spec.ts:507`. A targeted search for the removed symbols and helpers in both files returned zero hits. Tests, typecheck, lint, build, serve, and e2e were not run, as instructed.

## Decisions

- Kept the `ActivitySource` type and its `skills` member in `libs/shared/src/lib/types/rpc/rpc-activity.types.ts:35,48`. The union is declared in shared code, outside the editable files, and this batch explicitly leaves `libs/shared` unchanged.
- Kept the existing activity ring capacity of 50 for the remaining event sources.

## Clarifications Needed

none
