# Music credits & licensing

Tracks in this folder are the promo background-music beds (see `render-promo.mjs`
→ `DEFAULT_MUSIC`). **Check each track's license before publishing** — some
require attribution.

| File              | Title       | Artist      | License   | Attribution required |
| ----------------- | ----------- | ----------- | --------- | -------------------- |
| `rising-dawn.mp3` | Rising Dawn | Ethereal 88 | CC BY 4.0 | **Yes**              |

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
