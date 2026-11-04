Verdict: REVISE

| Initial finding | Resolved? | Plan body evidence |
| --- | --- | --- |
| Blocking: default sign-in never calls `shell.openExternal` on a validated HTTPS URL | Yes | `implementation-plan.md:303-318,365-372,1015-1020`; Electron adapter at `libs/backend/platform-electron/src/implementations/electron-user-interaction.ts:88-95` delegates to `shell.openExternal`. |
| Serious: cancelled start can report success | Yes | `implementation-plan.md:325-327,436-446,469-479`; `cancelled` maps to `success:false` and both races have tests. |
| Serious: app quit may leave the child running | Yes | `implementation-plan.md:328-335,515-549,568-577`; the plan names the actual `main.ts` → `handleWillQuit` path (`apps/ptah-electron/src/main.ts:457-498`, `apps/ptah-electron/src/activation/shutdown.ts:609-660`), defers active login and budgets the tree kill. |
| Serious: no AC 3.11 routing test | Yes, subject to finding 1 below | `implementation-plan.md:1084-1091,1248-1281` defines a host spec with a real save handler, chat start, connection switch, new message, runtime/provider assertions and pre-switch resume refusal. `connection-settings-methods.ts:83-154` and `chat-session.native.spec.ts:576-627` support its seams. |
| Moderate: AC 1.9 lane half lacks a new test | Yes | `implementation-plan.md:415-420,1128-1133,1284-1299` assigns empty-home cases to both lane specs and the scoped H verify. The behavior exists at `codex-app-server-lane.adapter.ts:156-175` and `codex-lane-runtime-composition.ts:119-126`. |
| Moderate: learn CLI output through interactive login | Yes | `implementation-plan.md:109-120,354-362` uses `codex login --help`, binary strings and synthetic fake-spawner transcripts; the Electron manual check covers real browser behavior. |

## New findings

1. **Serious — AC 3.11 step 4 is both assigned and explicitly left unwritten.** The executable spec and Component 11 require `AUTH_REQUIRED` and no `resumeSession` for a pre-switch conversation (`implementation-plan.md:838-841,1277-1281`), matching `decisions.md:41-42`. Yet the architecture and Testability sections say that half is held (`implementation-plan.md:183-187,1084-1091`), and the final scope recommendation says to “leave step 4 unwritten” (`implementation-plan.md:1391-1395`). These are conflicting handoff instructions for required proof. Make the body and Revision 1 consistently assign the four-step spec, while keeping carry-over in its separate task. The prior user answer at `implementation-plan.md:1309-1315` is historical; identify it as superseded by rows 37-38.

2. **Moderate — The reused URL extractor cannot implement the stated validation contract unchanged.** Component 3 promises the first valid HTTPS URL with a 4096-character ceiling and continued parsing after invalid candidates (`implementation-plan.md:303-318,367-369`), but it also says to move and reuse `extractHttpsUrl` (`implementation-plan.md:337-339`). The current helper takes only the first URL-shaped match on a line and rejects anything over 2048 characters (`libs/backend/auth-providers/src/lib/providers/kimi-code/kimi-code-login.service.ts:402-415`). A valid 2049-4096-character sign-in URL is dropped, and a valid URL after an invalid first candidate on the same line is missed. Specify a Codex extraction path or a compatible shared helper change, and test those cases.

## Decisions

| Decision | Options | Evidence | Reversible? |
| --- | --- | --- | --- |
| Keep the approved all-platform Electron URL open, with Linux/BSD `BROWSER` suppression and accepted macOS/Windows duplicate tabs. | Skip Ptah open on some platforms; change default to device mode. | `decisions.md:39`; `implementation-plan.md:291-318,373-375`; `design-spec.md:193-196`. | Yes. |
| Treat AC 3.11 step 4 as an `AUTH_REQUIRED` refusal test here; carry-over is separate. | Implement carry-over here; omit step 4. | `decisions.md:41-42`; `implementation-plan.md:1277-1281`; existing refusal test `chat-session.native.spec.ts:576-627`. | Yes. |
| Require one unambiguous implementation contract for URL extraction; the 4096-character acceptance promised by the plan controls. | Narrow the declared limit to 2048 and permit first-match-only parsing. | `implementation-plan.md:303-318`; `kimi-code-login.service.ts:402-415`. | Yes. |
