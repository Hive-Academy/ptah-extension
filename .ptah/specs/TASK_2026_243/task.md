---
id: TASK_2026_243
status: in_review
type: BUGFIX
title: >-
  Fix the `[value]`-without-`[selected]` select binding that silently
  discards a pre-set value
description: >-
  Angular applies a `[value]` property binding on a `<select>` during the same
  update pass in which its `@for` options are still materialising. The browser
  rejects a value matching no existing option, and Angular never re-applies it
  because the bound expression itself never changed — so a pre-set value renders
  as the first option instead. Confirmed and fixed in
  `provider-model-picker.component.ts` under TASK_2026_180; the identical
  construction survives in `json-schema-form.component.ts:74-87`. Sweep
  `libs/frontend` for the rest.
---

# Fix the `[value]`-without-`[selected]` select binding

A `<select>` whose value is bound with `[value]` but whose `@for` options carry
no `[selected]` silently discards a pre-set value and renders the first option.

Found while fixing the provider/model picker in TASK_2026_180. One confirmed
remaining instance; the sweep is the point of this task.

See `context.md` for the mechanism, the known instances, the fix pattern, and
why the async case is the dangerous one.
