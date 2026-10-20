# Ptah aurora surfaces — prototype B

Open `index.html` locally to navigate the four screens. Each page has a theme toggle. The setup page has three readiness previews; the chat page switches among six prompt categories; the boot page previews all five stages. The controls show intended layout and states only. They do not call the Electron host.

## Rationale

The background uses two slow color fields on a dark blue charcoal base, with warm gold as the visual anchor and lapis and teal as supporting light. Glass cards use an intentionally substantial fill, blur, a fine warm border, an inner highlight and a restrained shadow. This keeps small text legible while retaining depth. The light palette shifts to warm cream with dark ink and a darker gold for accessible copy. Local `ptah-icon.png` and inline 1.6px line SVGs avoid network assets and broken glyphs. Shared `tokens.css` holds the palette and material values.

## Tokens and implementation map

| Prototype token | Purpose | Angular / Tailwind / DaisyUI mapping |
| --- | --- | --- |
| `--base`, `--base-2`, `--base-3` | Background hierarchy | `bg-base-100`, `bg-base-200`, `bg-base-300` |
| `--ink`, `--muted` | Main and secondary text | `text-base-content`, `text-base-content-muted` |
| `--gold`, `--gold-strong` | Brand emphasis and headings | `secondary`, `secondary-focus` |
| `--lapis`, `--teal` | Supporting aurora and icon accents | `primary`, custom accent utility |
| `--glass-fill`, `--glass-soft`, `--glass-border`, `--glass-border-strong` | Card and tile material | theme-aware `.glass-panel` utility with CSS variables |
| `--blur`, `--shadow`, `--glow` | Translucency and depth | `backdrop-blur`, shadow utilities or shared material class |
| `--radius-xl`, `--radius-lg`, `--radius-md` | Cards, panels, tiles | `rounded-box`, `rounded-2xl`, `rounded-xl` |
| `--aurora-gold`, `--aurora-blue`, `--aurora-teal` | Slow decorative color fields | `AuroraEffectComponent` brand variant |
| `--focus` | Keyboard focus ring | `focus-visible:ring` theme token |

The dark base, blue primary and gold secondary follow the existing `anubis` theme. The light cream background and teal accent follow `anubis-light`; gold is darkened for legible light-theme text. Both variants keep text on glass surfaces solid and use opaque enough fills for contrast. The `prefers-reduced-motion` rule stops the aurora, orbit and transitions. `:focus-visible` gives every link and button a visible ring.

## Component correspondence

| Prototype | Existing component | Content / state correspondence |
| --- | --- | --- |
| `setup-card.html` | `ProjectSetupCardComponent` | Retains **Before you begin**, **Get ready**, subtitle, `0 of 2 ready`, Skills, Agents, Project scan, all row actions, setup tools, and compact **Ready** actions. Preview tabs show 0, 1 and all ready. The `+ New session` button represents its surrounding screen. Host actions and loading/error/no-folder states remain implementation concerns. |
| `welcome.html` | `ElectronWelcomeComponent` | Retains logo, exact title and description, Open Folder CTA, and the three feature titles/descriptions. |
| `empty-state.html` | `ChatEmptyStateComponent` + `PromptSuggestionsComponent` | Retains Ptah wordmark/tagline, Get Started, all six category names, and the source prompt titles, subtitles and command text. Build is selected initially. The optional `showProjectSetup` composition is shown as its own setup prototype. |
| `boot.html` | `BootProgressComponent` | Retains Ptah, exact five boot labels, current headline, elapsed seconds and done/active/pending states. Stage buttons are prototype controls; a real view would derive them from the host phase. Optional host detail and degraded/failed tint are accounted for in CSS, but no fabricated host message is displayed. |

## Decisions

- Used one shared stylesheet and local PNG so every page opens directly from disk without external assets.
- Used CSS variables on `:root` and `[data-theme]` for colors, radii, blur and glow, easing later translation into DaisyUI theme values and Tailwind utilities.
- Kept the setup component's all-ready state compact, matching its source rather than forcing all three rows to remain visible.
- Used plain buttons for host-dependent actions; the prototype does not claim an Electron action has occurred.
- Made category and boot preview controls interactive in minimal vanilla JS to demonstrate their real component states, with ARIA selection/pressed state exposed.
- Used inline SVG line icons instead of the existing hieroglyph category glyphs, while preserving the category names and prompt content.
