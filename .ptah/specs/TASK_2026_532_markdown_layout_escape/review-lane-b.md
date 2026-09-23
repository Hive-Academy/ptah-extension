# Code Logic Review — `TASK_2026_532_markdown_layout_escape`

**Verdict: REVISE.** Three independently confirmed ways to produce viewport overlays remain; one also changes the document root's scrolling. The original `fixed inset-0 z-50` example is blocked, but the requested containment guarantee is not met.

## Summary

| Metric | Value |
| --- | --- |
| Overall score | 4/10 |
| Assessment | NEEDS_REVISION |
| Blocking issues | 3 |
| Serious issues | 1 |
| Moderate issues | 1 |
| Minor issues | 1 |
| Failure modes found | 6 |

Score rationale: the hook plumbing, instance isolation and direct regression cases work, so this is not a foundational integration failure (1–2). Confirmed untrusted-content overlays and global CSS effects prevent the 5–6 band. The defects concern the security boundary's policy, not formatting.

Paths below are relative to the worktree. `provide-markdown-rendering.ts`, its spec, `marked-extensions.ts`, and `markdown-block.component.ts` are under `libs/frontend/markdown/src/lib/`. Installed dependency paths resolve under `D:/projects/ptah-extension/node_modules/`.

## Scope and verification

- Read the entire sanitizer, its entire spec, marked extensions, and markdown block component; read task context and implementer report. The task folder contained context and lane reports, but no task.md, task-description.md, implementation-plan.md, batches.md, or style review. No applicable AGENTS.md was found by Ptah search or direct ancestor checks. No source edits or git operations were performed.
- Added a temporary `zz-review-probe.spec.ts`, exercised the actual `provideMarkdownRendering({extensions:'full'})` factory with real DOMPurify **3.4.15**, then deleted the spec; deletion was verified with `Test-Path` returning false.
- Ran `npx jest -c libs/frontend/markdown/jest.config.ts --runInBand --runTestsByPath libs/frontend/markdown/src/lib/zz-review-probe.spec.ts libs/frontend/markdown/src/lib/provide-markdown-rendering.spec.ts`: **2 suites, 64 tests passed** (63 supplied tests plus one observational probe). Extended and reran the probe: **1 test passed**. These observational assertions deliberately confirm vulnerabilities; they are not acceptance tests.
- Loaded sanitizer outputs in installed Playwright Chromium at 1000×800. Used installed daisyUI `dist/styled.css`, a 400×150 host at (100,200), and both `overflow:visible` and `overflow:hidden`. Recorded computed styles, bounds and `elementFromPoint(20,20)`. This is a browser harness, not a full Electron/webview launch; app-specific stacking above the sample header was not reproduced.
- Local raw evidence: `C:/Users/abdal/AppData/Local/Temp/ptah-review-lane-b-probes.json`, `ptah-review-lane-b-browser.json`, and `ptah-review-lane-b-extra.json`. Reproduction payloads and measured results are retained below so the review does not depend on those temporary files.
- Scoped Ptah diagnostics reported TS2352 at `libs/frontend/markdown/src/lib/marked-extensions.spec.ts:135` (a partial token cast lacks `raw` and `text`). This is outside the changed sanitizer paths; its provenance was not established, and it is not counted as a hardening defect. No new lint/typecheck run or full app build was performed.

## Worth fixing now — numbered defects / failure modes

### 1. CSS comments and escapes bypass property detection — Blocking

- **File/evidence:** `provide-markdown-rendering.ts:76` splits text on semicolons and compares literal property spelling at line 79; the hook retains unmatched style attributes at lines 111–115.
- **Trigger:** Any of these survives unchanged:

```html
<div style="/**/position:fixed;/**/inset:0;background:red">x</div>
<div style="position/**/:fixed;inset/**/:0;background:red">x</div>
<div style="\70 osition:fixed;\69 nset:0;background:red">x</div>
```

- **Symptom/impact:** A result accepted as sanitized can cover and intercept app controls. Chromium computed `position:fixed`, `inset:0px`, and rectangle (0,0,1000,800); the injected div won the header hit test even with host overflow hidden. The SVG equivalent, `<svg style="/**/position:fixed;/**/inset:0;width:100vw;height:100vh"><rect width="100%" height="100%" fill="red"/></svg>`, also covered the header.
- **Current handling:** Lowercasing and trimming handles `POSITION : fixed!important` correctly, but neither parses comments nor decodes CSS identifiers. `posi/**/tion` itself was invalid in Chromium and stayed static; it is not the exploitable comment spelling.
- **Concrete fix:** Replace literal property splitting with parsed, canonical CSS declarations and an explicit allowed-property/value policy; serialize only accepted declarations. Fail closed on unparsable syntax. At minimum, reject styles containing comments or backslash escapes before any denylist check, but that alone does not close defects 2–4. Add all three payloads on HTML and SVG to regression tests.

### 2. Existing app classes recreate overlays and alter root CSS — Blocking

