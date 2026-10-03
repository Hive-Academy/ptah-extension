# Batch 25 report: routing map + nodes

Executor: Providers owner (in-process frontend-developer). Worktree
`D:\projects\ptah-extension\.claude-worktrees\task-555-settings-redesign`, on top of 7f1742f4d.

- Nothing committed; no git stash / restore / checkout / reset / clean.
- No PowerShell find-and-replace: every file edit used the edit tool.
- No `ui`, `core`, `shared` or backend edits.
- `ProviderSetupWizardComponent` is untouched: its `git diff HEAD --stat` is empty.

Paths are relative to `libs/frontend/chat/src/lib/settings/providers/` unless prefixed `HARNESS/`
(`libs/frontend/webview-e2e-harness/src/lib/scenarios/settings/`).

| Abbreviation | File |
|---|---|
| `M` | `routing-map.component.ts` |
| `N` | `routing-map-node.component.ts` |
| `PS` | `providers-settings.component.ts` |

## Files

| Status | File | Lines | Role |
|---|---|---|---|
| CREATE | `routing-map.component.ts` (+ spec) | 272 | Map: header, "Operational" pill, three nodes, preview derivations (exported pure functions), tab navigation |
| CREATE | `routing-map-node.component.ts` (+ spec) | 100 | Generic node shell: dot + status text, header badge slot, skeleton / error / preview, footer with the stretched action |
| MODIFY | `providers-settings.component.ts` (+ spec) | 700 (at the limit) | Mounts the map above the main-agent block (deferred); moves the D16 badges into the Main Agent node header |
| MODIFY | `HARNESS/settings-visual.e2e.spec.ts` | — | Node columns / size measurement and assertions (outside the list; the capture spec is the per-batch gate) |

## Acceptance → file:line → spec

| Acceptance | Implementation | Spec |
|---|---|---|
| `RoutingMapComponent` + `RoutingMapNodeComponent`, testids `routing-map`, `routing-node-main-agent\|background-roles\|cli-agents` | `M:112` (`routing-map`), `M:129/:148/:174`. `N:33` renders `routing-node-{nodeId}`. | Map spec "renders the three nodes…"; visual spec (3 nodes present in both hosts) |
| Status dots always paired with text | `N:37` puts the dot (`aria-hidden`) next to the title, and `N:41-42` renders the visible status text (`routing-node-status`: "Active" / "Needs attention" / "Not set", "6 roles", "4 enabled"). The map pill pairs its dot with its text (`M:120-122`). Colour is on the dot / pill only; text is base-content (deviation 6). | Node spec "renders the title, a dot always paired with visible status text…", "tone %s colours the dot only" |
| "Operational" badge reflects `route.ready` | `M:75` `routeStatus`: "Operational" exactly when the route is loaded and `ready`, else "Needs attention" / "Checking…" / "Route unavailable". Rendered with `role="status"` (`M:121`). | Map spec `routeStatus` (4 cases), "…an 'Operational' pill that follows route.ready" |
| Each node has a skeleton while its section loads | `N:47-52` (`aria-busy` on the node, `routing-node-skeleton`). Sources: Main = route; Background = memory, lanes and judging (all three); CLI = orchestration (`M` `sectionState`). A failed read shows fixed copy and a Retry of **only** the failed read (`N:53-60`; `M:267` `retryBackground`). | Node spec "busy skeleton…", "a failed read shows fixed copy and Retry…"; map spec "a loading route shows the skeleton; a failed one offers Retry…", "loads with a skeleton until all three reads land; Retry re-reads only the failed ones", "…a failed read retries the orchestration read" |
| Background and CLI nodes call `requestSettingsTab({tab:'orchestration', section:…})` | `M:261` `open()`: `background-models` / `cli-agents`, then `nodeActivated`. It follows the Overview tab's existing `AppStateManager.requestSettingsTab` use; the shell routes these sections to Orchestration (Batch 18, `settings.component.ts:55`). | Map spec "Inspect opens Agent Orchestration at the background models", "Manage matrix opens Agent Orchestration at the CLI agents" |
| Background preview = 2 explicit roles + "N follow main agent" | `M:29` `backgroundRolesPreview`: the six roles in Orchestration order; explicit ones get their **connection name**. `M:148-172` renders the first two explicit rows, "{k} more set" when there are more, and "{n} roles · Follow main agent". Footer "{set} set · {n} following"; status "6 roles". | Map spec (preview function; 2 rows + follower row; "2 more set") |
| CLI preview = first 4 in preferred order + counts | `M:53` `cliAgentsPreview`: the same ordering rule as the Orchestration tab's `orderedAgents` (installed only, preferred order first). Disabled system CLIs are flagged: muted, with an sr-only "(off)". `M:174-196` renders the first four `→`-joined, with footer "{n} CLIs · {m} Ptah instance(s)" and status "{n} enabled". A payload without `detectedClis` reads as "No CLI agents detected." (`M:58`). | Map spec (ordering, disabled flag, counts, no-preference order, empty list) |
| Main Agent node reuses the existing controls until Batch 26 (D14) | The old main-agent block is **unchanged** under the map: Change main provider, Edit model, Check connection, Save provider to…, effort select, reviews. Node "Reassign" emits `nodeActivated('main-agent')`, and `PS:80` focuses that block (`requestFocus('main-agent')`, `data-focus="main-agent"` `PS:111`). The node shows the next request's provider (connection name), model (id / "{tier} tier" / "Default (chosen by Claude)") and effort. | Map spec "Main Agent node" block (5 cases: content, model variants, not-ready / no driver, Reassign emits without navigating, skeleton / retry) |
| D16 scope badges | Moved from the old block into the Main Agent node header, as in the prototype. They are projected from the page (`PS:81-104`, `[main-agent-badges]`, `data-testid="main-scope-badges"`, `class="contents"`) through `M:133` (`ngProjectAs="[node-badges]"`). The page still owns their review-then-confirm handlers. | Map spec (projected badge in the Main node); parent spec "scope badges (Batch 23, D16)" (4 cases, unchanged, pass); harness #17, #18, RUX-6 (Gate G) |
| A node is a keyboard-operable target (design-spec §3.1) | `N:68-74`: the footer action is a real `<button>` stretched over the node (`after:absolute after:inset-0`, focus outline). Header badges sit above it (`relative z-10`), so there is no nested interactive content (see deviation 1). | Node spec "the footer action is the node's one trigger…", "header badges are projected above the stretched action…"; page spec 36 px rule (node actions are stretched targets) |
| Q-extra-1 container-width rule, where the node row has the same Electron problem | Measured first with `md:grid-cols-3`: VS Code 261 px nodes; Electron **207 px** nodes, 205-233 px tall, with titles, badge text and the model id wrapping. Applied `grid-cols-[repeat(auto-fit,minmax(15rem,1fr))]` (`M:128`): **VS Code 3 columns, Electron 2** (316 px nodes, 123-143 px, no wrapping). | Visual spec asserts 3 columns (VS Code) / 2 (Electron) and single-line node titles (`HARNESS/settings-visual.e2e.spec.ts:99-129`) |
| Bundle: no budget error | The map is deferred into its own chunk (`routing-map-component`, 14.41 kB) behind a same-footprint placeholder (`PS:79`, `:106-108`), like the drawer (Batch 21). | Build log (below) |

