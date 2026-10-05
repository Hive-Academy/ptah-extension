Revision: 5

# Design Spec - TASK_2026_596_0a19: plan limits and lane usage

Design system applied: the existing webview theme (`anubis` / `anubis-light` in `apps/ptah-extension-webview/tailwind.config.js`, daisyUI 4 + Tailwind 3). No new tokens, no new CDK. Prototype: `prototype/index.html` (controls for theme, P3, P9, P4, source wording, width). Classification below follows `task-description.md` Revision 3 exactly; the prototype's state engine is the executable form of section 2 and drives both the UI and the tool text. Existing cards, chips, the per-model table and the context bar in `session-stats-summary.component.ts` stay as they are. No parity inventory exists for this task.

## Revision 2 changes

| Finding | Change |
| --- | --- |
| 1 blocking (lane windows incomplete) | New per-run "Windows (n)" disclosure on every lane row (section 3.3). It lists every applicable window with used/unknown, absolute + relative reset or "reset unknown", and per-field source chips, reusing the Plan limits row. Open examples in the prototype: near limit (Claude Sonnet), exhausted (Claude Opus, model-scoped), restored (Antigravity with its known 5-hour window), plus owner-level evidence and lookup-timeout rows |
| 2 blocking (owner exhaustion hidden) | Collapsed indicator is now driven by `laneState`; active non-estimated owner-level exhaustion triggers it with zero windows (the `[].every()` defect is gone). Section 3.1 wording corrected to "no usage source without active exhaustion". Frames C (known reset) and D (unknown reset) show it under default variant A; E shows the no-evidence case with no indicator |
| 3 blocking (alternatives drop resets) | Every alternatives line prints every applicable window with its known reset and source tag, for confirmed room, near limit, unknown and at-limit lanes alike; an estimated reset keeps its `estimated` tag. New examples: no confirmed room, all at limit, empty roster, unsuccessful spawn, single-lane roster (zero alternatives, never claims exhaustion) (section 5) |
| 4 blocking (engine differs from Revision 3) | Section 2 defines last-reset/observation semantics, freshness, exhaustion precedence over stale, and the partial-event rule. The prototype engine implements them. Reset fixture chronology fixed (reset 11:20, last observation 10:52 = 68 min ago, before the reset). New examples for the five edge cases (section 2.2) |
| 5 blocking (colour-only P4 C) | Variant C is replaced by a compact visible text pill ("▲ Near limit" / "■ At limit", no detail) plus an optional dot. Colour-only is no longer offered (section 3.1) |
| 6 should-fix (lifecycle) | New sessions A/B storyboard, prototype section 1b and spec section 3.4 |
| 7 should-fix (decisions) | Full P1-P9 table with defaults, valid alternatives, visible consequences and binding vs scope status (section 6); P3/P9 consequences corrected against the engine; effects of all five designer clarifications (section 7) |
| 8 should-fix (compatibility) | Populated compatibility examples preserving Model Tier, Role, CLI Session ID, role-delivery capability suffix and the workspace roles line; each roster table is followed within ten lines by an "illustrative" annotation (section 5) |
| 9 should-fix (exhaustion provenance) | Third field label "limit" next to "used" and "reset"; fields are grouped by source. Example: Weekly · Opus has used and reset from the API and the exhaustion from an error: two chips ("used · reset Provider API", "limit From error") |

## Revision 3 changes

| Finding | Change |
| --- | --- |
| 4a blocking (order) | The prototype now checks observation against reset **before** age and stale, matching section 2.1. `codexAged` is fixed: window began 11:10, read at 11:38, so it is a real aged current-window value. A separate `codexPreReset` example is read at 11:38 before its 11:40 restart |
| 4b blocking (wrong reset shown) | "Reset · usage unknown" now renders the reset that invalidated the observation separately from the next reset, null-safe: "Reset today 11:20 UTC (40m ago) came after the last observation (10:52 UTC)" + "Next reset unknown" (past-reset case, reset field passed), and "Reset today 11:40 UTC (20m ago) ..." + "Next reset today 16:40 UTC · in 4h 40m" (known last reset, future next reset). Tool text prints "reset passed <time>; next reset <time or unknown>; last observed <time>, before it" |
| 7 (P1, P9) | P9 consequence rewritten to what the prototype does (section 6). P1 now states the behaviour effects of both folds and marks them as requirements / data-contract changes |
| N1 blocking | Single-lane spawn and empty-roster list print all four groups with `none` after the unchanged "no other lanes" sentence (section 5) |
| N2 | Default variant A is now a wrapping alert line above the scrolling chip strip, so state and reset are always fully visible at 280 px; B and C stay in the strip (section 3.1). Frames A, C, D rechecked at 280 px |
| 5 optional | Inline note on the failed-spawn block: header and Error line are illustrative placeholders |

## Revision 4 changes

