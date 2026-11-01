# Review B7: live demo landing section

Scope read in full: `live-demo-section.component.ts` (265 lines), its spec (111), `live-demo-catalog.ts`, the `landing-page.component.ts` diff (one import, one array entry, one tag; nothing removed), `runtime/control-channel.ts`, `types.ts`, the `play`/`pause`/`boot` paths of `playback-engine.ts`, the B7 and B1 contracts and `batch-b7-notes.md`. Nothing was executed (no verify/nx/Jest, per instructions).

## Verdict: REVISE (0 blockers, 2 major, 8 minor)

The security and SSR basics are sound. The two major findings are behavioural and both are on the mobile and fast-scroll paths.

Verified OK:
- SSR: `browser` guard on every `window`/`document` use. `matchMedia`, `IntersectionObserver` and `navigator.connection` are touched only inside `afterNextRender` (component.ts:157-194). The poster `<img>` renders at SSR and the iframe is gated by `active()`, so `frameUrl()` is never evaluated at SSR. The SSR spec covers this.
- Iframe creation rules (visible, at least 1024px, no reduced motion, no Save-Data, or click) match the contract (:169, :184, :222). The click path ignores the gates, which is intended.
- Inbound filter: `event.origin === location.origin` and `event.source === iframe.contentWindow`, plus the source tag and a scenario match (:259-261). Outbound `postMessage` uses `view.location.origin` (:246). Matches `control-channel.ts`.
- Cleanup: observer, resize, message and visibilitychange listeners are removed through `destroyRef.onDestroy` (:188-193). `afterNextRender` is not run if the component dies first, so nothing leaks.
- URL: a constant catalog, the id regex (:151) and `bypassSecurityTrustResourceUrl` only for a validated id with a fixed prefix. Safe.
- Strings present: "See PtahCode work", "Replay of a recorded PtahCode session", "Download PtahCode" linking to `/download`, iframe `title`, `sandbox` and `loading` as contracted.
- Tab change: the iframe element persists and its bound `src` changes, so it reloads. Speed and state are reset (:197-202). Stale messages from the old scenario are dropped by the scenario check (:261).
- A11y basics: tablist/tab/tabpanel, `aria-selected`, roving `tabIndex`, Arrow/Home/End, focus-visible outlines, progressbar `aria-valuenow` and `aria-valuetext`.
- Field initialisation order is safe (`platformId` before `browser`, `sanitizer` before `frameUrl`). Signals and OnPush match the neighbours.

## Major

### M1. The mobile video never changes when the tab changes

- File: `live-demo-section.component.ts:58-63`
- Scenario: at under 768px the single `<video>` is kept across tab changes. Only `<source [src]>` and `[poster]` are re-bound.
- Impact: changing the `src` of an existing `<source>` does not make the media element reselect a resource (the browser only re-runs resource selection on `load()` or when the `<source>` is inserted). The poster and label switch to the new scenario while the video keeps loading or playing the previous scenario's file. Wrong-content bug on the mobile fallback, which has no iframe to cover for it. The `aria-label` also changes while the content does not.
- Fix: bind the file on the video element so the resource is re-selected, for example `<video #replayVideo [src]="selected().video" ...>` with no `<source>` child. Alternatively force a new element per tab with `@for (demo of [selected()]; track demo.id) { <video ...> }`.
- Related, minor: the only format is WebM. iOS Safari support for WebM is partial and older iOS has none. If B8 can emit an MP4/H.264 file, add a second `<source>` and let the browser pick, using the `@for` re-creation above.

### M2. The pause on leaving the viewport or hiding the tab is lost while the iframe is still loading

- File: `live-demo-section.component.ts:249-253`, `:172-174`, `:181-185`
- Scenario: the demo auto-starts when visible, which sets `active` and creates the iframe. The visitor scrolls past, or switches tab, within the load window (seconds for the app bundle). `sendControl('pause')` posts to the iframe's initial `about:blank` window or a not-yet-installed bridge, so the message is dropped. The bridge boots, autoplays, and the replay (CPU, timers) runs off-screen or in a hidden tab with no way to catch up. The control channel never re-sends.
- Impact: breaks the contract "pause when the section leaves the viewport or document is hidden". It also wastes battery and CPU on a landing page, and the viewer misses the start of the replay.
- Fix: keep `visible` as a class field (it is currently a local `let`, :165) and add an `isOffscreenOrHidden()` check. In `acceptStateMessage`, after `this.state.set(...)`, add `if (data.state.playing && (!this.visible || this.document.visibilityState === 'hidden')) this.sendControl('pause');`. This self-heals on the first state message from a booted bridge. Add a spec case for it.

