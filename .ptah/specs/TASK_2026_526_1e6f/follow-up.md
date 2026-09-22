# Follow-up — deliberately not done in this PR

Two items were cut from TASK_2026_526 on purpose. Both are blocked on
TASK_2026_523 (`feat/task-2026-523-providers-auth`), which at time of writing
is six commits ahead of `main`, local-only and unpushed **by design**: its
landing strategy is one PR opened only after its group D lands, because no
intermediate commit of that branch may leave two writable editors for the same
settings key. Confirmed directly with the session that owns it.

Neither item blocks this PR. The backend is complete and the providers work.

## 1. Frontend registration of `opencode-zen` and `opencode-go`

**Do NOT add them to the `ProviderOption` constant in
`libs/frontend/chat/src/lib/settings/ptah-ai/ptah-cli-config.component.ts`.**

The original implementation plan named that constant as the target. That is now
wrong. TASK_2026_523's Decision 9 gives the component treatment "MOVE and REWORK
in place": it becomes the CLI agents section's instance manager, and its
embedded nine-entry provider constant is **replaced by the merged registry** in
batch D-ii/D-iii. The component survives; the constant does not.

Adding the two ids there today would have been correct on the day and deleted by
D-ii/D-iii without anyone noticing the work had existed.

**After 523 lands**, register both providers once in the merged registry rather
than per surface. That is one registration instead of one edit per settings
component, which is why waiting is the cheaper option and not merely the safer
one.

## 2. Vendor marks for the two providers

`libs/frontend/ui/src/lib/native/provider-mark/provider-marks.data.ts` exists
only on 523 (commit `b156e62c2`, batch C). It is coupled to that branch's
`ProviderModelPickerComponent` extensions, so it must NOT be cherry-picked —
the pair has a seam. The 523 owner asked to hand the pair over coherently rather
than have it taken piecemeal.

**Nothing is broken in the interim.** That file documents its own fallback: a
provider id absent from the table resolves to a host-chosen lucide glyph
(`Terminal` for a CLI route, `Server` for an endpoint, `Bot` otherwise). The two
OpenCode tiles render with a generic glyph rather than a vendor mark. Verified
by reading the table contract, not assumed.

When 523 lands, this is a two-record edit. `{ kind: 'lucide', icon: 'Server' }`
pins the fallback explicitly without hand-authoring a mark; a real path mark is
a licensing question owned elsewhere (Decision 10, D1/D2 on that branch).

One open variable: the 523 owner's user has asked whether the marks table should
widen beyond its six inlined entries to cover every provider. If that lands as
its own batch it will sweep these two ids up automatically and this item
disappears. If it does not, the two-record edit stands as described.

## Excluded by design, not deferred

For the avoidance of doubt, these are NOT follow-ups — they are out of scope
with reasons recorded in `research-report.md`:

- The seven `gemini-*` ids (`/zen/v1/models/{id}`, Google generateContent).
  Ptah ships no translator for that protocol. Adding one is a separate task.
- `jev-1.13` and `jev-1.13-free` (`/zen/v1/systemone`). A structured-judgment
  API, not a chat protocol; it does not belong behind a Messages-shaped provider.

## Known gap, low severity

`contextLength` is `0` for all 97 models. This is safe rather than wrong:
`registerModelContextWindows` skips any entry `<= 0`
(`libs/shared/src/lib/utils/pricing.utils.ts:404`), so the models read as
"window unknown" instead of "window zero". The live `/api/model` probe reports
real per-model windows (128K to 1.05M) but only for the subset one account can
reach, and neither entry declares a `modelsEndpoint` to correct a guess later.
Populating it needs the full 97-model table.