- **File/evidence:** `provide-markdown-rendering.ts:40`, `:65`, and `:100` permit every class outside the narrow utility pattern. The app enables unprefixed daisyUI at `apps/ptah-extension-webview/tailwind.config.js:66` and `:230`. Its use of `modal modal-open` is explicit in `libs/frontend/chat/src/lib/update-dialog/update-dialog.component.ts:48`.
- **Trigger:** `<div class="modal modal-open" style="background:red">x</div>` survives unchanged. Even `<p class="modal-open">innocent text</p>` alone survives.
- **Symptom/impact:** The first payload covered the viewport and intercepted the header; Chromium computed fixed positioning, inset zero, and z-index 999 from the existing stylesheet. Root overflow changed to `hidden` for both payloads. This independently violates both containment and the prohibition on global restyling, without a style tag or a dangerous style property.
- **Dependency evidence:** Installed `daisyui/dist/styled.css:894` defines `.modal` with fixed positioning, inset zero and z-index 999; `:920` activates pointer events and opacity; `:938` applies `overflow:hidden` and `scrollbar-gutter:stable` to `:root:has(...)`.
- **Concrete fix:** Define allowed classes for markdown (extension classes, code languages and explicitly reviewed presentation utilities), rather than trying to enumerate positioning utility names. Immediately exclude modal families, including `modal-open` by itself, and audit other app component classes such as toast/drawer. Alternatively isolate rich HTML in a separate document with a controlled stylesheet. A paint-containment wrapper alone does not stop the root `:has` rule.

### 3. `popover` supplies fixed positioning through the browser stylesheet — Blocking

- **File/evidence:** `provide-markdown-rendering.ts:111` only screens class/style; `:178` does not forbid `popover`. Its accepted `display`, width and height declarations do not appear in the set at `:48`.
- **Trigger:** `<div popover style="display:block;width:100vw;height:100vh;background:red">x</div>` survives unchanged.
- **Symptom/impact:** Chromium computed `position:fixed`; the rectangle was (0,-7,1014,814) and the injected div won the header hit test through an overflow-hidden host. Neither JavaScript nor a `position` declaration is needed. An ordinary hidden popover was inert, but overriding display exposed the browser's fixed-position styling.
- **Important distinction:** This demonstrated escape did **not** enter the top layer: `matches(':popover-open')` was false. The ordinary declarative button trigger was stripped by the existing forbidden button tag. Do not dismiss the attribute merely because no top-layer trigger survives.
- **Concrete fix:** Forbid `popover` and related command/target attributes in this output contract, and audit HTML elements with UA-supplied out-of-flow layout. Forbid `dialog` unless there is a specific supported requirement; ordinary details/summary can remain. Add the exact payload above to browser regression tests.

### 4. Surviving geometry styles still escape an unclipped markdown host — Serious

- **File/evidence:** `provide-markdown-rendering.ts:48` omits transforms, translate, margins and logical inset properties; `:100` retains `relative`. `markdown-block.component.ts:26` provides no paint containment, and its classes at `:46` include `max-w-none`.
- **Trigger:** `<div style="transform:translate(-100px,-200px);width:100vw;height:100vh;background:red">x</div>`; substituting `translate:-100px -200px` or `margin:-200px 0 0 -100px` also survives. `<div class="relative" style="inset-inline:0;inset-block:-200px;width:100vw;height:100vh;background:red">x</div>` keeps logical positioning.
- **Symptom/impact:** With visible overflow, transform/translate/negative-margin cases measured (0,0,1000,800) and intercepted the sample header. The logical-inset case moved to y=0 and outside its host. These were clipped by an overflow-hidden positioned host. Thus this is conditional on the surrounding layout, unlike defects 1–3; it still refutes a sanitizer-level guarantee for every consumer.
- **Concrete fix:** Establish a trusted, non-content-controlled block wrapper on every full-preset rendering surface with tested layout/paint containment and clipping; verify wide tables and SVG usability, preferably with internal scrolling. Combine it with the class/attribute policy above. If containment must be guaranteed by sanitized HTML alone, use an explicit restricted CSS policy or a sandboxed document; adding only more property names is insufficient.

### 5. Tests establish token filtering, not the claimed containment contract — Moderate

- **File/evidence:** `provide-markdown-rendering.spec.ts:193` tests a copied configuration using the global instance; the copied FORBID_TAGS at `:197` already omits the new `style` exclusion. The actual factory tests at `:384` check serialized strings, and the compatibility test at `:453` samples only a few extension classes.
- **Trigger/symptom:** All 63 supplied tests pass while defects 1–4 remain reproducible. Existing table/details compatibility assertions at `:240` and `:254` never invoke the changed hook, so they cannot detect a hook-induced regression.
- **Impact:** A green suite gives no evidence for the central no-overlay/no-global-restyling requirement.
- **Concrete fix:** Route the copied-config suite through `presetConfig('full')`; keep the useful real-factory token tests. Add CSS-canonicalization and popover fixtures, SVG cases, full extension-renderer outputs, and a Chromium harness using the shipped stylesheet. Assert header hit testing, paint bounds and unchanged root scrolling after insertion and after relevant user actions, not just absence of literal `fixed`.

## Acceptable residual risk / lower-priority correction

### 6. Exact utility alternatives are actually prefix matches — Minor