Gate 1.7 outcome: the user accepted all P1-P9 defaults, T1 = local zone + abbreviation, T2 = short source labels, and asked for one design change: show resets and lanes as stat tiles instead of two titled sections ("include the reset in the stats as tiles and allow for their own expansion ... convert the second title with stats cards and show the cli as a tile inside"). Only the expanded stats grid changed.

| Request | Change |
| --- | --- |
| Remove the "PLAN LIMITS" section | Each plan-limit window is a tile in the same 2-column card grid and card style as Model / Context / Tokens: label ("5-HOUR"), value ("94% used"), reset line, state chip. It expands in place to span both columns with bar, absolute + relative reset, passed vs next reset and per-field sources. No-usage-source, owner-level limit evidence and cooldown are tiles too (section 3.2) |
| Remove the "LANE RUNS" section | Each CLI lane is one tile: CLI name + role, tokens and cost (or unknown), run-state chip and limit-state chip. It expands to show model, every run and the per-window detail from Revision 3 (section 3.3) |
| Lanes read as outside the totals | Caption "lane · not in totals" on every lane tile, dashed border, and a "Lanes · subtotal" tile (section 3.3). Text carries the meaning; dash style and fill are redundant |
| 280 / 440 px and keyboard | Checked in the prototype at 280, 360, 440 px (no overflow; wrapping, no truncated state words). Tiles are buttons with aria-expanded and aria-controls; keyboard test: Enter opens, Space closes, Tab moves to the next tile |
| Unchanged | Collapsed row (variant A wrapping alert), dashboard card, tool text, section 2 semantics and everything else are as approved in Revision 3. The storyboard uses lane tiles instead of rows |

## Revision 5 changes

| Finding | Change |
| --- | --- |
| 2 closed-face provenance | Every closed plan tile shows short source chips for the values on its face (used / reset / limit, distinct when they differ); owner-evidence and cooldown tiles show their source; lane faces show the basis of their limit chip (sections 3.2, 3.3) |
| 3 grouped runs inheriting runs[0] | One tile per CLI + role, but quota state is evaluated per owner + model-scope subgroup. The face is an aggregate with explicit affected-run wording ("At limit · 1 of 2 runs (opus)" + "Near limit · 1 of 2 runs (sonnet)"). New examples: Claude docs (Sonnet + Opus runs) and Claude research (unknown owner) |
| 4 expired owner evidence | Chip, value and border use the same active non-estimated test as the lane state. After the reset the tile reads "Limit hit · expired" with an Expired chip. Frames H (before) and H2 (after) |
| 5 stale notice | Compact "Usage / Stale" tile with the refresh-failed time; windows keep Aged (frame J). No section heading |
| 6 dense packing | Removed `grid-auto-flow: dense`; DOM, Tab and visual order agree; an empty half-row before an expanded tile is accepted |
| 7 + orchestrator expansion rule | One rule: all tiles start CLOSED; manual open/close kept for the life of the view; spec (section 9) and README agree. The old "open for limit/near/unknown" wording is gone |
| O1 repetition | A lane on the same account as the session no longer repeats the window detail: it shows "Same account as this session · see plan tiles" plus affected-window chips. Full window detail appears only for different or unknown owners |
| O2 screenshots | Regenerated all-closed stats-grid (dark, light), narrow-280-dark, width-440-dark, lane-lifecycle (dark, light), plus stats-grid-open-dark.png (a plan tile, a same-owner mixed-scope lane, a different-owner lane and an unknown-owner lane opened) |

Collapsed row, dashboard card, tool text and section 2 semantics are unchanged.

## 0. Principles

1. State is a word first. Colour, border style and bar pattern only reinforce it.
2. Unknown is never 0. No bar is drawn without a value; the row reads "Used: unknown".
3. Plan windows, cooldowns and lane usage are three separate objects (solid section, info-coloured "Cooldown" notice, dashed "Lane runs" section).
4. Times always show absolute and relative together ("Thu 8 Oct 09:00 UTC · in 4d 21h"), whichever zone is chosen. Absolute: "today HH:MM" within 24 h on the same calendar day, otherwise "Ddd D Mon HH:MM". Tool text: `YYYY-MM-DD HH:MM UTC`.
5. Each visible claim names its own evidence (section 1).

## 1. Source labels

| Enum | Short label (default) | Verbose label (alternative) | Style |
| --- | --- | --- | --- |
| `provider-api` | Provider API | Reported by provider | solid outline |
| `provider-unofficial` | Unofficial | Unofficial provider endpoint | dashed, italic |
| `stream-event` | Live event | Live session event | solid |
| `error-derived` | From error | Read from limit error | solid |
| `estimated` | ~ Estimate | Local estimate (unconfirmed) | dashed, italic, "~" prefix |

