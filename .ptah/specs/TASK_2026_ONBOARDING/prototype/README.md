# Onboarding prototype
Open `index.html` (hash `#ready`, `#readyset`, `#home`, `#analyze`, `#project`; `?theme=ptah-glass|ptah-glass-light|anubis|anubis-light` (default `ptah-glass`; `?rt=reduce` previews reduced transparency); `?state=checking|ready|missing|signed-out|error` sets the Claude Code state used by the Get ready screens and the Home banner; the bar's "Claude Code state" group does the same). `narrow.html?theme=...&view=...&state=...&w=400` frames it (default 640px). Get ready screenshots: `screenshots/get-ready-*.png` (spec section 12).
Tokens copied from `apps/ptah-extension-webview/tailwind.config.js` and `src/styles.css` (project rules).

## Lane-introduced constraints
- Review-anyway override on proposal apply `[lane-proposed]`
- Countdown pauses while Details log focused `[lane-proposed]`
- Get ready pre-steps: first-run redirect target, `ready` flag object, banner scope, copy and PATH hint (spec 12.11 L1-L7) `[lane-proposed]`

## Visual revision v2 screenshots (spec section 13)
Files: `screenshots/v2-<screen>-<state>-<theme>.png`, theme suffix `glass-dark` (ptah-glass), `glass-light` (ptah-glass-light), `plain-dark` (anubis), `plain-light` (anubis-light). Each is the full page at 1280px.
- Get ready stage 1: `v2-get-ready-{checking,ready,missing,signed-out,error}-<theme>.png`
- Get ready stage 2: `v2-providers-missing-<theme>.png`, `v2-cli-tools-ready-<theme>.png`
- Home: `v2-home-ready-<theme>.png` (3 cards, progress strip), `v2-home-missing-<theme>.png` (warning banner)
- Step UIs: `v2-analyze-generating-`, `v2-project-proposal-`, `v2-review-apply-`, `v2-team-start-`, `v2-team-proposal-`, `v2-states-` + `<theme>.png`
- Narrow 400px (glass dark and glass light only): `v2-get-ready-missing-narrow-<theme>.png`, `v2-providers-narrow-<theme>.png`
- Reduced transparency (glass dark and light): `v2-providers-missing-reduced-transparency-<theme>.png`
Provider marks in the prototype are the repo's vendored artwork (`libs/frontend/ui/src/lib/native/brand-mark/`), see section 13.2.
