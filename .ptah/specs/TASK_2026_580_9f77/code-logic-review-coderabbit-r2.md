VERDICT: APPROVED
Score: 8/10

CodeRabbit comment 4166659037 fix reviewed: `keepDraftUntilTrimmedChange` in
libs/frontend/chat/src/lib/components/molecules/session-filter-bar/session-filter-bar.component.ts.

## Checks

### (1) linkedSignal options-form typing/semantics — CORRECT

Angular 22 signature: `linkedSignal<TSource, TValue>({ source, computation })`,
where `computation(source, previous: { source: TSource; value: TValue } | undefined)`.
The helper's second parameter is typed `{ source: string; value: string } | undefined`
and is only read when defined (`previous !== undefined &&`), so the first run (no
previous) falls through to `: seed`. Both `text` and `taskId` declare their generics
explicitly (`linkedSignal<string, string>`), so `previous.value` narrows to `string`.
No issue.

### (2) External reset still wins — MOSTLY, with one acceptable/known hole

- Seed differing after trimming (`'bar'` vs draft `'foo '`): `'foo '.trim() === 'bar'`
  is false → `seed` wins. Spec asserts this (`bar` replaces `foo `). OK.
- A genuinely different seed replaces the draft. OK.
- Hole: an external reset to `''` while the draft is whitespace-only (`'   '`) keeps
  the draft, because `'   '.trim() === ''` is true. "Clear filters"/"Clear search"
  set the draft to `''` directly before the echo arrives, so they are NOT affected.
  The surviving case is a workspace switch / parent-driven reset to an empty query
  while the user has typed only spaces. Consequence is bounded: `normalizeQuery`
  (session-filter-bar.component.ts:~430) drops whitespace-only text/taskId, so the
  whitespace never reaches `session:list`; `activeFilterCount` (~line 385) also
  trims. The only residue is the input box still displaying spaces, which then
  prefix the next typed character. Judged acceptable (pre-existing display quirk of
  an unsubmitted whitespace draft, not data loss), but worth a follow-up decision.
  Not a regression introduced by this fix — before the fix, the trailing space
  disappeared on every echo; now a whitespace-only draft survives echoes.

### (3) Emitted query stays trimmed; equal-query no-op — OK

`normalizeQuery` still trims `text`/`taskId` and drops empty fields, and `flush()`
(~line 460) still guards `key === baseline` against the last seed/normalization, so
echoing the same trimmed query cannot loop. The kept draft (`'foo '`) re-normalizes
to the same key, so no re-emission occurs either.

### (4) Debounce/timer — UNCHANGED

`schedule(true)` debounce (250 ms), single `pendingTimer`, `cancelPending()` on
replace and on `DestroyRef.onDestroy` all untouched by the diff. Non-debounced
fields still flush immediately. No regression.

### (5) Spec — WOULD FAIL WITHOUT THE FIX

The new spec types `'foo '`, ticks the debounce, expects the trimmed echo, feeds it
back via `setInput('query', emitted[0])`, and asserts the input still holds `'foo '`.
Under the old `linkedSignal(() => this.query().text ?? '')` the echo would reset the
draft to `'foo'`, failing the assertion. It also covers the seed-differs-after-trim
reset path. Second field (`taskId`) is covered only implicitly — the helper is
shared, so risk is low.

## Findings

- [Moderate] Whitespace-only drafts survive a legitimate external reset to `''`
  (e.g. workspace switch while the user holds unsubmitted spaces), because
  `'   '.trim() === ''` picks the keep-branch. File:
  libs/frontend/chat/src/lib/components/molecules/session-filter-bar/session-filter-bar.component.ts:93-96.
  Impact: cosmetic — the spaces linger in the input and prefix the next typed
  character; no wrong query is emitted (normalizeQuery drops them). Fix option:
  treat an empty/whitespace-only `previous.value` as resettable, e.g. keep only when
  `previous.value.trim() !== '' && previous.value.trim() === seed`.
- [Minor] No spec for the whitespace-only-draft-vs-empty-seed case, so the accepted
  behaviour in (2) is unpinned. File:
  libs/frontend/chat/src/lib/components/molecules/session-filter-bar/session-filter-bar.component.spec.ts:79.

## Score rationale

8/10: the fix is correct for the reported bug, semantics match Angular 22's
`linkedSignal`, debounce and no-op invariants hold, and the spec would catch a
regression. Deducted for the unhandled whitespace-only-draft-on-external-reset
boundary and the missing assertion pinning the chosen behaviour.
