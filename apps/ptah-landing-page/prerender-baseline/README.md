# Prerender baselines

One JSON file per prerendered route (`{ route, h1, text }`). They record the
English text of the six static routes, and
`nx run ptah-landing-page:prerender-check` compares every build against them
(`tools/i18n-check/src/prerender/check-prerender.ts`). Translation work must
leave this text unchanged (TASK_2026_575, requirement 3.5).

## Source

Captured once with `--update` at commit `70b712f8`, from the templates before
any i18n change.

## One-time edit (TASK_2026_575, Batch 9)

`home.json` and `pricing.json` were edited by hand, not recaptured. Each lost
one segment: the live countdown value (`03Days:07Hrs:58Min:51Sec`) of
`ptah-countdown-timer`. For each file the new `text` is
`collapseWhitespace(old.text.replace(/\d{2}Days:\d{2}Hrs:\d{2}Min:\d{2}Sec/, ''))`.
`route` and `h1` are unchanged, and the other four files are untouched.

Why: a live countdown is not copy. Its prerendered value depends on the build
time, so it made every later compare drift. After Sep 30 it renders
"Applications closing" instead of the cells, so masking only the digits would
break again. The countdown host now carries `data-prerender-volatile`, and the
checker skips that subtree when it captures and when it compares.

## Rules

- `--update` is forbidden, except to record an approved English copy change.
- A text difference in a translated template is fixed in the template or in its
  `en.json` value, never here.
