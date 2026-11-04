# Prototype - provider-aware readiness (TASK_2026_864_1376)

Open `index.html` in a browser. `?theme=light` or `?theme=dark` (default dark), `?bare=1` hides the
prototype bar. Hand-written CSS in `assets/prototype.css` uses the real `ptah-glass` and
`ptah-glass-light` token values (reduced-transparency opaque mapping). Not production code.

Pages: `home.html`, `stage1-codex-main.html`, `stage1-fresh.html` (clickable choice and confirm),
`stage1-states.html`, `stage1-signin.html` (Codex sign-in states), `stage1-choice.html`, `settings.html`. Specification: `../design-spec.md`.

Known prototype approximations: in `stage1-fresh.html` the swap on "Use Codex" changes tags, borders and
disclosure state but does not re-render the help content; Lucide icons are inline SVG copies of the
same shapes; install commands for Codex are placeholders.

## Screenshots (`screenshots/`)

- stage1-codex-main-dark-1280.png, stage1-codex-main-light-800.png, stage1-codex-main-dark-400.png
- stage1-fresh-light-800.png, stage1-fresh-confirm-dark-1280.png
- stage1-states-light-1280.png, stage1-choice-dark-1280.png
- home-dark-1280.png (captured at an 800 px viewport; the browser session reused its first size), settings-light-800.png

Not captured: every page in both themes at both widths. Each page renders in both via `?theme=`.

## Revision 1 screenshots

`signin|states|home|settings` x `dark|light` x `800|1280`, named `<page>-<theme>-<width>.jpg`.

## Lane-introduced constraints

See `../design-spec.md` section "Lane-introduced constraints".