Per-field provenance: a window has up to three claims: **used**, **reset**, **limit** (the exhaustion). Fields with the same source share one chip; if all share one source there is no prefix. Otherwise each chip is prefixed with the fields it covers: "used · reset Provider API" + "limit From error"; "used Unofficial" + "reset ~ Estimate". Chip: `text-[10px] px-1 rounded border border-base-content/20 text-base-content/80`, plus `border-dashed italic` for the two unofficial classes. Tool text mirrors this: `[used+reset provider-api; limit error-derived]`.

## 2. State semantics (Revision 3; binding for UI and text)

### 2.1 Window fields and rules
Each window has: used (percent or amount + unit + limit, or none), reset (next reset, or none), **last reset** (the instant the current window began, or none when it cannot be determined: provider payload without it and no known duration), observation instant, and per-field sources. A window value is **fresh** when it is non-estimated, observed within P9, observed after the window's last reset, and the provider status is not `stale`. First match wins:

1. **Limit reached**: active non-estimated exhaustion (no reset, or reset in the future). Beats stale status and aged values. Expired exhaustion falls through to the rules below.
2. **Reset, usage unknown**: evaluated **before** aged, stale and not-confirmed. Either (a) the reported reset has passed and the last observation predates it, or (b) the last reset is known and the last observation predates it. The old value is never shown as current; the row reads "Used: unknown". It shows the reset that invalidated the observation and the next reset as two separate facts: "Reset today 11:20 UTC (40m ago) came after the last observation (10:52 UTC)" and "Next reset unknown" (case a, the next reset is not known) or "Next reset today 16:40 UTC · in 4h 40m" (case b, next reset may also be unknown).
3. **Usage unknown**: no used value.
4. **Estimate only**: used is `estimated`.
5. **Aged**: older than P9, or provider `stale`. Value stays visible with "observed 22m ago"; it cannot confirm room or near limit.
6. **Not confirmed**: last reset cannot be determined, so freshness cannot be established (fresh-looking value, still not usable for room or near limit). Shown with "last reset unknown: freshness cannot be confirmed".
7. **Near limit**: fresh and at or above P3. Otherwise **ok**.

### 2.2 Lane state (mutually exclusive, in this order)
- **At limit**: owner-level evidence (active, non-estimated, window unknown) or any applicable window in state "Limit reached". Model-scoped windows apply only to that model scope (the Weekly · Opus window limits an Opus lane, not a Sonnet lane).
- **Near limit**: any applicable window is "Near limit". A partial event can establish near limit; it cannot establish room.
- **Confirmed room**: the window set is established (a full-table `provider-api` or `provider-unofficial` read), is non-empty, every applicable window is "ok", no active cooldown, status `available`.
- **Unknown**: everything else, always with a stated reason (no usage source, lookup timed out, window set not established, aged value, last reset unknown, usage unknown, reset passed, cooldown active, stale).

Prototype examples for each edge case: fresh usage with unknown last reset (Antigravity, Ollama: "Not confirmed"); partial-event-only (Claude native event: unknown "window set not established, partial data"); aged but current-window lookup (Codex window began 11:10, read 11:38, 22 min old: unknown "aged value"; turns Room at P9 = 30); read before the last reset (Codex read 11:38, window restarted 11:40: "Reset · usage unknown" at every P9, with the passed reset and the next reset 16:40 shown separately); stale with active exhaustion (Codex stale cache + Weekly limit from a live event: still "Limit reached"); post-reset fresh observation (last reset 11:20, observed 11:50, 3%: ok); reset passed without a newer observation (reset 11:20, observed 10:52: "Reset · usage unknown", next reset unknown).

## 3. Surface 1: per-session stats grid (`session-stats-summary.component.ts`)

### 3.1 Collapsed row
New pills, inserted into the existing `flex gap-1.5 overflow-x-auto text-xs` row:
- **Limits indicator, first.** Variant A (default) renders it as a **wrapping alert line above the chip strip** (full-width, `role="status"`, `flex flex-wrap`), outside the horizontally scrolling strip, so the whole state, window and reset stay visible at 280-440 px (at 280 px it wraps onto a second line instead of clipping). It appears only when the session's applicable state is At limit or Near limit, including owner-level exhaustion with no windows: "LIMITS At limit · Wk Opus · resets Mon 09:00", "LIMITS Near · 5-hour 94% · resets 15:10", "LIMITS At limit · window unknown · resets 17:05", "LIMITS At limit · window unknown · reset unknown". Healthy, unknown, not-confirmed, estimate-only, and no-usage-source sessions **without active exhaustion** show no indicator.
- **Lanes pill** (after Cost): "LANES 7", title "Lane runs are counted separately from session totals". Not an alert.
- Classes: pill base as existing, plus `border-error bg-error/15 font-semibold` or `border-warning bg-warning/15 font-semibold`.

