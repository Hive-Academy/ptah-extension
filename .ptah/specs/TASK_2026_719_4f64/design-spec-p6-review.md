# P6 Gate 1.7 cross-side review

Verdict: REVISE

Score: 6/10

The placement and calmer list meet D52 visually; capability parity and interaction evidence do not yet pass. Review only: no source changes, builds, tests, installs, or e2e runs.

## Findings

1. **Serious — retained capabilities have no destination.** `design-spec-p6.md`, Surface 3 / Copy, and `prototype/p6/index.html`, `detail()` omit terminal fallback instructions/script/Copy script, active-run counts and resume-unavailable warning, and the pending sign-in completion instruction (`parity-inventory-p6.md` §§3,5). Rename and Remove remain enabled in A12 although parity requires both locked during sign-in. A failed/signed-out row offers only Sign in and is explicitly non-interactive otherwise: Manage/detail/rename/remove are consequently unreachable for those accounts. The success flow after Add also stops at the list instead of opening the new account's access controls. These are behavior removals, not copy reductions. Restore access and map each retained capability into the flat panel.

2. **Serious — prototype cannot establish B-2 or Gate 1.7 interaction acceptance.** `prototype/p6/index.html` only renders fixtures; there are no action/change/keyboard handlers. Add never enables, Manage cannot navigate, and the remove “modal” is a div rather than an opened dialog. Repeated IDs (`ma`, `rn`, `an`, `lt`) break label associations across the gallery. M5 uses native `disabled`, losing the specified focusable waiting target; A12 does not lock Name/Remove. The spec repeats B-2, but unconditionally sends focus to the new row after Add and to the heading after Remove. Make those transitions conditional on active-view/current-focus ownership, demonstrate dynamic toast announcements, and resolve lane radio arrow selection versus immediate save-and-close. A toast role alone does not prove completion announcements or focus preservation. Missing `prototype/p6/README.md` also leaves lane constraints undocumented.

3. **Serious — selector state contract is incomplete.** Surface 1 / P6-4 combines provider Save and account Save without ordering or partial-success behavior. The existing service performs a separate revision-checked `provider:setAccountSelection` (`provider-accounts-state.service.ts:383-409`), not an atomic provider/account transaction. Specify initialization via `open('claude')`, cached ambient reads, loading/no-workspace behavior, draft versus pushed selection reconciliation, conflict recovery, and unconfirmed-write toast/re-read (`:591-598`). Missing parity items also include ambient unknown/signed-out option suffixes, disabled unavailable options and a reachable sign-in path, safe refusal/release-held feedback, and notification when the open account disappears (§§1,2,7). Only-existing-login and unsupported-host hiding are correctly specified. B-1 is correctly retained in prose; the removed-account open question is partially answered by `provider-account.types.ts:251-254`: there is no distinct `removed` selection variant, only `omitted|ambient|named`. Demonstrate absent named IDs separately from signed-out profiles; M4 currently conflates them.

4. **Moderate — responsive and contrast evidence is incomplete.** Inspected A2-dark, R245 detail-light and lane-dark PNGs look legible and spacious. However, `capture.mjs` uses a 1200px viewport and screenshots fixed-width frames; R260 is not an actual 200% zoom check. The narrow main fixture explicitly overrides width rather than proving production popover constraints. Verify real viewport/zoom, long lane names and open popovers without clipping. `design-spec-p6.md`, Contrast explicitly says pairs were not measured. Tokens match the project config; independent spot checks pass: base text/background dark 15.71:1, light 15.39:1; primary text/background dark 9.88:1, light 6.16:1. Record all applied text, muted, focus and status pairs against AA 4.5:1 text / 3:1 UI rather than relying only on existing test names.

5. **Minor — spacing implementation differs from the specification.** `.stack-6` intends 24px block separation, but `list()` puts inline `margin:0` on the ul, overriding its top margin (A2 heading/action sits directly against the first row). Restore the specified separation. Row padding 12px/16px, 12px row gaps and 14px text otherwise support D52 and the cited settings conventions.

## Copy audit

Excluding gallery captions, labels, state words and transient toasts: M1–M3/M5–M6 = 0 helper sentences; M4 = 1; L1–L8 = 0; A1–A15 = 0; reflow fixtures = 0. No remaining normal-state helper sentence needs removal. M4's “Sign in again” is inaccurate for a removed account: distinguish that recovery state. A9's persistent failure/retry row is a useful necessary exception to toast-only feedback. Flat detail and removal of explanatory copy are aligned with D52; functional instructions and retained state warnings must not disappear with that copy.

## Review limit

Static source/PNG inspection and arithmetic contrast spot checks only. Keyboard, screen-reader announcements, real zoom, host removal commits and end-to-end RPC behavior were not exercised. No redesign or implementation is included.
