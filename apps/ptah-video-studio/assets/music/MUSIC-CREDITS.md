# Music credits & licensing

Tracks in this folder are the promo background-music beds (see `render-promo.mjs`
→ `DEFAULT_MUSIC`). **Check each track's license before publishing** — some
require attribution.

| File                                 | Title                   | Source      | Length | License   | Attribution required |
| ------------------------------------ | ----------------------- | ----------- | ------ | --------- | -------------------- |
| `mixkit-digital-clouds.mp3`          | Digital Clouds          | Mixkit      | 1:41   | Mixkit    | No                   |
| `mixkit-better-times-are-coming.mp3` | Better Times Are Coming | Mixkit      | 1:40   | Mixkit    | No                   |
| `mixkit-minimal-emotion.mp3`         | Minimal Emotion         | Mixkit      | 2:00   | Mixkit    | No                   |
| `mixkit-uplifting-bass.mp3`          | Uplifting Bass          | Mixkit      | 1:36   | Mixkit    | No                   |
| `mixkit-close-up.mp3`                | Close Up                | Mixkit      | 1:35   | Mixkit    | No                   |
| `mixkit-deep-techno-ambience.mp3`    | Deep Techno Ambience    | Mixkit      | 2:03   | Mixkit    | No                   |
| `rising-dawn.mp3`                    | Rising Dawn             | Ethereal 88 | 1:10   | CC BY 4.0 | **Yes**              |

## Track length is a hard constraint

`PromoReel` loops the bed (`<Audio loop>`), so a track SHORTER than the finished
video repeats mid-reel with an audible seam. `rising-dawn.mp3` is **1:10** and
was looping under the 1:22 answer reel before anyone noticed. Check the track
length against the render before shipping:

```bash
node -e "…"   # or just: the render log prints the final duration
```

Every `mixkit-*` track above is 1:35 or longer, which clears a typical 60–90s promo.

## Mixkit License (the no-attribution option)

Mixkit tracks are free for commercial and personal projects with **no credit
required**. You may not resell or redistribute the tracks themselves, or use
them in a product whose main value is the music. Full terms:
<https://mixkit.co/license/#musicFree>

Downloaded from <https://mixkit.co/free-stock-music/>.

## Where to find more (no attribution required)

| Source                                              | Licence             | Notes                                                                                  |
| --------------------------------------------------- | ------------------- | -------------------------------------------------------------------------------------- |
| [Mixkit](https://mixkit.co/free-stock-music/)       | Mixkit Free         | Curated, quality over quantity. No credit. Direct mp3s.                                |
| [Pixabay Music](https://pixabay.com/music/)         | Pixabay Content     | 180k+ tracks, no credit, commercial OK. Quality varies; popular tracks are everywhere. |
| [Uppbeat](https://uppbeat.io/)                      | Freemium            | Free tier needs a credit; paid tier removes it. YouTube-safe.                          |
| [Chosic](https://www.chosic.com/free-music/)        | Mixed (CC0 / CC BY) | Filter for "no attribution" — per-track check required.                                |
| [Free Music Archive](https://freemusicarchive.org/) | Mixed CC            | Large, but check every track's licence individually.                                   |

**Avoid CC BY for paid ads** — the credit line is awkward on ad platforms. That
is why the default moved off `rising-dawn.mp3`.

## Attribution string (CC BY 4.0)

When a video uses `rising-dawn.mp3`, credit the artist somewhere associated with
the post (video description, caption, or end card):

> Music: "Rising Dawn" by Ethereal 88 — free-stock-music.com (CC BY 4.0)

Source: https://www.free-stock-music.com/music/ethereal88/mp3/ethereal88-rising-dawn.mp3

## Want zero-attribution audio (for paid ads)?

CC BY still requires a credit line, which is awkward on some ad platforms. For
truly attribution-free music, drop a **Pixabay-license** or **CC0** track into
this folder and point a spec at it:

```jsonc
// in a promo spec
"music": "my-pixabay-track.mp3"   // or "music": null to render silent (VO only)
```

Then set `DEFAULT_MUSIC` in `scripts/render-promo.mjs` if it should be the
campaign-wide default.
