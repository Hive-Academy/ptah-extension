Verdict: REVISE
# Gate 2 plan review — initial

## Findings

1. **Blocking — The default Electron sign-in does not satisfy the approved browser-opening contract.** `decisions.md:11` requires the main process to run the selected executable **and open a validated HTTPS URL via `shell.openExternal`**. The plan instead makes plain `codex login` the default and explicitly never calls `openExternal` in that mode (`implementation-plan.md:135-136,252-262`). The CLI may open a browser itself, but the main process neither validates that URL nor observes that an open occurred. Design rule 5 permits an architect's mode choice (`design-spec.md:215-217`); it does not waive decision 7's explicit open requirement. Set a default flow that actually extracts, validates, and opens the URL through the Electron boundary, or obtain a revised user decision. Test the default mode's actual `openExternal` call, invalid URL rejection, and false/throw outcomes. A-1's unverified CLI output assumption (`implementation-plan.md:105-110`) makes the current promise unprovable.
2. **Serious — Cancel can be returned as success.** The RPC response is planned as `success: state.status !== 'failed'` (`implementation-plan.md:340-349`), while `cancelled` is a final status (`implementation-plan.md:161-170,263-267`). A cancel racing the start response can therefore return `{success:true, state:{status:'cancelled'}}`. That is a success-looking result for an incomplete sign-in and violates the decision 7 requirement that cancellation be distinct. Define `success` as a launched/running attempt only, or use a discriminated start result; add a cancel-during-start RPC test, including the instant-after-spawn race.
3. **Serious — Child cleanup on app quit is conditional and may be omitted.** Component 6 says to find a teardown registry, then, if Kimi has no disposal, “leave it as is and record the gap” (`implementation-plan.md:405-411`). The proposed Codex child is new and may live for ten minutes (`:265-267`); its cleanup is a requirement independent of Kimi. Current `main.ts:457-498` delegates quit to `handleWillQuit` with explicit callbacks, not an arbitrary disposer registry. Name the actual quit hook and add a quit-while-login-active test that observes tree termination and a single final state. Do not leave this as A-6 for an implementation lane.
4. **Serious — AC 3.11 has no test that proves its end-to-end result.** The criterion explicitly requires a test that starts chat, switches the connection on stage 1, sends a message, and asserts the new connection served it (`task-description.md:318-321`). The plan admits it only checks the shared `activateConnection` call at unit level and defers the message to a manual or visual step (`implementation-plan.md:902-905`). Shared save plumbing cannot prove session reset and routing after a live chat. Add a scoped integration/host test for the stated sequence; a visual check alone cannot identify which backend served the message.
5. **Moderate — AC 1.9's lane half is asserted, not assigned a new test.** The criterion demands a test for both onboarding's installed/unreadable facts and the lane's retained `installed:false` in the explicitly empty-home case (`task-description.md:222-226`). Component 4 names only the onboarding half (`implementation-plan.md:320-324`); the final handoff says existing lane tests pass unchanged (`:988-1001`). The parity inventory explicitly calls for a *new* empty-home case (`parity-inventory.md:70`). Assign that case to a named `cli-agent-runtime` or `cli-engine` spec and include it in the relevant scoped verify target.
6. **Moderate — The plan does not prove the default mode's CLI output assumption safely.** A-1 proposes running both interactive login modes against a temporary home and recording output as spec fixtures (`implementation-plan.md:105-110`). This is an interactive external flow, and output can change with CLI version or contain session data. Use `codex login --help` and controlled fake-spawner transcripts to establish parser behavior, then use the Electron visual/manual check for actual browser behavior. The 20-second state 4b is honest when no URL/code is observed (`design-spec.md:218-224`), but it does not itself prove the approved open contract.

Logic questions: (1) Silent success: the cancelled start response in finding 2. (2) User action: quitting during login leaves the child lifecycle unspecified in finding 3. (3) Wrong-answer input: an explicitly empty Codex home needs the missing lane assertion in finding 5. (4) Failed dependency: `openExternal` false/throw has a planned device-mode result (`implementation-plan.md:868`), but the default mode never invokes it. (5) Missing requirement proof: chat routing after a stage 1 save in finding 4.

## Acceptance-criteria coverage

