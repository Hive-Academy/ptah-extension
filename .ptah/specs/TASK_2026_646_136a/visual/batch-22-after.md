# Batch 22 AFTER screenshots (Settings > Agent Orchestration > Background Model Roles, new "Decision model" card)

After commit: `d8675a544` (contains Batch 22 commit `4a3b758c9`), detached worktree
`D:\projects\ptah-extension\.claude-worktrees\646-after-shots` (node_modules junction to the main checkout).
Before commit: `c57a9a1e7` (`646-base-shots`, not rebuilt). Authorised by decision #58. Risk R-10, step A12.

## Method

1. Build in the after worktree root, `NX_DAEMON=false NX_NO_CLOUD=true`, one at a time, `--parallel=1`:
   `npx nx build-dev ptah-electron` (about 1 m 6 s, exit 0), then `npx nx copy-renderer-dev ptah-electron`
   (about 2 m 25 s, exit 0). No `rebuild-native`, no `nx serve`, no other build, e2e or package target.
   The built renderer chunk contains `consumer-row-decision` (grep check), so the AFTER bundle is the feature commit.
2. Capture 1 (same script, no change): `capture-orchestration-settings.cjs` copied byte-identical (`cmp`) into
   `visual\batch-22-after\`; run with `<worktreeRoot>` = the after worktree, prefix `after`.
   Output: `after-roles-{viewport,section,row-open}-{dark,light}.png` (the BEFORE framings 1:1).
   Log: consumer rows 7 (`...judging-enhancement`, `consumer-row-decision`), summary badge "7 roles",
   viewport `{"w":1100,"h":700,"dpr":1}`, themes `anubis` then `anubis-light`.
   The section is 487 px (dark) / 490 px (light) high, shorter than the window, so no `roles-rest` shot was needed.
3. Capture 2 (new script `capture-decision-card.cjs`, same isolation, one Electron launch per scenario): the Decision model
   card, its editor and its states. It also measures contrast, targets, overflow and the Tab order in the page (canvas-based sRGB
   resolution of oklch colours, alpha-composited backgrounds).
4. Pixel check of the six old rows: `compare-rows.cjs` (sharp) on BEFORE vs AFTER PNGs.

Command (each about 1-4 min, the script launches and closes Electron itself):

    node ...\visual\batch-22-after\capture-decision-card.cjs <worktreeRoot> <outDir> after [scenario,...]

Scenarios run: `default` (unset), `ollama-unreachable`, `ollama-unsupported`, `ollama-ready`, `jev-nokey`, `kinds`, `sibling`.

## Isolation (unchanged from BEFORE)

Temp `HOME`/`USERPROFILE`, temp `--user-data-dir`, temp `PTAH_DB_PATH`, `NODE_ENV=test`, `PTAH_E2E=1`, temp workspace with a `.ptah`
marker. The real `~/.ptah` and `%APPDATA%\Ptah Dev` were not read or written (`skillSynthesis.enabled=false` there untouched);
memory not touched. Temp dirs are deleted in the script `finally` (0 `ptah-646-b22*` dirs remain).

## Seeding for the not-ready states (isolated profile only)

- Selection: `<udd>/config.json` = `{ "ptah": { "agentOrchestration.decisionModel": { "kind": "ollama", "model": "tev1" } } }`
  (ElectronWorkspaceProvider config file, `electron-workspace-provider.ts:69,90-100`; section `ptah`, key
  `agentOrchestration.decisionModel`, `decision-model.types.ts:99`).
- Ollama endpoint: `<isolated HOME>/.ptah/settings.json` = `{ "provider.ollama.baseUrl": "<url>" }`. `provider.<id>.baseUrl` matches
  `PROVIDER_BASE_URL_PATTERN` (`platform-core/src/file-settings-keys.ts:724,775`), so it is a file-based key, not a config.json key.
  Run 1 got this wrong (see Limits); the shots in this folder come from the corrected run.
- `unreachable`: base URL `http://127.0.0.1:1` (connection refused), shows "Detail: fetch failed".
- `unsupported-endpoint`: a throw-away Node HTTP mock on `127.0.0.1:<random>` answering `/api/version` with `0.34.2`
  (shows "Detail: Ollama 0.34.2 < 0.35.0").
- `ready` (bonus): the mock answering `0.35.0`, `/v1/systemone` 400 JSON and the control path 404 text.
- `no-credential` (bonus): selection `jev`, no key stored (the isolated secret store is empty).
- No Jev key was ever saved; a dummy string was typed in the field only to see it masked, then the editor was closed (never Save).

## Script change

- `capture-orchestration-settings.cjs`: none (byte-identical to the BEFORE script).
- `capture-decision-card.cjs`: new. Revisions during the work: (a) base URL seeding moved from config.json to the isolated
  `HOME/.ptah/settings.json`; (b) metrics file name carries the scenario list; (c) the "kinds" view uses a `size=4` DOM tweak with
  `height:auto` (screenshot-only, because a native `<select>` popup cannot be captured) in the separate `kinds` scenario.
  The `default` scenario ran with an earlier revision of the kinds tweak (no `height:auto`) so its four
  `after-decision-default-editor-kinds-*.png` were deleted; use `after-decision-kinds-editor-kinds-{dark,light}.png`.
- `compare-rows.cjs`: new, pixel compare of the six old rows.