- **File/evidence:** `provide-markdown-rendering.ts:41` has no end anchor on `fixed|absolute|sticky`.
- **Probe:** `<div class="fixed-width absolute-value sticky-note">x</div>` became `<div>x</div>` although none is one of the three exact positioning utilities described by the implementation.
- **Impact:** Unrelated custom classes sharing those prefixes can lose styling. No such class used by the six marked extensions was found, so no current extension regression is claimed.
- **Concrete fix:** Anchor those alternatives, for example `^(?:(?:fixed|absolute|sticky)$|-?(?:inset(?:-[xy])?|top|right|bottom|left|start|end|z)-)`, and add nonmatching-prefix tests. This can be folded into the class-policy revision.

Other conditional risks, not additional confirmed app defects:

- **Colon-bearing arbitrary values:** `top-[length:var(--y)]` survives because `provide-markdown-rendering.ts:66` splits every colon, including those inside brackets. `[inset:0]` and `[z-index:999]` survive too; `[position:fixed]` happened to be removed by the unanchored `fixed` prefix. Runtime HTML does not cause Tailwind to generate CSS, so these are not demonstrated shipped-app exploits. Parse variant separators outside bracket expressions, or avoid this parsing problem with the allowed-class policy. Treat their future activation as a maintenance risk.
- **IDs and cross-element controls:** `provide-markdown-rendering.ts:178` does not scope `id`, `for`, or details `name`. Arbitrary IDs and `<label for="app-toggle">` survived; a browser fixture with an existing checkbox showed that clicking the injected label toggles the external control. An injected `<details name="review-details">` closed an existing same-name details element when opened. No matching live-app target was established. Remove unnecessary cross-document control attributes; namespace allowed IDs and rewrite local SVG/anchor references consistently if isolation is required. Forms, inputs and the tested `form` attribute were removed.
- **SVG compatibility:** `foreignObject` was removed by installed DOMPurify even before any layout-specific policy is considered; preserve this existing restriction unless deliberately changing the threat model. Plain SVG paths, viewBox, stroke and basic shapes survived. There was no full visual rendering audit of all possible agent diagrams.

## Five logic questions

### 1. How does this fail silently?

The factory returns success-looking HTML for all three unconditional overlay payloads (`provide-markdown-rendering.ts:158`). No rejection marker distinguishes their surviving CSS from safe presentation; details are defects 1–3.

### 2. What user action produces unexpected behaviour?

Simply displaying agent HTML containing `modal modal-open` covers the UI and changes root scrolling (`provide-markdown-rendering.ts:100`; installed daisyUI `dist/styled.css:938`). In synthetic collision tests, clicking an injected label or opening a named details group affects an existing external element (`provide-markdown-rendering.ts:178`); no current app collision is asserted.

### 3. What input data produces a wrong answer?

Commented/escaped CSS identifiers, UA-positioned popovers and component classes pass the current policy (`provide-markdown-rendering.ts:76`, `:100`, `:178`). Innocent class prefixes are removed (`:41`). Transform and logical-inset styles retain geometry that the container contract does not constrain (`:48`).

### 4. What happens when a dependency fails?

DOMPurify is synchronous here; there is no network timeout or cancellation boundary. Exceptions from instance creation or sanitize propagate because the factory has no catch/fallback (`provide-markdown-rendering.ts:134`, `:157`). There is no observed fallback to unsanitized HTML in this code. Factory use still requires a DOM-capable runtime; the full preset is documented for webview (`:383`). Broader consumer error presentation and SSR execution were not tested.

### 5. What is missing that the requirements never mentioned?

The policy needs an explicit decision about preexisting CSS selectors, UA styles, trusted host paint containment, cross-element IDs/names, and which rich-HTML styling is supported (`provide-markdown-rendering.ts:48`, `:178`; `markdown-block.component.ts:26`). Preventing literal Tailwind positioning tokens is insufficient to define that boundary.

## Blocking issues

Defects **1–3** above: CSS spelling bypass, application-class/global-style bypass, and UA popover positioning. Each includes source location, scenario, impact, fix and browser evidence.

## Serious issues

Defect **4** above: unrestricted geometry without a universal containing host. Scope is explicitly conditional on surrounding clipping.

## Moderate and minor issues

Defect **5** is moderate test-evidence drift (`provide-markdown-rendering.spec.ts:193`); defect **6** is minor class overfiltering (`provide-markdown-rendering.ts:41`).

## Data flow and hook correctness