| P4 variant | Behaviour | Trade-off |
| --- | --- | --- |
| A (default) | Wrapping alert line above the strip, only when hot | Quiet; always shows full state, window and reset; costs one extra line while hot |
| B | Short text pill inside the strip, always: "Room", "Unknown", "Near limit", "At limit" | Always informative; constant extra chip; no window or reset (may scroll at 280 px) |
| C | Compact visible word only ("▲ Near limit" / "■ At limit") plus a dot on the expand button; detail only when expanded | Narrowest; text is visible, the dot is redundant. Replaces the old colour-only option, which is withdrawn as non-compliant |

### 3.2 Expanded: one card grid of tiles (Revision 4)

The expanded grid is a single 2-column card grid (`grid grid-cols-2 gap-1.5`, ordinary row placement, **no `grid-auto-flow: dense`**, so the visual order always equals the DOM and Tab order; an opened tile spans both columns and may leave an empty half-row before it). There is no "Plan limits" title bar and no "Lane runs" title bar. Order: Model, Context, Tokens, Cost, Duration, Agents (unchanged cards) -> plan-limit tiles -> lane tiles -> lane subtotal tile. The per-model table and the context bar stay where they are. All tiles use the existing card style (`bg-base-200/50 rounded px-2 py-1.5 border`, small uppercase label, `text-sm font-semibold` value).

**Initial expansion rule (one rule): every tile starts CLOSED.** The state chip, reset line and source labels on the closed face are enough to read the state. Nothing opens automatically on entry or on usage refresh. The user's manual open/close choices are kept for the life of the session view and are never reset or moved by a refresh.

**Expandable tile pattern (all plan and lane tiles).** The whole tile is a `<button type="button" aria-expanded aria-controls>` like the existing Models toggle; its detail panel is the next sibling (`hidden` when closed). Opening a tile makes its wrapper span both columns (`col-span-2`); the tile and its panel join into one block (squared bottom corners, `border-t-0` panel). A chevron (aria-hidden, top right) shows state. Tab reaches every tile in DOM order, Enter and Space toggle (verified in the prototype with a keyboard test), focus ring `outline 2px info, offset 2px`. No new CDK.

