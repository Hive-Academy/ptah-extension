# PR #802 review fixes

## 1. Rail geometry

**Still valid:** Yes. The card added 88 or 136 px for attention content, while the board always subtracted 88 px.

**Change:** `canvas-rail-card.component.ts:73-76,425-429` computes the attention extra once, exposes it on the host, and uses it in the height. Collapsed cards and cards without attention report zero. `canvas-rail-board.component.ts:696` subtracts each card's reported extra. The geometry helper needed no change.

**Specs:** `canvas-rail-card.component.spec.ts:240-278` asserts the reported and rendered heights for zero, 88, 136, and collapsed states. `canvas-rail-board.component.spec.ts:702-716` asserts that both extras produce no shift and a wrong extra produces one shift.

**CodeRabbit reply:** Fixed. Each card now reports its attention height, and the board removes that exact value when checking the base card geometry. Added card and board assertions for both content heights and collapsed state.

## 2. Permission preview redaction

**Still valid:** Yes. The existing patterns only recognized a bare sensitive key.

**Change:** `chat-attention-source.service.ts:20-22` accepts alphanumeric, underscore, and hyphen prefixes and suffixes around the existing sensitive words. Assignment still requires `=`; quoted and unquoted value handling is unchanged. The key patterns use flat character classes without nested quantifiers.

**Specs:** `chat-attention-source.service.spec.ts:165-179` covers prefixed assignment keys, suffixed assignment keys, and prefixed flags. Every new secret shaped input is assembled at runtime from separate parts. The existing fixtures at lines 156 and 160 already follow this convention.

**CodeRabbit reply:** Fixed. The preview now redacts full environment variable and flag names containing a sensitive word. Added runtime assembled fixtures for both forms; assignment matching remains limited to `=`.

## 3. GitGuardian documentation finding

**Still valid:** Yes. Review notes contained contiguous fake credential examples. Replaced them with redacted placeholders in `code-logic-review-pr802-fixes.md:56-58`, `code-logic-review-no-tab-answer-2.md:42,107`, `code-logic-review-no-tab-answer-3.md:92`, and `lane-no-tab-answer-fix-2.md:6`. A scan of markdown in this directory found no remaining credential value examples.

## Decisions

- Kept the geometry helper unchanged because the board owns DOM measurements and the helper only compares normalized heights. This is reversible.
- Used the card's existing 88 and 136 px rules, preserving current layout. This is reversible.

## Verification and remaining work

No Nx, Jest, TypeScript CLI, lint, build, or git command was run, as instructed. Scoped `ptah_get_diagnostics` returned unavailable after 45 seconds with all six changed TypeScript files unchecked. CI still needs to run the affected specs.
