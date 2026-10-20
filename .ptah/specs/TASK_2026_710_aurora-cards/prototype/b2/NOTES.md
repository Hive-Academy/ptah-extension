# Ptah Aurora / glass explorations, Round 2

## Decisions

- Theme values are `data-theme="dark"` and `data-theme="light"`. They map to the app's Anubis near black and warm gold, and a warm parchment light theme.
- The shared aurora copies the actual AuroraEffectComponent repeating stripe and color gradients, radial masks, two background size layers and 60 second aurora-shift animation. The OKLCH DaisyUI channel references map to literal Anubis colors in `tokens.css`. Board uses a 570px aurora; brand fills the scene.
- Glass has visible transparency, 22px backdrop blur, saturation, inner highlight, layered shadow, pointer spotlight and a conic border beam. At rest, text remains high contrast. Reduced motion disables all animation and transitions. Focus rings use the theme focus color.
- Setup v1 is a wide readiness hero and asymmetric bento; v2 is a vertical readiness rail beside compact task tiles. The floating developer button previews 0, 1 and 2 of 2 states, including the Ready / Run setup state. Both preserve Skills, Agents, Project scan, + New session and setup tools.
- Welcome v1 uses a horizontal gateway hero above an asymmetric feature bento. V2 uses a tall portal hero alongside a feature mosaic. Both preserve the Open Folder action and the three source feature names.
- Empty v1 uses a six choice medallion ribbon and an asymmetric prompt bento. V2 uses a category command rail and a different prompt masonry arrangement. Both use the existing prototype's source prompt title, subtitle and command data for all six categories.
- Boot v1 is a central halo with a horizontal stage track. V2 pairs a large brand panel with an illuminated step sequence. Both preserve all five stage labels and provide a developer stage preview.
- The theme and state controls live in a floating developer toolbar outside the product content. Buttons on prototype cards are visual previews; no host RPC is attached.

## Angular / Tailwind mapping

- `project-setup-card.component.ts`: readiness signal drives `--pct` for the ring and status tiles; retain existing action handlers. The chat wrapper remains at or below 720px.
- `electron-welcome.component.ts`: map the welcome hero and three feature records to CSS grid; retain `addFolder()`.
- `chat-empty-state.component.ts` and PromptSuggestions: map category selection and prompt records to the two arrangements, retaining `promptSelected`.
- `boot-progress.component.ts`: map `phase` and computed step states to the ring and track. Elapsed time comes from the existing component, not the static placeholder.
- `tokens.css` custom properties correspond to DaisyUI base/secondary and Tailwind utility families for colors, borders, shadows, radius and backdrop blur. The logo is local.
