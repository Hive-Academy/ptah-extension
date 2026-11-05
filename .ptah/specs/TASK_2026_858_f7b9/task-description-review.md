# Requirements document review

Verdict: APPROVED

## Round 2 re-review

Verdict: APPROVED

1. Round 1 Serious 1 — **resolved** (Phase 1 minimum capability set, lines 150-188; 1.2, lines 231-239). Capabilities planned for this task now have named later phases; remote CLI lanes and other excluded capabilities are marked unsupported remotely or not applicable. The U1 option-3 lane spike remains conditional (lines 182-184, 207).
2. Round 1 Minor 1 — **resolved** (2.9.4, lines 328-335; 2.10, lines 337-343). The test now uses a workspace and session outside a narrowed grant, checks only methods accepting the relevant IDs, and compares allowed and nonexistent IDs.
3. Extra out-of-scope bullet — **consistent** (Scope, lines 106-110; Phase 1 minimum, lines 179-188; HANDOFF Goal, lines 3-10). Remote file browsing, settings and provider-account management are excluded consistently and are not among the user's requested remote actions: start and watch sessions, approve tool use, and receive notifications.

### New Minor

1. **Grant extension is not described** (2.10, lines 337-343; 2.3.1, lines 286-293). Criterion 2.10 says the operator may extend a grant on the worker after pairing, but the local action is not specified. Name that action or state that re-pairing is required. This does not block the Phase 1 exit or approval.

No Blocking or Serious item remains open. The Round 1 and initial findings below are historical records superseded by this verdict.

## Round 1 re-review

Verdict: REVISE

1. Earlier Blocking 1 — **resolved** (Scope, lines 64-128; Phases, lines 130-143; Scope under each user decision, lines 175-193; U1-U5, lines 592-623). The selected path is now a recommendation, and alternatives have stated scope effects.
2. Earlier Blocking 2 — **resolved** (2.2-2.4, lines 258-283; 8.1, lines 461-465). Pairing is a bounded bootstrap outside the RPC handler surface, and the listener is distinguished from a network-facing port.
3. Earlier Serious 1 — **resolved** (Phase 1 minimum, lines 145-173; 1.8-1.9, lines 230-241). Installation, readiness, and a minimum capability set are checkable. The new deferred-capability conflict is listed below.
4. Earlier Serious 2 — **resolved** (2.9-2.10, lines 295-311). The grant is checked against named resources before handlers, and lists and streams are filtered.
5. Earlier Serious 3 — **resolved** (7.1, lines 418-421; 7.6, lines 433-449). The doctor checks worker prerequisites before registration or session start and reports corrective steps.
6. Earlier Serious 4 — **resolved** (out of scope, lines 106-109; 5.2, lines 386-391; D8, line 589). Remote transcripts have a worker endpoint; the CLI contract change is separate.
7. Earlier Minor 1 — **resolved** (Context, lines 39-50). The corrected Electron call and refusal citations match the cited code.
8. Earlier Minor 2 — **resolved** (9.1, lines 489-495). Installation can use the documented flow for each supported browser.
9. Earlier Minor 3 — **resolved** (Requirement 4 and 4.2-4.3, lines 341-362; reconnect NFR, lines 536-540). The observable result is gap-free, duplicate-free rendered state with client deduplication.

### New Serious

1. **The new deferred list adds excluded feature scope** (Phase 1 minimum, lines 147-149 and 162-166; Scope, lines 100-105). It says *every* Electron capability outside the Phase 1 minimum is deferred, explicitly including CLI lanes, although product remote CLI lanes are out of scope; it gives no phase for the other examples despite 1.2 requiring one for each deferred capability (lines 209-215). Change the list to distinguish capabilities actually planned for later phases, with their phases, from unsupported or out-of-scope capabilities. Keep CLI lanes out except the conditional U1 spike. This is open Serious, so the verdict remains REVISE.

### New Minor

1. **The authorization test needs an outside-grant resource** (2.9.4, lines 304-306; 2.10, lines 308-311). A Phase 1 token covers every workspace registered on its worker when issued, so an arbitrary second workspace or session may be authorized. Specify that the second IDs are outside the tested token's grant and that each tested method accepts the relevant resource ID.

The initial findings and Checks below are retained as the round 0 record; the round 1 status is above.

## Blocking

