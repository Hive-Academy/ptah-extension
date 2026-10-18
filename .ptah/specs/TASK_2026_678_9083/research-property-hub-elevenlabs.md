# Property-hub ElevenLabs inventory — TASK_2026_678_9083

## 1. Every matching file

**Scope and method.** Case-insensitive literal search for `elevenlabs|xi-api-key|convai|@11labs|@elevenlabs` with hidden and ignored files included; only `node_modules`, `dist`, and `.git` excluded. This found **672 files**: 84 in the main checkout and 588 in eight `.claude-worktrees` copies. A hit is a text mention, not necessarily executable integration. The main-checkout inventory below gives the first hit line in every file. Secret-bearing `.env` files were counted but their contents were not opened.

**Worktree expansion (accounts for all 588 other files).** Take every main-checkout path below **except** these 10 root-only paths: `.env`, `apps/pro-estate-video-studio/.env`, `.claude/skills/video-showcase/SKILL.md`, `.claude/skills/video-showcase/reference/install.md`, `.claude/skills/video-showcase/reference/camera-and-render.md`, `.nx/cache/terminalOutputs/6824805105562734734`, `tmp/static/environment.js`, `tmp/tribunal/agent-output-05648be7-6c73-4d78-83fd-d1db4b18ef78.md`, `tmp/tribunal/agent-output-11ed4d9a-7ece-4547-b329-0aa9bed5777b.md`, `tmp/zmtest/remote/ai-agent.zmodel`. Prefix those remaining 74 relative paths with each absolute worktree path below. Four 73-file worktrees omit `.nx/workspace-data/file-map.json`. This defines every matching absolute path without repeating generated copies; line numbers below are evidence for the main checkout only, since worktree versions can differ.

| Worktree prefix (absolute) | Hits | Omission |
| --- | ---: | --- |
| D:/projects/property-hub/.claude-worktrees/agent-a97c6cda61f8c086a | 74 | — |
| D:/projects/property-hub/.claude-worktrees/agent-a9e9ca02d7a968461 | 74 | — |
| D:/projects/property-hub/.claude-worktrees/agent-ac44a570d6a2f8612 | 73 | file-map.json |
| D:/projects/property-hub/.claude-worktrees/agent-ad78e6a03067855be | 73 | file-map.json |
| D:/projects/property-hub/.claude-worktrees/agent-ad848a1738661d074 | 74 | — |
| D:/projects/property-hub/.claude-worktrees/agent-adc33ebe46177c13d | 73 | file-map.json |
| D:/projects/property-hub/.claude-worktrees/agent-ae5b1ff787da81e11 | 73 | file-map.json |
| D:/projects/property-hub/.claude-worktrees/agent-af4afb212edc3f34f | 74 | — |