## Viewports (actual)

- Wide: `{"w":1100,"h":700,"dpr":1}` (all shots without a suffix).
- Narrow: requested 700 x 700, the window clamps to **784 x 700** (`docScrollW` 784 = `innerW` 784). Files with the suffix `-700` were
  taken at 784 px. 700 px is not reachable in this window.

## Screenshot table (folder `batch-22-after\`, 98 PNG)

| Files | Shows |
| --- | --- |
| `after-roles-viewport-{dark,light}.png` | Roles section scrolled to the top: "7 roles", summary "...judging, decision", six old cards plus the Decision model card (unset) in the third row, time-limit row below. Same framing as BEFORE. |
| `after-roles-section-{dark,light}.png` | Element shot of `background-roles-details` (702 x 487 dark, 702 x 490 light). |
| `after-roles-row-open-{dark,light}.png` | "Synthesis lane" reassign popover open (compare 1:1 with BEFORE). |
| `after-decision-default-card-{dark,light}.png`, `...-viewport-...`, `...-section-...` | Decision model card, default unset state (badge "unset", "Unset · code ranking", explanation sentence). |
| `after-decision-default-editor-unset-{dark,light}.png` | Editor open on Unset (picker + help line). |
| `after-decision-kinds-editor-kinds-{dark,light}.png` | The four kinds, expanded inline: Unset, Ollama decision model, TypeSafe Jev, Structured-output model (DOM tweak, screenshot only). |
| `after-decision-default-editor-jev-{dark,light}.png` | Jev kind: optional model (placeholder `jev-1.13.0`), write-only key field EMPTY (type password, value length 0, no stored key echoed), "Remove stored key", "Save decision model". |
| `after-decision-default-editor-jev-typed-{dark,light}.png` | Same with a dummy 24-character key typed: masked dots. After Escape and reopen the field is empty again (log: `valueLength 0`). Nothing saved; the card stays Unset. |
| `after-decision-default-editor-ollama-*`, `...-structured-*` | Ollama and Structured-output editors (no providers/suggestions in the isolated profile). |
| `after-decision-ollama-unreachable-{card,viewport,section,editor}-{dark,light}.png` | State `unreachable`: badge "not reachable", "Could not reach Ollama. Check that it is running and reachable.", "Detail: fetch failed", locality "Runs on this machine: the request text and lane data stay on this machine.", link "Set up Ollama". Editor shot shows the Ollama picker with `tev1`. |
| `after-decision-ollama-unsupported-*` | State `unsupported-endpoint`: badge "not supported", "This Ollama endpoint does not serve decision models. It needs Ollama 0.35 or later.", "Detail: Ollama 0.34.2 < 0.35.0", locality, "Set up Ollama". |
| `after-decision-ollama-ready-*` | State `ready` (local): "Ollama is ready to answer routing questions." plus the local sentence, no set-up link. |
| `after-decision-jev-nokey-*` | State `no-credential` (remote): "No TypeSafe Jev API key is stored. Add one in this row to use Jev.", "Detail: TypeSafe Jev API key is not set", "The request text and lane data are sent to TypeSafe Jev."; no set-up link (Jev has none). |
| `after-decision-default-focus-01..07-{dark,light}.png` | Tab walk from the cell with the Jev editor open: Close, kind select, model input, key input, Remove stored key, Save, then the page behind (Subagent TTL select). Visible 2 px focus outline at every stop. |
| `after-decision-default-*-700.png` | Same card/editor shots at 784 px wide (2-column card grid). |
| `after-decision-sibling-synthesis-editor-{dark,light}.png` | Reference: the existing Synthesis editor with "Not listed? Enter a model ID" open, used to compare control borders and placeholder contrast. |
| `after-decision-metrics-*.json` | Contrast, target size, overflow, kind options, focus stops, style comparison, sibling Tab walk. `...-run1.json` holds run 1 (its three Ollama scenarios are void, see Limits). |
| `run2.log`, `run3.log`, `run4.log` | Capture logs (run2 = run 1 of the card script, all scenarios; run3 = corrected Ollama scenarios + kinds; run4 = sibling). |

## Limits

- Run 1 of the card script seeded the Ollama base URL in the wrong file, so for three scenarios the app probed the machine's real
  Ollama at `127.0.0.1:11434` (read-only status probe, no request text). Those shots were deleted and re-taken with the corrected seed.
  The Ollama probe results in this folder are all against the throw-away mock or a refused port.
- Not seeded: a stored Jev key (the "key stored" state), a configured structured-output provider with models, an Ollama endpoint
  with real model suggestions, and a remote (non-loopback) Ollama URL (locality "remote"). The Structured editor therefore shows its empty
  provider state only.
- The kinds shot expands the `<select>` with `size=4`; the real native popup is not capturable.
- The narrow window is 784 px, not 700 px (window minimum).
- Hover/active states of the new card were not captured separately; the pointer is parked at (5, 5) for closed-state shots.
- Fonts and rendering are of this machine; compare BEFORE and AFTER on the same machine only.
- Other Electron/Node/Jest processes from other sessions were running during the work (an Ollama server too); only this
  run's Electron (one at a time, 12 launches in total, one aborted early) was started and closed by the script; 0 Electron processes from the after worktree remain.
- No Jest, lint, typecheck, serve, e2e or package target was run. No git action taken.