## Write-path trace

This batch adds **no write**. The map only reads (`route`, `effort`, `memory`, `lanes`, `judging`, `orchestration`,
`connections`) and re-reads a failed section on Retry. Background and CLI navigate (`requestSettingsTab`, app state
only); Main Agent focuses the existing block. The moved D16 badges keep the Batch 23 trace unchanged: badge → Clear /
Use global → the page's review → `state.clearScopeOverride` → `config:clearScopeOverride`, which ends sessions for the
page's auth / provider keys.

## Verification

1. `npx nx run-many -t typecheck,test,lint -p @ptah-extension/chat @ptah-extension/core @ptah-extension/ui
   @ptah-extension/webview-e2e-harness ptah-extension-webview --parallel=2` exited 0 ("Successfully ran targets typecheck, test,
   lint for 5 projects"). This is the final run on the final source tree; the only later change was the spec-only visual
   assertions, covered by the harness lint below. Log: `%TEMP%\b25-verify.log`.
   - Tests: core 1083/1083; ui 610/610; chat 1943 passed + 2 skipped (1945; +29 over Batch 24); webview 224/224.
   - Lint: 0 errors. Warnings core 11, chat 30, harness 41 (unchanged).
2. **Build.** `npx nx build ptah-extension-webview` exited 0, **no budget error** (`%TEMP%\b25-gateg-build.log`).
   - Initial total 3.49 MB (718.81 kB transfer): 986.45 kB over the 2.5 MB warning budget, about **13.5 kB under the
     3.5 MB error budget**.
   - A first, non-deferred build reached 998.44 kB (1.5 kB of headroom). That is why the map is deferred.
   - Lazy chunk `routing-map-component` 14.41 kB.
3. **Gate G.** `settings-reachability.e2e.spec.ts --reporter=list --repeat-each=3` gave **27 passed** (1.6m), exit 0. Log:
   `%TEMP%\b25-gateG.log`.
4. **Captures.** `settings-visual.e2e.spec.ts --reporter=list --repeat-each=3` gave **12 passed** (36.6s), exit 0
   (`%TEMP%\b25-visual.log`).
   - Every repeat:
     - VS Code nodes 261 × 169-171 px, 3 columns.
     - Electron nodes 316 × 143 / 143 / 123 px, 2 columns.
     - VS Code cards 80 px (Batch 24; Electron cards unchanged, 100-111 px, Batch 28's container-width grid).
   - `git status --short -- …/screenshots/angular/baseline-*` is **empty**.
   - **One infrastructure failure, recorded:** during tuning, one Electron case failed at 0 ms with "worker process
     exited unexpectedly (code=3221226505)". That is Windows 0xC0000409: the Playwright worker process crashed before
     the test body ran. Log kept at `%TEMP%\b25-visual-crash.log`. It did not reproduce: the immediate re-run and the
     final 12/12 `--repeat-each=3` passed. Suspected cause: a Chromium worker crash under repeated local builds, not the
     page.

## Capture comparison (`current-providers-*` vs `prototypes/final/screenshots/index-{anubis,anubis-light}-1024x768.png`)

| Aspect | Prototype | Ours (VS Code, both themes) | Ours (Electron, both themes) |
|---|---|---|---|
| Map frame | Rounded panel, "⊙ ROUTING MAP" + helper text, "● Operational" pill right | Same: compass icon, uppercase muted title, helper "Select a work node to see or change what it runs on", success-tinted "● Operational" pill with base-content text | Same |
| Node row | 3 nodes side by side (about 310 × 130 px) | 3 nodes, 261 × 169-171 px (the page is 832 px wide: the shell's `max-w-4xl`) | 2 + 1 (container-width rule), 316 × 123-143 px |
| Main Agent node | Dot + "MAIN AGENT", header "App override" / "Workspace override" badges; "PROVIDER: Claude (Subscription)", "MODEL: Default (chosen by Claude)"; footer "Effort: medium • Next request target", "Reassign ⌄" | Dot + "MAIN AGENT", status "Active", D16 badge "Effort · Workspace"; "PROVIDER: Claude (Subscription)", "MODEL: Default (chosen by Claude)"; footer "Effort: medium", "Reassign ⌄" | Same, on one header line |
| Background Roles node | "6 roles active" pill; "Memory curator — OpenAI Codex", "Judge lane — Moonshot", "Archaeologist, Synthesis, Replay — Follows main agent →"; footer "6 autonomous background tasks", "Inspect ⌄" | "6 roles" pill; "Memory curator — OpenAI Codex", "Judge lane — Moonshot (Kimi)", "4 roles — Follow main agent"; footer "2 set · 4 following", "Inspect ›" | Same |
| CLI node | "1 Quota Reached" pill (warning dot); "Execution priority: Codex → Antigravity → Glm → Copilot" (Copilot muted); footer "4 active system CLIs · 1 Ptah instance", "Manage Matrix ›" | "4 enabled" pill (info dot); the same priority line (Copilot muted); footer "3 CLIs · 1 Ptah instance", "Manage matrix ›" | Same |

Differences, with reasons:
1. **Values that differ from the prototype are real data.** "4 roles" follow in the fixture, and Judging & enhancement
   is the sixth role. "3 CLIs": the fixture has Copilot disabled. There is **no quota pill**, because no quota data
   exists in the state.
2. **Action and value text are base-content with a muted chevron, not `text-primary`** (design-spec §3.1, deviation 6).
   The Background action points right (›), because it goes to another tab.
3. **"Next request target" is dropped from the Main footer**, which keeps it on one line in 261 px nodes. The map
   header says what the nodes are.
4. **The follower row names a count ("4 roles"), not the role names.** Three names do not fit a 261 px node on one line.
5. **The Main node carries a status word ("Active").** The dot is never the only signal (§3.1).
6. **Both thumbnails show the old main-agent block below the map, on purpose (D14):** its controls stay until the
   Batch 26 popover.

## Deviations and open points

1. **Node trigger markup.** The design-spec §3.1 node is a `<button>`, but the Main Agent node holds D16 badges
   (buttons), and a button inside a button is invalid. Instead, the footer action is the one `<button>`, stretched
   over the node, with the badges layered above it. The whole node is still one click and keyboard target.
2. **The map is deferred** (`@defer (on immediate)` behind a 178 px placeholder). The eager settings route had 1.5 kB
   of budget left with the map eager.
3. **Container-width node grid** instead of design-spec §3.1's `md:grid-cols-3`. Applied per the coordinator's
   Q-extra-1 instruction, after measuring the same Electron wrap.
   - Electron's third node sits alone on the second row (half width).
   - This makes the map taller in Electron: 143 + 12 + 123 px of nodes, against 233 px for three cramped nodes.
     Batch 28's fold gate owns the final numbers.
4. **The D16 badges moved** from the old main-agent block into the node header, where the prototype places them. They
   are the same components, handlers and testids.
5. **The page file is at exactly 700 lines.** Batch 26 removes the old main-agent block (about 60 lines), which frees
   room.
6. **No reachability-table entry was added.** The table is not in this batch's file list. Node navigation is pinned by
   unit specs, and the shell's routing of `background-models` / `cli-agents` is Batch 18's.
   - Candidate for Batch 28's Providers scenes: a Gate G reach that clicks each node and asserts the landing section.