**Main checkout, first match per file** (absolute `file:line`):
- `D:/projects/property-hub/.claude/skills/video-showcase/reference/camera-and-render.md:82`
- `D:/projects/property-hub/.claude/skills/video-showcase/reference/install.md:91`
- `D:/projects/property-hub/.claude/skills/video-showcase/SKILL.md:35`
- `D:/projects/property-hub/.env:222`
- `D:/projects/property-hub/.env.example:306`
- `D:/projects/property-hub/.nx/cache/terminalOutputs/6824805105562734734:7`
- `D:/projects/property-hub/.nx/workspace-data/file-map.json:19486`
- `D:/projects/property-hub/apps/admin/src/assets/i18n/ar.json:1570`
- `D:/projects/property-hub/apps/admin/src/assets/i18n/en.json:1748`
- `D:/projects/property-hub/apps/admin-e2e/src/showcase-live/SCENES.md:64`
- `D:/projects/property-hub/apps/api/test-live/ai-agent/coach-voice.live-spec.ts:11`
- `D:/projects/property-hub/apps/pro-estate-video-studio/.env:21`
- `D:/projects/property-hub/apps/pro-estate-video-studio/.env.example:21`
- `D:/projects/property-hub/apps/pro-estate-video-studio/promos/ads-ar.json:6`
- `D:/projects/property-hub/apps/pro-estate-video-studio/promos/ads-en.json:6`
- `D:/projects/property-hub/apps/pro-estate-video-studio/promos/ai-concierge-ar.json:6`
- `D:/projects/property-hub/apps/pro-estate-video-studio/promos/ai-concierge-en.json:6`
- `D:/projects/property-hub/apps/pro-estate-video-studio/promos/ai-copilot-ar.json:6`
- `D:/projects/property-hub/apps/pro-estate-video-studio/promos/ai-copilot-en.json:6`
- `D:/projects/property-hub/apps/pro-estate-video-studio/promos/automations-ar.json:6`
- `D:/projects/property-hub/apps/pro-estate-video-studio/promos/automations-en.json:6`
- `D:/projects/property-hub/apps/pro-estate-video-studio/promos/broadcasts-ar.json:6`
- `D:/projects/property-hub/apps/pro-estate-video-studio/promos/broadcasts-en.json:6`
- `D:/projects/property-hub/apps/pro-estate-video-studio/promos/contacts-ar.json:6`
- `D:/projects/property-hub/apps/pro-estate-video-studio/promos/contacts-en.json:6`
- `D:/projects/property-hub/apps/pro-estate-video-studio/promos/dashboard-ar.json:6`
- `D:/projects/property-hub/apps/pro-estate-video-studio/promos/dashboard-en.json:6`
- `D:/projects/property-hub/apps/pro-estate-video-studio/promos/inbox-ar.json:6`
- `D:/projects/property-hub/apps/pro-estate-video-studio/promos/inbox-en.json:6`
- `D:/projects/property-hub/apps/pro-estate-video-studio/promos/leads-ar.json:6`
- `D:/projects/property-hub/apps/pro-estate-video-studio/promos/leads-en.json:6`
- `D:/projects/property-hub/apps/pro-estate-video-studio/promos/opportunities-ar.json:6`
- `D:/projects/property-hub/apps/pro-estate-video-studio/promos/opportunities-en.json:6`
- `D:/projects/property-hub/apps/pro-estate-video-studio/promos/page-builder-ar.json:6`
- `D:/projects/property-hub/apps/pro-estate-video-studio/promos/page-builder-en.json:6`
- `D:/projects/property-hub/apps/pro-estate-video-studio/promos/projects-ar.json:6`
- `D:/projects/property-hub/apps/pro-estate-video-studio/promos/projects-en.json:6`
- `D:/projects/property-hub/apps/pro-estate-video-studio/promos/properties-ar.json:6`
- `D:/projects/property-hub/apps/pro-estate-video-studio/promos/properties-en.json:6`
- `D:/projects/property-hub/apps/pro-estate-video-studio/promos/regions-ar.json:6`
- `D:/projects/property-hub/apps/pro-estate-video-studio/promos/regions-en.json:6`
- `D:/projects/property-hub/apps/pro-estate-video-studio/promos/social-ar.json:6`
- `D:/projects/property-hub/apps/pro-estate-video-studio/promos/social-en.json:6`
- `D:/projects/property-hub/apps/pro-estate-video-studio/promos/team-ar.json:6`
- `D:/projects/property-hub/apps/pro-estate-video-studio/promos/team-en.json:6`
- `D:/projects/property-hub/apps/pro-estate-video-studio/promos/whatsapp-flows-ar.json:6`
- `D:/projects/property-hub/apps/pro-estate-video-studio/promos/whatsapp-flows-en.json:6`
- `D:/projects/property-hub/apps/pro-estate-video-studio/README.md:65`
- `D:/projects/property-hub/apps/pro-estate-video-studio/scripts/narrate.mjs:15`
- `D:/projects/property-hub/apps/pro-estate-video-studio/scripts/paths.mjs:42`
- `D:/projects/property-hub/apps/pro-estate-video-studio/scripts/render-all.mjs:144`
- `D:/projects/property-hub/apps/pro-estate-video-studio/scripts/render-promo.mjs:140`
- `D:/projects/property-hub/apps/pro-estate-video-studio/src/concept/scene-kit.tsx:122`
- `D:/projects/property-hub/apps/pro-estate-video-studio/src/PromoReel.tsx:108`
- `D:/projects/property-hub/docker-compose.yml:133`
- `D:/projects/property-hub/libs/admin/feature-ai-agent/src/lib/chat-panel/chat-panel.component.ts:51`
- `D:/projects/property-hub/libs/admin/feature-ai-agent/src/lib/voice/voice-api.service.spec.ts:61`
- `D:/projects/property-hub/libs/admin/feature-ai-agent/src/lib/voice/voice-api.service.ts:7`
- `D:/projects/property-hub/libs/admin/feature-ai-agent/src/lib/voice/voice-session.service.ts:46`
- `D:/projects/property-hub/libs/admin/feature-settings/src/lib/ai-agent-settings.component.ts:66`
- `D:/projects/property-hub/libs/api/coach-agent/src/lib/coach-agent.module.ts:13`
- `D:/projects/property-hub/libs/api/coach-agent/src/lib/voice/coach-voice.controller.spec.ts:8`
- `D:/projects/property-hub/libs/api/coach-agent/src/lib/voice/coach-voice.controller.ts:3`
- `D:/projects/property-hub/libs/api/coach-agent/src/lib/voice/dto/tts-request.dto.ts:6`
- `D:/projects/property-hub/libs/api/coach-agent/src/lib/voice/elevenlabs.client.spec.ts:1`
- `D:/projects/property-hub/libs/api/coach-agent/src/lib/voice/elevenlabs.client.ts:1`
- `D:/projects/property-hub/libs/api/coach-agent/src/lib/voice/kokoro-http.provider.spec.ts:12`
- `D:/projects/property-hub/libs/api/coach-agent/src/lib/voice/kokoro-http.provider.ts:7`
- `D:/projects/property-hub/libs/api/coach-agent/src/lib/voice/voice.constants.ts:4`
- `D:/projects/property-hub/libs/api/coach-agent/src/lib/voice/voice-provider.port.ts:5`
- `D:/projects/property-hub/libs/api/coach-agent/src/lib/voice/voice-provider.selector.spec.ts:7`
- `D:/projects/property-hub/libs/api/coach-agent/src/lib/voice/voice-provider.selector.ts:9`
- `D:/projects/property-hub/libs/api/coach-agent/src/lib/voice/voice-usage.service.ts:6`
- `D:/projects/property-hub/libs/api/coach-agent/src/lib/voice/whisper-http.provider.spec.ts:11`
- `D:/projects/property-hub/libs/api/coach-agent/src/lib/voice/whisper-http.provider.ts:9`
- `D:/projects/property-hub/libs/api/organizations/src/lib/organizations.service.spec.ts:1531`
- `D:/projects/property-hub/libs/api/organizations/src/lib/organizations.service.ts:285`
- `D:/projects/property-hub/libs/common/data-access-orm/schemas/system.zmodel:454`
- `D:/projects/property-hub/libs/common/models/src/lib/organization.interface.ts:91`
- `D:/projects/property-hub/libs/shared/contracts/coach/src/lib/coach.contracts.ts:85`
- `D:/projects/property-hub/tmp/static/environment.js:21`
- `D:/projects/property-hub/tmp/tribunal/agent-output-05648be7-6c73-4d78-83fd-d1db4b18ef78.md:103`
- `D:/projects/property-hub/tmp/tribunal/agent-output-11ed4d9a-7ece-4547-b329-0aa9bed5777b.md:103`
- `D:/projects/property-hub/tmp/zmtest/remote/ai-agent.zmodel:287`

