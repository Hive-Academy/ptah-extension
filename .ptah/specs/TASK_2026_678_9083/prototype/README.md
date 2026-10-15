# Command Center prototype — revision 3

Open `command-center.html` directly, or serve this folder with `python -m http.server 8765 --bind 127.0.0.1` and visit `http://127.0.0.1:8765/command-center.html`. It is one self-contained HTML file with inline CSS and JavaScript, no imports, CDN, backend, microphone access or network calls.

Use **Preview state** to inspect deterministic states, **Demo** to play the scripted voice sequence, the theme button for dark/light, drag the stage to tilt orbits, click a sphere or Tab through the mirrored list to select work, and use Mute, Stop, New/Resume and the text command form. The scripted demo runs: user command → Ptah planning → two CLI lanes and a Crucible → architecture completes and speaks a concise toast → release checks fail persistently → a separate OpenCode lane requests tool approval. Approve/Deny work by click and A/D keys when the card is open. The question card accepts typed input; voice response is illustrated by the voice HUD.

## Screenshot map

All PNGs are in `screenshots/`, captured at 1440×900 through `ptah_browser_navigate` and `ptah_browser_screenshot` against the local HTTP server.

| Preview | Dark | Light |
|---|---|---|
| Idle | `dark-idle.png` | `light-idle.png` |
| Demo with delegated work | `dark-mid-demo.png` | `light-mid-demo.png` |
| Persistent failure + tool approval | `dark-failed-approval.png` | `light-failed-approval.png` |
| Pending question | `dark-question.png` | `light-question.png` |
| Microphone denied | `dark-mic-denied.png` | `light-mic-denied.png` |
| Missing voice provider | `dark-missing-provider.png` | `light-missing-provider.png` |
| Tribunal terminal states | `dark-tribunal-terminal.png` | `light-tribunal-terminal.png` |
| 24 scene nodes | `dark-24-nodes.png` | `light-24-nodes.png` |
| Listening / thinking / speaking | `dark-listening.png`, `dark-thinking.png`, `dark-speaking.png` | `light-listening.png`, `light-thinking.png`, `light-speaking.png` |
| Muted / barge-in / voice error | `dark-muted.png`, `dark-barge-in.png`, `dark-error.png` | `light-muted.png`, `light-barge-in.png`, `light-error.png` |
| Stopped lane | `dark-stopped.png` | `light-stopped.png` |
| Transcription / playback / chat failure | `dark-transcription-error.png`, `dark-playback-error.png`, `dark-chat-error.png` | `light-transcription-error.png`, `light-playback-error.png`, `light-chat-error.png` |

The Preview menu also covers listening, thinking, transcription failure, playback failure and chat failure. Each state has its own HUD copy and recovery cue. The scene uses 24 total nodes in the stress preview: Ptah plus 23 delegates, including a Tribunal with three participant satellites and nested list rows. At 24 nodes the stage prioritizes Ptah, selected, awaiting and failed plates plus five other names; sphere and ring keep-outs hide any plate without a safe position. All 24 nodes remain in the keyboard list.

## Performance observation

After adding provider faces, headless Chromium on this machine, viewport 1440×900, stage backing 1044×654 at DPR 1: the 24-node preview measured **16–33 FPS** across two themes and three warm 2.2–3.0-second samples, with **p95 draw 2.6–3.7ms**. The earlier 41–47 FPS observation predates the brand faces and is superseded. This sample does not consistently clear the 30 FPS floor; browser scheduling affects frame cadence despite draw time staying below 4ms. These are headless browser observations, not Electron or integrated GPU results; Electron must pass p95 draw ≤8ms and the 30 FPS floor at N=24.