| Criteria | Planned component(s) | Planned proof / gap |
| --- | --- | --- |
| 1.1-1.4 | 2, 4, 9, 12 | Outcome, reader, derivation and panel specs (`implementation-plan.md:230-232,320-324,582-584,709-716`). |
| 1.5-1.7 | 4, 8, 9, 12 | Re-check and independent-failure specs (`:320-324,509-510,590-593,709-720`); sign-in completion also uses 3, 5, 14. |
| 1.8-1.9 | 4, 9 | Existing detection specs retained (`:988-1001`); **new lane empty-home assertion missing** (finding 5). |
| 1.10-1.13 | 2, 4, 8 | Five-outcome auth fixtures, timeout handling, existing auth-status tests (`:230-234,320-324,507-510,1000-1001`). |
| 2.1-2.5 | 8, 12, 14 | Command-row, sign-in, cancel and source tests (`:461-465,709-720,798-804`); default browser-opening contract fails (finding 1). |
| 3.1-3.6 | 9, 11, 12 | Selection derivation and choice component/store specs (`:582-585,657-668`). |
| 3.7-3.10 | 8, 11, 14 | Shared target helper, save outcomes and Providers state specs (`:514-520,657-668,798-804`). |
| 3.11 | 8, 11 | **No chat-message routing test** (finding 4). |
| 3.12-3.20 | 8, 9, 11, 14 | Failed/unconfirmed/saved reread tests and existing-caller compatibility (`:515-520,567-569,657-668,798-804`); 3.19 has explicit retry/no-write case. |
| 4.1-4.6 | 9, 10, 12, 13 | Chosen-only banner/strip and old/new flag/guard specs (`:618-625,722-724,750-757`). |
| 5.1-5.9 | 4, 7, 8, 9, 13 | Bounded follow-up, unclosed-child, timeout classification, logging and Home specs (`:311-324,441-443,507-513,585-594,750-757`). |
| 6.1-6.2 | 9-13, 15 | Parity tests are ported or retained; non-Electron guard/store/Home cases remain (`:582-596,618-625,709-724,750-757,810-825`). |

Parity check: `parity-inventory.md:16-73` maps the Claude derivation, store owner, banner, strip, stage 1 help, stage 2, Home, guard/flag, visual cases, lane detection, auth booleans and Providers switch to Components 8-15. No working capability is proposed for removal. Design state 11 is omitted under `decisions.md:19,29`: current `openTerminal` implementations are no-ops, so this removes a false-success branch, not a functioning terminal hand-off. The CLI runner remains (`implementation-plan.md:345-348,988-996`). Batch A-H file sets are disjoint (`:926-941`), Home edits are limited to the stated regions (`:731-759`), and `npm run verify -- -p <projects>` is scoped (`:1004-1009`). No build, test, or verify command was run for this document review.

## Lane-introduced constraints

| Constraint | Judgment | Reason |
| --- | --- | --- |
| Keep `IAuthCommandRunner`, `platform-cli`, `cli-engine`, `cli-agent-runtime` behavior | Justified | Current runner path is used by CLI; plan preserves it (`implementation-plan.md:31,345-348,988-996`). |
| Electron-only service registration, lazy selection snapshot, expected-resolvable and DI gates | Justified | Snapshot is registered after bootstrap under a guarded path; component 6 addresses the Electron composition and token checks (`:389-427`). |
| Default plain `codex login` with no Ptah `openExternal` | Not justified | Conflicts with approved decision 7's explicit main-process HTTPS open (`decisions.md:11`; finding 1). |
| No terminal hand-off state | Justified | Binding D-4 and orchestrator source check show no working terminal host (`decisions.md:19,29`). |
| No raw CLI output in UI/log | Justified | Fixed-copy failure contract protects credentials (`decisions.md:21`; `implementation-plan.md:257-262`). |
| Leave quit cleanup gap if Kimi lacks it | Not justified | Codex starts a new long-lived child; its own disposer needs wiring and proof (`implementation-plan.md:405-411`). |
| AC 3.11 as manual-only Electron proof | Not justified | The acceptance criterion explicitly requires a chat-message test (`task-description.md:318-321`). |

## Decisions

- **Verdict REVISE.** Finding 1 is Blocking; findings 2-4 are Serious. Approval requires no Blocking or Serious findings.
- **D-4 terminal hand-off:** accept as consistent with decision 7 and the observed no-op hosts; no separate user escalation is warranted (`decisions.md:19,29`). Reversible if a real terminal host is later added.
- **D-5 default mode:** the architect may choose the mode, but the chosen implementation must still fulfill user-approved `shell.openExternal` behavior. The present default does not. A device-flow default is a reversible way to satisfy the contract if the CLI supplies a validated URL (`design-spec.md:215-224`).
- **Review limits:** This is a plan and source review. No new implementation exists to diagnose; runtime behavior of the installed Codex CLI, Electron browser handling, and child teardown remains to be proven by the implementation's focused tests and Electron review.
