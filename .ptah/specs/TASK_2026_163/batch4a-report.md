# Batch 4 Lane 4a — Builders Dashboard Card — Implementation Report

**Task**: TASK_2026_163 · B4a.1 (create BuildersCardComponent) + B4a.2 (mount + export)
**Executor**: frontend-developer
**Date**: 2026-07-19
**Status**: ✅ COMPLETE — typecheck green

---

## Files created

1. `libs/frontend/dashboard/src/lib/components/builders-card/builders-card.component.ts`
   - Selector `ptah-builders-card`; standalone; `ChangeDetectionStrategy.OnPush`; signals + `inject()`; imports `LucideAngularModule`.
   - Cloned the `AnalyticsCardComponent` structure (external `templateUrl`, matching its layout convention — analytics card uses a sibling `.html`, so this card does too).
   - `dismissed = signal<boolean>(...)` seeded from `globalThis.localStorage?.getItem('ptah.builders-card.dismissed') === '1'` — pattern mirrored from `conversation-registry.service.ts:326` (`readPersisted`) / `:355` (`writePersisted`), including the `try/catch (error: unknown)` + `console.warn` shape on the write.
   - `exploreBuilders()` reuses the exact link-out mechanism from `settings.component.ts:184` (`openPricing`): `this.rpcService.call('command:execute', { command: 'ptah.openPricing' })` via injected `ClaudeRpcService` from `@ptah-extension/core`. No new RPC/command invented.
   - `dismiss()` writes `'1'` to the localStorage key and sets the signal → permanent hide, no re-nag.
   - No license RPC anywhere; zero network calls unless the user clicks "Explore Ptah Builders".

2. `libs/frontend/dashboard/src/lib/components/builders-card/builders-card.component.html`
   - `@if (!dismissed())` wraps the whole card → dismissed = never rendered.
   - Content: community icon (`Users` from lucide) + heading "Ptah is open source" + one sentence promoting Ptah Builders (community + training + priority support) + primary "Explore Ptah Builders" link button + ghost "Dismiss" button.
   - No countdowns, comparison tables, "upgrade" verbs, modals, or nags.
   - a11y: `aria-label="Ptah Builders membership"` on the section; `aria-label="Dismiss the Ptah Builders card"` on the ghost button; icon `aria-hidden="true"`. Both buttons are real `<button type="button">` (keyboard-accessible). No `[innerHTML]`.
   - Tailwind/daisyui classes reused from the analytics card idiom (`card bg-base-200/40 border border-base-content/10 shadow-sm mt-2`, `card-body`, `card-actions`, `btn btn-primary btn-sm`, `btn-ghost`).

## Files touched (mount + export)

3. `libs/frontend/dashboard/src/lib/components/dashboard-grid/dashboard-grid.component.html`
   - Added `<ptah-builders-card />` immediately after `<ptah-analytics-card />` (the analytics card sits at line 48 in the current file, not requiring `~line 48` guesswork — verified in place).

4. `libs/frontend/dashboard/src/lib/components/dashboard-grid/dashboard-grid.component.ts`
   - Added import of `BuildersCardComponent` and added it to the standalone `imports` array (required because `DashboardGridComponent` is standalone; the grid template renders the card).

5. `libs/frontend/dashboard/src/index.ts`
   - Added `export { BuildersCardComponent } from './lib/components/builders-card/builders-card.component';`

---

## Deltas / lower-risk choices recorded

- **DELTA (mount wiring beyond task list)**: B4a.2 as written names only `dashboard-grid.component.html` + `index.ts`. Because `DashboardGridComponent` is a **standalone** component, rendering `<ptah-builders-card />` in its template also requires registering `BuildersCardComponent` in the grid's `imports` array (`dashboard-grid.component.ts`). This TS edit was necessary for the mount to compile — lower-risk than leaving a template referencing an unimported component. Flagged here as an additional touched file.
- **Icon choice**: used lucide `Users` (community icon) — a neutral, community-connoting glyph; matches the "community" framing without any trademarked reference.
- **Link URL**: per B3a.4 delta, `openPricing`'s target URL is resolved **host-side** by the `ptah.openPricing` command (see `settings.component.ts:179-188` doc comment: "target URL is resolved host-side. Reused by the Builders promotion card."). The card therefore carries no URL constant of its own — nothing to repoint on the frontend; final Builders/community path is owned host-side and coordinated with TASK_2026_162. This is the lower-risk choice (no duplicated URL to drift).
- **Sibling `.html`**: created because `AnalyticsCardComponent` uses `templateUrl` (external template) — matched its convention as instructed.

## R5 (marketplace scanning) compliance

- TS + HTML copy is fully neutral: "Ptah is open source", "Ptah Builders", "community", "training", "priority support". No trademarked AI product names (copilot / codex / claude / openai / anthropic) added to any non-JS file. The only `Claude*` token in the TS is the existing `ClaudeRpcService` symbol imported from `@ptah-extension/core` (a JS/TS identifier, safe — marketplace scanner flags non-JS files only).

## Acceptance verification

- **Compiles**: `npx nx run @ptah-extension/dashboard:typecheck` → **Successfully ran target typecheck** (green; ran `npx ngc --noEmit --project libs/frontend/dashboard/tsconfig.lib.json`).
- **Dismiss reads/writes** localStorage key `ptah.builders-card.dismissed` (seed on construct via `getItem`, write `'1'` via `setItem`).
- **Renders in both shells**: card mounted in `DashboardGridComponent`, which is already mounted in both the VS Code webview and Electron shells via `app-shell.component.html` — card auto-appears in both.
- **a11y**: `aria-label` on section + dismiss button; icon `aria-hidden`; native buttons keyboard-accessible.
- **Signed-out**: no license RPC; functional with no license key; zero network calls when dismissed.

## Not done (out of scope / per rules)

- No git commit (team-leader owns commits).
- No spec files touched.
- Lint not run (acceptance requires typecheck only); typecheck is green.