1. **OK:** `provideMarkdownRendering` installs the full factory and six extension providers at `provide-markdown-rendering.ts:406`; the tests reach that actual factory at `provide-markdown-rendering.spec.ts:80`.
2. **OK:** `getFullPurifier` checks the private singleton, creates an instance and registers its hook once in a synchronous path (`provide-markdown-rendering.ts:134`). Ten repeated factory/sanitize calls returned identical output; source inspection, rather than a hook-count spy, establishes one registration.
3. **OK for ordinary tokens:** Whitespace splitting and empty-class removal at `provide-markdown-rendering.ts:97` worked for tabs/newlines and whitespace-only class values. Variants, important modifiers, negatives and sampled arbitrary values were removed. SVG class filtering worked because the hook reads the string attribute value instead of SVGAnimatedString `className` (`:96`). Colon-bearing bracket syntax is the limitation noted above.
4. **OK:** Installed DOMPurify reads the mutated `hookEvent.attrValue` at `dompurify/dist/purify.cjs.js:2198` and removes attributes when `keepAttr` is false at `:2228`. Both behaviours were observed through the factory, including SVG.
5. **GAP:** Class and style policy is incomplete (`provide-markdown-rendering.ts:100`, `:113`); details are defects 1–4.
6. **OK:** `FORBID_TAGS` removes HTML and SVG namespace style elements and their CSS text (`provide-markdown-rendering.ts:168`); foreignObject was removed by DOMPurify defaults. Normal table/details/basic SVG payloads survived.
7. **OK:** The full instance is separate from the member instance at `provide-markdown-rendering.ts:349` and the global export. After using the full sanitizer, both member and global sanitization retained `class="fixed"`. The full change does not harden the member preset, which is a separate policy.
8. **GAP:** Sanitized output enters an ordinary document element; the shared markdown component does not itself establish paint containment (`markdown-block.component.ts:26`). Browser selectors and UA layout therefore still matter.

## Requirements fulfilment

| Requirement | Status | Gap / evidence |
| --- | --- | --- |
| Stop the original fixed/inset/z utility payload | COMPLETE | Output became `<div class="flex">x</div>`; `provide-markdown-rendering.ts:100` |
| No surviving HTML can cover app UI | PARTIAL | Defects 1–4; `provide-markdown-rendering.ts:48`, `:100`, `:178` |
| Nothing globally restyles the app | PARTIAL | Style elements blocked at `:168`, but `.modal-open` activates root CSS |
| Preserve ordinary table/details/basic SVG | COMPLETE for tested fixtures | Real-factory probe retained structures; `provide-markdown-rendering.ts:159` |
| Preserve marked extension classes | COMPLETE by source audit and sampled output | No emitted class at `marked-extensions.ts:90`, `:193`, `:238`, `:269`, `:309`, `:347` matches current deny pattern |
| Full-only hook; global/member unchanged | COMPLETE | Factory probes and private instances at `provide-markdown-rendering.ts:132`, `:347` |
| Regression tests prove browser containment | MISSING | Current tests inspect strings; `provide-markdown-rendering.spec.ts:384` |

Implicit requirements not addressed: host paint containment and a policy for browser/app CSS and cross-element identities.

## Edge cases / requested bypass matrix

| Case | Handled | Evidence / concern |
| --- | --- | --- |
| Uppercase POSITION, spaces, trailing whitespace, !important | YES | Style removed; property normalization at `provide-markdown-rendering.ts:78` |
| Comments before/after property identifiers | NO | Fixed viewport overlay; defect 1 |
| `posi/**/tion` within identifier | Browser rejects | Survives sanitizer but computes static; no escape from this spelling |
| CSS hexadecimal escapes | NO | Fixed viewport overlay; defect 1 |
| Logical inset-inline/inset-block with relative class | NO | Moves outside unclipped host; defect 4 |
| Transform / translate / large negative margins | NO in unclipped host | Header hit in visible-overflow harness; clipped in hidden-overflow harness; defect 4 |
| Width 100vw / height 100vh alone | PARTIAL | Oversized (100,200,1000,800); did not cover sampled header without movement |
| Huge box shadow | Unconstrained | Style survives; hit-testing does not measure shadow pixels, so visual coverage was not independently established |
| SVG foreignObject | YES | Entire foreignObject subtree removed by DOMPurify |
| SVG inline commented positioning style | NO | Viewport-sized SVG rect intercepted header; defect 1 |
| SVG namespace style tag | YES | Tag and body CSS removed; `provide-markdown-rendering.ts:168` |
| SVG className handling | YES | Only benign diagram/drawing classes remained; hook uses attrValue |
| dialog open | PARTIAL | Survives, UA position absolute, oversized bounds; not modal/top-layer merely because open; ordinary clipping contained tested dialog |
| Bare popover with forbidden button trigger | YES for this payload | Popover stayed hidden; button removed; not a general defence |
| Popover with display:block | NO | UA fixed positioning covers header without entering top layer; defect 3 |
| Ordinary details/summary | YES | Structure retained; named-group collision is conditional residual risk |
| Class whitespace/empty class/repeated calls | YES | Probes passed; `provide-markdown-rendering.ts:97`, `:134` |
| IDs / for / form collisions | PARTIAL | IDs and label targeting survive; forms/inputs/tested form attribute removed; no current app collision demonstrated |

## Verdict

- **Recommendation:** REVISE.
- **Confidence:** HIGH for defects 1–3 and hook behaviour; MEDIUM for coverage of all app surfaces, which were not launched.
- **Top risk:** Untrusted agent HTML can still create an interactive viewport overlay, and a surviving component class can change root scrolling.
- **What a robust implementation would add:** Parsed CSS allowlisting, reviewed markdown class/attribute policy, removal of UA overlay affordances, a trusted containing host or isolated document, and browser tests using the actual stylesheet while preserving table/details/SVG and all extension output.


## Re-review (final round) — orchestrator, in-process