## Minor

1. **Playback does not resume on return.** Returning to the viewport or tab only calls `startDemo()`, which is a no-op when already active (:184, :172-174). The demo stays paused, and the Play button is the only recovery. Acceptable, but record it as a decision. The optional alternative is to resume only if the section paused it itself (a `pausedByVisibility` flag).
2. **Play button is misleading in two states.** While `state().waitingForSend` (orchestration) or `complete`, or before the first state arrives, the label reads "Play" but the engine ignores it (`playback-engine.ts:78`, `:85`). Fix: disable the button with `[disabled]="state()?.waitingForSend || state()?.complete"`. Label it "Replay" or call `restart()` when complete. The "Click Send in the demo to start" hint (:85-87) is correct but static, so hide it once `state()?.waitingForSend === false`.
3. **`muted` attribute on `<video>` (:59).** Angular's static `muted` sets the attribute after element creation, which does not set the `muted` property (known Angular quirk). Use `[muted]="true"` to guarantee a muted element.
4. **Automatic activation of tabs reloads a full iframe per arrow press** (:204-219). Arrowing through four tabs loads up to four app instances. Consider manual activation (arrows move focus, Enter/Space selects) or a short debounce on iframe `src` changes.
5. **`aria-label` on a plain `div`** (:95, controls wrapper) is ignored by assistive tech. Add `role="group"`.
6. **Nonexistent Tailwind class.** `text-ink-200` (:34, :84) is not in `apps/ptah-landing-page/tailwind.config.js` (ink has 950 to 400 and 100; there is no 200). The text silently inherits `text-ink-100`, which still passes AA, but the class does nothing. Use `text-ink-300` or `text-ink-100`. `amber-300` is not extended in the config either. It exists only if Tailwind's default amber survives the `extend`, so confirm in a build or use `amber-400`.
7. **Focus outline may be clipped.** The tablist is `overflow-x-auto` with only `pb-2` (:40), so the offset focus ring on the first or last tab can be clipped at the top and sides. Add `p-1` or use `focus-visible:-outline-offset-2`.
8. **Reduced-motion and Save-Data are read once.** There is no `change` listener on the media query, and `frameUrl` depends on `reducedMotion` (:152). With reduced motion the click path also creates the iframe with `autoplay=0`, so the visitor clicks "Play live demo" and then Play again. State this in the UI or drop `autoplay=0` for explicit clicks (pass `autoplay=1` when `startDemo` was user-initiated).
9. **Sandbox note (informational).** `allow-scripts allow-same-origin` on a same-origin document gives no isolation, because the framed page can remove its own sandbox. This is the contracted value and the page is first-party, so no change is requested. The B3 CSP (`frame-src 'none'` inside the demo) is the real control.

## Spec quality (`live-demo-section.component.spec.ts`)

Good: the SSR poster-only test, the roving-tabindex and keys test, the tab-change URL test, and the origin/source/scenario message-filter test with the progress assertion.

Missing coverage, each worth a case:
- The <768px video fallback: attributes `muted`, `playsinline`, `controls`, `preload=none`, and re-selection on tab change (would catch M1).
- Control messages: spy on `iframe.contentWindow.postMessage` and assert the payload and `targetOrigin === location.origin` for play, pause, speed and restart.
- Pause on `visibilitychange` hidden, and on IntersectionObserver not intersecting (needs a stubbed `IntersectionObserver`). This would catch M2.
- Gating of the auto-start: wide, reduced-motion and Save-Data cases.
- Listener cleanup: `fixture.destroy()`, then dispatch a message and assert there is no throw or state change, or spy on `removeEventListener`.
- The required strings and the `/download` link.
- The spec asserts `document.activeElement` on a detached fixture. Attach the fixture to `document.body` to avoid flakiness.

## Contract and scope checks

- The landing-page diff is additive only. Confirmed.
- The catalog has four entries (orchestration, tribunal-council, command-center, multi-agent). This is the lead's catalog decision, which supersedes the three-entry plan. `batch-b7-notes.md` records it.
- `batch-b7-notes.md` reports that the final verify run was not completed after the last edit (lock queue). The unrun checks are lint, test and typecheck on the final state of this component. They should be re-run by the coordinator before commit.
