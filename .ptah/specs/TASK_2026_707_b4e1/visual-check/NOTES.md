# Electron visual check - TASK_2026_707_b4e1

Run 2026-10-20 on the `feat/voice-ripples` build (`build-dev` + `copy-renderer-dev`), Electron on
port 9334, throwaway HOME/APPDATA/user-data-dir/PTAH_DB_PATH and an empty temp workspace,
viewport 1440x900. Voice states were driven by calling the scene renderer's `setVoice` from the
page every 50 ms (no provider, no real turn). Root radius 77 px; crops are 340x340 around the root.

| State (level) | Ripples live | Result (dark and light) |
| --- | --- | --- |
| listening, speech-like 0.15-0.95 | 3 | Green rings outside the voice ring; visible in both themes |
| listening, loud 0.95 | 4 (cap) | Rings closer together; cap holds at 4 |
| speaking, speech-like | 2 | Amber rings around the dashed voice ring |
| speaking, quiet 0.12 | 0 | No rings; dashed voice ring alone (review item 8: reads as intended) |
| thinking | 1 | One soft breath ring around the rotating arc |
| idle | 0 | No rings |
| reduced motion (speaking, loud) | 0 | No rings |

- Draw placement after the sprite: no arc is hidden by the logo (review finding F5).
- Review item 6 (oldest ring dropped while faint at the loud cap) is not visible as a pop at
  this alpha; no change.
- Dark theme rings are quieter than light; kept as designed (alpha 0.10 + 0.30 * strength).
- Not seen live: real microphone level and real delegated work (the throwaway profile has no
  provider login; using the real profile needs the user's approval).