The codex re-review lane was stopped by the vendor's content filter (the prompt listed overlay payloads), so this round was run in-process by the orchestrator. It is not an outside lane.

Method: every payload from the first review, sanitized by the real `'full'` factory (Jest probe, deleted afterwards), then loaded in Playwright Chromium 1000×800 with installed daisyUI `styled.css`, a header at the top, and the content inside a `<markdown>` host at (100,200) 400×150. Measured `elementFromPoint` at the header and at 6 points outside the host, plus root `overflow`. Three modes: raw without the rule, raw with only the containment rule, and shipped (sanitizer + rule). Popovers were force-opened with `showPopover()` as a worst case.

| Mode | Result |
|---|---|
| Raw, no rule (bug) | `original`, `modal`, `popover` cover the header (6/6 outside hits). 4 CSS-spelling payloads hit 4/6. `modal`/`modal-open` set root overflow to hidden. Bug reproduced. |
| Raw + containment only | 0 outside hits for all payloads except a force-opened `popover` (top layer). `modal`/`modal-open` still change root overflow (`:root:has()`). Layer 2 closes both. |
| Shipped (sanitizer + rule) | 14/14 payloads: header hit, 0 outside hits, root overflow unchanged. |

Legit content: a 13-column table with 40-char tokens and an 80-statement code line inside a 400px scroller. With and without the rule the table wraps to 400px (`.prose` has `word-break: break-word`), the last cell stays reachable, and `pre` scrolls internally. File links use a native `title` tooltip, which paint containment does not clip.

Note: lane B's usage audit said tables "scroll internally". That is wrong (`.prose table` has `overflow: hidden`), but it has no effect because the table wraps.

Verification by the orchestrator: `npx nx run-many -t test,lint,typecheck -p @ptah-extension/markdown @ptah-extension/chat @ptah-extension/chat-ui` passed. `ptah-extension-webview:lint` passed. The webview `build` could not run in this worktree because it has no local `node_modules` (`node_modules/prismjs/...` is referenced by relative path). Environmental; not caused by this change.

**Verdict: APPROVE.**

## Re-review (final round)

**Verdict: REVISE — containment passes the tested cases; wide tables and fixed-width SVG diagrams become partially unreachable.**

This is the independent continuation of the requested review. It preserves the earlier in-process review above. Its conclusion differs on compatibility: a table that happens to wrap to 400px does not establish that every supported table wraps, and an explicit-width SVG is not addressed by word wrapping.

### Updated assessment

| Metric | Current result |
| --- | --- |
| Overall score | 6/10 |
| Assessment | NEEDS_REVISION |
| Blocking issues | 0 confirmed in this round |
| Serious issues | 1 |
| Moderate issues | 0 current defects counted |
| Minor issues | 1 |
| Failure modes counted | 2 |

The earlier three blocking bypasses were closed in the measured two-layer configuration. The score moves into the working-with-real-gaps band because one legitimate-content requirement still fails; it cannot reach 7–8 until hidden table/diagram content is reachable.

### Verification method and limits

- Read the revised sanitizer and tests, the new containment rule and surrounding global styles, extension output, file-link listeners and relevant bubble-specific styles. The new policy is at `libs/frontend/markdown/src/lib/provide-markdown-rendering.ts:42`, `:97`, `:132`, `:203` and `:226`; containment is at `apps/ptah-extension-webview/src/styles.css:703`.
- Temporary Jest probe exported the **real full-preset factory's** output for every earlier saved input, plus absolute-position, descendant-containment-reset, overflowing SVG, filter, long-height, wide table, wide SVG and real extension-renderer fixtures. `npx jest -c libs/frontend/markdown/jest.config.ts --runInBand --runTestsByPath libs/frontend/markdown/src/lib/zz-review-probe.spec.ts libs/frontend/markdown/src/lib/provide-markdown-rendering.spec.ts` passed **73/73 tests in 2 suites** (72 supplied tests and one observational probe). The temporary spec was deleted and absence verified.
- Playwright Chromium: viewport 1000×800, installed daisyUI `dist/styled.css`, and the actual webview `styles.css` with external imports/Tailwind build directives omitted. The stylesheet's native CSS rules, including markdown containment and prose styling, were loaded. No full Electron/VS Code session or compiled Angular application was launched.
- Safety harness: actual `<markdown class="prose">` at **(100,200), 400×150**, with a header above. Compared screenshot pixels against an empty-host baseline **everywhere outside the host**, and hit-tested an outside-host grid at 10px intervals. Checked root/body overflow, document scroll dimensions and offsets after each insertion. Thus the shadow/filter cases received paint checks as well as hit tests.
- Baseline and all 46 inserted fixtures: root overflow **visible**, body overflow **hidden**, document scroll size **1000×800**, window offset **(0,0)**. All 46 had **zero outside-host changed paint pixels and zero outside-host descendant hits**. Geometry can extend beyond the host while its paint and hit region remain clipped; the table below deliberately reports both.
- Separate compatibility harness used a **400px-wide, max-height:300px, overflow:auto parent** and a **natural-height markdown host**, avoiding the artificial fixed height used for the safety matrix. Repeated with only containment disabled to distinguish a new clipping regression from existing layout.
- Scoped diagnostics again reported only the earlier TS2352 at `libs/frontend/markdown/src/lib/marked-extensions.spec.ts:135`. No new production source was written, no git operation was run, and `code-logic-review.md` was not changed in this round.

