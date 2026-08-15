# TASK_2026_243 — context

## Where this came from

Found while fixing a user-visible defect in the shared provider/model picker
during **TASK_2026_180** (Phase 1). That instance is **fixed and committed**
(`9e42f9c81`). This task is the sweep for the rest.

## The mechanism — read this before "fixing" anything

```html
<!-- BROKEN -->
<select [value]="selected()">
  <option value="">Default</option>
  @for (opt of options; track opt.id) {
  <option [value]="opt.id">{{ opt.name }}</option>
  }
</select>
```

`[value]` is a **property binding applied during the update pass** — the same
pass in which the `@for` options are still materialising. A `<select>` cannot
hold a value that matches none of its current options, so the browser silently
discards the assignment. Angular never re-applies it, because the bound
expression itself never changed.

**Net effect: a pre-set value renders as the first option.** No error, no
warning, nothing in the console.

### Why this is worth a task rather than a shrug

The failure is invisible in the three places you would normally look:

1. **It does not throw.** The DOM just quietly disagrees with the component.
2. **A "did the data arrive?" test passes.** In the picker, the loader was
   called with the correct id — the value reached the component perfectly. Only
   the _render_ was wrong. Any spec asserting the input, the loader call, or the
   emitted output passes while the user sees the wrong thing.
3. **It can render correctly by luck.** If the pre-set value happens to be the
   first option, or options are synchronous and the ordering works out, it looks
   fine — until data or ordering changes.

In the picker, the _provider_ select (synchronous options) looked merely flaky,
while the _model_ select (async loader) failed on **every** render. **Async
options make it deterministic; synchronous options make it a time bomb.**

## Known instances

| File                                                                                       | Status                                                                                                                                                |
| ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `libs/frontend/ui/src/lib/native/provider-model-picker/provider-model-picker.component.ts` | ✅ **Fixed** in `9e42f9c81` (both its selects)                                                                                                        |
| `libs/frontend/ui/src/lib/native/form/json-schema-form.component.ts:74-87`                 | ❌ **Confirmed present.** Options are synchronous and schema-derived, so it may render correctly today by ordering luck. Same construction, same bug. |

**The sweep is the deliverable.** Two instances in one lib means there are
probably more. Search `libs/frontend/**` for `<select` carrying `[value]` (or
`[attr.value]`) whose options come from `@for` / `*ngFor` without `[selected]`.
Check `libs/web/**` too — it is Angular and shares no code with `libs/frontend`,
so it can carry the same bug independently.

## The fix pattern — house precedent exists, follow it

Keep `[value]` on the select and add `[selected]` to **every** option including
any sentinel/default:

```html
<select [value]="selected()">
  <option value="" [selected]="selected() === ''">Default</option>
  @for (opt of options; track opt.id) {
  <option [value]="opt.id" [selected]="opt.id === selected()">{{ opt.name }}</option>
  }
</select>
```

Precedent already in the repo — do **not** invent a new pattern:

- `libs/frontend/chat/src/lib/settings/ptah-ai/voice-config.component.ts:93-101` — the closest analogue (also a provider select)
- `libs/frontend/chat/.../elevenlabs-panel.component.ts:229-235`
- `agent-orchestration-config.component.ts` — precedent for the _sentinel_ case (`[selected]="!agentConfig()?.codexModel"`)

Do **not** reach for `FormsModule` / `ReactiveFormsModule` to solve this. The
picker fix stayed on signals + `OnPush` with no new imports and required **zero
consumer changes**; pulling in forms bindings would widen the blast radius for
no benefit.

## Test requirements — the part that actually matters

A spec that asserts the input, the loader call, or the emitted output **will
pass against the broken code**. That is exactly how this survived: a consumer
spec described the defect in a comment instead of catching it.

Assert the **rendered DOM**:

```ts
expect(select.value).toBe(expectedId);
expect(select.selectedIndex).toBeGreaterThan(0);
expect(select.options[select.selectedIndex].value).toBe(expectedId);
```

