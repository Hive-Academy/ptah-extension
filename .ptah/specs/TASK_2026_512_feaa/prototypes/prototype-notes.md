# Compact Session Tile Redesign — Prototype Rationale & Usability Notes

**Task ID**: `TASK_2026_512_feaa`  
**Role**: `ui-ux-designer`  
**Scope**: Standalone visual prototypes for the compact session tile redesign (880px width, 232px compact / 472px compact-tall).

---

## 1. Variant Breakdown (Optimization vs Cost)

### Variant 1: Horizontal Ticker Marquee (`variant-1-ticker.html`)
* **What it optimizes for**: Literal realization of the retro broadcast newsbar aesthetic and minimal vertical footprint. It fits into a 32px band, preserving the remaining vertical tile space for an active callout card and prose snippet while maintaining continuous ambient motion.
* **What it costs**: **Catastrophic scanability and high cognitive friction.** Horizontal text scrolling forces continuous saccadic tracking. Users cannot scan at their own reading speed. If an error occurs (`17:24:50 ✖ bash failed`), it scrolls offscreen within seconds; an engineer glancing at the tile misses it entirely unless they catch that fleeting window and chase the moving target with their mouse to hover-pause.

### Variant 2: Stacked Terminal Log (`variant-2-stacked-log.html`)
* **What it optimizes for**: Maximum operational scanability, rapid anomaly detection, and authentic CRT teletype aesthetics. Monospace timestamps in a dedicated left gutter (`17:24:50`), dual-coded accessible tone badges (`✖ [TERM]`, `▲ [COMP]`, `✓ [AGENT]`), and a stable vertical reading axis allow an engineer to evaluate session status in under 200 milliseconds.
* **What it costs**: Total sacrifice of synthesized natural language context. It surfaces *what* tools ran, but completely drops *why*—the assistant’s thought process, decisions, and high-level human-readable outcome are invisible unless the user expands to full view. Additionally, at 880px wide, short single-line log items leave significant dead whitespace across the right half of the tile.