## 2. SDK packages and versions

**Verified:** Neither `package.json`'s dependency lists nor `package-lock.json` has `@elevenlabs`, `@11labs`, `elevenlabs`, or `convai` packages (searched both files). Thus there is **no ElevenLabs client or server SDK version to port**. The backend uses native `fetch`, `FormData`, and `Blob` in [elevenlabs.client.ts](D:/projects/property-hub/libs/api/coach-agent/src/lib/voice/elevenlabs.client.ts:102); the Angular client uses its existing `BaseApiService` in [voice-api.service.ts](D:/projects/property-hub/libs/admin/feature-ai-agent/src/lib/voice/voice-api.service.ts:12). This is an absence finding from the checked manifest and lockfile, not a claim about unexamined worktree manifests.

## 3. Session architecture

**Verified:** This is **not an ElevenLabs Conversational AI session**. A user toggles the mic in [chat-panel.component.ts](D:/projects/property-hub/libs/admin/feature-ai-agent/src/lib/chat-panel/chat-panel.component.ts:72); [voice-session.service.ts](D:/projects/property-hub/libs/admin/feature-ai-agent/src/lib/voice/voice-session.service.ts:100) requests `getUserMedia`, records utterance blobs with `MediaRecorder` (lines 128–155), posts STT, sends the transcript to the app's Coach agent (lines 182–222), then speaks returned token chunks via TTS (lines 227–263). The browser's only voice endpoints are `POST /coach/voice/stt` and `POST /coach/voice/tts`, plus a provider list ([voice-api.service.ts](D:/projects/property-hub/libs/admin/feature-ai-agent/src/lib/voice/voice-api.service.ts:18)). The server calls fixed-host ElevenLabs REST STT and streaming TTS endpoints ([elevenlabs.client.ts](D:/projects/property-hub/libs/api/coach-agent/src/lib/voice/elevenlabs.client.ts:113), [same file](D:/projects/property-hub/libs/api/coach-agent/src/lib/voice/elevenlabs.client.ts:152)). No signed URL, conversation token, public agent ID, WebRTC, or ElevenLabs WebSocket is present in this path; no backend token minting endpoint was found. The application agent's own stream is separate from ElevenLabs.