### Payload → measured result

Bounds are `(x, y, width, height)` for the first surviving element, in CSS pixels. The third column is **changed paint pixels outside host / outside-host descendant hit samples**. Root state includes overflow, scroll dimensions and scroll offsets, not just the header hit. The retained named-details/label fixtures below are passive insertion tests; their separate cross-element activation checks are documented under residual risk.

| Input | Computed position; first-element bounds | Outside paint / hits | Root state |
| --- | --- | --- | --- |
| Original `fixed inset-0 z-50 flex` | static; (100, 200, 400, 22.09) | 0 / 0 | unchanged |
| `POSITION :fixed!important; TOP :0` | static; (100, 200, 400, 22.09) | 0 / 0 | unchanged |
| `/**/position:fixed;/**/inset:0` | static; (100, 200, 400, 22.09) | 0 / 0 | unchanged |
| `position/**/:fixed;inset/**/:0` | static; (100, 200, 400, 22.09) | 0 / 0 | unchanged |
| `posi/**/tion:fixed;in/**/set:0` | static; (100, 200, 400, 22.09) | 0 / 0 | unchanged |
| `\70 osition:fixed;\69 nset:0` | static; (100, 200, 400, 22.09) | 0 / 0 | unchanged |
| `relative` + `inset-inline:0;inset-block:-200px` | static; (100, 200, 1000, 800) | 0 / 0 | unchanged |
| `transform:translate(-100px,-200px);width:100vw;height:100vh` | static; (0, 0, 1000, 800) | 0 / 0 | unchanged |
| `translate:-100px -200px; width:100vw;height:100vh` | static; (0, 0, 1000, 800) | 0 / 0 | unchanged |
| `margin:-200px 0 0 -100px; width:100vw;height:100vh` | static; (0, 0, 1000, 800) | 0 / 0 | unchanged |
| `width:100vw;height:100vh` | static; (100, 200, 1000, 800) | 0 / 0 | unchanged |
| `box-shadow:0 0 0 100vmax red` | static; (100, 200, 400, 22.09) | 0 / 0 | unchanged |
| `modal modal-open` | static; (100, 200, 400, 22.09) | 0 / 0 | unchanged |
| `modal-open` alone | static; (100, 200, 400, 22.09) | 0 / 0 | unchanged |
| `dialog open` + viewport sizing | —; text only / empty | 0 / 0 | unchanged |
| `popover` + `display:block` + viewport sizing | static; (100, 200, 1000, 800) | 0 / 0 | unchanged |
| Bare `popover=manual` + forbidden button trigger | static; (100, 200, 400, 22.09) | 0 / 0 | unchanged |
| `details open name=review-details` | static; (100, 200, 400, 44.19) | 0 / 0 | unchanged |
| SVG `foreignObject` containing modal div | static; (100, 200, 300, 150) | 0 / 0 | unchanged |
| SVG commented fixed positioning + full-size rect | static; (100, 200, 300, 150) | 0 / 0 | unchanged |
| SVG namespace `<style>body{display:none}</style>` | static; (100, 200, 300, 150) | 0 / 0 | unchanged |
| SVG/g with positioning and diagram/drawing classes | static; (100, 200, 300, 150) | 0 / 0 | unchanged |
| HTML `<style>body{display:none}</style>` | static; (100, 200, 400, 22.09) | 0 / 0 | unchanged |
| Variants, `!`, negative offsets, `[&>*]:absolute` | static; (100, 200, 400, 22.09) | 0 / 0 | unchanged |
| `[position:fixed] [inset:0] [z-index:999]` | static; (100, 200, 400, 22.09) | 0 / 0 | unchanged |
| `top-[var(--x,theme(spacing.1:2))]` | static; (100, 200, 400, 22.09) | 0 / 0 | unchanged |
| `relative top-[length:var(--y)]`, custom property | static; (100, 200, 1000, 800) | 0 / 0 | unchanged |
| `fixed-width absolute-value sticky-note` | static; (100, 200, 400, 22.09) | 0 / 0 | unchanged |
| Tabs/newlines between utility class tokens | static; (100, 200, 400, 22.09) | 0 / 0 | unchanged |
| Whitespace-only class | static; (100, 200, 400, 22.09) | 0 / 0 | unchanged |
| Arbitrary ID, external label `for`, form/input/form attr | static; (100, 200, 400, 22.09) | 0 / 0 | unchanged |
| Table + details + SVG path + callout class fixture | static; (100, 211.69, 400, 30.69) | 0 / 0 | unchanged |
| `position:absolute;inset:0` | static; (100, 200, 400, 22.09) | 0 / 0 | unchanged |
| Allowed `prose-divider-ornament` + translated viewport size | absolute; (0, 0, 1000, 800) | 0 / 0 | unchanged |
| Allowed `prose-divider` + negative logical insets | relative; (0, 22.75, 1000, 800) | 0 / 0 | unchanged |
| Allowed ornament + negative logical insets + `transform:none` | absolute; (0, 0, 1000, 800) | 0 / 0 | unchanged |
| Allowed ornament + descendant `contain:none;isolation:auto` | absolute; (0, 0, 1000, 800) | 0 / 0 | unchanged |
| SVG `overflow:visible`, rect from (-1000,-1000) to (2000,2000) | static; (100, 200, 100, 100) | 0 / 0 | unchanged |
| `filter:drop-shadow(0 -200px 0 red)` + viewport size | static; (100, 200, 1000, 800) | 0 / 0 | unchanged |
| `height:100000px;width:100vw` | static; (100, 200, 1000, 100000) | 0 / 0 | unchanged |
| 20-column native table (Header0…19 / Column0…19) | static; (100, 211.69, 627, 239.31) | 0 / 0 | unchanged |
| SVG width=1200 height=100, far-edge text at x=1000 | static; (100, 200, 1200, 100) | 0 / 0 | unchanged |
| Real extension: 40 lines, each 180+ characters | static; (100, 209.75, 400, 788.86) | 0 / 0 | unchanged |
| Real NOTE callout renderer | static; (100, 208.28, 400, 45.11) | 0 / 0 | unchanged |
| Real file-link renderer, `C:/src/a.ts:12:3` | static; (100, 202, 53.5, 18) | 0 / 0 | unchanged |
| Real divider renderer | relative; (100, 222.75, 400, 1) | 0 / 0 | unchanged |

