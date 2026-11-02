# Code Logic Review — landing live demo in hero + session converter

## Summary

| Metric | Value |
| --- | --- |
| Overall score | 7/10 |
| Assessment | APPROVED with follow-ups |
| Blocking issues | 0 |
| Serious issues | 0 |
| Moderate issues | 4 |
| Failure modes found | 5 |

Scope: `git diff` and untracked files for `libs/web/landing/src/lib/sections/{hero,live-demo}`, `landing-page.component.ts`, `index.ts`, `scripts/landing/session-to-scenario.mjs`, `scripts/landing/session-replay/*`. Spot checks on `orchestration.json` and `orchestration.scenario.generated.ts`. No builds or tests were run (12/12 already green per the task). I read the converter's synthetic-text, deny-list, rewrite, refill and scan paths. I did not read `live-timeline.mjs` (475 lines) line by line.

Privacy rule files are unchanged: `git status` shows no change under `libs/web/landing/src/lib/live-demo/scenario/` or `apps/ptah-electron/src/replay/`.

## Five logic questions

1. Silent failure. `git()` in `scripts/landing/session-to-scenario.mjs:79-85` returns `''` on any git error. The runtime deny list (user name, org, repo) then shrinks silently, and the output scans only catch credential-, host-, IP- and path-shaped text. Real prose names would pass. The converter also keeps prose by design (`synthetic-text.mjs` header: "keeps the shape of the text (prose, ...)"). It protects only identifiers, paths and the deny terms.
2. Unexpected user action. `?demo=B ` and `?demo=%20c` parse correctly (trim + lowercase, `live-demo-variant.ts:21`). `?demo=x` falls back to `stage`. A user who opens `?demo=b` gets the prerendered stage layout first, then a layout swap after hydration (`hero.component.ts` `afterNextRender`: `variant.set(...)`). That is a visible layout shift. It is acceptable for a design-review query param, but it must not ship as a user-facing feature.
3. Wrong answer from input. Real timestamps and process details survive in tool output. Examples: `2026-10-30T15:16:40.279Z`, `pid 903994`, `free memory: 8.8 GB`, and the real session date. No rewriter rule covers ISO timestamps, PIDs or memory sizes.
4. Dependency failure. A missing `chat-tool-call.json` or `multi-agent.json` throws from `baseRpc` and no file is written. That is the right fail-closed behaviour. A scan finding throws before `writeFileSync`. Sanitizer timeline-length drift also throws.
5. Missing. There is no regression test for the converter. Nothing asserts that `orchestration.json` is free of denied terms. The CI scan covers only the generic patterns.

## Failure modes

### Deny-list fails open when git metadata is unavailable
- Trigger: running the converter outside a git checkout, with no `origin` remote, or when `git -C` times out (5 s).
- Symptom: the real org or repo name is not replaced in prose, and nothing reports it.
- Evidence: `session-to-scenario.mjs:79-85`, `:95-100`.
- Current handling: silent empty string.
- Recommendation: print a warning to stderr when `origin` or `user.name` resolve empty. Require `--deny` in that case.

### Structural keys skip the rewrite
- Trigger: a session whose `cwd`, `workingDirectory`, `displayName` or `ptahCliName` holds a real value.
- Evidence: `STRUCTURAL_KEYS` at `session-to-scenario.mjs:42-45` is passed through unchanged by `rewriteTree` (`:130`).
- Current handling: the sanitizer and the two scans run afterwards. The spot check found no `/home/` or `amun` hits, so this run is clean. For `displayName` and `ptahCliName`, a real value would pass if it is not path-shaped.
- Recommendation: run `ids` or `text` on `displayName`, `ptahCliName` and `cwd`. Keep only enum-like keys (`type`, `status`, `phase`, `model`) structural.

### Real timestamps, PIDs and machine stats in tool output
- Evidence: `orchestration.json` contains `2026-10-30T15:16:40.279Z`, `2026-10-30T15:31:17.567Z` and `pid 903994` in an excerpted tool result.
- Impact: low. It leaks the real recording date and some local process facts. It is not an identity leak.
- Recommendation: add a `scrub` rule for ISO timestamps and `pid \d+`, or accept it and note it.

### Variant swaps layout after hydration
- Evidence: `hero.component.ts` constructor, `afterNextRender` sets `variant`.
- Impact: CLS on `?demo=b|c` only. The default path is stable.