**Plan-limit tiles** (one per applicable window; the provider is named in each tile's caption, so no section title is needed):
- Label: short window name, uppercase ("5-HOUR", "WEEKLY", "WEEKLY · OPUS", "OVERAGE", "SESSION"), with a 10 px caption "<Provider> plan limit".
- Value: "94% used", "$3.20 of $50.00", or "unknown" (never 0).
- Reset line (`text-[11px] text-base-content/70`): "resets 15:10 · in 3h 10m", "reset unknown", "Limit reached · resets Mon 09:00 · in 1d 21h", "reset 11:20 passed · next unknown", "observed 22m ago", "last reset unknown".
- State chip (text first): Near limit, Limit reached, Aged, Usage unknown, Not confirmed, Reset · usage unknown, Estimate only. Healthy windows show no chip. Border tint (warning / error) is redundant to the chip.
- **Source labels on the closed face:** short, wrapping chips under the chip row for every value the face shows, distinct when they differ ("used · reset Provider API" + "limit From error"; "used Unofficial" + "reset ~ Estimate"; an unknown value carries no used-source chip). Owner-evidence and cooldown tiles show their source chip too.
- Expansion: bar with the P3 tick, "Used" value, absolute + relative reset, the passed reset and the next reset as two separate facts, and per-field source chips (used / reset / limit, section 1).
- Other plan tiles: **Usage / "No usage source"** tile; **Usage / "Stale"** tile ("cached data · refresh failed 11:13 UTC", chip "Stale"; expansion: "Showing cached account data; refresh failed at ..."; windows keep their own Aged chip and an active live limit is still shown; no section heading); **Limit hit** owner-evidence tile; **Cooldown** tile ("until 12:14", "retry delay, not a plan reset", info-tinted, chip "Cooldown", source chip); provider failure statuses use a "Usage / Unavailable" tile with the raw status name.
- **Owner evidence, active vs expired** (one rule, the same active non-estimated test as the lane state for chip, value and border): active = value "At limit", chip "■ At limit", error border, "window unknown · resets 17:05 · in 5h 5m" or "reset unknown". After the known reset passes it becomes value "Limit hit · expired", chip "↻ Expired", no error border, "window unknown · reset 11:50 passed". It never claims current exhaustion. Prototype frames H (before) and H2 (after).

### 3.3 Lane tiles, outside the session totals

One tile per CLI and role. Runs of that lane are grouped for the face totals, but **quota state is never copied from the first run**: runs are split into subgroups by quota owner + model scope, and every subgroup is evaluated on its own.
- Label: CLI name + role ("CODEX · REVIEW", "CLAUDE · DOCS", "ANTIGRAVITY"), caption "lane · not in totals".
- Value: tokens summed over known runs ("160.2k tokens", "unknown tokens"; "+1 unknown" when only some runs are known). Second line: "cost $0.76 · 2 runs", "cost unknown", "cost $0.18 (+1 unknown)". Never 0 for unknown.
- Chips: the run state (Live · running, Live · 1 of 2 running, Completed, Restored · completed, Quota failure), then the limit state **as an aggregate over the subgroups with explicit affected-run wording** plus short source labels: one state for all runs reads "✓ Room" / "▲ Near limit" / "■ At limit" / "? Limit unknown"; when subgroups differ each state gets its own chip, e.g. "■ At limit · 1 of 2 runs (opus)" and "▲ Near limit · 1 of 2 runs (sonnet)". Example: the Claude docs lane (Sonnet run + Opus run) is one tile with both chips.
- Expansion (spans both columns): one block per subgroup (model/scope heading, its runs with run label, model or "unknown", tokens, cost, run state, started time when restored). Per subgroup the limit part depends on the owner:
  - **Same account as the session** (e.g. a Claude lane in a Claude session): do **not** repeat the window detail the plan tiles already show. Show "Same account as this session · see plan tiles" and one chip per affected window ("5-hour · Near limit", "Weekly · OK", "Weekly · Opus · Limit reached", "Overage · OK"). A Sonnet subgroup lists no Opus window.
  - **Different owner** (e.g. Antigravity, or Codex in a Claude session): the full window detail (used/unknown, absolute + relative reset or "reset unknown", passed vs next reset, per-field sources), plus owner evidence, cooldown and lookup-failure messages.
  - **Unknown owner** (account cannot be determined): "Limit unknown · quota owner cannot be determined; no other account's windows are borrowed". Example: Claude research lane.
- A lane whose owner cannot be determined shows "Limit unknown" on the face and in its expansion; it never borrows another owner's windows.

**Gate 1.7 amendments (binding; close Codex Rev 5 findings N1 and N2; these override the examples above and the prototype where they differ):**
- **A1 (N1) Owner identity.** A quota owner is `provider + resolved account identity` (for Codex: the resolved account of the `CODEX_HOME` the lane and the account reader use; for Claude: the signed-in account or API-key route). The provider name alone never establishes ownership. "Same account as this session" is shown only when BOTH identities are known AND equal; otherwise the subgroup is "Different owner" (both known, not equal) or "Unknown owner" (either side unknown). Subgroups group by owner identity + model scope. After a sign-out or an account change, earlier runs keep the owner identity recorded at their run and are re-evaluated against the session's current owner. Required test fixtures: same provider with account A vs account B; unknown session owner; account change during the session.
- **A2 (N2) No hidden windows.** "see plan tiles" may replace a window's detail only when the session's plan tiles render that same window (same owner, window and model scope). Any window that applies to the lane but has no session plan tile (for example Weekly · Opus for an Opus lane in a Sonnet session) keeps its full detail in the lane expansion: used, reset, passed vs next reset and per-field sources. It never becomes a session plan tile. Required test fixture: Sonnet main session, Opus lane on the same account, Opus-only exhaustion.
- **A3 (O2) Expansion retention.** The open/closed state is keyed by session id + a stable tile id (window key, or lane CLI + role), never a render index, and survives usage and state refreshes. Required test: an opened tile stays open after a refresh.

**Req 8 separation (outside the session totals), three redundant cues, two of them text:** (1) every lane tile carries the caption "lane · not in totals"; (2) lane tiles have a dashed border and a `bg-base-300/40` fill, so they differ from the solid session tiles; (3) a **Lanes · subtotal** tile closes the group: "304.1k tokens known · $1.96 known cost · 6 lanes · 7 runs · 3 cost unknown", also captioned "lane · not in totals", never added to the Tokens or Cost cards. The collapsed row's "LANES 7" pill is unchanged and also says in its title that lanes are counted separately.

**Width behaviour.** Verified in the prototype at 280, 360 and 440 px: tiles keep a 2-column layout (about 130 px per tile at 280 px); captions, reset lines and chips wrap and no state word truncates; opened tiles span the full width and their bars and source chips wrap; no horizontal overflow in any frame.

### 3.4 Lifecycle storyboard (prototype section 1b, now with lane tiles)
| Step | Session A (spawned the Codex run) | Session B (own Claude lane) |
| --- | --- | --- |
| 1 Spawn | Codex tile appears: "Live · running", 12.4k tokens, $0.05, Room | Own Claude tile, Near limit |
| 2 Live | Tokens 48.2k and the limit chip flips to Near limit without reload (the tile stays closed; the chip is enough); user switches to B and back: tile unchanged | B's tile unchanged; never shows A's run |
| 3 Completed | Chip "Completed"; figures 112.0k / $0.55 kept for the life of the view | Still live; unaffected |
| 4 Reopened | "Restored · completed", tokens and cost "unknown", limit state is current, not historical | Same, own tile only |

## 4. Surface 2: dashboard provider account card (`provider-account-card.component.ts`)

One `<section class="rounded-lg border border-base-content/10 bg-base-100/40 p-3">` per provider in scope (replace the `isCodex()` gate with "provider has an account-usage result"). Header as today plus a status chip when status is not `available` (raw status name, omitted for `no-usage-source`). The Codex Activity block is unchanged.

Window row: name `text-[13px] font-semibold`; state chip right; bar + "94% used" / "$3.20 of $50.00 used" / "Used: unknown"; reset line "Resets Thu 8 Oct 09:00 UTC · in 4d 21h" or "Reset unknown"; source chips. Exhausted: "Limit reached — resets <time>" or "Limit reached — reset unknown". Bar: `h-1.5 rounded bg-base-content/12`, neutral fill `bg-base-content/70`, tick mark at P3, `role="meter"` with `aria-valuenow`; stripes (warning/error) are decoration.

State chips: "■ Limit reached" (error border/tint), "▲ Near limit" (warning), "◷ Aged", "? Usage unknown", "? Not confirmed", "↻ Reset · usage unknown", "~ Estimate only", "Cooldown" (info), lane "✓ Room" (success). Prototype cards (16): Claude (mixed provenance, overage amount), Claude window-known/reset-unknown, Codex room, Antigravity, OpenCode none / known reset / unknown reset, Ollama (not confirmed + cooldown), partial event, aged, stale, stale + live limit, post-reset fresh, reset passed, `unsupported-auth`, `service-unavailable`. `unsupported-config`, `provider-unsupported`, `cli-unavailable`, `cli-version-unsupported` use the same notice with their own sentence and the raw status name.

## 5. Surface 3: tool text

Canonical enum names in brackets, UTC with relative time. Existing columns, fields and blocks stay in place; additions are the fifth column, two sections and the limit lines.

### 5.1 `ptah_agent_list`
Table keeps Agent, Type, Status, Capabilities (including the `, role delivery: <delivery>/<channel>` suffix) and appends `Limit state`. The workspace roles line stays directly after the table. Then `### Plan limits` (one row per window: Agent, Window, Used, State, Reset, Source; owner-evidence and lookup-failure rows use `(none)`), then `### Alternatives by limit state` with the four groups. Every alternatives line lists every applicable window with its known reset and source; unknown lanes keep their reset (an estimated one is tagged `estimated`).

```
## Available Agents

**Total:** 5

| Agent | Type | Status | Capabilities | Limit state |
| --- | --- | --- | --- | --- |
| claude | cli | installed | messaging: stdin | AT LIMIT (Weekly · Opus, resets 2026-10-05 09:00 UTC) |
| codex | cli | installed | messaging: stdin, role delivery: system-prompt/file | confirmed room |
| gemini (Antigravity) | cli | installed | messaging: restart | unknown (5-hour session: last reset unknown) |
| opencode | cli | installed | messaging: restart | AT LIMIT (window unknown, reset unknown) [error-derived] · no usage source |
| Glm | ptah-cli | available | provider: Ollama Cloud, ptahCliId: glm-1, messaging: stdin | unknown (limit lookup timed out) |

Roles in this workspace: reviewer, implementer

[annotation, not formatter output: illustrative sample, not a runtime inventory; do not copy into skills]

### Plan limits

| Agent | Window | Used | State | Reset | Source |
| --- | --- | --- | --- | --- | --- |
| claude | 5-hour session | 94% | near limit | resets 2026-10-03 15:10 UTC (in 3h 10m) | provider-api |
| claude | Weekly · Opus | 100% | LIMIT REACHED | resets 2026-10-05 09:00 UTC (in 1d 21h) | used+reset provider-api; limit error-derived |
| gemini (Antigravity) | 5-hour session | 57% | not confirmed (last reset unknown) | resets 2026-10-03 17:00 UTC (in 5h 0m) | used provider-unofficial; reset estimated |
| gemini (Antigravity) | Weekly | unknown | unknown | reset unknown | - |
| opencode | (none) | no usage source | AT LIMIT (owner level, window unknown) | reset unknown | error-derived |
...

### Alternatives by limit state

**Confirmed room:**
- codex: 5-hour session 38%, resets 2026-10-03 16:40 UTC (in 4h 40m) [provider-api]; Weekly 12%, resets 2026-10-09 07:30 UTC (in 5d 19h) [provider-api]

**Near limit:** none

**Unknown:**
- gemini (Antigravity): not confirmed: 5-hour session: last reset unknown. 5-hour session 57% (not confirmed, last reset unknown), resets 2026-10-03 17:00 UTC (in 5h 0m) [used provider-unofficial; reset estimated]; Weekly used unknown, reset unknown
- Glm: limit lookup timed out; no windows known

**At limit:**
- claude: (all four applicable windows with resets, Weekly · Opus marked LIMIT REACHED)
- opencode: at limit, window unknown, reset unknown [error-derived] · no usage source
```
(The "..." rows and the claude line are abbreviated here; the prototype prints them in full.) The roster above is illustrative only: production rows come from discovery, and this sample must not be copied into other skills or tests.

Other list examples, all in the prototype section 3:
- **No lane has confirmed room** (Claude Sonnet near limit, Codex lookup aged): "No lane has confirmed room. Near-limit and unknown lanes may still work; every known reset is listed below." Near-limit lane lists all windows with resets; the aged Codex lane keeps both resets.
- **Every lane at its limit**: "No lane has room: every lane is at its limit. Known resets are listed below." Printed only when the near and unknown groups are both empty and the roster is non-empty.
- **Empty roster**: the existing "No agents found..." text, the roles line, then the full alternatives section: "### Alternatives by limit state", the sentence "No lanes are available to list. This does not mean any lane is at its limit.", and all four groups (`**Confirmed room:** none`, `**Near limit:** none`, `**Unknown:** none`, `**At limit:** none`).

### 5.2 `ptah_agent_spawn`
Existing fields and order stay (Agent ID, CLI, Model Tier, Role, Status, Started, CLI Session ID); `Limit state`, an optional warning or note, an optional `**Cooldown:**` line, and the alternatives section are appended after them.

```
## Agent Spawned

**Agent ID:** agent-7f3a2c
**CLI:** claude
**Model Tier:** sonnet
**Role:** reviewer (system-prompt via file)
**Status:** running
**Started:** 2026-10-03T12:00:00.000Z
**CLI Session ID:** sess-91c4d0
**Limit state:** near limit (5-hour session 94%)

> WARNING: 5-hour session is 94% used; resets 2026-10-03 15:10 UTC (in 3h 10m) [provider-api]. The spawn was still started.

### Alternatives by limit state
No other lane has confirmed room. Near-limit and unknown lanes may still work; every known reset is listed below.
...
```
Variants shown in the prototype: at limit with a known reset (warning names window, reset, per-field sources); owner-level limit with window and reset unknown; unknown after a lookup timeout (no warning); cooldown (`**Cooldown:** retrying after <time> ... a retry delay, not a plan reset`); estimate only (`> Note (estimate, not a warning): ...`, never WARNING); confirmed room (no warning); **unsuccessful spawn** (`## Agent Spawn Failed`, Status failed, Error line: the header and Error line are illustrative placeholders, noted inline in the prototype; the identical `Limit state` and alternatives still follow, and a warning, when any, ends "The spawn was still attempted."; the exact failure header stays whatever the formatter emits for that outcome); **single-lane roster** (the sentence "No other lanes are available to list. This does not mean any lane is at its limit." followed by all four groups, each `none`). The spawn is never blocked (D2).

## 6. Decision table P1-P9 (what the user confirms at Gate 1.7)

| # | Proposal | Default | Valid alternatives | Visible consequence | Status |
| --- | --- | --- | --- | --- | --- |
| P1 | Fifth provenance `provider-unofficial` | Keep | Fold into `estimated`, or into `provider-api` | Folding into `estimated`: that data could no longer confirm room or raise an at-limit/near-limit warning (estimates never do), so Antigravity and Ollama would stay "Unknown" even with a clean read, and the chip becomes "~ Estimate". Folding into `provider-api`: the undocumented-source distinction disappears, so unofficial data looks as trustworthy as documented data. Either option changes requirements and the data contract | Requirements / data-contract change, not a UI taste choice |
| P2 | Cooldown separate from plan reset | Keep | none compliant | A cooldown is always its own "Cooldown" notice, never a reset time. Merging is not allowed by Req 3.6 | Binding requirement |
| P3 | Near-limit threshold | 90% | 80%, 95% | At 80: Claude native event (82%, partial) turns "Near limit"; nothing else in the fixtures changes. At 95: Claude Sonnet lane (94%) and Codex near (93%) become Room, and the Sonnet session's Limits pill disappears. Claude Opus stays At limit at any threshold (independent exhaustion) | User choice |
| P4 | Collapsed indicator | A | B (always on), C (compact word + dot) | See 3.1. Colour-only is not offered | User choice among compliant options |
| P5 | Lookup deadline (agent tools) | 3 s | 1-2 s, 5 s | Shorter: more "unknown (limit lookup timed out)" rows and fewer Room rows; longer: slower list/spawn output. Spawn never fails because of it | User choice, text only |
| P6 | Known-reset exhaustion survives restart | Keep | drop on restart | Kept: reopened view still shows "At limit · resets Mon 09:00"; dropped: shows Unknown until a new read. Unknown-reset exhaustion never survives | Scope/behaviour; changes Req 3.8 |
| P7 | No reset notifications | Keep | add notifications | No new UI. Alternative adds a notification surface (not designed) | Scope |
| P8 | No OpenCode budget estimation | Keep | estimate from local lane cost | OpenCode stays "No usage source" (+ evidence). Alternative would add an "~ Estimate" window, informational only, after TASK_2026_535 | Scope |
| P9 | Freshness bound | 15 min | 5, 30 | At 5: the 10-minute-old Claude post-reset read becomes "Aged" and stops confirming room; Claude/Codex reads 1-2 minutes old are unaffected. At 30: the Codex lookup that is 22 minutes old but belongs to the current window (began 11:10) becomes fresh and its lane flips from Unknown to Room. A read taken before its window restarted (Codex read 11:38, restart 11:40) stays "Reset · usage unknown" at every bound, and the 47-minute stale cache stays Aged. The Ollama 4-minute read is "Not confirmed" at any bound (last reset unknown) and its cooldown also blocks room | User choice |

## 7. Effects of the five designer clarifications

1. **P4 indicator (A / B / C)**: A shows detail only when hot (widest pill, quiet otherwise); B adds a permanent chip (always shows "Room"/"Unknown"); C shows only "Near limit" / "At limit" plus a dot (narrowest, no window or reset until expanded). All three put text on screen.
2. **P3 threshold**: section 6. Never clears independent exhaustion.
3. **P9 freshness**: section 6. Changes when values read "Aged" and whether a lane can be Room.
4. **Time zone**: *Local zone with abbreviation* (default): absolute times match the user's calendar, "today" and weekday labels follow the local midnight, so the same reset can read "today 23:50" for one user and "Sun 00:50" for another; resets across daylight-saving changes use the local offset on that date. *UTC everywhere*: identical text on every machine and in screenshots, easier to compare with tool text, but "today" labels may look off near the user's midnight. In both, the relative time ("in 3h 10m") is always shown next to the absolute time; tool timestamps stay UTC either way.
5. **Source wording**: short labels (default) fit at 280 px: one line of chips beside the reset line. Verbose labels ("Reported by provider", "Unofficial provider endpoint", "Live session event", "Read from limit error", "Local estimate (unconfirmed)") explain the evidence without tooltips but wrap onto a second line at 280 px and make the mixed "used · reset ... / limit ..." chips about twice as wide. Both are in the prototype (Source wording control and the legend).

## 8. Accessibility and contrast

- Every state has a text label; glyphs are `aria-hidden`; colour, stripes and dashes are redundant cues. Bars are `role="meter"` with name and value; disclosure buttons carry `aria-expanded` and `aria-controls`; notices use `role="status"`; focus ring `2px info, offset 2px`; pulsing dot respects `prefers-reduced-motion`.
- Contrast measured on theme sRGB values (WCAG 2.1 AA: 4.5:1 text, 3:1 non-text). Light values converted from the oklch tokens.

| Pair | Dark | Light |
| --- | --- | --- |
| base-content on base-100 / base-200 | 14.86 / 13.89 | 15.92 / 14.21 |
| base-content/70 on base-100 / 200 / 300 (all new secondary text) | 7.70 / 7.37 / 6.77 | 6.20 / 5.83 / 5.65 |
| base-content on chip tint (warning/error/success/info 15% over base-200) | 11.3 to 12.5 | 11.5 to 12.6 |
| `--bcm` (existing muted) on base-200 | 4.97 | **4.46 (fails)** |
| warning text on base-100 | 6.61 | **2.46 (fails)** |
| error text on base-100 | **3.84 (fails text)** | **3.57 (fails text)** |
| success / info text on base-100 (light) | 5.62 / 5.04 | **2.37 / 2.59 (fail)** |

Binding consequences: new secondary text uses `text-base-content/70`; semantic colours are never text colour (only chip border/tint and bar stripes behind `base-content` text); bar fill is neutral and the percentage is always printed. The prototype colours were converted by script, not verified with an external colourimeter.

## 9. Lane-introduced constraints
[lane-proposed] `text-base-content/70` instead of `text-base-content-muted` for new secondary text. [lane-proposed] No semantic colour as text. [lane-proposed] Source wording in section 1. [lane-proposed] Limits pill first in the collapsed row. [lane-proposed] Initial expansion: every tile starts closed (section 3.2). [lane-proposed] Lane tiles carry the caption "lane · not in totals", a dashed border and a subtotal tile. Existing components (badges, tooltips, `ptah-cost-badge`) are not banned. Antigravity, Ollama and OpenCode data in the prototype is illustrative, not collected fixtures. Production components stay standalone + OnPush; the plain-HTML prototype does not prove Angular compliance.

## Clarifications Needed
None open. Gate 1.7 decisions recorded: P1-P9 defaults accepted (P3 90%, P4 A, P5 3 s, P9 15 min, P6-P8 as listed in section 6), T1 local zone + abbreviation, T2 short source labels.
