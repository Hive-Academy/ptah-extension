# Sound-effect credits & licensing

Effects in this folder are the promo cut/accent sounds (see `PromoSoundDesign`
in `src/components/PromoSoundDesign.tsx` and `render-promo.mjs`'s
`stagePromoSfx()`). All sourced from Mixkit, trimmed with `ffmpeg` (short fade-
out, no other processing) for a punchier hit than the raw preview clips.

| File         | Source clip (Mixkit ID) | Purpose                                         | License        | Attribution required |
| ------------ | ----------------------- | ----------------------------------------------- | -------------- | -------------------- |
| `whoosh.mp3` | sfx/1461                | Slide + phase-cut transition burst              | Mixkit License | No                   |
| `tick.mp3`   | sfx/1109                | UI count-up / row-land accent                   | Mixkit License | No                   |
| `chime.mp3`  | sfx/2039                | Success beat (e.g. deal won, booking confirmed) | Mixkit License | No                   |

Source pages: https://mixkit.co/free-sound-effects/swoosh/,
https://mixkit.co/free-sound-effects/click/,
https://mixkit.co/free-sound-effects/success/

## License summary

Mixkit sound effects are free for commercial and personal use, no attribution
required, under the [Mixkit License](https://mixkit.co/license/#sfxFree). You
may not resell or redistribute the files as a standalone SFX/stock-asset
pack — using them baked into these rendered marketing videos is within terms.

## Want a different sound?

Drop a replacement file with the same name into this folder (`whoosh.mp3` /
`tick.mp3` / `chime.mp3`) — `render-promo.mjs`'s `stagePromoSfx()` picks up
whatever is present and gracefully no-ops if a file is missing, so nothing
breaks if you swap or remove one.