1. **Reserved choices are written as settled scope** (Scope lines 64-75, 82-85, 102; Phases lines 112-115; 9.7, lines 338-339; Risks R1 line 390; Decisions D2-D3 lines 404-405; U1-U5 lines 416-438). The handoff calls the Tailscale/Cloudflare design a recommendation that the user has not decided (HANDOFF lines 16-20), and the document itself reserves Phase 1, exposure, PWA hosting, and licensing. Yet it excludes the lane option, selects the worker-service Phase 1 and transport order, constrains PWA hosting to the user's deployment, and excludes paid gating before those answers. Make these a clearly conditional recommended plan, preserve the U1-U5 alternatives as live choices, and state which phase/scope clauses change under each answer. In particular, do not label the undecided transport selection `user-requested`.
2. **First-token enrollment contradicts the authentication rule** (2.2-2.3, lines 166-170; 3.1, lines 191-193; 8.1, lines 300-301). The service must close a connection without a valid token before any RPC, but a new client must connect with only a pairing code to obtain its first token. The text also says SSH opens no listening port while the service has a loopback listener. Define a checkable bootstrap path, including how the code reaches the worker, what the unauthenticated client may do, and how it avoids an unauthenticated RPC port. Change 8.1 to distinguish a loopback listener from a network-facing port.

## Serious

1. **Phase 1 has no installation or readiness path, so its exit is not reproducible** (Phase table and exit lines 111-120; 1.1, lines 132-134; 3.1, lines 191-193; provisioning deferred to Phase 2, lines 270-280). The exit assumes a worker service is already installed and paired on Chappie or another worker, but Phase 1 gives a reviewer no checkable way to put that service on a preprovisioned Linux worker. The slice also carries a full runtime, cross-process ownership, durable replay, transcripts, SSH pairing, approvals, and an Electron view. Add a minimal Phase 1 install/readiness path and explicit supported-capability minimum; defer remaining capabilities in the audit, so the single-machine scenario is independently shippable.
2. **Authorization is specified only at the method level** (1.3, lines 140-141; 2.5, lines 173-176; 3.2, lines 194-195). A scoped token could still pass another workspace or session ID to an allowed method and read or drive resources outside its grant. P1-critique.md line 19 specifically calls for method-and-resource authorization. Add acceptance checks that authorize each requested machine, workspace, session, and permission response against the token grant, and reject cross-resource access before invoking a handler.
3. **The fleet provisioning exit omits worker readiness** (7.1-7.3, lines 277-286; Phase 2 line 113). The Council notes that a usable worker needs a checkout, dependencies/native modules, provider CLIs, and provider authentication as well as Node and Ptah versions (P2-critique.md line 39). Add a worker-doctor/readiness criterion that checks these prerequisites and gives actionable failures before registration or session start. Keep credential copying as O1, not an implicit provisioning step.
4. **Transcript work adds an unrequested CLI behavior change** (5.2, lines 249-251). The user needs remote transcripts; changing `ptah interact`'s existing A2A `session.history` contract is a separate compatibility change, and the cited implementation explicitly documents its empty response. Either justify it as necessary for the worker protocol and tag it `pm-proposed`, with compatibility criteria, or move it to a separate task. Phase 1 should require a worker transcript endpoint regardless of that choice.

## Minor

1. **Incorrect or insufficient code citations** (Context lines 39-45). `phase-4-handlers.ts` registers handler classes and says `registerRpcSurface()` runs in `apps/ptah-electron/src/activation/wire-runtime.ts`; the call is at line 337 there. `attached-session-registry.ts:19-44` shows the process-local map and lookup, not the rejection of a webview resume. Correct the wiring path and cite the actual refusal site for the latter claim. The other spot-checked claims about `interact.ts`, `session:load`, `ipc-bridge.ts`, `ClaudeRpcService`, and the Electron profile were supported.
2. **Install criterion assumes a browser prompt** (9.1, lines 323-324). A supported browser may provide installation through its menu rather than offer a prompt. Specify a documented install flow and standalone launch on the named support floor; keep the browser-support research before Phase 3.
3. **Replay wording overpromises transport delivery** (4.2, lines 220-222; NFR lines 360-361). A socket cannot ensure each event is sent exactly once across reconnect races. Make the observable criterion gap-free, duplicate-free rendered state after cursor replay or snapshot fallback, with event IDs and client deduplication.

## Checks

1. Traceability: **FAIL** — undecided transport choices are tagged `user-requested`, and 5.2 is an unmarked CLI scope addition.
2. Acceptance criteria and Phase 1: **FAIL** — most scenarios are checkable, but Phase 1 lacks an install/readiness path, a bounded capability minimum, and pairing bootstrap.
3. Scope and user decisions: **FAIL** — U1, U2 and U5 are effectively settled in scope/phase text despite being reserved.
4. Security: **FAIL** — loopback and token intent are present, but first-token enrollment and per-resource authorization are unspecified.
5. Reserved and operational decisions: **FAIL** — O1-O6 remain outside code scope, but U1-U5 are not consistently conditional.
6. Code citations: **FAIL** — `registerRpcSurface()` is called in `activation/wire-runtime.ts`, and the registry citation does not show the asserted refusal.
7. Project rules: **PASS** — Electron leads; TUI/VS Code feature work is excluded while dependent hosts must pass scoped verification; the document forbids workspace-wide checks and build/serve/dev/e2e/package targets.
