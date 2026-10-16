# P4 Final Visual Review - TASK_2026_646_136a - Decision model card after Batches 40b / 40c

## Summary

| Metric | Value |
| --- | --- |
| Verdict | **APPROVED** |
| Overall score | 9/10 |
| Visual breaking | 0 |
| Serious | 0 (both original Serious findings CLOSED) |
| Moderate | 0 new (original Moderate 1 CLOSED) |
| Minor | 3 (2 carried over, 1 new observation; none blocks) |
| Viewports | 1100 x 700 and 784 x 700 (window minimum), themes `anubis` (dark) and `anubis-light` (light) |
| Scenarios | default, ollama-unreachable, ollama-unsupported, ollama-ready, jev-nokey, kinds, sibling (all 7, dark + light) |
| Screenshots | 96 PNG in `visual\batch-40-recheck\` (prefix `recheck-decision-`) |

Why 9: every Serious and Moderate finding of `reviews\p4-visual-review.md` is closed with measured evidence, the six old
rows are pixel-identical to Batch 22, and no layout regression appeared. 10 is withheld for the carried-over focus-ring
touch (Minor 1) and for the sibling controls that still fail 3:1 (inherited, outside this card).

## Environment

- Build under test: `D:\projects\ptah-extension\.claude-worktrees\646-after-shots`, detached at `f5d28d2f4` (contains 40b and 40c),
  dev build already present (`dist\apps\ptah-electron\main.mjs`). No build, nx, jest, serve or e2e command was run; no source edited.
- Driver: `visual\batch-40-recheck\capture-decision-card.cjs`, a copy of the Batch 22 script with two changes, both approved by the
  coordinator: (1) scenarios without a seed (default, kinds, sibling) now also write `provider.ollama.baseUrl = http://127.0.0.1:1` (refused port)
  into the isolated HOME, because the default scenario selects the Ollama kind and the editor loads model suggestions from the Ollama endpoint;
  (2) metrics are written per scenario. Command:
  `node capture-decision-card.cjs <A> <T>\visual\batch-40-recheck recheck default,ollama-unreachable,ollama-unsupported,ollama-ready,jev-nokey,kinds,sibling`.
- Isolation: temp HOME/USERPROFILE, temp `--user-data-dir`, temp `PTAH_DB_PATH`, `NODE_ENV=test`, `PTAH_E2E=1`, temp workspace. Ollama base URL per scenario:
  unreachable = `127.0.0.1:1`, unsupported/ready = throw-away Node mock on `127.0.0.1:<random>`, jev-nokey = `127.0.0.1:1`, default/kinds/sibling = `127.0.0.1:1` (guard).
  The real Ollama at `127.0.0.1:11434`, `C:\Users\abdal\.ptah` and the real Ptah profile were never configured as a target.
- One Electron at a time. A first launch was stopped on the coordinator's HOLD during the `default` scenario; its shots and metrics were discarded and
  the whole run repeated after "GO 2". All Electron processes started are closed (0 `electron.exe` left); the leftover temp folder of the stopped run was deleted.
- Standard: no accessibility standard declared in the repository; WCAG 2.2 AA as in the earlier review (1.4.3 text 4.5:1, 1.4.11 components 3:1, focus 3:1, 2.5.8 target 24 x 24).
  Colours are measured in sRGB after alpha compositing (canvas resolution of oklch), computed styles, not pixel sampling.

## Original findings

| # | Original finding | Status | Measured evidence | Screenshot |
| --- | --- | --- | --- | --- |
| Serious 1 | Light theme: select and input borders 1.21:1 | **CLOSED** | Border colour vs its surround, light: `select#decision-kind`, `input#decision-model`, `input#decision-jev-key` all `#745665` = **6.04:1** (was 1.21). Dark: `#989291` = **5.07:1**. Measured in every editor state (unset, jev, ollama, structured, 1100 and 784 wide); 27 of 27 control samples per theme. Needed 3:1. | `recheck-decision-default-editor-jev-light.png`, `...-editor-unset-light.png`, `...-editor-structured-light.png`, `...-editor-jev-dark.png` |
| Serious 2 | Light theme: placeholders 3.28:1 | **CLOSED** | Placeholder colour vs input fill: light `#745665` on `#faf7f5` = **6.04:1** (was 3.28) for "jev-1.13.0" and "Enter a new key to store it"; dark `#989291` on `#131317` = **6.05:1**. Needed 4.5:1. | `recheck-decision-default-editor-jev-light.png`, `recheck-decision-jev-nokey-editor-light.png` |
| Moderate 1 | Raw "Detail: fetch failed" | **CLOSED** | Unreachable card text now: "Could not reach Ollama. Check that it is running and reachable. / Detail: The model endpoint could not be reached." No "fetch failed" or other raw error text in any card or editor of any scenario (grep of the run log and all metrics JSON: 0 hits). The only remaining Detail strings are the fixed `Detail: Ollama 0.34.2 < 0.35.0` (version numbers, unsupported) and `Detail: TypeSafe Jev API key is not set`. Dark and light. The unreachable card grew 227 to 243 px because the fixed sentence wraps to two lines; no overflow. | `recheck-decision-ollama-unreachable-card-dark.png`, `...-card-light.png`, `...-section-dark.png` |
| Minor | "Remove stored key" always shown | **CLOSED** (by design as described) | jev-nokey (host reports `no-credential`): the button is absent from the editor (no `decision-jev-key-remove` target in the measure; screenshot shows Save only). default (selection unset, key state unknown, Jev kind picked in the editor): button visible, 110 x 24 px, contrast 12.46 dark / 15.92 light. Ollama and structured editors have no key field. | `recheck-decision-jev-nokey-editor-light.png`, `recheck-decision-default-editor-jev-light.png` |
| Minor | Footer says "with Undo" | **CLOSED** | Footer now: "Unset saves at once and sends no decision request. Other choices save with Save. Undo puts the previous choice back." (status read: ollama-ready, unreachable, unsupported editors) and, in the Jev editor, "... Undo puts the previous choice back; a key change has no Undo." The sibling Synthesis editor still says "Each choice saves at once, with Undo." (different card). Footer contrast 5.07 dark / 6.04 light. The third variant (status not read) was not rendered: no seed produces `unset` + `unreachable`. | `recheck-decision-ollama-unreachable-editor-light.png`, `recheck-decision-default-editor-jev-light.png` |

