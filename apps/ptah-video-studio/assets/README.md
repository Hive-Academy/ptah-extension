# Sound-design assets (optional)

`render-all.mjs` layers subtle sound design onto the showcase video **only when
these files exist**. They are optional — if a file is missing, the render simply
proceeds without that audio (it never fails). See `src/components/SoundDesign.tsx`
for the mixing logic and `scripts/render-all.mjs` (`stageSoundAssets`) for how
they are served.

## Expected files

| Path                    | Role                                                           | Target level |
| ----------------------- | -------------------------------------------------------------- | ------------ |
| `assets/sfx/whoosh.mp3` | Whoosh triggered at each camera punch-in (shot focus change).  | ~0.35        |
| `assets/music/bed.mp3`  | Low music bed looped/trimmed under the whole VO, faded in/out. | ~0.08        |

- **whoosh.mp3** — a short (~300–600ms) airy transition whoosh. One-shot; it is
  placed at every shot boundary whose focus actually changes.
- **bed.mp3** — an ambient / lo-fi / cinematic underscore. Any length: it is
  looped and trimmed to the composition duration, with a ~900ms fade in and out.
  Keep it low-energy and non-distracting so it sits under the narration.

## How they're served

Remotion's `staticFile()` resolves against `--public-dir` (the per-scene
recording dir), and rejects absolute `file://` paths. So at render time
`render-all.mjs` copies whichever of these files exist into
`<sceneDir>/_sfx/{whoosh,bed}.mp3` and hands the composition those relative
names. Nothing to configure — drop the files here and re-render.

## Recommended sources

Use royalty-free / CC0 audio you have the rights to ship:

- **Whooshes**: freesound.org (filter to CC0), Pixabay Sound Effects, or a
  Foley/whoosh pack (e.g. "transition whoosh", "swoosh").
- **Music beds**: Pixabay Music, Free Music Archive (CC0/CC-BY), Uppbeat, or
  YouTube Audio Library — pick "ambient", "lo-fi", or "cinematic underscore".

Verify licensing before committing any audio into the repo.
