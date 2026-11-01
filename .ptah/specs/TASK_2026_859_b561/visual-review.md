# Visual Review - TASK_2026_859_b561 (AFTER state, Electron only)

Verdict: PASS (score 8/10). No visual-breaking and no serious defects. 2 moderate findings, 2 minor. One requested case (unsupported entry) could not be reproduced against live data.

## Environment

- Build: `node scripts/verify.mjs --exec --task electron-screenshot -- npx nx run ptah-electron:build` from the worktree (HEAD 9547ccc77), exit 0, 246 s, then `node apps/ptah-electron/scripts/copy-renderer.js`. Log: `/tmp/mra-build.log`.
- Launch: `node_modules/.bin/electron --remote-debugging-port=9356 dist/apps/ptah-electron/main.mjs` with HOME, XDG_*, `--user-data-dir` and PTAH_DB_PATH under `/tmp/mra-run`, workspace a temp git repo. Driven over CDP with playwright-core (`/tmp/mra-scripts`). Real `~/.ptah` untouched. App closed afterwards (0 processes left).
- Real live registry data was used. No fetch shim (the earlier reviewer needed one; it is no longer needed).
- Route: Marketplace > MCP Servers > MCP Registry.
- Themes: `anubis` (Dark tab), `anubis-light` (Light tab), plus `ptah-glass` (the app's default; its shots are `*-glass.png`). Dark and light are separate full runs. Window is 1365x982 for dark/light and 645x774 (narrow) for glass, so glass doubles as a narrow-width check.
- The final Install button was never clicked. Dummy values were cleared afterwards (0 password inputs left, panel cancelled).
- Screenshots: `/home/amun/ptah-extension/.claude-worktrees/mcp-registry-api/.ptah/specs/TASK_2026_859_b561/screenshots/` (36 files, `after-<n>-<name>-<dark|light|glass>.png`).
- Before evidence: TASK_2026_853 Phase D finding 8 (`/home/amun/ptah-extension/.claude-worktrees/session-prefix-diet-d/.ptah/specs/TASK_2026_853_897f/visual-review-phase-d.md`). It is text only: every registry entry showed "Could not auto-detect configuration". No before screenshot exists, so comparison is against that description.

## Screenshot results (each file exists for dark, light and glass; only the dark/light theme paths are listed)

| File prefix (screenshots/) | Shows | Result |
| --- | --- | --- |
| after-01-popular-{dark,light} | Popular servers list: cards with name, version, transport and an Install button | PASS. All entries list and render (50 Install buttons). Panels opened for the first 26 of them; none showed "Could not auto-detect". |
| after-02-search-github-{dark,light} | Search "github": result grid | PASS. Results render (20+). Opened 20 panels, 0 errors. |
| after-03-search-filesystem-{dark,light} | Search "filesystem": 10 results | PASS. Opened all 10 panels, 0 errors. |
| after-04-npm-panel-{dark,light} | `io.github.domdomegg/filesystem-mcp`: `stdio npx -y filesystem-mcp@1.3.0`, 7 targets checked, Install enabled | PASS. This is the npx config preview. |
| after-05-http-panel-{dark,light} | `ac.inference.sh/mcp` (remote only): `http https://api.inference.sh/mcp` | PASS. This is the http config. |
| after-06a/06b-secret-empty-{dark,light} | `com.pulsemcp/remote-filesystem`: REQUIRED INPUTS with GCS_BUCKET (text) and GCS_PRIVATE_KEY (`secret` badge, password field). "Install to 7 targets" is disabled=true | PASS |
| after-07a-secret-typed-bucket-empty-* | Secret field typed `test-value` (masked dots), bucket still empty | PASS. Install stays disabled. |
| after-07b-secret-typed-both-* | Both fields filled | PASS. Install becomes enabled (disabled=false). The value `test-value` is not in the DOM text or innerHTML. |
| after-07c-secret-focus-* | Focus on the secret input | PASS with finding M2 (ring subtle). |
| after-08a/08b-header-secret-*  | `ae.easyvoice/tts` (http): REQUIRED INPUTS "Authorization" with secret badge. Empty: Install disabled. Typed `test-value`: Install enabled | PASS for masking and the disabled-to-enabled gate. See M1 for the preview. |

Other panels checked in text (not screenshot): a secret input appears for other entries in the same way (apex-ai-academy, propick, medium-ops, a docker/oci entry `ai.aliengiraffe/spotdb`). Non-secret required inputs (WORKSPACE_ROOT, allowed-directories) render as text fields. Stdio entries using npx, uvx, dnx and docker all produce a preview.

Comparison with before: 0 of the opened popular and search entries (about 56 panels) showed the failure message, against 22 of 22 before. The fix works in the real app.

## Findings

### Serious / visual breaking

None.

### Moderate

- M1. The config preview does not show env vars or headers at all, so the masked `••••••` that the task expected never appears in the UI. After typing `test-value` into the secret field the preview line stays `http https://easyvoice.ae/api/mcp` (08b), and the stdio preview stays `npx -y -y remote-filesystem-mcp-server@0.1.5` (07b). The component builds the preview from `preview.command/args` or `preview.url` only (`libs/frontend/chat-ui/src/lib/molecules/setup-plugins/mcp-directory-browser.component.ts:701-706`), while the mapper does emit redacted `headers` and uses `SECRET_PREVIEW = '••••••'` (`libs/shared/src/lib/types/mcp-registry-config.mapper.ts:71`, preview headers at about `:458`). No secret leaks (verified: value absent from DOM). But the user cannot see that their header or env var will be written. Fix: render the preview's `env` and `headers` entries as `NAME ••••••` lines, or state that explicitly in the spec. Moderate because it is a safe omission and not a defect in the secret handling.
- M2. Focus ring on the new inputs is faint. Computed: dark `outline 2px solid oklch(.925 .007 88 / .2)`, light `outline 2px solid oklch(.236 .066 313 / .2)` (alpha 0.2). In glass a gold glow ring is visible (07c-glass); in dark and light the ring reads as a thin grey double ring (07c-dark, 07c-light). It is visible but under the 3:1 non-text contrast target (WCAG 1.4.11, measured by eye, not computed). Fix: raise the outline alpha or use a primary-colour ring.

### Minor

- m1. The CONFIGURATION preview shows `npx -y -y remote-filesystem-mcp-server@0.1.5`: a duplicated `-y`. Cause is the registry entry supplying `-y` as a runtime argument, plus the mapper adding its own. Harmless but sloppy. Mapper: `mcp-registry-config.mapper.ts` (npm branch, `mapPackage`). Fix: de-duplicate a leading `-y`.
- m2. The `secret` badge is 10 px text. Contrast is fine (dark: L .87 on .24; light: L .92 on .27) but it is small. Optional hints are listed under "REQUIRED INPUTS" and blocked Install even when the registry description says "Optional" (apex-ai-academy "Authorization": "Optional: Bearer ...", spotdb "X-API-Key": "Optional API key"). That is the registry's `isRequired` flag versus its text; flag for the logic reviewer, not a layout defect.

## Not reproducible: unsupported entry

I scanned the whole live registry (about 1,200 entries) through its API: the only entries with no install source in the supported set are two oci-stdio entries (`ai.aliengiraffe/spotdb`, `ai.apithreshold/apithreshold`). The app treats oci as installable (`docker run -i --rm ...`, screenshot-less, text captured), so no live entry reaches the coded unsupported message. The coded message and the transport-failure coded message (`MCP_NO_INSTALL_SOURCE` and similar) were therefore not rendered. Unit tests or a fixture would be needed (fixtures exist in `.ptah/specs/TASK_2026_859_b561/fixtures/`, e.g. `detail-mcpb.json`); I did not use a fetch shim. This is the one gap in the verification.

## Prototype fidelity

- Approved prototype: None for this task (bugfix of existing surface).
- Fidelity: NOT APPLICABLE. Before/after: the before state exists as text only (Phase D finding 8, no screenshot). The after state for dark, light and glass is in `screenshots/after-*-{dark,light,glass}.png`. Result: the regression is fixed in every captured pair; no visual regression in layout. Cards, spacing, badges and buttons match the rest of the Marketplace.

## Viewport results

| Viewport | Theme | Result |
| --- | --- | --- |
| 645x774 (narrow, glass) | ptah-glass | Panel and inputs fit, no horizontal scroll, input full width, wraps long command (spotdb docker line wraps cleanly). |
| 1365x982 | anubis, anubis-light | Grid reflows to 3 columns, panel spans full width, no overflow. |

An intermediate width was not opened (the Electron window is not resizable through CDP in this build). Sample is an audit selection.

## Accessibility audit

- Input height 32 px, above the 24 px AA target-size minimum. Input text on its background: dark L .93 on .19, light L .24 on .98: well above 4.5:1. Hint text 12 px: dark L .67 on dark panel about 5.8:1; light L .49 on L .98 above 4.5:1. Install button text: dark white on blue about 5:1; light dark teal text on light teal above 4.5:1. Contrast figures are estimates from computed OKLCH, not a tool measurement.
- Password type confirmed on the secret input; value never present in the DOM text or HTML.
- Disabled Install state is a real `disabled` attribute (verified true / false). No visual explanation of why it is disabled (no helper text) - minor UX note.
- Focus ring: see M2.

## Verdict

- Recommendation: APPROVE (PASS)
- Confidence: MEDIUM-HIGH (unsupported-entry message not rendered)
- Key concern: M1, the preview omits env/header entries so the redacted mask is never shown.