The platform key is read server-side from `ELEVENLABS_API_KEY` in [coach-agent.module.ts](D:/projects/property-hub/libs/api/coach-agent/src/lib/coach-agent.module.ts:65). A per-organization key can override it in [voice-provider.selector.ts](D:/projects/property-hub/libs/api/coach-agent/src/lib/voice/voice-provider.selector.ts:139). `xi-api-key` is sent only by the server's STT/TTS client ([elevenlabs.client.ts](D:/projects/property-hub/libs/api/coach-agent/src/lib/voice/elevenlabs.client.ts:113), lines 158–166).

## 4. Client tools, server tools, and live updates

**Verified:** There are **no ElevenLabs Conversational AI client tools, server tool webhooks, ConvAI tool schemas, tool results, `sendUserMessage`, or contextual-update calls** in the integration. The Coach's functions are local application-agent tools assembled as `flatTools` in [coach-agent.service.ts](D:/projects/property-hub/libs/api/coach-agent/src/lib/coach-agent.service.ts:88), then passed to `AgentService.streamCustomerResponse` (lines 105–124). Their results return through that agent's app stream, not an ElevenLabs voice agent.

The voice session submits the STT transcript with `store.sendMessage(transcript, undefined, 'voice')` and claims its thread ([voice-session.service.ts](D:/projects/property-hub/libs/admin/feature-ai-agent/src/lib/voice/voice-session.service.ts:209)). [agent-chat.store.ts](D:/projects/property-hub/libs/admin/feature-ai-agent/src/lib/stores/agent-chat.store.ts:682) taps token/done/error events only for that claimed thread; the voice session sentence-chunks tokens and sends each sentence to TTS ([voice-session.service.ts](D:/projects/property-hub/libs/admin/feature-ai-agent/src/lib/voice/voice-session.service.ts:227)). Fresh personal/team context is injected on each Coach turn through the application's `memoryContext` seam ([coach-agent.service.ts](D:/projects/property-hub/libs/api/coach-agent/src/lib/coach-agent.service.ts:69)); it is **not pushed into ElevenLabs**. Porting this to ElevenLabs Conversational AI would require a new session bridge and tool-result protocol.

