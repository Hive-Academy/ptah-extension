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

## Synthesized effects (no third-party rights)

`pop.mp3` and `ring.mp3` are not sourced from anywhere — they are generated from
scratch by `ffmpeg`'s `aevalsrc` as decaying sine sums, so there is no licence to
honour and nothing to attribute. They exist because the self-shot pipeline cues
sound to the overlay ANIMATIONS (see `src/components/SoundDesign.tsx`), and the
Mixkit set had no card-arrival sound that sat under a voice without competing
with it.

| File       | Purpose                                        | Recipe                                                                       |
| ---------- | ---------------------------------------------- | ---------------------------------------------------------------------------- |
| `pop.mp3`  | Card / chip arrival — fires with the spring-in | 210 Hz body + 420 Hz harmonic + 1.4 kHz transient, exponential decay, 300 ms |
| `ring.mp3` | Stat count settling, highlight ring drawing    | 1046 Hz + 1568 Hz (C6 + G6, a fifth), exponential decay, 450 ms              |

Regenerate either with:

```bash
ffmpeg -f lavfi -i "aevalsrc='0.70*exp(-t*32)*sin(2*PI*210*t)+0.30*exp(-t*45)*sin(2*PI*420*t)+0.22*exp(-t*110)*sin(2*PI*1400*t)':d=0.30:s=48000:c=stereo" \
  -af "afade=t=in:st=0:d=0.004,alimiter=limit=0.95" -c:a libmp3lame -b:a 192k pop.mp3
ffmpeg -f lavfi -i "aevalsrc='0.45*exp(-t*18)*sin(2*PI*1046*t)+0.28*exp(-t*20)*sin(2*PI*1568*t)':d=0.45:s=48000:c=stereo" \
  -af "afade=t=in:st=0:d=0.004,alimiter=limit=0.95" -c:a libmp3lame -b:a 192k ring.mp3
```

The 4 ms fade-in is load-bearing: `aevalsrc` starts at full amplitude, and
without it every hit begins on a DC step that reads as a click.

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
