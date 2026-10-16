# Delta 2 notes: agent dock, agent tiles, tool rows as today (TASK_2026_677_efcd)

Prototype only. Merges the chosen delta 2 design (decisions rows 30-31, option B) into `index.html`, `assets/app.js`, `assets/app.css`, and applies row 32.
`options-delta-2.html` and its assets (`delta2.css`, `delta2.js`, `delta2-sprite.js`, `capture-delta2.mjs`) are unchanged and still pass.
`delta2-sprite.js` (lucide-angular icon data, ids `d-<name>`) is now also loaded by `index.html`; `sprite-extra.js` is unchanged (the vendored provider marks
`m-claude`, `m-codex`, `m-antigravity`, ... already live in `sprite.js`).

## What changed

| Area | Change | Where |
| --- | --- | --- |
| Thread switcher | New agent dock (option B) between the header and the thread: `role="tablist"` "Agent threads", avatar chips, the selected chip expanded (gold-bordered pill, name + status word + duration), group dividers, explicit `N agents ›` button (count badge at <= 520 px), hover/focus card, grouped menu. Hidden when `host=electron` (no lane surface) and when there are no agents (`body=empty`, `loading`). | `index.html` `#dock`; `app.js` "agent dock" block; `app.css` `.dk-*` |
| Selection model | Orchestrator = session thread (`state.lane = ''`); any other agent opens its lane view (`state.lane = id`), same state the AGENTS rows and the `Open lane` link use. Automatic activation. From the dock, focus stays on the tab (tab pattern); rows and `Open lane` still land on the lane title. | `dockSelect`, `openLane(id, {dock:true})` |
| Hover / focus card | 220 ms hover delay, opens on `:focus-visible`, stays open while the pointer is on the card (it is inside the item, WCAG 1.4.13), Esc dismisses it (capture-phase handler, runs before the sheet's Esc), one card at a time (a hovered item hides another item's keyboard-focus card). No touch trigger; the `N agents ›` menu is the touch path. | `.dk-tip`, window `keydown` in `dockEvents` |
| Overflow | Strict priority: Orchestrator, selected, needs you, error, running, rest. Pip on `N agents ›` when a hidden agent needs you or failed (`aria-label` says so). | `dockFit` |
| AGENTS tile | Avatar 32 (status ring + corner glyph) | name + status word + duration / kind badge + activity. Row padding 11/14/11/17, gap 13. Label, `aria-current`, request panel (`.req-wrap`, indent 62 px) unchanged. | `agentsHTML`, `.agent__*` |
| Avatars | CLI lanes: provider marks (`codex`, `antigravity`). Sub-agents: lucide role icons (`layout-template`, `drafting-compass`, `bot` default). Background: `square-terminal`, dashed. **Orchestrator: the session provider mark (`m-claude` in the mock) with the gold hairline, no `Workflow` glyph (user decision 3).** | `av()`, `AG`, `ORCH` |
| Providers | No Gemini anywhere in `index.html` output: replaced by Antigravity (real `antigravity` mark, id `antigravity`, lane id, request keys `lane:antigravity:r*`, `?lane=antigravity`). The monogram fallback is not shown (no unknown CLI id in the mock). Lane types are today's only (codex, copilot, cursor, antigravity, opencode, pi, grok, ptah-cli). | `AG`, `index.html`, `capture.mjs` |
| Turn chips | The inline agent chips in the thread use the same role icons and marks (no `>_` / bot / layers). | `index.html` `.cs-agents` |
| **Tool rows (row 32)** | Tool-call rows in the work log keep today's rendering: verb in muted text (`Read`, `Grep`, `Bash`), name in bold base-content, full path / args muted (mono), small muted chip for extra args (`lines 14-25`, `content`, `allow_large`), thin 2 px left accent bar per row (`--surface-border-strong`; running rows use `--state-ink-run`). Thinking and sub-agent rows keep their delta 1 look (same bar). The `Worked for` disclosure, collapse and everything else are unchanged. | `index.html` `.log-tool--call`; `app.css` end |

## State rules (unchanged vocabulary)

State = ring + corner glyph + status word, never colour alone. Status words are the app's existing ones (`running`, `waiting`, `done`, ...); the ring maps
running = spinning 30% arc, waiting = solid ring + halo, failed = solid ring, done / stopped = no ring. Reduced motion (`prefers-reduced-motion`, or the
prototype `reduce=1`): static arc, no halo, transitions 0 ms.

## Contrast

No new colour pair. Every pair is one already in design-spec 8.2 (state ink words and rings on surface-0/1/2, muted text on surface-0/1/2/3, kind badge on
surface-3, gold selected indicator, focus ring). The tool-row accent bar is decorative (`--surface-border-strong`, or the run ink); the chip text is muted on
surface-3 (the kind-badge pair). `contrast-check.mjs`: 34 themes, 34 pass, 0 fail.

## Checks

- `node .ptah/tmp/check-run.mjs proto-checks -- node <task>/prototype/assets/capture.mjs checks`: **162 PASS / 0 FAIL** (was 122; +40). New section L:
  dock tablist and single tab stop (roving tabindex), no target < 24 x 24 px in the dock (wide, 400 px) and in the menu, 6 agents fit at 1594 px,
  overflow at 400 px, ArrowRight / ArrowLeft (wrap) / Home / End with automatic activation and focus kept on the tab, hover card opens on keyboard focus,
  Esc dismisses it, pointer card delay + stays while hovered + closes on leave, `N agents ›` menu (grouped, focus on checked row, Esc returns focus, Enter
  selects), overflow pip when a hidden agent needs you (and no pip when nothing hidden needs you), AGENTS tile anatomy, provider marks and role icons, no
  Gemini, orchestrator provider mark with gold hairline and no `Workflow` glyph, tool rows as today, dock hidden for `host=electron` and empty bodies (dark + light).
- `capture-delta2.mjs checks`: no targets below 24 x 24, no console errors (options page still works).
- `contrast-check.mjs`: 34 / 34.

## Screenshots (`screenshots/`, dark = anubis, light = anubis-light)

`delta2-merged-full-dock-inspector-{dark,light}.png`, `delta2-merged-lane-selected-*`, `delta2-merged-dock-400-*`, `delta2-merged-dock-400-overflow-pip-*` (340 px,
hidden agent needs you), `delta2-merged-hover-card-*` (pointer), `delta2-merged-hover-card-focus-visible-*` (400 px, keyboard),
`delta2-merged-agents-menu-open-*` (wide), `delta2-merged-agents-menu-open-400-*`, `delta2-merged-tool-rows-*`. The older state screenshots were regenerated with
the dock (`capture.mjs shots` no longer deletes `delta2-*` files). Mode `capture.mjs delta2-merged` rebuilds only the new set.

## Not touched

`design-spec.md`, `task-description.md`, `parity-inventory.md` (other agents). `prototype/README.md` and the older ROUND / DELTA notes are not updated here (they still
describe the pre-delta-2 chips, tiles and tool rows). Hover card has no touch trigger by decision; the `N agents ›` menu is the touch path.
