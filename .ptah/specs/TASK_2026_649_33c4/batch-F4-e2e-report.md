# Batch F4 — Electron e2e repair

Source: CI run 38930440440, `D:\tmp\ptah-649-pr\e2e-failed.log`. All ten failures are spec drift after normal workflow chat tabs replaced surface-mode sessions. The changes below retain the user-facing checks. No app source was changed.

| Test | Exact failing assertion or locator in CI | Cause | Decision | Change (file:line) |
| --- | --- | --- | --- | --- |
| `new-project-dotnet.spec.ts:266` .NET skills and transcript | `expect(params.surfaceMode).toBe(true)` at old line 121; received `undefined` | Normal chat `chat:start` has no `surfaceMode`; its prompt contains the seed plus visible intake. | (a) | Mock seed in `harness:start-new-project`; assert seed in `chat:start`, same embedded tab, .NET skills and visible-only intake: `new-project-dotnet.spec.ts:105-135, 276-327`. |
| `new-project-dotnet.spec.ts:317` missing toolchain hint | Same `surfaceMode` assertion at old line 121; received `undefined` | Same old start shape. | (a) | Shared helper now checks the normal tab; test still checks exact install hint and transcript exclusion: `new-project-dotnet.spec.ts:105-135, 328-370`. |
| `new-project-question-routing.spec.ts:109` correlation-only question | `No surfaceMode chat:start within 10000ms (saw 1 chat:start call(s))` at old line 75 | Start is a normal chat tab; `surfaceMode` cannot identify it. | (a) | Identify its start by unique seed, create a real canvas tab, assert builder-only card and response: `new-project-question-routing.spec.ts:54-112, 120-180`. |
| `new-project-question-routing.spec.ts:171` foreign session question | Same `No surfaceMode chat:start` at old line 75 | Same old start filter; foreign-session isolation must now be between two normal tabs. | (a) | Bind a separate canvas tab to the foreign SDK session; assert no builder card and a card on that tab: `new-project-question-routing.spec.ts:185-246`. |
| `new-project-question-routing.spec.ts:212` Resume after switch | Same `No surfaceMode chat:start` at old line 75 | Shared setup fails before Resume. | (a) | Assert resumed embedded transcript has the original tab ID and only one start for that ID: `new-project-question-routing.spec.ts:248-277`. |
| `new-project.spec.ts:191` intake summary/start | `expect(page).toHaveURL(/\/harness-builder\/new-project\/<tabId>/)` at old line 97; received Electron `file:///.../renderer/index.html` | `MemoryPlatformLocation` owns Angular's logical route; Electron's browser URL stays at the file. | (a) | Assert the builder contains a transcript with the started tab ID; keep seed transport and intake-only transcript checks: `new-project.spec.ts:94-104, 192-218`. |
| `new-project.spec.ts:216` AskUserQuestion | Same `toHaveURL` at helper old line 97 | Shared setup fails before question assertion. | (a) | Shared helper checks tab identity; test still checks question card and main-process response: `new-project.spec.ts:94-104, 219-288`. |
| `new-project.spec.ts:293` Hub Resume | Same `toHaveURL` at helper old line 97 | Shared setup fails; later URL assertion would also inspect the wrong URL. | (a) | Assert original embedded tab after Resume and exactly one start: `new-project.spec.ts:293-323`. |
| `new-project.spec.ts:320` reload restore | Same `toHaveURL` at helper old line 97 | Shared setup fails; reload URL assertion would likewise inspect the file URL. | (a) | Assert original embedded tab and transcript after `prepare()`, with no second start: `new-project.spec.ts:326-381`. |
| `message-handlers-eager.spec.ts:95` unopened eager handler | `locator('ptah-harness-builder-view')` not found at old line 116 | Relay `{mode:'new-project'}` lacks required intake; handler rejects it before navigation. | (a) | Send valid intake and mock the new-project RPC; still push before builder mount and assert automatic navigation: `message-handlers-eager.spec.ts:95-135`. |

## Decisions

| Decision | Options considered | Evidence | Reversible |
| --- | --- | --- | --- |
| Identify builder route's tab through the embedded transcript's existing `data-tab-id`. | Browser URL; new test ID; existing transcript ID. | `chat-view.component.html:94-100` binds `data-tab-id`; `app.config.ts:155-174` uses `MemoryPlatformLocation`; CI reports unchanged `file:///.../index.html`. | Yes — replace with another stable route probe if exposed later. |
| Model New Project entry through a complete `harness:start-new-project` result. | Use relay seed; mock RPC result. | `harness-workflow-request.service.ts:374-390` takes `started.seedPrompt` and sets the first-message preamble; `harness-builder-records.service.ts:80-102` requires plugin fields for the stack record. | Yes. |
| Keep question isolation by binding an unrelated normal tab. | Preserve old surface claim test; use a foreign tab and SDK ID. | D1/D2 and parity inventory row 23 move builder questions to ChatView; `stream-router.service.ts:496-535` routes by bound tab or session; `chat-view.component.html:193` renders the card. | Yes. |
| Keep eager registration check with a valid relay. | Configure-harness relay; New Project relay with intake. | `harness-workflow-message.handler.ts:73-100` rejects New Project without intake unless resumable; valid relay delegates to `requestAndNavigate`. | Yes. |

## Proposed Removals

none

## What I could not do

Per the edit-only instruction, I ran no Nx, Jest, Playwright, TypeScript, lint, build, serve, or e2e checks. CI must verify the updated specs. The foreign-tab question case uses a `session:id-resolved` event to bind its SDK ID; its runtime behavior is unverified locally.
