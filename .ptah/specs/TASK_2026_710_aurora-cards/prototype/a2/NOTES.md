# Aurora cards — round 2 (prototype a2)

Open `index.html`. All files are self-contained (`tokens.css`, `kit.js`, `empty-data.js`, `ptah-icon.png`); no network. Dev toolbar (bottom) = state switcher, 600/760px column width, theme toggle. `?theme=light` also works.

## Design rationale
Round 1 kept the "panel of rows" structure and used a home-made blob backdrop. Round 2 reuses the app's real aurora and changes card *structure*:
- **Backdrop**: the CSS of `aurora-effect.component.ts` (stripe + colors layers, `aurora-shift` 60s, radial mask, `brand` variant) is copied into `tokens.css`; `oklch(var(--b1))` / `oklch(var(--s))` became literal `--b1` / `--s`. Opacity is lifted (dark .34, light .5 vs app .14/.24) so glass has something to refract. The same layer is also clipped inside hero cards (`.aurora.in-card`).
- **Cards**: true glass (`blur(18px) saturate(140%)`), inner highlight, layered shadows, conic **border beam** (`@property --ang`), cursor **spotlight** (`--x/--y`), glowing icon **medallions**, **progress ring / bar / step track**, filled-gold and glow-ghost buttons (no outline pills).

## Directions
| Surface | v1 | v2 |
|---|---|---|
| Setup card | Ring hero (0/1/2 of 2) + 2-col bento; Project scan is a wide beam tile | One glass card: aurora banner with big counter/bar, medallions on a glowing step rail, 3 pillars |
| Welcome | Centered logo with orbiting beam, 3-tile bento with raised featured middle | Split: tall hero card with in-card aurora + asymmetric tile cluster |
| Empty state | Row of 6 glowing medallions (beam on selected) + bento prompts (wide first) | Segmented glass control with sliding glowing thumb + featured tall tile / 2 / wide |
| Boot | Ring-progress orb with sweep + 5-stage medallion track | Console glass card, beam progress bar + stage checklist |

## Tokens (declared once in `tokens.css`, per `[data-theme]`)
Colour: `--b1 --b2 --s --gold-b --gold-t --lapis(-t) --teal(-t) --text --muted --on-gold --focus --ok`. Glass: `--glass --glass-2 --glass-brd --glass-hi --glass-shadow --spot --track --blur`. Aurora: `--aurora-o`. Shape: `--r-sm..xl`. Layout: `--col`.

## Mapping
- Setup → `project-setup-card.component.ts` (same strings; states 0/1/2 via `Ptah.setup()` in `kit.js`).
- Welcome → `electron-welcome.component.ts`; Empty → `chat-empty-state.component.ts` (6 categories, real SVG icons; prompt text is sample copy); Boot → `boot-progress.component.ts` (stages: Starting up, Opening the database, Syncing the agent harness, Importing sessions, Indexing the workspace).
- Tailwind/DaisyUI: tokens map to `bg-base-100`, `text-secondary` (gold); `.glass` → `bg-base-100/10 backdrop-blur-xl border border-secondary/20`; beam/spotlight need a small `@property` + CSS in a shared aurora-card directive.

## Decisions
- Reuse the real aurora verbatim; only token substitution and higher opacity for visibility.
- Gold text on dark glass uses `--gold-t` (lighter) and in light theme a dark amber `#7a5300` for WCAG AA; filled gold buttons carry dark `--on-gold` text.
- Focus ring is a 2px lapis outline, offset 3px, on every control.
- `prefers-reduced-motion`: all animations/transitions off (aurora, beams, pulses); boot pins stage 3 and stops cycling.
- Chat-column surfaces fit 600px (toggle 760px); under ~520px grids collapse to one column.
- Not verified in a browser (no run allowed); `color-mix`, `@property`, `mask-composite` require Chromium (Electron-safe). Gradient text (`.gold-text`) uses fixed colours that should be re-checked for AA in light theme.
- Prompt copy in the empty state and decorative chips/bars in welcome are placeholders, not source text.
