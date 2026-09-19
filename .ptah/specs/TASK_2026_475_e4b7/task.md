---
status: in_review
type: bugfix
title: Pricing lookup bills a model at another model's rates
description: >-
  `lookupPricingEntry` matches a model id against the pricing map with a
  bidirectional substring test, so `gpt-5.3-codex` can be billed at `gpt-5`'s
  published rates. The result is a confidently wrong dollar figure with no
  warning, because the unknown-model warning fires only on a total miss. The
  repository already made the same lookup exact-match-only for context windows
  and named the pricing table as the bad example.
labels:
  - pricing
  - shared
---

# Pricing lookup bills a model at another model's rates

`libs/shared/src/lib/utils/pricing.utils.ts:241-248`:

```ts
for (const [key, pricing] of Object.entries(modelPricingMap)) {
  if (normalizedId.includes(key.toLowerCase())) return pricing;
  if (key.toLowerCase().includes(normalizedId)) return pricing;
}
```

`gpt-5.3-codex` contains `gpt-5`. If `gpt-5` is a registered key, the Codex
model is billed at the rates of a different model, silently.

The repository already knows this rule is wrong. `pricing.utils.ts:338`, in the
doc comment for `registerModelContextWindows`:

> Lookup is EXACT-match only — `gpt-5` must never answer for `gpt-5.6-sol` the
> way the pricing table's partial matching would.

The exact-match rule was applied to context windows and never to pricing.

## Why this is not a one-line change

Partial matching is deliberate for date-snapshot ids and is pinned by two
tests:

- `pricing.utils.spec.ts:125` — `gpt-4o-2024-08-06` must resolve to `gpt-4o`.
- `pricing.utils.spec.ts:132` — `supermodel` must resolve to
  `supermodel-2099-final-edition` (the reverse direction).

A segment-boundary rule does NOT fix the reported case: `gpt-5.3-codex` still
starts with `gpt-5` at a `.` boundary. The rule that separates the two cases is
a date-snapshot suffix — accept a partial match only when the remainder matches
`-\d{4}-\d{2}-\d{2}` or a comparable version-snapshot form.

The reverse direction needs its own decision. It has no stated motivation
beyond the test that pins it.

## Acceptance criteria

1. `gpt-5.3-codex` returns `null` when only `gpt-5` is registered.
2. `gpt-4o-2024-08-06` still resolves to `gpt-4o`.
3. The reverse-direction match is either justified in a comment or removed,
   with its test updated to match the decision.
4. A model id that no longer resolves emits the existing unknown-model warning.
5. `test`, `typecheck` and `lint` pass for every touched project.

## Origin

Found during TASK_2026_474_5c9f. Full evidence, including the Codex token and
cost trace, is in that task's `codex-pricing-findings.md`.
