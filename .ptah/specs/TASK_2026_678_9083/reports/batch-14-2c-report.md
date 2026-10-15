# Batch 14.2c report

Status: **partial**. Tribunal wiring works for an established root session. A new tab without an SDK session ID cannot issue a root-bound nonce; the page rejects its Tribunal move request with a visible message until a session exists.

## Wiring

| Item | Evidence |
| --- | --- |
| Page-scoped transport and coordinator | `libs/frontend/command-center/src/lib/components/command-center-tribunal.transport.ts:20`; `command-center-page.controller.ts:23`; `command-center-page.component.ts:26` |
| Tab-explicit question answer, neutral non-Decline text | `command-center-tribunal.transport.ts:78`; coordinator answer path used at `:87` |
| Discovery vendors, unavailable state, disabled CLIs cached on open | `command-center-tribunal.transport.ts:53,107`; config failure leaves no launchable lanes |
| Root terminal pulse settles discovery | `command-center-tribunal.transport.ts:30,122` |
| Task allocation, record manifest, launch send, toast | `command-center-tribunal.transport.ts:128,152,158,161,164` |
| Typed/voice move framing with page UUID and root | `command-center-page.controller.ts:277`; `voice/command-voice-loop.ts:21,390`; persona copy rule at `libs/frontend/chat-state/src/lib/command-center-persona.ts:7` |
| Roster receive, nonce/root validation, invalid decline/toast, voice notice | `command-center-page.controller.ts:137-184`; ordinary question selector excludes roster at `:48` |
| Card proposal and click/focused-key outputs | `command-center-page.component.ts:123-125`; existing `command-pending-input.component.ts:177,188` owns click/key activation |
| Confirm, decline, timeout, page exit before voice exit | `command-center-page.controller.ts:292-329`; 120-second proposal timer at `:170` |
| Typed command submit uses page | `command-center-page.component.ts:145` |

The coordinator consumes proposal IDs and sends at most one successful launch turn. The transport replaces its internal non-Decline answer with `Discovery turn ended. Await further instructions.`; no affirmative answer text reaches the model through that path. Decline remains literal `Decline`.

## Specs

| Case | Name and location |
| --- | --- |
| Typed move framing and unchanged ordinary text | `frames typed move words with a fresh page nonce and root id; ordinary text stays unchanged`, `command-center-page.controller.spec.ts:269` |
| Matching nonce; wrong nonce/root rejected | `opens a matching roster and rejects wrong nonce or root`, `command-center-page.controller.spec.ts:281` |
| Confirm order, one launch, no affirmative answer | `confirms once and launches after the manifest without affirmative answer text`, `command-center-page.controller.spec.ts:303`; relay path checks answer → task → manifest → launch |
| Decline, timeout, voice resolved | `declines and times out proposals with Decline, then resolves voice`, `command-center-page.controller.spec.ts:337` |
| Page exit ordering | `calls pageExit before voice exit`, `command-center-page.controller.spec.ts:362` |
| Availability and disabled CLI mapping | `maps unavailable vendors to non-launchable lanes and applies disabledClis`, `command-center-tribunal.transport.spec.ts:77` |
| Neutral answer through tab path | `answers a card confirmation with neutral discovery text through the tab path`, `command-center-tribunal.transport.spec.ts:98` |

## Verification

- Scoped Jest: 2 suites passed, 13 tests passed, `--coverage=false --maxWorkers=2`. Three allowed runs used: first blocked by `gridstack` ESM import through the panel root, then two passes after spec-only module mocks. The final fail-safe no-session branch was linted but added after the last Jest pass.
- ESLint: exit 0 on all seven changed source/spec files; final controller-only lint also exit 0.
- Prettier: `--write` completed; `--check` reported “All matched files use Prettier code style!”; final controller formatting was unchanged.
- Bash `tasklist` was unavailable. Equivalent `tasklist.exe`/PowerShell process checks returned zero Jest processes before each Jest run.
- No Nx, TypeScript compiler, git, build, serve, dev, or e2e command was run.

## Degradation audit

- New transport catches at `command-center-tribunal.transport.ts:65,100,143`: each begins with `// degradation-audit: reported — ...`, reports a safe toast, and returns a fail-closed result.
- Existing controller catch at `command-center-page.controller.ts:245`: first-line reported audit comment; voice readiness is disabled.
- No catch or `.catch` was added to the voice loop. Its existing catches at `voice/command-voice-loop.ts:100,114,187,232,401` were outside the send-path change.

## Needed changes outside the batch

- A new Command Center tab needs an SDK root session ID before its first Tribunal move can be framed. A session-initialization path that yields that ID before discovery is required; the page currently rejects the move with a safe toast. Sending the command unframed would remove nonce validation.
- A backend turn/message ID on terminal pulses would provide exact discovery-turn correlation; the page currently uses the marked tab and increasing pulse sequence.
- The tab-explicit answer API returns `void`, so successful delivery cannot be proved after a nonthrowing call. A delivery acknowledgement would make the non-delivery Decline fallback definitive.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Use the panel's shared discovery cache and page-open `agent:getConfig` | Duplicate vendor discovery; share existing service | `command-center-tribunal.transport.ts:53,107` | Yes |
| Treat undiscovered/unavailable/config-failed vendors as non-launchable | Optimistic launch; fail closed | `command-center-tribunal.transport.ts:107` | Yes |
| Use a neutral discovery answer in the transport | Pass coordinator's internal recorded text; normalize at delivery | `command-center-tribunal.transport.ts:78`, spec `:98` | Yes |
| Reject a Tribunal command without an SDK root ID | Send unframed; wait for session initialization | `command-center-page.controller.ts:277` | Yes |
| Use a page timer for roster expiry | Card-local timer; controller timer | `command-center-page.controller.ts:170,306` | Yes |

## Anything not done

First-turn Tribunal discovery on a brand-new session remains unavailable until a root SDK ID exists. No TypeScript compile or full page component test was run under this lane's verification limits. The timer path is covered by direct timeout method invocation, not a clock-advancement test.