## 5. Agent configuration

**Verified:** No ElevenLabs dashboard agent or API-created/updated ConvAI agent was found. The Coach's system prompt and voice register are code-owned in [coach-agent.constants.ts](D:/projects/property-hub/libs/api/coach-agent/src/lib/coach-agent.constants.ts:22) and passed to the application's agent service in [coach-agent.service.ts](D:/projects/property-hub/libs/api/coach-agent/src/lib/coach-agent.service.ts:85). The voice register asks for brief spoken Egyptian Arabic and a filler before tool calls. The ElevenLabs voice ID is server-fixed, default `qEQA7YHlwMCBoUeRCXlv`; STT model `scribe_v1`, TTS model `eleven_flash_v2_5`, MP3 `mp3_44100_128` ([voice.constants.ts](D:/projects/property-hub/libs/api/coach-agent/src/lib/voice/voice.constants.ts:65)); module environment overrides are at [coach-agent.module.ts](D:/projects/property-hub/libs/api/coach-agent/src/lib/coach-agent.module.ts:72). There is no ElevenLabs LLM choice, first message, or conversation override to copy; the application's model/provider selection belongs to its separate agent engine.

## 6. UI and conversation behavior

**Verified:** The mic is Coach-only and hidden when browser capture is unavailable or the server disabled voice ([chat-panel.component.ts](D:/projects/property-hub/libs/admin/feature-ai-agent/src/lib/chat-panel/chat-panel.component.ts:47)). `getUserMedia` requests echo cancellation/noise suppression, and denial shows a toast ([voice-session.service.ts](D:/projects/property-hub/libs/admin/feature-ai-agent/src/lib/voice/voice-session.service.ts:100)). Voice mode is a toggle with automatic VAD utterance boundaries, **not push-to-talk**: [vad.ts](D:/projects/property-hub/libs/admin/feature-ai-agent/src/lib/voice/vad.ts:63) uses RMS threshold 0.02, 120 ms start, 700 ms silence hangover, 50 ms sampling; [voice-session.service.ts](D:/projects/property-hub/libs/admin/feature-ai-agent/src/lib/voice/voice-session.service.ts:148) hooks its speech events. The panel HUD displays listening/thinking/speaking/error state, animated orb, and exit button ([voice-mode.component.ts](D:/projects/property-hub/libs/admin/feature-ai-agent/src/lib/voice/voice-mode.component.ts:20)); the message transcript stays in normal chat bubbles ([chat-panel.component.html](D:/projects/property-hub/libs/admin/feature-ai-agent/src/lib/chat-panel/chat-panel.component.html:16)). The HUD itself has no live transcript text or waveform/audio-level visualization.

Barge-in stops queued audio and re-arms listening on VAD speech-start while speaking ([voice-session.service.ts](D:/projects/property-hub/libs/admin/feature-ai-agent/src/lib/voice/voice-session.service.ts:148), [tts-playback-queue.ts](D:/projects/property-hub/libs/admin/feature-ai-agent/src/lib/voice/tts-playback-queue.ts:74)). A 4-second filler TTS timer covers slow first response ([voice-session.service.ts](D:/projects/property-hub/libs/admin/feature-ai-agent/src/lib/voice/voice-session.service.ts:280)). Permission/STT failure tears down mic, VAD, and audio, enters recoverable `error`, and `start()` retries ([voice-session.service.ts](D:/projects/property-hub/libs/admin/feature-ai-agent/src/lib/voice/voice-session.service.ts:307)). There is no WebSocket reconnect flow because no ElevenLabs live socket exists. **Inference:** `bargeIn()` stops playback, but outstanding TTS HTTP subscriptions are not cancelled in that method (lines 158–161, 248–263); a late prior-turn blob could be enqueued after interruption. Verify with a delayed-TTS interruption test before reusing this behavior.

## 7. Costs, limits, environment, secrets

