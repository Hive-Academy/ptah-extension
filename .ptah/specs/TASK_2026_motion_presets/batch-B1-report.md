# Batch B1 implementation report

## Changes

- `apps/ptah-extension-webview/src/styles.css:47`: added preset variables to the existing `:root` timing tokens, with Rise as the default. `:840` defines the six preset blocks; `:912` defines stage direction; `:921` defines enter and leave keyframes; `:935` makes leaves overlap the replacement; `:954` protects glass surfaces; `:976` hides leaves and clones under reduced motion.
- `apps/ptah-extension-webview/src/styles.css:829`: changed the root View Transition keyframe to a plain opacity crossfade for every preset, per `user-decisions.md` item 2.
- `apps/ptah-extension-webview/src/app/motion-presets.spec.ts:1`: added contract tests for preset selectors, shared timing, stage/clone behavior, glass rules, reduced motion, and the root crossfade.
- `apps/ptah-extension-webview/src/index.html:146`: mirrored the persisted motion style before Angular paints.
- `apps/ptah-extension-webview/src/app/theme-pre-paint-parity.spec.ts:50,267`: compared `data-motion-style` across the script and ThemeService in Electron and VS Code persistence shapes.
- `libs/frontend/core/src/lib/services/theme.service.ts:72,231,388`: added the six-name type and ordered list, Rise default, readonly signal, state-first boot resolution, setter persistence, and `<html>` attribute effect.
- `libs/frontend/core/src/lib/services/theme.service.spec.ts:165`: covered boot precedence, invalid choices, setter persistence, DOM attributes, and unavailable localStorage.
- `libs/frontend/core/src/lib/services/index.ts:15`: exported the motion style API from `@ptah-extension/core`.

## Preset CSS contract

- `data-motion-style`: `fade`, `rise`, `slide-left`, `slide-right`, `scale`, `directional`; absent or unknown means Rise. There is no `none` preset. `<html>` omits the attribute for Rise; preview tiles may set their own value.
- `.ptah-motion-stage` positions the switch and supplies `--ptah-motion-sign`. `[data-motion-dir='back']` reverses the sign only for `directional`.
- `.ptah-motion-panel` is the B2 layout-neutral marker. `.ptah-motion-enter` uses `ptahMotionEnter` over `--ptah-motion-in` (320ms). `.ptah-motion-leave` is absolute over the replacement and uses `ptahMotionLeave` over `--ptah-motion-out` (180ms). The two run concurrently, with no blank frame.
- `[data-motion-clone='pending']` pauses the B2 fallback clone; `[data-motion-clone='running']` uses the normal leave animation. Reduced motion hides both clone states and the leave panel.
- Preset displacement is Fade 0, Rise 18px, Slide left/right 32px, Scale 0.94 on entry, and Directional 32px with back reversal. Non-glass panels combine transform and opacity; glass-bearing panels keep opacity at 1 during entrance and cut the exit. Fade on glass enters with an 18px rise so it remains visible. The selector covers a panel that is itself a glass surface or contains one.
- Top-level `::view-transition-old(root)` stays opaque beneath `::view-transition-new(root)`, which fades from opacity 0 to 1 over `--ptah-motion-switch` (380ms). Neither snapshot translates or scales. This is the same whole-window crossfade for every preset, including surface changes involving the navbar, rails, and dock.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Use 18px Rise, 32px slides, and 0.94 entry Scale instead of the plan's earlier 8px/24px/0.97 values. | Earlier plan distances or stronger visible motion. | The later motion tuning raised the pane rise to about 16â€“20px, and this task reports that the earlier animations read as a small flash. Timings still use only the existing tokens. | Yes, CSS variables only. |
| Remove the 18px root snapshot rise and keep the old root snapshot stationary beneath the incoming opacity fade. | Keep the tuning keyframe or use the accepted plain crossfade. | `user-decisions.md` item 2 explicitly chooses a plain whole-window crossfade for every preset. The coordinator's independent review identified the root rise as a navbar, rail, and dock jolt. `ptahPageIn` now has only opacity keyframes, and the root pseudo-element rules contain no translate. | Yes. |
| Include a panel's own `data-glass-surface` as well as descendants in the glass selector, regardless of theme marker. | The plan's role-limited descendant selector or the user's broader no-opacity rule. | The task requires no opacity animation on any element that is or contains `data-glass-surface`. | Yes. |

## Verification

- `npm run verify -- -t test -p ptah-extension-webview -- --testPathPatterns="motion-presets|theme-pre-paint-parity"`: **NX 1 task: 1 succeeded**, 0/1 cache hit, run duration 16.1s.
- `npm run verify -- -t test -p @ptah-extension/core -- --testPathPatterns=theme.service`: first run **NX 1 task: 0 succeeded, 1 failed** because the new assertion counted an existing accent-mirror boot write. After narrowing it to the motion key, **NX 1 task: 1 succeeded**, 0/1 cache hit, run duration 17.8s.
- `npm run verify -- -p ptah-extension-webview,@ptah-extension/core`: **NX 6 tasks: 6 succeeded**, 0/6 cache hit, run duration 3m 59s; typecheck, lint, and tests passed.
- Scoped `ptah_get_diagnostics` was called after source edits. Its TypeScript compiler exceeded 45s and left five files unchecked; the subsequent full scoped Nx verification passed.

## Not done / Clarifications Needed