Cover all four cases:

1. A pre-set value from the **start** of the option list.
2. A pre-set value from the **end** of the list — catches ordering-luck passes.
3. A pre-set value arriving **after** an async option load.
4. The **sentinel/default** still selecting option 0.

**Mutation-check every spec you write.** Revert the fix, confirm the new specs
fail, restore, confirm they pass, and report both numbers. This was done for the
picker: `4 failed, 30 passed` reverted → `34 passed` fixed. A spec that cannot
fail is worth nothing here, because the entire bug class is "looks fine, asserts
fine, renders wrong."

## Out of scope

- Migrating anything to reactive forms.
- Changing any component's public input/output surface.
- `libs/api/**` (NestJS, no templates).

## Verification

- `nx run-many -t test -p ui skill-synthesis-ui memory-curator-ui chat` (extend to whatever the sweep touches)
- `nx run-many -t lint -p <touched>` — note `nx lint a b c` silently lints only `a`; use `run-many -p`
- `npm run typecheck:all`
- Angular libs typecheck via `tsconfig.lib.json`, which **excludes specs** — run `tsc --noEmit -p <lib>/tsconfig.spec.json` separately if you want specs typechecked

## Outcome

The sweep found **16 broken selects across 12 files** — six more files than the
two this task was filed with, and split across both Angular products.

`libs/frontend` (10 selects, 7 files):

| File                                                               | Selects |
| ------------------------------------------------------------------ | ------- |
| `ui/.../native/form/json-schema-form.component.ts`                 | 1       |
| `tribunal-panel/.../wizard/step-role-roster.component.ts`          | 2       |
| `tribunal-panel/.../wizard/step-panel-preview.component.ts`        | 2       |
| `chat/.../settings/output-style/output-style-list.component.ts`    | 1       |
| `setup-wizard/.../components/welcome.component.ts`                 | 1       |
| `tasks-ui/.../components/filter/task-filter-bar.component.ts`      | 1       |
| `cron-scheduler-ui/.../components/cron-scheduler-tab.component.ts` | 1       |
| `memory-curator-ui/.../components/memory-danger-zone.component.ts` | 1       |

`libs/web/admin` (6 selects, 5 files): `builders/packs/packs-list.html`,
`builders/packs/components/pack-form-modal/pack-form-modal.html`,
`builders/sessions/sessions-list.html`, `components/data-table/data-table.html`,
`components/template-picker/template-picker.html`,
`failed-webhooks/webhooks-triage.html`.

The context's prediction held: **the async-loaded lists fail on every render**,
not intermittently. `template-picker` (`templates()`), `pack-form-modal`
(`groups()`) and `packs-list` (`cohortOptions()`) all populate from a fetch, so
editing a pack has never shown its own cohort — it has always rendered the first
option. Those three are Builders-packs admin surfaces.

### One reported instance was not a defect

`tasks-ui/.../bulk/task-bulk-bar.component.ts:217` matches the search pattern
but is correct. Its `[value]="''"` is a constant sentinel on an action menu, not
a bound state value, and `onStatusPicked` already resets the element
imperatively (`select.value = ''`, line 383). Adding `[selected]` to its `@for`
options would evaluate to a permanent `false` and change nothing. **Left alone
deliberately** — do not "complete the sweep" by touching it.

### Test coverage

Five DOM-asserting specs in `json-schema-form.component.spec.ts`, the shared
primitive: start-of-list, end-of-list, value-arrives-before-options, the
required field that has no sentinel, and the sentinel control case.

Mutation-checked as required. Fix reverted: **4 failed, 318 passed**. Fix
restored: **322 passed**. The one new spec that does NOT fail on reverted code
is the sentinel case, which is the intended control — with no value set, option
0 is selected either way.

Full run across all eight touched projects: **2643 passed, 2 skipped, 0
failed**; lint 0 errors; typecheck clean.
