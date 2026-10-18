# PR #735 review comments - follow-up PR list

Source: CodeRabbit review of `a608ce267` (2026-10-16 21:10 UTC): 11 inline comments + 2 nitpicks.
Greptile posted only "trial ended" (3x, no findings). GitGuardian: 1 incident (fake test key, dashboard action).
CodeRabbit skipped 186 files by path filters and processed 84.

| # | Sev | File:line | Finding | Fix direction |
| --- | --- | --- | --- | --- |
| 1 | Major | libs/frontend/command-center/src/lib/model/tribunal-run-coordinator.ts:174 | Confirm retry after a retryable failure (createTask / writeManifest / sendLaunchTurn) awaits `discoveryComplete()` again; no new pulse seq > boundarySeq, so the promise never settles and stays in `inFlight` | Record discovery completion on the entry; skip the wait on retry |
| 2 | Major | libs/frontend/command-center/src/lib/voice/vad.ts:73 | `EnergyVad.processFrame` resets `aboveSince` on any frame below speechThreshold; frames between noiseFloor and speechThreshold delay/prevent `start` and barge-in | Start onset at speechThreshold, reset only below noiseFloor |
| 3 | Minor | apps/ptah-electron/src/activation/bootstrap.ts:211 | Argv workspace predicate checks `isDirectory()` only; an unreadable dir is chosen and later candidates skipped | Also check read+execute access (`fs.accessSync(R_OK X_OK)`) |
| 4 | Minor | libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts:1197 | `ChatStartParamsSchema` does not apply the 16 KiB `SystemPromptSchema` to `options.systemPrompt` on `chat:start` | Validate options.systemPrompt, keep passthrough |
| 5 | Minor | libs/frontend/chat/src/lib/services/chat-store/message-dispatch.service.ts:193 | Message queued while the Command Center send lock is held is flushed only at turn end; lock release on an idle tab leaves it unsent | Flush the queue on lock release for an idle tab |
| 6 | Minor | libs/frontend/command-center/src/lib/components/command-center-page.component.ts:209 | "Drag to tilt orbits" hint, but the scene has no drag/tilt | Remove the hint, keep "Select a sphere for status" |
| 7 | Minor | command-center-page.component.ts:358 + voice/command-voice-loop.ts:224-234 | After Start voice, `setProvider({transcription, synthesis})` drops stt/tts, so the chip reads "Voice unavailable" while voice works (also nitpick N2) | Use `summarizeVoiceProviders(config)` in `CommandVoiceLoop.start` and pass the full result |
| 8 | Minor | libs/frontend/command-center/src/lib/components/command-center-page.controller.ts:566 | `movePattern` matches race/relay/forge/council anywhere ("fix the race condition"); with no session the send is refused, with a session a roster request is injected | Require explicit Tribunal intent (word "tribunal" or verb + move); otherwise ordinary send |
| 9 | Minor | command-center-page.controller.ts:595 | `confirmProposal` keeps the card after a non-retryable failure (lanes-unavailable, not-launchable, cancelled); each Confirm repeats the toast | Clear pendingProposal on ok or `retryable: false` |
| 10 | Minor | libs/frontend/command-center/src/lib/components/command-center-projection.source.ts:183 | Persisted manifest with no matching agents shows `starting` forever | Use `manifest.startedAt` + launch window, then `unknown` |
| 11 | Minor | libs/frontend/command-center/src/lib/voice/status-narrator.ts:66 | First observation after root change or `clear()` (every voice stop) narrates all old completed/running work | Treat a new baseline as silent: record states, queue nothing |
| N1 | Trivial | libs/frontend/tribunal-panel/src/lib/services/tribunal-phase-derivation.ts:326-328 | Unused `describe` helper | Delete it (keep the copy in tribunal-progress.service.ts) |
| N2 | Trivial | voice/command-voice-loop.ts:224-233 | Second readiness rule duplicates `summarizeVoiceProviders` | Same fix as #7 |

Also for the follow-up PR (from our own reviews):
- Merge-2 review Minor: Space does not activate the Setup hub Command Center card (all main cards share the pattern).
- r6 Moderate-1 (initial `page.open()` rejection unhandled, status stuck at `starting`) and Moderate-2 (no retry
  of the open after a failed rebind); the r6 reviewer recommends both before release.
- D58: Ptah artwork icon on the root sphere (separate follow-up PR per the user).
