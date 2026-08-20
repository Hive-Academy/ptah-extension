# Ptah — 80s Sizzle Trailer Storyboard

Top-of-funnel hook cut for X / LinkedIn / YouTube / Shorts (16:9 master; 9:16 crop noted per shot).
Target: **80 seconds**, 8 beats. Every clip is pulled from an existing rendered tour — no re-capture needed for the master edit.

Source MP4s live at `dist/apps/ptah-electron-e2e/recordings/<scene>/out/<scene>.mp4`.

---

## Structure (problem → 5 proofs → payoff)

| #   | t (in→out) | Source clip       | In/out of source                                           | On-screen                                                                 | VO / caption                                                                 |
| --- | ---------- | ----------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| 1   | 0:00–0:07  | landing-page-tour | 0:00–0:07                                                  | Ptah wordmark reveal                                                      | "Your AI coding assistant forgets everything the moment you close the chat." |
| 2   | 0:07–0:22  | canvas-orchestra  | ~0:07–0:20 (three tiles live) + a beat of the parallel run | Kicker: **3 agents. One screen.**                                         | "Stop chatting with one AI — start conducting three, live, on one codebase." |
| 3   | 0:22–0:34  | chat-code-edit    | the "make the change" → diff appears moment                | Kicker: **It edits your files.**                                          | "Just say 'make the change.' It edits the file and shows the diff."          |
| 4   | 0:34–0:46  | tribunal-tour     | ~0:15–0:27 (rival bench + convene)                         | Kicker: **Rival models, on purpose.**                                     | "Rival AI models check each other — so you don't have to."                   |
| 5   | 0:46–0:57  | memory-recall     | ~0:15–0:28 (three tiers / recall)                          | Kicker: **It remembers.**                                                 | "Persistent memory across every session. Explain your codebase once."        |
| 6   | 0:57–1:07  | cron-tour         | ~0:15–0:27 (schedule list / next-fire)                     | Kicker: **Works while you sleep.**                                        | "Schedule agents like cron jobs. Your night shift, automated."               |
| 7   | 1:07–1:16  | gateway-tour      | ~0:12–0:21 (Telegram/Discord/Slack)                        | Kicker: **Drive it from your pocket.**                                    | "Kick off work from Telegram, Discord, or Slack — anywhere."                 |
| 8   | 1:16–1:20  | landing-page-tour | end card (2:59–3:06)                                       | **It remembers. It learns. It ships.** + `ptah.live` · 100-day free trial | "Ptah — the AI coding orchestra. Start free at ptah.live."                   |

## Grade & audio

- **Cuts:** hard cuts on the beat; 3–4 frame dip-to-black only between #1→#2 and #7→#8.
- **Kickers:** amber (brand accent), bottom-third, in/out with a 6-frame slide; match the tours' caption font.
- **Music:** single driving bed, ~120–128 BPM, one build that peaks on the #8 logo lockup. Duck −12 dB under any retained VO.
- **VO:** either (a) reuse the original ElevenLabs narration snippets from each scene's `wav/`, or (b) record one fresh continuous VO from the captions above for a tighter through-line (recommended).
- **9:16 crop:** center-punch on the active tile/panel each shot; move the kicker to lower-center. Canvas (#2) crop to a single running tile, not the full grid.

## How to produce it

The showcase pipeline renders **one scene from its own capture** — it has no native "supercut" mode. Two paths:

1. **Editor assembly (fastest, recommended for v1):** import the 8 source MP4s into any NLE (or `ffmpeg`), trim to the in/out points above, add kickers + music. Fully deterministic from assets that already exist.
2. **Native pipeline (for a fully on-brand render):** author a new `sizzle.scene.ts` that drives the app through these 7 surfaces quickly, plus `scripts/sizzle.json` narration, then `narrate` → `render-all.mjs --scene sizzle`. Heavier: needs the app running + an ElevenLabs key, but yields camera/caption/brand consistency and re-renders endlessly.

Vertical variants render from the same manifest by switching the output aspect.