- No live Electron screenshot: this task forbids serving, building, or launching the host, and these B1 files have no standalone rendered HTML artifact. The CSS contract and pre-paint script were checked by the focused tests; frame-by-frame glass blur remains for the approved Electron visual matrix.
- The required `angular-frontend-patterns` skill could not be loaded because this CLI lane exposed no skill-loading tool or host skill catalogue. Repository instructions, the approved plan, and source conventions governed this implementation.
- No clarification is needed for B1.

## Revise round 1

- `apps/ptah-extension-webview/src/styles.css:912`: lowered the stage positioning rule to `:where(.ptah-motion-stage)` so a host's `absolute` or `sticky` utility can win.
- `apps/ptah-extension-webview/src/styles.css:921`: the ordinary enter reaches opacity 0.8 at 28% of 320 ms (89.6 ms) and 0.94 at 56.25% (180 ms). `:940` holds the leaving panel at opacity 1 until 75% of 180 ms (135 ms), then fades it out by 180 ms. Existing duration tokens remain unchanged.
- `apps/ptah-extension-webview/src/styles.css:934`: added `ptahMotionEnterGlass` with only a transform declaration. The glass entrance selector at `:969` chooses that keyframe; the glass leave at `:981` remains an immediate cut with no animation.
- `apps/ptah-extension-webview/src/app/motion-presets.spec.ts:19`: asserts the low-specificity stage rule and the overlap opacity stops. `:29` extracts the glass keyframe block, verifies that it contains no opacity declaration, and checks that the glass selector names it and the exit is cut.

Coverage math: for a leaving panel above the entering panel, combined opacity coverage is `1 - (1 - leaveOpacity) * (1 - enterOpacity)`. At about 90 ms and 135 ms the leave remains opaque, so coverage is 1. At 180 ms the leave is transparent and the enter is 0.94, so coverage is 0.94. This removes the review's approximate 0.65 dip at 90 ms. Easing changes the values between stops; the fixed stops and the opaque hold provide the stated endpoint coverage. Glass panels use transform-only entrance and cut exit, so the ordinary opacity coverage calculation does not apply to them.

Verification:

- `npm run verify -- -t test -p ptah-extension-webview -- --testPathPatterns=motion-presets`: **NX 1 task: 1 succeeded**; cache 0/1 hit; run duration 6.4s; exit code 0.
- `npm run verify -- -p ptah-extension-webview`: **NX 3 tasks: 3 succeeded**; cache 0/3 hit; run duration 1m 38s; exit code 0.
- No rendered Electron check was run because the task forbids build, serve, e2e, and launching Electron. Visual confirmation of the glass backdrop and overlap remains for the host visual matrix.

## Follow-up for B4

1. **Native drawer exit — confirmed.** `NativeDrawerComponent` renders a `popover="manual"` layer with a blurred backdrop and `.ptah-drawer-panel` as siblings; its host is `display: contents` (`libs/frontend/ui/src/lib/native/drawer/native-drawer.component.ts:66-82,126-127`). The B4 owners keep `[isOpen]="true"` while `animate.leave` removes the host, so the component does not close the popover before Angular's leave completes. Added a scoped preset leave animation to the panel only (`apps/ptah-extension-webview/src/styles.css:963-967`), and excluded the native drawer host from the active-glass cut rule (`styles.css:989`). The backdrop is not targeted. Contract assertions are at `apps/ptah-extension-webview/src/app/motion-presets.spec.ts:43-49`. Runtime frame-by-frame retention was not checked: build, serve, Electron and e2e are outside this lane's allowed verification. If a future owner changes `[isOpen]` to false before host removal, the component's `@if (isOpen())` will remove the popover immediately and CSS cannot retain it; that owner would need to defer `isOpen=false` until the exit completes.
2. **Glass selector scope — confirmed.** `data-glass-surface` appears directly in templates independent of theme (for example `libs/frontend/chat/src/lib/components/templates/chat-view.component.html:4,162`), while glass surface styling is gated by `:root[data-glass='on']` (`apps/ptah-extension-webview/src/styles.css:3069-3075`). The old descendant selector therefore matched non-glass themes. Scoped all four glass downgrade rules to the active-glass root, retaining transform-only entrance and cut exit for ordinary glass-bearing panels (`styles.css:975-990`). Both root-level motion styles and nested preview styles remain covered. Assertions are at `motion-presets.spec.ts:29-41`. Read `libs/frontend/chat/src/lib/components/organisms/transcript/chat-transcript.component.css:1-30`: its component-local pane-switch selectors are separate from these global `.ptah-motion-panel` rules, so this edit does not change transcript behavior. The transcript's own glass selector is still unscoped; B7 owns that file.

Verification: focused `npm run verify -- -t test -p ptah-extension-webview -- --testPathPatterns="motion-presets|theme-pre-paint-parity"`: **1/1 task succeeded** (11.7s run, 0/1 cache, exit 0). Full `npm run verify -- -p ptah-extension-webview`: **3/3 tasks succeeded** (59.0s run, 0/3 cache, exit 0). Scoped `ptah_get_diagnostics` found no diagnostics in the changed TypeScript spec; it does not recognize CSS and reported 16 errors in unrelated sibling files under its compiler settings. The required full verifier passed. The `angular-frontend-patterns` SKILL.md was read from `.claude/skills`, but this lane exposes no native skill-loading tool. No rendered screenshot was possible under the prohibition on build/serve/e2e and Electron launch.