**Verified:** Controller guards require JWT, organization, role, and voice rate limit ([coach-voice.controller.ts](D:/projects/property-hub/libs/api/coach-agent/src/lib/voice/coach-voice.controller.ts:74)). Redis guard defaults to 30 STT and 120 TTS calls per user/org per minute; production rejects if Redis is unavailable ([coach-voice-rate-limit.guard.ts](D:/projects/property-hub/libs/api/coach-agent/src/lib/guards/coach-voice-rate-limit.guard.ts:30), lines 80–115). Audio uploads cap at 10 MB and TTS requests at 500 characters ([voice.constants.ts](D:/projects/property-hub/libs/api/coach-agent/src/lib/voice/voice.constants.ts:88)); controller validates MIME ([coach-voice.controller.ts](D:/projects/property-hub/libs/api/coach-agent/src/lib/voice/coach-voice.controller.ts:205)). Metering records STT seconds and TTS characters best-effort, with monthly aggregation for a future quota guard ([voice-usage.service.ts](D:/projects/property-hub/libs/api/coach-agent/src/lib/voice/voice-usage.service.ts:23), lines 55–76). No enforced monthly spend/quota cap was found in this path.

Server env example documents `ELEVENLABS_API_KEY`, `PH_ELEVENLABS_VOICE_ID`, `ELEVENLABS_STT_MODEL`, and `ELEVENLABS_TTS_MODEL` ([.env.example](D:/projects/property-hub/.env.example:306)); [coach-agent.module.ts](D:/projects/property-hub/libs/api/coach-agent/src/lib/coach-agent.module.ts:65) reads them. Org settings can carry a bring-your-own key; API responses replace the key with `elevenLabsApiKeySet` ([organizations.service.ts](D:/projects/property-hub/libs/api/organizations/src/lib/organizations.service.ts:284)), and blank updates retain the stored key (lines 298–327). The reference stores this field in org settings; storage encryption was not established from the examined code. The upstream client uses a fixed host and strips key occurrences from network errors ([elevenlabs.client.ts](D:/projects/property-hub/libs/api/coach-agent/src/lib/voice/elevenlabs.client.ts:203)). A missing key returns typed `VOICE_DISABLED` 503 ([coach-voice.controller.ts](D:/projects/property-hub/libs/api/coach-agent/src/lib/voice/coach-voice.controller.ts:229)).

## 8. Property-hub-specific versus reusable

The Sales Coach persona, Egyptian Arabic directive, CRM grounding/memory tools, organization/rep scoping, tenant key storage, Nest guards/Prisma metering, and `/coach/voice/*` routes are property-hub-specific ([coach-agent.service.ts](D:/projects/property-hub/libs/api/coach-agent/src/lib/coach-agent.service.ts:80), [coach-voice.controller.ts](D:/projects/property-hub/libs/api/coach-agent/src/lib/voice/coach-voice.controller.ts:74)). The VAD interface/energy detector, state-machine pattern, sentence chunker, playback queue, and minimal state HUD are conceptually reusable; they still need Ptah host/RPC integration and interruption review.

## Portability to Ptah

