# Code Logic Review 3 — glass scenes (753bbc19c, dc071b348, f472bdb8c)

Score: 7/10. Verdict: REVISE (one Serious, minor items). Static reading only; no checks run.

## Verified OK
- (d) index.html pre-paint (SCENE list, `if (!has(SCENE, scene)) scene='pyramid'`, set for `!theme` / ptah-glass / ptah-glass-light) matches ThemeService effect (theme.service.ts ~L276: data-scene for exactly those two themes) and DEFAULT_SCENE='pyramid'. Stored scene still wins in both. Per-scene `--glass-scene` rules exist for all 6 scenes in both themes (styles.css L3043-3054), so removing the aurora fallback leaves no unset-scene gap as long as data-scene is always set (it is, in both paths). Only residual: a non-Angular boot where neither runs would have no backdrop; not reachable in Electron.
- (e) dark->dracula migration intact: index.html L117/L124, theme.service.ts L333 and L443 (`legacy === 'dark'` -> dracula).
- (2) Merge: remerge-diff shows conflicts resolved correctly. theme.service.ts keeps the 6-scene list + DEFAULT_SCENE pyramid AND MotionStyleName / MOTION_STYLES / DEFAULT_MOTION_STYLE / isValidMotionStyle; initializeMotionStyle and the data-motion-style effect (L292-294) present. Toggle spec keeps setMotionStyle/motionStyle mocks, pyramid scene, count 5 tiles, Glass 5 partition. e2e keeps `test.fixme` (PR 880) with "35 themes".
- (a) New CSS rules are all under `:root[data-glass='on']` or `:host-context([data-glass='on'])`. The data-glass-surface attributes added to Providers card, CLI matrix and tasks empty state are inert in solid themes (attribute selectors are all glass-scoped, L3143-3165; base `:where([data-glass-surface])` isolation noted in surface-section.component.ts comment applies "every theme" — see Minor 2).
- (c) Cleared-root selectors match: `ptah-tasks-view` template root `<div ... bg-base-100>` (tasks-view.component.ts L98/L115), `ptah-workspace-sidebar` root `bg-surface-1` (workspace-sidebar.component.ts L44), `ptah-dashboard-grid` root `bg-surface-0` (dashboard-grid.component.html L1). All are direct children of the host.

## Blocking
None.

## Serious

### S1. Sticky task-list header becomes see-through under the new surface rule
- Evidence: libs/frontend/tasks-ui/src/lib/components/board/task-list.component.ts:169 (`surface-1 sticky top-0 z-30 ... backdrop-blur`) vs styles.css:3644-3648, which sets `background-color: var(--glass-scrim-text)`; that token is `oklch(var(--b1)/0.5)` by default (L2833) and 0.62 in dark glass (L2871). Previously the header had the opaque `--surface-1` fill.
- Scenario: Ptah Glass, Tasks list view, scroll a long group. Rows scroll under the pinned header and show through at 38-50% transparency; with only a mild blur the header text collides with row text, which makes the status header unreadable. The comment in that file says the pinned status "must not leave the screen" so readability is its whole purpose.
- Fix: exclude sticky/pinned headers from the rule (add a `data-glass-surface="bar"` to that header, or `:not(.sticky)`), or give the rule an opaque floor for `.sticky`.

## Minor
1. The reading-plane rule sits unlayered, so it beats `@layer` utilities `.elev-1`/`.elev-3` that `ptah-surface-card` applies (surface-card.component.ts L19-21) and the `.surface-2` `--elev-shadow`; card elevation is replaced by `--glass-raise`/glint in glass. Likely intended (the comment says so) but then `elevation=2` has no visual effect in glass.
2. Nesting: `ptah-surface-card`/`ptah-surface-tile` emit `surface-2` with no `data-glass-surface`, so one placed inside a `ptah-surface-section` (content/chrome, excluded from the rule, own fill) gets a second scrim stacked on the section fill. Not wrong, but denser than intended. Only real call sites outside libs/frontend/ui are memory-diagnostics-accordion (not a nested case), so the exposure is small today. Also `cursor-credential-popover.component.ts:187` uses `surface-2` inside a popover; if the popover host is `.popover-panel` (not in `:not()` list) the inner block gets a scrim on top of a glass overlay. Low impact; consider adding `.popover-panel` to the exclusion.
3. The rule's exclusion list lacks `.surface-3` intentionally and `bg-surface-1` utility users (e.g. agent-dock-card `fixed z-50 bg-surface-1`, inspector-agent-actions-menu `absolute z-20 bg-surface-1`) are NOT matched (utility class, not `.surface-1`), so they are unaffected by the shared rule. However `ptah-workspace-sidebar` is now fully transparent with no replacement reading plane (styles.css:3634); its text relies on the scene tint alone. Confirm visually.
4. glass-scrim.spec.ts only regex-matches CSS text; it would not catch the selector-vs-template drift in (c) or S1. Add a template-root assertion for the three cleared roots if desired.
5. Merged e2e `test.fixme` leaves the theme list test disabled; that is carried from main, not introduced here.

## Answers to the five questions (short)
1. Silent failure: none new; S1 is a visual silent regression.
2. Scrolling the Tasks list under glass (S1).
3. Scenes: a stored invalid scene falls to pyramid in both paths (consistent).
4. N/A (CSS/theme only).
5. Missing: opaque floor for sticky surfaces under glass; test of template roots.