Absolute positioning was deliberately reached through **allowed** `prose-divider-ornament`: `apps/ptah-extension-webview/src/styles.css:1168` supplies `position:absolute`. Both its transform and logical-inset versions measured **(0,0,1000,800)** but produced **0 paint / 0 hits** outside the host. Overriding `contain` on the descendant did not override the trusted ancestor's containment.

The original utility, modal and arbitrary-class inputs now lose those classes; CSS comments/backslashes lose the whole style attribute; dialog is removed and popover loses its UA affordance (`provide-markdown-rendering.ts:132`, `:147`, `:216`, `:242`). SVG `<style>` and foreignObject remain removed. No old spelling bypass survived this measured configuration.

### Legitimate content and interactions

| Check | Measured result | Conclusion |
| --- | --- | --- |
| 20-column table in 400px host | Table width **627px**; host clientWidth **400**, scrollWidth **627**, but assigned scrollLeft stayed **0**. Parent scrollWidth **400**, max scrollLeft **0**. Table itself has no scroll range. | **Fail:** rightmost 227px inaccessible. |
| Same table, containment disabled only | Parent scrollWidth **627**, max scrollLeft **227**. | Confirms containment introduced lost access. |
| SVG `width=1200 height=100` with far-edge label | SVG width **1200px**; host scrollWidth **1200**, scrollLeft stays **0**; parent scrollWidth **400**, max scrollLeft **0**. | **Fail:** rightmost 800px inaccessible. |
| Same SVG, containment disabled only | Parent max scrollLeft **800**. | Confirms regression for legitimate explicit-width diagrams. |
| 40-line code extension, 180+ chars/line | Pre clientWidth **398**, scrollWidth **1213**, max scrollLeft **815**; parent max scrollTop **508**. Details toggled `open` **true→false→true**. | Pass: long lines and bottom lines reachable. |
| Real NOTE callout / code header | Callout header remains **display:flex**, width **380.44px**; code header remains **display:flex**, width **398px**. All renderer classes survive the updated tests. | Pass for tested output. |
| Divider renderer | Host height **46.5px** includes margins; ornament remains inside the host paint boundary. | Pass. |
| File link keyboard focus | Tab focuses anchor, `:focus-visible` true; title and original file target retained. | Activation affordance survives; focus-ring clipping noted below. |
| File link hover tooltip mechanism | Renderer emits native `title="C:/src/a.ts:12:3"` at `marked-extensions.ts:347`; listener installs click/auxclick only at `markdown-file-links.ts:86`. | No app DOM tooltip/popover to clip. Native tooltip UI was not visually measured in headless Chromium. |

### Must fix

#### 1. Paint containment removes access to wide tables and diagrams — Serious