| Piece | Property-hub location | Reuse | Notes |
| --- | --- | --- | --- |
| ElevenLabs STT/TTS HTTP client | D:/projects/property-hub/libs/api/coach-agent/src/lib/voice/elevenlabs.client.ts:102 | Already exists in Ptah | Ptah has its own `ElevenLabsClient` with STT/TTS at D:/projects/ptah-extension/.claude-worktrees/command-center/libs/backend/voice-providers/src/lib/elevenlabs/elevenlabs-client.ts:112; use host voice RPC rather than importing the Nest client. |
| Secret storage | D:/projects/property-hub/libs/api/coach-agent/src/lib/coach-agent.module.ts:65 | Already exists in Ptah | Ptah `VoiceSecretStore` holds ciphertext at D:/projects/ptah-extension/.claude-worktrees/command-center/libs/backend/voice-providers/src/lib/voice-secret-store.ts:3. |
| Mic/VAD state machine | D:/projects/property-hub/libs/admin/feature-ai-agent/src/lib/voice/voice-session.service.ts:54; D:/projects/property-hub/libs/admin/feature-ai-agent/src/lib/voice/vad.ts:51 | Adapt | Angular signals fit, but bind to Ptah page lifecycle and host RPC; test delayed audio after barge-in. |
| Chunking/playback/HUD | D:/projects/property-hub/libs/admin/feature-ai-agent/src/lib/voice/sentence-chunker.ts:1; D:/projects/property-hub/libs/admin/feature-ai-agent/src/lib/voice/tts-playback-queue.ts:50; D:/projects/property-hub/libs/admin/feature-ai-agent/src/lib/voice/voice-mode.component.ts:15 | Adapt | No canvas rendering or live waveform to port. |
| Voice HTTP service | D:/projects/property-hub/libs/admin/feature-ai-agent/src/lib/voice/voice-api.service.ts:15 | Rewrite | Ptah has `VoiceRpcHandlers` at D:/projects/ptah-extension/.claude-worktrees/command-center/libs/backend/rpc-handlers/src/lib/handlers/voice-rpc.handlers.ts:472. |
| Coach stream/tool tap | D:/projects/property-hub/libs/api/coach-agent/src/lib/coach-agent.service.ts:88; D:/projects/property-hub/libs/admin/feature-ai-agent/src/lib/stores/agent-chat.store.ts:682 | Rewrite | Replace CRM Coach threads/tools with Ptah CLI agent/session/MCP orchestration and progress events. |
| Conversational AI live session/tools | No implementation in property-hub; REST calls at D:/projects/property-hub/libs/api/coach-agent/src/lib/voice/elevenlabs.client.ts:8 | New implementation | No signed URL, client/server ConvAI tool flow, contextual update channel, or ElevenLabs agent configuration is supplied by the reference. |
| Rate limit/metering | D:/projects/property-hub/libs/api/coach-agent/src/lib/guards/coach-voice-rate-limit.guard.ts:30; D:/projects/property-hub/libs/api/coach-agent/src/lib/voice/voice-usage.service.ts:23 | Adapt | Design limits for Ptah's host and ElevenLabs conversation billing; Nest/Redis/Prisma implementation is tied to property-hub. |

## Decisions

- **Evidence-based recommendation, architect to decide:** treat property-hub as a reference for mic capture, VAD, speech UX, and error handling; build the requested ElevenLabs Conversational AI session/tool integration separately. Alternatives considered: port its STT/TTS loop as the Command Center voice backend, or use ConvAI for the live voice agent. The former is simpler and reversible but does not provide an ElevenLabs voice agent or its client/server tools. Evidence: REST-only calls at D:/projects/property-hub/libs/api/coach-agent/src/lib/voice/elevenlabs.client.ts:8 and the local tool path at D:/projects/property-hub/libs/api/coach-agent/src/lib/coach-agent.service.ts:88.
- **Evidence-based recommendation, architect to decide:** use Ptah's existing voice providers/secret store rather than transplanting property-hub's Nest proxy. Evidence: D:/projects/ptah-extension/.claude-worktrees/command-center/libs/backend/voice-providers/src/lib/elevenlabs/elevenlabs-client.ts:112 and D:/projects/ptah-extension/.claude-worktrees/command-center/libs/backend/voice-providers/src/lib/voice-secret-store.ts:3. Reversible.

## Open Questions

- Which ElevenLabs Conversational AI transport and authentication mode suits the VS Code webview, Electron, and CLI hosts? This reference has none. Smallest experiment: a one-host authenticated session prototype.
- Can Ptah's CLI agent/session tool calls safely be exposed as ElevenLabs client tools, server webhooks, or a host-mediated bridge, with progress pushed into an active voice session? This reference has no applicable tool schema. Smallest experiment: one read-only status tool and one progress update.
- What budget and turn-duration cap should apply to live voice sessions? Property-hub meters STT/TTS units but provides no ConvAI budget precedent.

