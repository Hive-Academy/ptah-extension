# Batch 7 independent code-logic review

Score: **6/10**  
Verdict: **NEEDS_REVISION**

Scope: the three new input components and their specs, reviewed against Batch 7, implementation-plan.md:764-775, handoff-494.md section (c), surface-interaction.ts and checkDraftValue. No source files edited, no git or formatters run, and no access to libs/frontend/mcp-apps-page.

Paths below use `C = libs/frontend/declarative-dashboard/src/lib/components/` and `S = libs/shared/src/mcp-apps-contracts/`. Line numbers refer to the files read during this review.

## Findings

### F1 — High: a consumed text draft can commit twice before parent inputs refresh

Evidence: `C/surface-text-input.component.ts:183` falls back to `drafts()[node.id]` whenever local `typedText` is undefined. The first successful commit sets typedText to undefined at :186 and emits removal at :188, but does not locally mark that draft as consumed. Until Angular propagates the parent's updated draft and pending inputs, a second blur/Enter invocation reads the same old draft and emits another commit at :187. Clearing the timer at :181 prevents its scheduled callback, but does not prevent another event from committing. The same window exists after the debounce callback if blur occurs before inputs refresh.

Reproduction: type `draft`, propagate `{x: 'draft'}` into the child, call commit twice without refreshing its inputs. Both emit `{componentId: 'x', value: 'draft'}` against host `old`. A synchronous parent signal update alone does not immediately update a child's bound input signal.

Coverage gap: `C/surface-text-input.component.spec.ts:102` checks blur followed by timer advancement; :111 checks composing Enter then ordinary Enter. Neither checks Enter then blur, or debounce then blur, before input refresh. The debounce test explicitly rerenders at :95.

### F2 — High: stale local text survives host replacement and external draft removal

Evidence: local text is assigned at `C/surface-text-input.component.ts:151` and cleared only on successful commit at :186. There is no invalidation tied to host value, component identity/path, or externally removed/replaced drafts. At :183 it wins even over the current drafts input. The baseline at :113 reads the latest pending/host value, so a host replacement makes the old local draft different and therefore eligible for emission at :187.

Reproduction: type `stale`; update node.hostValue to `new host`, clear the parent's drafts, and propagate those inputs; blur. The display now derives from the new host (:101-110), but the emitted value is still `stale`. The pending timer can produce the same result. This can overwrite a host update with text the UI no longer shows. Reusing the instance with another node also risks emitting the former node's text under the new component id.

Coverage gap: `C/surface-text-input.component.spec.ts:173` changes external drafts and pending values without first typing locally; it cannot detect the surviving typedText.

### F3 — Medium: filtering options for rendering does not make validation safe

Evidence: `C/surface-choice-input.component.ts:103` filters malformed options, but :129 and :152 pass the original node to checkDraftValue. `S/surface-bindings.ts:229` directly calls `input.options.some(option => option.value === value)`. A null entry throws; a non-array options property throws for a string value. This affects both select and radio-group.

Reproduction: options `[null, {value: 'ok', label: 'Fine'}]`, initially null host value. The component renders the valid option. Choosing it calls checkDraftValue on the unfiltered options and throws `Cannot read properties of null (reading 'value')`. A string host/draft/pending value can also trigger the throw during errorText evaluation.

Coverage gap: `C/surface-choice-input.component.spec.ts:179` only renders malformed options with the default null value. `S/surface-bindings.ts:223` returns early for null, bypassing the unsafe iteration. No selection is attempted.

## Behaviour checklist

| Area | Judgment and evidence |
| --- | --- |
| No inputCommit per keystroke | PASS: text :150-153 emits only draftChange and arms the timer. |
| Blur, single-line Enter, 600 ms idle | PASS individually: text :62, :68, :155-167; debounce constant :30. Textarea has no Enter handler. |
| No duplicate commit | FAIL: F1. |
| IME Enter | PASS for the required isComposing event: text :157-159; spec :111-118. This is not a claim that the timer pauses throughout composition. |
| Host changes under a draft | FAIL: F2, including when the parent explicitly discards the draft. |
| Invalid or unchanged text | PASS at the gate: text :185 validates; :187 compares to pending/host baseline. Required/minLength/maxLength hints remain submit-only, correctly following S/surface-bindings.ts:193-199. |
| Timer per instance, restart, clear on commit/destroy | PASS: text :89, :97, :162-172, :181. Invalid and unchanged commit attempts also clear it. |
| Display precedence | PASS: text :101-106, choice :108-113, checkbox :61-66 use draft, then pending, then host. They preserve explicit null (a valid choice clear), false and empty string; absence is undefined. This is preferable to blindly using the plan's nullish-coalescing shorthand for null choices. |
| Choice/checkbox commit gate | PASS for well-formed nodes: choice :148-155 and checkbox :92-98 validate and compare to displayedValue. Malformed choices fail F3. |
| Empty select option | PASS: choice :54, :145-150 maps index zero to null. |
| Malformed options skipped without throwing | FAIL: render filtering exists, but validation bypasses it (F3). |
| Labels and accessibility attributes | PASS for ordinary nonempty messages: text :54-74; choice :47-84; checkbox :34-45. Radios have individual label-for associations; group required/invalid/describedby attributes are on fieldset. |
| Fieldset, legend, radiogroup | PASS: choice :62-67. |
| Unique DOM ids and radio names | PASS: text :34, :79-81; choice :25, :71, :91-92, :141-142; checkbox :20, :51-52. Counters are per family with distinct prefixes. |
| Focus keys | PASS: text :61, :67, :146; choice :52, :73, :140; checkbox :37, :89. Every focusable control has a key. |
| No style, literal text | PASS: complete component templates text :52-76, choice :44-87, checkbox :32-48 use classes, text interpolation and native value/attribute bindings. Targeted source scan found no style, innerHTML or bypassSecurityTrust occurrence. Literal-text tests: text spec :235, choice spec :202, checkbox spec :121. Full shared security-fixture integration remains B8. |