- **File:** `apps/ptah-extension-webview/src/styles.css:703` / `:705`; table sizing and `overflow:hidden` at `:949` / `:955`. The generic renderer has no inner scrolling wrapper (`libs/frontend/markdown/src/lib/markdown-block.component.ts:26`).
- **Trigger:** Ordinary HTML table with twenty columns, or `<svg width="1200" height="100">…</svg>` in a 400px markdown surface. Tables have minimum intrinsic width from cell padding/content even with word breaking. A wider-than-host table is not prevented by `width:100%`.
- **Impact:** Users cannot see the rightmost columns or diagram labels. An existing overflow-auto parent cannot recover the portion clipped inside the paint-contained child.
- **Probe evidence:** Table and SVG widths **627/1200** vs host **400**; host, table and parent horizontal scroll offsets all remain **0** despite attempts to scroll. Removing containment restores parent ranges **227/800**. This disproves the implementer note that table overflow hidden makes it scroll internally, and limits the earlier in-process review's wrapping observation to its particular fixture.
- **Concrete fix:** Keep containment and establish horizontal scrolling **inside the paint boundary**. A minimal candidate is `overflow-x:auto` on the trusted markdown host, with suitable sizing and accessible keyboard scrolling; an alternative is guaranteed bounded scroll wrappers around tables and wide diagrams. Do not remove containment. In a browser-only trial, adding `markdown { overflow-x:auto; }` retained computed `contain:layout paint` and yielded host max scrollLeft **227** for the table and **800** for the SVG.
- **Scope qualification:** Chat bubbles already add `overflow-x:auto` at `libs/frontend/chat/src/lib/components/organisms/message-bubble.component.css:82` / `:86`; this mitigates that consumer. The new global rule must also work for generic MarkdownBlock/release-note/preview and other consumers that have only an outer scroller. Do not infer coverage of those consumers from the bubble-specific fix.
- **Regression check to keep:** A table whose intrinsic minimum width exceeds the host, an explicit-width SVG with a visible far-edge marker, and a long code block. Assert that the far edge can be reached while paint/hit tests remain inside the host.

### Acceptable residual risk

#### 2. Edge-aligned links lose most of their external focus outline — Minor

- **File:** `apps/ptah-extension-webview/src/styles.css:705` clips descendant paint; `:508` / `:509` uses a **2px outline plus 2px positive offset** outside the anchor.
- **Probe:** Real file-link renderer at the start of a natural-height host: host **(100,200,400,22.09)**, anchor **(100,202,53.5,18)**. Tab focus was successful. Screenshot comparison found **44 changed focus pixels inside** the host and **0 outside**; with containment disabled, **234 additional focus pixels** appeared outside. A narrow visible part of the indicator remains, so this is not reported as complete keyboard-focus loss.
- **Fix:** Use an inset focus treatment for markdown links or reserve at least 4px of paint space inside the host. Verify first/last-line links and details summaries at narrow widths. Preserve containment.

Other residuals are documented caveats, not additional current app defects:

- **Cross-element IDs/labels/details names remain unscoped** at `libs/frontend/markdown/src/lib/provide-markdown-rendering.ts:226`. Retesting confirmed that an injected label can toggle an existing checkbox with the same ID, and opening an injected same-name details element closes an existing details element. No matching live-app target was established; these were existing policy risks, not new containment bypasses. Remove unnecessary `for`/`name` relationships or namespace them if stronger interaction isolation is required. Forms/inputs and the tested `form` attribute are still removed.
- **Prefix families are broader than literal emitted tokens** at `provide-markdown-rendering.ts:56`; e.g. arbitrary `callout-*` names survive. No current global selector effect from these families was found. Keep them reserved to markdown, or replace fixed families with exact emitted class names. The host boundary remains the physical safeguard.
- **Ordinary content height remains unconstrained by design:** a natural-height host can grow for long content. The fixed-height safety matrix establishes clipping, not a resource/size limit or a guarantee that every parent is properly sized.

### Five logic questions — updated answers

1. **Silent failure:** wide content survives sanitization but its far edge is hidden with no scroll affordance (`styles.css:705`, `:955`); must-fix 1.
2. **Unexpected user action:** horizontal scrolling an outer preview does nothing for that hidden edge; focusing an edge-aligned link clips most of its outline (`styles.css:509`, `:705`).
3. **Wrong input result:** an intrinsic-width table or explicit-width SVG larger than the host is the remaining demonstrated compatibility failure; tested positional/style/class inputs stayed contained.
4. **Dependency failure:** sanitizer errors still propagate through the synchronous factory without returning unsanitized fallback (`provide-markdown-rendering.ts:200`). The measured containment depends on this webview stylesheet being loaded; full app build/runtime integration was not independently exercised.
5. **Missing requirement:** the design now defines containment but needs an explicit inner scroll contract for every full-preset consumer (`styles.css:703`; `markdown-block.component.ts:26`).

### Final-round conclusion

**REVISE for must-fix 1.** No confirmed overlay or root-overflow bypass remained in the 46-case browser matrix. Compatibility is partial: ordinary callouts, details, code headers and code scrolling pass; wide native tables and explicit-width SVG diagrams need a reachable scrolling surface inside the paint boundary. Confidence is high in those measured results and limited to the browser harness, not a launched packaged app.

## Resolution of the codex final re-review (orchestrator)

The codex re-review found that paint containment clipped content wider than the host that cannot wrap (a 20-column table, a 1200px SVG) with no scroll path. This corrects the earlier in-process APPROVE, whose test table wrapped only because its cells held breakable text.

Fix: `overflow-x: auto` added to the `markdown` rule in `apps/ptah-extension-webview/src/styles.css`. Re-measured in Chromium: old rule, last table cell unreachable (`scrollLeft` 0); new rule, host scrolls 276px and the cell is reachable; the 1200px SVG end is reachable; a `position:fixed; inset:0` payload stays contained (header hit, nothing outside the host).

Accepted residual risk: the reviewer's minor finding that a focus outline on an element flush with the host edge is partly clipped. Links inside markdown keep a visible outline on the inner sides.