## Scenario results

| Scenario | Card state text | Dark | Light |
| --- | --- | --- | --- |
| default | badge "unset", "Unset · code ranking", "No decision model is set. Code ranking chooses lanes and models, and no decision request is sent." | OK | OK |
| ollama-unreachable | badge "not reachable", "Could not reach Ollama. Check that it is running and reachable.", Detail fixed text, local-machine sentence, "Set up Ollama" | OK | OK |
| ollama-unsupported | badge "not supported", "It needs Ollama 0.35 or later.", Detail "Ollama 0.34.2 < 0.35.0", "Set up Ollama" | OK | OK |
| ollama-ready | badge "ready", "Ollama is ready to answer routing questions." + local sentence, no set-up link | OK | OK |
| jev-nokey | badge "no credential", "No TypeSafe Jev API key is stored. Add one in this row to use Jev.", Detail "TypeSafe Jev API key is not set", remote sentence | OK | OK |
| kinds | four kinds expanded (Unset, Ollama decision model, TypeSafe Jev, Structured-output model) | OK | OK |
| sibling | Synthesis editor reference | inherited (below) | inherited (below) |

## Regression check against batch-22-after

- Six old rows, section element shot (`recheck-decision-default-section-*` vs `after-decision-default-section-*`, same 702 x 487 / 702 x 490):
  light 0 of 164 970 pixels differ; dark 3 724 differ with max channel delta 2 (hover transition noise). No change to the six old cards.
- Card sizes dark/light: default 229 x 137/138, ready 175/176, jev-nokey 197/198, unsupported 243/244: all identical to Batch 22.
  Only unreachable changed (227 to 243, the new fixed Detail text wraps).
- Focus walk (7 stops, both themes): 2 px outline at every stop, all inside the editor until the page behind; order Close, kind, model, key, Remove stored key, Save. Unchanged.
- No horizontal document scroll at 1100 or 784 (`docScrollW` = `innerW`).

## Remaining observations (not blocking)

- **Minor 1 (carried over, OPEN):** the focus ring of "Remove stored key" touches the "Save decision model" button (they sit with no gap; `recheck-decision-default-focus-05-dark.png`).
  40b reported it as out of scope. Fix: `mt-1`/gap on the Save button. Source: `decision-model-row.component.ts:290-312`.
- **Minor 2 (new observation, existing placement):** in the Jev editor the footer is now three lines. In the focus walk at a 700 px window the popover bottom is clipped by the window edge
  (`recheck-decision-default-focus-05-dark.png`, last line "Undo." cut); in the plain editor shots the popover fits. Batch 22 had the same placement with a two-line footer, so this is the
  popover position at that scroll offset, not a new break. Shorten the footer or let the popover flip upward.
- **Minor 3 (inherited, outside this card):** the shipped Synthesis editor still measures control borders 1.07 to 1.42:1 and a manual-ID placeholder 1.75/3.28:1
  (`recheck-decision-sibling-synthesis-editor-light.png`, `recheck-decision-metrics-sibling.json`); the "Use model ID" button reads 1.73 dark / 1.47 light (likely a disabled state, not checked). The 40b report already
  names the shared rule at `apps/ptah-extension-webview/src/styles.css:2129-2141`. Narrow 784 px: the card summary cell ("Unset · code ranking") is ellipsised (118 px in 109 px), the intended truncation noted in Batch 22.
- Ollama kind picked in the default editor (endpoint = refused port): no raw error text appears in `recheck-decision-default-editor-ollama-*.png` or the editor metrics.

## Not covered

- A stored Jev key (the `ready` Jev state, where "Remove stored key" is shown for a known key): no key was stored, by design.
- The "status not read" footer variant (`unset` + `unreachable`), a configured structured-output provider with models, a remote Ollama URL.
- The native `<select>` popup (only the `size=4` DOM expansion is captured).

## Verdict

- Recommendation: APPROVE. Confidence: HIGH (measured computed styles, 7 scenarios x 2 themes, pixel comparison with Batch 22).
- Key remaining item: Minor 1 (focus ring of Remove stored key touches Save), optional.

## Screenshots

All in `visual\batch-40-recheck\` (96 PNG). Pattern `recheck-decision-<scenario>-<state>-<theme>[-700].png`:

- `default`: card, viewport, section, editor-unset, editor-kinds, editor-jev, editor-jev-typed, editor-ollama, editor-structured (dark, light, and `-700` for 784 px), focus-01..07 (dark, light).
- `ollama-unreachable`, `ollama-unsupported`, `ollama-ready`: card, viewport, section, editor (dark, light).
- `jev-nokey`: card, viewport, section, editor (dark, light).
- `kinds`: card, viewport, section, editor-kinds (dark, light). `sibling`: card, viewport, section, synthesis-editor (dark, light).
- Metrics JSON: `recheck-decision-metrics-<scenario>.json` (per scenario) and the combined file; logs `run1.log`; `compare-section.cjs` (pixel comparison).