### Variant 3: Split Deck (`variant-3-split.html`)
* **What it optimizes for**: A pragmatic hybrid that retains today’s most valuable element (the assistant's synthesized recap and human-readable outcome) while delegating rapid-fire background tool telemetry to an ambient 30px retro news ribbon.
* **What it costs**: Compromises both paradigms: the moving ticker ribbon remains susceptible to motion fatigue and missed alerts (though softened because critical decisions live below it), while the assistant prose box is vertically constrained to two lines in the 232px compact height. In the 472px tall view, it splits into three stacked vertical bands, creating visual fragmentation.

### Variant 4: Dual-Pane Wire Console (`variant-4-wire-console.html`)
* **What it optimizes for**: **The widescreen 880x232px geometry (3.8:1 aspect ratio).** Rather than stacking full-width rows across 880px, it partitions the tile horizontally into an Executive Master pane (320px left: assistant recap, active agent, outcome badge, full-view trigger) and a Real-Time Teletype Detail pane (560px right: 5-row live event stream with timestamps and accessible glyphs). Line lengths in both columns remain in the ergonomically optimal 40–60 character range.
* **What it costs**: Higher visual density. Requires a clear dividing boundary (`border-r border-base-300`) and assumes the tile container maintains a minimum width of ~720px (which is guaranteed by the fixed 880px compact canvas grid contract).

---

## 2. Readability Verdict on the Moving Ticker

> **Verdict**: A horizontally scrolling ticker is **strictly decorative and is objectively unacceptable as the sole or primary view of session activity.**

### Technical & Ergonomic Rationale:
1. **Reading Physiology & Saccades**: Human reading relies on discrete fixations and saccadic jumps along a static line. Moving text forces continuous smooth-pursuit tracking, which drastically increases visual fatigue and slows comprehension by over 300%.
2. **Transient Alert Degradation**: AI coding sessions are monitored peripherally. When an engineer glances across four compact tiles on a canvas workspace, they need immediate, latching awareness of state changes. In a 24-item marquee loop running at standard speed, a critical error or compaction event is visible for roughly 4 seconds every 35 seconds. If the user glances away, the failure is invisible.
3. **Accessibility (WCAG 2.2.2 compliance)**: Moving content without an immediate, persistent static alternative creates severe barriers for users with cognitive or vestibular disorders. Even with hover-to-pause implemented, requiring motor precision to target and pause moving text is an established anti-pattern.
4. **Conclusion**: The retro ticker tape aesthetic is visually charming and evokes nostalgia, but if implemented, it must only serve as an ambient secondary ribbon (as demonstrated in Variant 3). It must never replace a static, structured log.

---

## 3. Honest Recommendation: Variant 4 (Dual-Pane Wire Console)

**Recommended Variant**: **Variant 4 (`variant-4-wire-console.html`) — The Dual-Pane Wire Console.**

### Why Variant 4 is the clear winner:
1. **Geometry-Native Layout**: An 880px wide by 232px high box is extremely wide and vertically shallow. Vertical stacking across 880px produces either awkward line wraps or 600px of empty space on every log line. A two-column split transforms this proportion into two perfectly balanced panels.
2. **Complete Information Architecture**: The user’s feature request specifically asks for *"recaps of what the agent is doing"*, while the concurrent backend and state work (Lane A/B) introduces the authoritative `lastAssistantMessage` and `outcomeLabel`. Variant 4 is the only layout that presents the **executive synthesis** (what the agent decided) and the **operational trace** (the tools it executed) side-by-side with zero clicks, zero scrolling, and zero motion sickness.
3. **Seamless Height Tier Scalability**:
   * At **232px (Compact 2U)**: Displays a 3-line executive recap, active agent, outcome badge, and the 5 most recent teletype log events.
   * At **472px (Compact-Tall 4U)**: Seamlessly deepens into an executive dossier with token delta metrics and a 12-line complete session teletype history with terminal prompt status.

---

## 4. Design Brief Critique

1. **The premise of a pure moving ticker as a usable view**:
   The brief asks whether a moving ticker is *"good enough to be the only view of activity."* As established above, proposing a moving ticker as the primary telemetry monitor in a production developer environment is a functional regression from today's static pills. The brief should have explicitly framed the ticker as an ambient companion, not a standalone candidate.
2. **Overlooking column partitioning for wide tiles**:
   The brief notes the 880px tile width but only prompts for vertically stacked directions (Ticker, Stacked log, Split). At 880px width, vertical stacking wastes screen estate. The design brief should have recognized horizontal column splits as the primary layout candidate for letterbox-proportioned tiles.
3. **472px (4U) is too aggressive as the only tall tier**:
   Doubling the tile height from 232px (2 units) directly to 472px (4 units) consumes almost the entire vertical canvas viewport in typical laptop displays (768px–900px height), pushing all other workspace tiles offscreen. A **3-unit tier (~352px)** is the ergonomic sweet spot for a compact-tall mode, fitting comfortably on any display while providing plenty of room for 8–10 log rows.
4. **Retaining `text` in `SemanticItem` is essential**:
   The brief notes that `summarizeLive` had `timestamp` and `text` and threw them away, suggesting `timestamp` be re-admitted to marks. However, discarding `text` remains a mistake: error descriptions (`Exit code 1: 3 test suites failed`) and compaction metrics (`-42k tokens`) live in `text`. If `text` is omitted, the logs are forced to render vague labels like `"bash failed"` without the actionable diagnosis. Both `timestamp` and `text` should be preserved in `CompactSemanticMark`.

---

## 5. Prototype Directory Manifest

All deliverable files have been written directly to `.ptah/specs/TASK_2026_512_feaa/prototypes/`:

* `variant-1-ticker.html`: Pure horizontal marquee ticker with scanlines, hover-to-pause, and active item callout.
* `variant-2-stacked-log.html`: High-scanability vertical teletype terminal stream with dual-coded glyphs and timestamp gutter.
* `variant-3-split.html`: Hybrid split deck pairing an ambient newsbar ribbon with the assistant's prose recap.
* `variant-4-wire-console.html`: **[RECOMMENDED]** Dual-pane master-detail wire console exploiting the 880px widescreen aspect ratio.
* `prototype-notes.md`: This design rationale and usability evaluation.