### Tilt effect re-registers on each variant or window change
- Evidence: `live-demo-section.component.ts`, the new `effect` in the constructor calls `gsap.registerPlugin(ScrollTrigger)` and `gsap.matchMedia()` each run.
- Handling: `onCleanup(() => mm.revert())` releases it, and `registerPlugin` is idempotent. No leak found.

## Blocking issues

None.

## Serious issues

None.

## Moderate and minor issues

- Moderate: deny-list fail-open (see Failure modes). `session-to-scenario.mjs:79-85`.
- Moderate: `displayName`, `ptahCliName` and `cwd` are never text-rewritten. `session-to-scenario.mjs:42-45`.
- Moderate: ISO timestamps, PIDs and memory figures are not scrubbed (`synthetic-text.mjs` `scrub`).
- Moderate: no automated test pins the converter output against a fixed denylist.
- Minor: `discoverDenyTerms` is case-sensitive. A lowercased or uppercased real name in prose is not matched.
- Minor: `hero.component.ts` moved `aria-hidden` and `pointer-events-none` from the individual decorative images to the wrapper. The wrapper keeps both, so there is no regression. The images now rely on the parent for non-interaction.

## Data flow

1. Session jsonl is read by the repo's own `JsonlReaderService` and `SessionReplayService` via jiti. OK. `vscode-core` is shimmed, with `TOKENS` as a Proxy and a silent `Logger`.
2. Lane records are read from `~/.ptah/state` and filtered to completed lanes in the window. OK.
3. `buildLiveTimeline` compresses the events to the duration.
4. `rewriteTree` rewrites text. Structural keys are skipped. See the gap above.
5. The strict sanitizer runs, placeholders are refilled by position, and a length check guards this. OK.
6. A second rewrite runs, then `rpc` and `config` are replaced from the sanitized output.
7. Both privacy scans run, and any finding throws before the write. OK, fail closed.
8. JSON is written, and the generated TS matches the JSON. This was checked by parsing both: equal, and `at` values are monotonic. OK.

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| Hero device mock and council-demo removed | COMPLETE | No remaining references in `libs` or `apps` (grep) beyond the new spec. Exports removed from `index.ts`. |
| Live demo inside hero with 3 variants (`?demo=a\|b\|c`) | COMPLETE | Layout swaps after hydration. |
| SSR safety | COMPLETE | The variant is read only in `afterNextRender`, guarded by `isPlatformBrowser`. The tilt effect is guarded by `browserReady`, `view` and `matchMedia`. |
| Iframe lifecycle and pause on scroll | COMPLETE | The section's IntersectionObserver and iframe code were not touched in the diff. |
| Accessibility | COMPLETE | Tablist, keyboard handling and progressbar labels are kept. The heading becomes `sr-only` when `showHeading` is false, and the `ptah-live-demo-heading` id stays unique. |
| Converter privacy | PARTIAL | See the moderate issues. Privacy rules were not loosened. |
| Event shapes match the shared types | COMPLETE | The events come from the repo's own replay and live builders. The event types in the output are the 8 expected kinds. |

Implicit requirements not addressed: converter regression test.

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| `?demo=` empty or invalid | YES | Defaults to `stage` | None |
| `?demo=C` | YES | Lowercased | None |
| SSR | YES | Browser-only reads | None |
| Reduced motion or narrow screen | YES | `TILT_MEDIA` gate | None |
| Tilt with a variant change | YES | `mm.revert()` | None |
| No git metadata | NO | Silent shorter deny list | Warn or require `--deny` |
| Real PIDs and timestamps in tool output | NO | Not scrubbed | Low impact |

## Verdict

- Recommendation: APPROVE (follow-ups tracked above)
- Confidence: MEDIUM-HIGH (frontend); MEDIUM (converter, because prose privacy rests on the deny list)
- Top risk: converter prose retention. Real session wording and non-path-shaped names reach the public scenario if the deny list is thin, and the scans cannot catch them.
- What a robust implementation would add: a stderr warning or required `--deny` when git metadata is missing; a text rewrite of `displayName`, `ptahCliName` and `cwd`; a rule for ISO timestamps and PIDs; a fixture test of the converter with a planted denylist; a manual read-through of the scenario prose before each publish.
