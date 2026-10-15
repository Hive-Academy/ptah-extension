# Batch 16 fix report (TL-26) — TASK_2026_646_136a

## Scope

Spec-only fix. Three Req 6.7 cases in `capability-matrix.store.spec.ts` built `harness()`
without an outcome reader, so `readLocalMatrix` correctly returned the
`outcomes-unavailable` reason and the exact `toEqual` / `toHaveLength(21)` asserts failed.
Each of those three cases now passes an empty (persistent) outcome reader, exactly as the
case at former lines 699-700 does. Production code (`capability-matrix.store.ts`,
`local-derivation.ts`) was not touched; nothing else in the spec changed.

Modified file (absolute path):

`D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\lane-routing\src\lib\matrix\capability-matrix.store.spec.ts`

## Change 1 — 'rejects a user file whose source is not user and names the entry (Req 6.7)'

- Line range: was 393-394, now **393-396** (+2 lines).
- Its previously-failing assert moved from :412 to **:414** (`expect(seeded.reasons).toEqual([...])`).

Before:

```ts
  it('rejects a user file whose source is not user and names the entry (Req 6.7)', async () => {
    const { store, files } = harness();
```

After:

```ts
  it('rejects a user file whose source is not user and names the entry (Req 6.7)', async () => {
    const { store, files } = harness({
      reader: outcomeReader({ summaries: [] }).reader,
    });
```

## Change 2 — 'rejects a malformed edit by name and keeps the last valid matrix (Req 6.7)'

- Line range: was 440-441, now **442-445** (+2 lines, shifted by change 1).
- Its previously-failing assert moved from :471 to **:475** (`expect(invalid.reasons).toEqual([...])`).

Before:

```ts
  it('rejects a malformed edit by name and keeps the last valid matrix (Req 6.7)', async () => {
    const { store, files, warnings } = harness();
```

After:

```ts
  it('rejects a malformed edit by name and keeps the last valid matrix (Req 6.7)', async () => {
    const { store, files, warnings } = harness({
      reader: outcomeReader({ summaries: [] }).reader,
    });
```

## Change 3 — 'caps named rejections and still names the entries it shows (Req 6.7)'

- Line range: was 492-493, now **496-499** (+2 lines, shifted by changes 1-2).
- Its previously-failing assert moved from :515 to **:521** (`expect(snapshot.reasons).toHaveLength(21)`).

Before:

```ts
  it('caps named rejections and still names the entries it shows (Req 6.7)', async () => {
    const { store, files } = harness();
```

After:

```ts
  it('caps named rejections and still names the entries it shows (Req 6.7)', async () => {
    const { store, files } = harness({
      reader: outcomeReader({ summaries: [] }).reader,
    });
```

## Why this fixes the asserts

`readLocalMatrix` (capability-matrix.store.ts:262-297) returns
`reasons: [OUTCOMES_UNAVAILABLE_REASON]` only when no reader is wired (or the reader
throws / is not persistent). With the double's default `persistent: true` and
`summaries: []`, it derives the local matrix from an empty history and returns
`reasons: []`, so the exact `toEqual` / `toHaveLength(21)` asserts hold. The untouched case
at former :679 ('names a missing or throwing outcome reader and still uses the seed') still
covers the no-reader `outcomes-unavailable` behavior.

## Verification (per decision #53 — no Nx, no Jest; the orchestrator runs the tests)

Command:

```
npx eslint libs/backend/lane-routing/src/lib/matrix/capability-matrix.store.spec.ts
```

Output tail (complete):

```
(no output; exit code 0 — no lint problems)
```

Command:

```
npx prettier --check libs/backend/lane-routing/src/lib/matrix/capability-matrix.store.spec.ts
```

Output tail (complete):

```
Checking formatting...
All matched files use Prettier code style!
```

(exit code 0; `--write` was not needed)

## Decisions

None — the fix followed the batch instruction exactly: the `reader` key was merged into
each case's `harness(...)` options (inline `outcomeReader({ summaries: [] }).reader`, since
none of the three cases needs the double's `calls`), wrapped over three lines to stay
within Prettier's default 80-column print width (`.prettierrc` sets only `singleQuote`).