The meter averages 45 frame intervals, updates no more than twice per second, and reads `FPS idle` when rAF has stopped. An idle voice with no running work renders on demand. One visible canvas has DPR capped at 2. Sphere, glow and provider-face variants are cached in detached canvases; `Path2D` is created only on a cache miss. The hot loop uses `drawImage` with paths and DOM transforms, no gradients, `shadowBlur`, `fillText` or computed-style reads. Particle cap is 16. Visibility pauses the loop; reduced motion removes drift, particles and pulses. The prototype has no route lifecycle; Angular teardown is specified in `design-spec.md`.

## Revision 3 geometry

The N=24 stress frame uses eight inner and fifteen outer orbit positions fitted to the stage aspect ratio. Five separation passes enforce a 12px sphere gap plus a Ptah ring keep-out. Vendor families are color-coded as Codex blue, Grok teal, OpenCode plum, Antigravity red, Glm jade, child session silver and Tribunal gold. The provider's shipped brand path is inlaid on each CLI or child-session orb and used in its DOM chip/list row; Tribunal participants show parent provider marks and names. Provider ID wins over model name: a GLM lane on Ollama Cloud uses the Ollama mark; Z.ai uses `zdotai`. Unknown providers get a monogram tile. Ptah keeps its `P` orb. The prototype inlines a subset of the vendored TypeScript path data; production must keep path data in TypeScript per the Marketplace scanner note. Label placement tests four sides and rejects sphere/ring and label collisions. The same policy applies in both themes.

## Deviations

- The standalone file uses system serif/sans/mono fallbacks because it cannot load the product's Cinzel, Inter and JetBrains Mono font assets without imports. Production uses the app font stack.
- Light CSS hex values approximate the app's OKLCH `anubis-light` theme for the standalone HTML. The Angular implementation should resolve the actual theme values through CSS.
- The prototype simulates mic/TTS levels, status, recovery actions and session actions. It does not call chat RPC, store a real session or perform a real tool approval.

## Project rules applied

- [project-rule] Canvas 2D plus CSS transforms only; no graphics/3D libraries. Source: latest user direction in `context.md`.
- [project-rule] One ordinary Ptah chat session, Electron page, descendants only; main voice provider configuration. Source: `task-description.md` rev 3 and `context.md`.
- [project-rule] Tool approval by click/key, questions by voice or UI, separate Stop/Mute/barge-in semantics, text fallback and reduced motion. Source: `task-description.md` AC6, AC17–18, AC22–25.
- [project-rule] Dark/light theme colors, state inks and radii. Source: `apps/ptah-extension-webview/tailwind.config.js` and `.claude/skills/technical-content-writer/DESIGN-SYSTEM.md`.
- [project-rule] Revision 1 Serious findings resolved by DOM labels, expanded screenshots, 24-node scene, Tribunal participants and terminal states, and separate Ptah voice ring. Source: `design-spec-review.md`.
- [project-rule] Provider brand path data stays in TypeScript; the standalone prototype may inline it. Source: `libs/frontend/ui/src/lib/native/brand-mark/provider-brand-art.vendored.ts` header and the user request.

## Lane-introduced constraints

- [lane-proposed] 72px header, 336px desktop rail, 16px gap, 600px minimum desktop stage, stack below 720px; source: `design-spec.md` layout.
- [lane-proposed] Ptah 154px desktop / 124px narrow, delegate 58px nominal, Tribunal core 70px and branded satellites 25px; source: `design-spec.md` scene grammar.
- [lane-proposed] At 24 scene nodes, prioritize selected/awaiting/failed labels plus five other names, with sphere-aware collision rejection; use list/tooltip for every full name; source: N=24 visual collision test.
- [lane-proposed] Up to 24 scene nodes, 16 particles, 48 backdrop dots, DPR ≤2, 30 FPS floor and 60 FPS target; source: `design-spec.md` performance budget.
- [lane-proposed] Primary controls at least 44px, name plates collision-managed, one shared tooltip; source: `design-spec.md` accessibility/scene grammar.

No `parity-inventory.md` exists in this task folder; the binding parity source is `task-description.md` AC1–25. Gate 1.7 reviewer acceptance remains pending.