## Requested rulings

| Item | Ruling | Reason and evidence |
| --- | --- | --- |
| (a) New draftChange output | CARRY-TO-B8 | The output is a reasonable implementation of the plan's local draft writes, not an unwanted I/O channel. Text :24-27 defines removal via undefined; :88 declares it; :152/:188 emit writes/removal. B8 must forward it through the node renderer into viewState.drafts and viewStateChange, including deletion, and pass updated drafts back. See implementation-plan.md:767-771 and batch-7-report.md:106-108. This wiring does not excuse F1/F2. |
| (b) Select/radio/checkbox snapback | ACCEPT | These are controlled inputs. Choice :159-163 and checkbox :98 restore the authoritative displayed value when the parent does not apply a commit. Their parent should install a pending overlay promptly; accepting the change does not require waiting for a host echo. Specs choice :95, :156, :166 and checkbox :57, :68 cover applied and unapplied commits. |
| (c) role="radiogroup" on fieldset | ACCEPT | Choice :62-67 preserves fieldset/legend and expresses the radio-group semantics for group-level required/error attributes; labels remain associated with individual radios at :70-74. |
| (d) Duplicated label/error/issue helpers | ACCEPT | No demonstrated behavioural defect follows from duplication alone. Text :124-147, choice :121-142 and checkbox :70-90 are small corresponding implementations. Consolidation is optional maintenance work, not a required correctness fix; plainText itself exists only in text among these three files. |
| (e) Neutral error text | ACCEPT | Text :71-74, choice :82-84 and checkbox :43-45 use text-base-content plus font-medium, and errors are additionally exposed via aria-invalid/describedby. This matches the neutral styling decision recorded in batch-7-report.md:115-116. Visual distinction remains subject to the later visual gate. |

## Exact fix list

1. **B7 / text:** Track consumption of each local/external draft generation so a second trigger cannot re-emit a consumed draft while parent inputs lag. Preserve first-commit support before the parent's initial draft round trip; do not use a permanent value-only dedupe that blocks a later intentional edit to the same string.
2. **B7 / text:** Invalidate local typedText and its timer when the authoritative host value or node identity/path changes, and when the parent discards/replaces the corresponding draft. Coordinate draft removal through draftChange so obsolete drafts cannot be resurrected through the fallback. Preserve drafts across unrelated updates that do not change the bound value.
3. **B7 / text specs:** Add Enter→blur and debounce→blur tests before input refresh, then repeat after refresh, asserting one commit. Add host-change and external draft-clear/replacement tests after actual typing; cover blur and timer, and instance reuse with a different node. Verify a subsequent new edit still commits normally.
4. **B7 / choice:** Pass a node containing the sanitized options list to checkDraftValue in both errorText and chooseIndex (or provide equivalent local safe validation). Keep the same sanitized list for rendering and selection. Do not broaden the shared validator's well-typed contract merely to hide a component-level mismatch.
5. **B7 / choice specs:** For both kinds, test `[null, validOption]` with a non-null displayed value and selection of the valid option; test non-array options with a string displayed value. Assert no throw, correct validation error/commit, and no malformed option rendered.
6. **B8 carryover:** Wire draftChange writes/removals into viewState and forward changed inputs; install pending overlays before discarding committed drafts. Add renderer-level tests for that ordering, draft error propagation, submit flushing, and literal text using the handoff security fixture. These are integration obligations, not missing B7 source files.

## Verification and limitations

- Ran once: `npx nx run-many -t test -p @ptah-extension/declarative-dashboard --skip-nx-cache`. **Exit 0**, project test target successful; Nx reported 14.8 seconds. Output is in `.ptah/specs/TASK_2026_494_ca38/batch-7-codex-test.log`. Nx suppressed suite details, so the executor's 114-test count was not independently verified.
- Ran an in-memory TypeScript-transpilation probe against the actual component methods and actual shared validator. Angular signals/outputs were replaced with minimal test doubles to hold child inputs unchanged between calls. It reproduced two identical commits, stale text after draft removal/host replacement, and the null-option exception. This supplements source reasoning; it is not an Angular DOM regression suite. An initial probe failed during dependency loading; the corrected recursive loader produced all three results above.
- Existing specs were read, not modified. No browser accessibility/visual review, lint or typecheck was run independently. No changes were made to production or test source.
