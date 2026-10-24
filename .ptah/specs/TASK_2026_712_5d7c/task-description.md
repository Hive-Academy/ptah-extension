# Task description — TASK_2026_712_5d7c

**Requirements revision:** 1

## Outcome

A person using Ptah can run Claude as a system lane beside Codex, and can add, inspect, sign in, sign out, and select more than one named Claude account. The main chat and a Claude lane can use different named accounts at the same time. Resume follows the profile the run started with and does not silently follow a rename, a new default, a retargeted directory, or a different known identity. Usage aggregates by verified provider identity. Codex gets the same named-account treatment, including add, status, sign-in, and sign-out, after Claude is in place. The login Ptah uses today keeps working, and no existing lane loses a capability.

Technical specification and mocked proof of those actions are in this task. Enabling or releasing a disputed subscription-authenticated flow stays held until the user supplies authorization evidence. This document does not decide that licensing question and does not replace the requested actions with directory selection.

## Classification

| Field | Value | Why |
| --- | --- | --- |
| Type | FEATURE | New selectable lane and new account state. `TASK_TYPES` in `libs/shared/src/lib/types/task-spec.types.ts`. |
| Estimate | XL | Crosses the SDK runner, lane registry, quota owners, resume, account actions, and an Electron surface. `TASK_ESTIMATES` is `XS, S, M, L, XL` in the same file. The order is relative only. |
| Priority | omitted | The user did not set one, and this description does not invent a priority gate. |

Workflow is Full: requirements, Electron design, architecture, then implementation batches. This document does not choose libraries, new file names, screen layout, or the sign-in mechanism.

## Phases

Phase 1 is Claude. Phase 2 is Codex. Phase 2 does not start until Phase 1 acceptance criteria that do not mention Codex are met. Phase 2 stays inside this task. It is not a second product.

| Phase | Done when |
| --- | --- |
| 1. Claude lane and Claude accounts | Claude is a system lane. The user can add a Claude account, see its status, sign in, sign out, and select it for the next main session and for a Claude lane. Resume stays on the bound profile. Usage follows verified identity. Each existing runner keeps its current default directory resolution, including a directory already configured for that path. Live subscription enablement and release stay held. The current local login remains available. |
| 2. Codex accounts | The same named-account rules, including add, status, sign-in, and sign-out, apply to Codex. Today's single Codex home remains the default until the user selects another. A new Codex subscription sign-in is specified and mockable. It is not released as authorized while the task's subscription-authorization decision is still open. |

## Actors and capabilities

| Actor or system | Capability | Outcome |
| --- | --- | --- |
| Electron user | Add an account, see its status, sign in, sign out, and choose one | The next main session and a Claude lane spawn can use different accounts. In-flight work keeps the account it started with. Status is visible without exposing credentials. |
| Main chat | Talk to Claude through the existing Agent SDK runner | With no named account selected, that runner path keeps the directory resolution it already has, including a preconfigured directory that path already honors. With one selected, that run resolves only that account. Reuse of the runner still launches a Claude Code child. It does not mean the agent runs only inside the host process, and it does not require a separate stream protocol. |
| Lane caller (`ptah_agent_list`, `ptah_agent_spawn`, message, status, read, wait) | Spawn Claude the way other system lanes are spawned | Claude appears as its own system lane. Model and supported effort are forwarded. A `ptah-cli` provider id remains a provider id, not a substitute for that lane. `modelTier` stays a Ptah CLI provider control. |
| Resume | Continue a conversation | Resume uses the profile id stored on that run. Rename, a new selection, a new default, or a retargeted directory does not move it. A missing bound profile fails visibly. |
| Plan limits and dashboard | Attribute usage | Quota follows verified provider identity. The same identity aggregates. Distinct proven identities stay separate. Unknown stays unknown. A profile id is not an owner key. Codex stays on its current single home until Phase 2, then uses the same identity rule. |
| Other system lanes and non-Claude Ptah CLI providers | Keep current spawn, model, effort, messaging, MCP, resume, auth, and limits | Those paths stay available. |
| Release owner | Decide permitted subscription use | Technical work and mocked sign-in proceed. Enabling or releasing the disputed subscription-authenticated path waits on authorization evidence. Existing behaviour stays. This task does not answer the licensing question. |

## Scope

### In scope

- Claude as a member of the system CLI set, detected and spawnable like the lanes already in that set, implemented by reusing the Agent SDK query runner after the architect checks that runner's messaging, permission, MCP, resume, model, effort, and per-child env contracts. A separate CLI stream protocol is not a goal. The current runner's off-thread child spawn stays acceptable (`sdk-query-runner.service.ts:295-316`).
- Named Claude account records that the main session and Claude lanes both select. A record identifies a local profile. It does not contain a token or key. The profile id is not the quota-owner id.
- Account actions for Claude, then Codex: add, status, sign-in, and sign-out. The observable outcomes are in the acceptance criteria. The sign-in mechanism, terminal flow, and screen layout are not specified here.
- Mocked seams so those actions can be implemented and tested without a live login, logout, or paid call.
- Per-run binding of the selected profile to that run's child environment only, including directory metadata for the selected account. Directory metadata is not an injected secret.
- Resume bound to the stored profile id, with the rename, default, deletion, retarget, legacy-unbound, and reauthentication outcomes below.
- Usage (owner key, watcher, dashboard tile) bound to verified provider identity, with aggregation and unknown-identity rules below.
- Explicit model and supported-effort forwarding on the new Claude lane, existing default and precedence, and truthful handling when a value is unsupported.
- Electron account surface for the actions above, for the next main session and for a Claude lane. Dark and light. Interaction tests on that surface. Visual evidence is Electron only.
- Phase 2: the same selection, account actions, and per-run home binding for Codex, including auth, App Server usage, spawn, and resume, under the same identity and release-hold rules.
- Keeping VS Code, CLI, and TUI able to run against the preserved default when shared libraries change. No feature work or polish for those hosts. Dependent host projects that a shared change affects are in the verification set.
- Tests that prove isolation, per-path default preservation, identity aggregation, resume binding, model and effort forwarding, and mocked account actions. Temporary directories and mocked process environments only.

### Out of scope

| Item | Reason |
| --- | --- |
| Shadow-home sharing, automatic rotation, credential copying, silent failover, cross-account conversation migration, silent rebinding when identity or home changes | Not requested. Smallest isolated behaviour is the proposal. |
| A new Claude binary protocol or a second runner beside the Agent SDK | Research and the user brief prefer the existing SDK runner. The architect may reject reuse only if a contract cannot be met, and must say which contract. |
| TUI and VS Code feature work or polish | Electron is the account surface. Other hosts keep the preserved default and stay compiling. |
| Executing a live login, logout, or paid model request during verification | Verification rule. It does not remove add, status, sign-in, or sign-out from the product. |
| Replacing add, status, sign-in, and sign-out with directory selection only | The user asked to implement these account actions. This document does not reduce that scope. A narrower release needs the user's decision. |
| Deciding Anthropic approval, or enabling or releasing the disputed subscription-authenticated path | User-reserved. Mocked technical work stays in scope. Existing behaviour stays. |
| Removing the ambient `claude-cli` provider, Codex, or any other current lane | Preservation is a requirement. Removals need user approval and are listed only as proposals in the parity inventory. None are proposed. |
| Expanding `modelTier` onto standard CLI lanes | Its current public description applies only when `ptahCliId` is set (`tool-description.builder.ts:713-716`). |
| Workspace-wide build, serve, dev, e2e, or package | User verification rule. |
| Commit, push, or history rewrite | Not authorized. |

## Constraint sources

| Id | Constraint | Source |
| --- | --- | --- |
| C1 | Claude first, Codex second. Preserve today's default local logins and today's main and lane capabilities, including model, effort, messaging, MCP, and resume contracts that already hold. | User request, decisions D4. |
| C2 | Prefer the existing SDK runner. Do not assume a separate CLI protocol. Reuse still launches a child. | User brief and decisions D5. The architect still verifies messaging, permission, MCP, resume, model, effort, and per-child env. |
| C3 | No shadow homes, automatic rotation, credential copying, cross-account resume, or silent rebinding in the first design. | Decisions D6, proposal, plus review R4. |
| C4 | Do not infer provider approval from existing behaviour or from directory selection. Do not remove current behaviour or the requested account actions because approval is unknown. Hold disputed subscription enablement and release. | Decisions D7, user-reserved, review R2. |
| C5 | Electron account surface and Electron-only visual evidence. No TUI or VS Code feature or polish. Other hosts stay compiling. Dark and light visual review needs a stated launch permission before it runs. | User brief, `CLAUDE.md` product focus, context verification section. |
| C6 | Changed projects and dependent host projects required by shared changes. Scoped typecheck and tests. `nx --parallel=1`. Jest `--maxWorkers=2`. One heavy check at a time. No live login, logout, or paid inference during verification. | `CLAUDE.md` verification rules and decisions D8. |
| C7 | Account directory is per child process. The host process environment is not the account switch. | Proposal grounded in current code: `SdkQueryRunner` copies `process.env` into a one-shot (`sdk-query-runner.service.ts:600`), and `CodexHomeResolver` reads `process.env.CODEX_HOME` once (`codex-home-resolver.ts:25`). A global write would change every run. |

## User-reserved decision

Anthropic's Agent SDK authentication docs restrict third-party use of claude.ai login and subscription limits unless Anthropic has approved that use. This task does not know whether that approval exists. This document does not answer that question. Existing local login and directory selection are not treated as approval, and they are not an exception that clears new subscription use.

What proceeds while the question is open:

- Technical specification and implementation of the lane, profile records, selection, and add, status, sign-in, and sign-out, proved through mocked seams.
- Preservation of behaviour that already ships, including the Claude (Subscription) provider entry and each runner's current effective directory resolution.

What stays held until the user records authorization evidence:

- Enabling or releasing a flow that newly authenticates a subscription account for the disputed third-party use.
- Settings, onboarding, or release text that says a claude.ai subscription is authorized for Ptah.
- Any claim that a narrower directory-only release is accepted. That reduction is not approved here.

Codex Phase 2 specifies the same account actions and mocks them. This document does not grant a separate clearance to release a new Codex subscription sign-in. Existing Codex home behaviour stays.

If a store cannot be shown to isolate a second concurrent Codex account (keyring, auto, ephemeral), Phase 2 refuses that second account and says why. That is a technical fail-closed rule, not a licensing decision.

No further question is sent from this revision. The hold remains open.

## Acceptance criteria

1. When `ptah_agent_list` runs and the Claude SDK runner can be constructed, the system shall list Claude as a system lane with its own CLI id, separate from `codex` and from any `ptah-cli` provider whose id is `claude-cli`.
2. When the caller spawns that Claude CLI id, the system shall start the lane through the existing Agent SDK query runner. That run's account directory shall be applied only on the child environment. Directory metadata on that child env is allowed. The host `process.env` shall not be switched.
3. When the user has not selected a named profile, each existing runner path shall keep the effective configuration directory it already resolves, including a directory already configured for that path. An empty native-auth result (`ptah-cli-registry.ts:1544-1551`) shall mean no injected provider credential, base URL, or tier override. It shall not be treated as proof that every path uses `~/.claude`, and it shall not discard a preconfigured `CLAUDE_CONFIG_DIR` on a path that already honors one. The one-shot runner (`sdk-query-runner.service.ts:600-615`, which starts from `process.env`), the safe child env (`build-safe-env.ts:46-85`, which forwards selected home and `XDG_*` variables and does not independently forward ambient `CLAUDE_CONFIG_DIR`), and the native-auth auth object shall each be checked against that path's own current resolution.
4. When the user has two named Claude profiles whose canonical directories differ, and selects one for the next main session and the other for a Claude lane, both runs shall proceed together. Neither run shall write its directory onto the host `process.env`, and neither shall copy credential files into the other directory. Two profile records that resolve to the same canonical directory shall not be presented as isolated accounts.
5. When a main session or Claude lane is resumed, the system shall use the profile id stored on that run and shall not rebind it. Renaming the profile label shall not move the conversation. Changing the selected profile or the default profile shall not rebind an in-flight run or a resumed run. Changing the directory recorded for that profile shall not silently move the conversation onto the new directory. When the bound profile is missing, deleted, or unavailable, resume shall fail visibly and shall not fall back to another profile or to the current default. A legacy record with no stored profile id shall resume on the historical ambient route that existed before named profiles, not on a profile later marked as default. After sign-out or an external reauthentication, continuation shall not silently switch to a different known identity. When the identity at the bound route is a different known identity, or cannot be shown to be the same identity, the system shall fail visibly. The architect chooses how identity is stored and compared.
6. When plan limits or usage are read, the quota owner shall be the verified provider identity, not the local profile id. For Claude, that identity is email plus organization from that run's own `accountInfo()` (`provider-owner.resolver.ts:523-546`). The same verified identity shall aggregate to one owner even when two profiles or two directories produced it. Distinct proven identities shall stay separate. A missing email or a failed read shall leave the owner unknown for that route, shall not fail the run, and shall not borrow another profile's identity (`ptah-cli-lane-plan-limits.ts:146-158`). Unknown shall stay unknown.
7. When usage is shown, the dashboard shall show one tile per verified quota owner. Two profiles of one verified identity shall share one owner tile. Two distinct proven identities shall show two tiles. An unknown owner shall stay an unknown tile for that route and shall not merge with a known owner. The tile for an ambient owner shall remain available while that owner is still observed. Codex stays on its current single-home owner until Phase 2, then follows the same aggregation rule.
8. When the user changes the selected account or the default account in Electron, a session or lane that has already started shall keep its original account until it ends.
9. When the user spawns, lists, messages, resumes, or limits `codex`, `copilot`, `cursor`, `antigravity`, `opencode`, `pi`, `grok`, or a non-`claude-cli` Ptah CLI provider, the system shall keep that lane's current auth, model, effort, messaging, permission, MCP, resume, and quota behaviour.
10. When a Claude run is built, an `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, or `ANTHROPIC_BASE_URL` from a different provider route shall not replace the selected account. A non-default Claude account shall not inherit another account's token or base URL. Account-directory metadata may be present on the child env. The rest of the effective environment is not required to be empty, and directory metadata shall not be treated as an injected secret.
11. When authorization evidence is still absent, the system shall not enable or release a new subscription-authenticated sign-in as an authorized product path, and settings, onboarding, and release text shall not claim that Ptah may use a claude.ai subscription. The existing Claude (Subscription) provider entry shall remain selectable. Add, status, sign-in, and sign-out shall still be specified and covered by mocked seams. This criterion does not declare directory selection approved and does not remove the requested actions.
12. Until Phase 2 is implemented, Codex auth, usage, spawn, and resume shall keep resolving the single home from `CodexHomeResolver` (`codex-home-resolver.ts:15-26`) and `ownerForCodexHome` (`provider-owner.resolver.ts:553-564`).
13. When Phase 2 selects two named Codex accounts with distinct canonical homes, auth, App Server usage, spawn, and resume for a run shall share that run's home through the child environment and shall not assign `process.env.CODEX_HOME` on the host process. Two records for one canonical home shall not be treated as isolated. Quota shall follow the observed account: the same verified account aggregates, distinct proven accounts stay separate, and unknown stays unknown.
14. When Phase 2 cannot show that a Codex credential store (keyring, auto, or ephemeral) stays isolated per account, the system shall refuse a second concurrent account on that store and shall surface the reason. It shall not share the store silently.
15. When the Electron account surface is shown, the user shall be able to add a Claude account, see its status, start sign-in, sign out, and choose the account for the next main session and for a Claude lane spawn. Status shall distinguish signed-in from not signed-in without exposing credentials. The same actions shall be readable in dark and light theme. Phase 2 presents the same actions for Codex. Layout is a design choice.
16. When sign-in has not completed, status shall show that profile as not signed in. When the mocked sign-in seam completes, status shall show that profile as signed in. When the user signs out, status shall show signed out. An in-flight run shall keep the identity it started with until it ends. A later resume shall not silently attach to a different known identity. These transitions shall be provable without a live provider call.
17. When a Claude lane is listed or spawned, its messaging, permission, MCP, and resume declarations shall match what the reused runner actually implements for that lane. The lane shall not advertise steer, interrupt, MCP, or resume that the runner does not provide (`cli-adapter.interface.ts:160-184` and the adapter contract at `:190-248`). Verification uses that runner's real capability. A new protocol is not required.
18. When the caller supplies a model the Claude lane supports, that run shall use it. When the model is omitted, the lane shall keep the existing default and precedence already described for CLI spawn (user-configured default when omitted, `tool-description.builder.ts:697-703`). When the caller supplies a reasoning effort the lane supports, that explicit value shall be forwarded and shall win over the per-CLI setting and the chat effort (`tool-description.builder.ts:732-737`). The native-provider path that already passes `model` and `effort` into SDK query options (`ptah-cli-registry.ts:807-812`) shall keep that behaviour. When a supplied model or effort is not supported by this lane, the system shall not report that value as applied. The existing public rule that an unsupported effort is ignored shall remain true. `modelTier` shall remain limited to Ptah CLI providers and shall stay ignored for this standard CLI lane (`tool-description.builder.ts:713-716`).
19. When Claude is added to the system CLI set, `ptah_agent_spawn`'s CLI enum, the CLI `--cli` selector, and preferred-order filtering shall take that member from `SYSTEM_CLI_TYPES` (`agent-process.types.ts:74-82`). A second handwritten list is not acceptable.
20. When concurrent lanes are running, the existing cap shall still apply: configured `ptah.agentOrchestration.maxConcurrentAgents`, default 5, bounded to 1..100 (`agent-spawn-environment.service.ts:308-323`).
21. When account metadata is stored or shown, the record and the surface shall not contain API keys, access tokens, refresh tokens, session cookies, or credential-file bodies.
22. The system shall not add shadow-home sharing, automatic account rotation, credential copying, silent failover to another account, or migration of a conversation onto another account.
23. When shared libraries change, VS Code, Electron, CLI, and TUI shall still start a default-account Claude or Codex run. Visual work and visual evidence beyond the Electron account surface are not required. No TUI or VS Code feature or polish is required.
24. Tests for this task shall use temporary directories, mocked environments, and the mocked account-action seam. They shall not log in, log out, or send a paid model request. That prohibition is on verification, not on implementing the actions.
25. Verification for a shared-library change shall include the projects whose source changed and each dependent host project that depends on that shared change. Each included project shall get scoped typecheck and tests. Nx shall use `--parallel=1`. Jest shall use `--maxWorkers=2`. One heavy check shall run at a time. Workspace-wide checks, and `build`, `serve`, `dev`, `e2e`, and `package`, shall not run unless the user authorizes them.

## Non-functional requirements

| Id | Requirement | Check |
| --- | --- | --- |
| N1 | Account choice is per run, not process-global. | A test starts two runs with different account dirs and asserts the host `process.env` keys `CLAUDE_CONFIG_DIR` and `CODEX_HOME` are unchanged, while each child env carries only its own directory metadata. |
| N2 | Secrets stay out of logs and UI. Account status stays useful. | Logs and the Electron surface shall not record or render API keys, tokens, cookies, or credential-file bodies, and shall not render raw errors from auth files. Status may show a user-facing label and sign-in state so the user can tell accounts apart. A blanket ban on account-identifying labels was a lane proposal, not a user requirement. Existing boolean logs such as `hasEmail` (`ptah-cli-lane-plan-limits.ts:152-156`) remain acceptable. |
| N3 | Concurrency stays inside the current agent cap. | Existing max-concurrent tests still pass, and a Claude lane counts toward that cap. |
| N4 | Verification matches `CLAUDE.md`. | Changed projects and dependent host projects required by shared changes. Scoped typecheck and tests. `nx --parallel=1`. Jest `--maxWorkers=2`. One heavy run at a time. Electron-only visual review. No workspace-wide build, serve, dev, e2e, or package unless the user later allows it. No live login, logout, or paid inference. |

No latency number is set. None was supplied.

## Stakeholders

| Who | Needs |
| --- | --- |
| Electron user with more than one Claude login | Add an account, see status, sign in, sign out, and choose an account without logging the other one out. See usage per verified identity. |
| Person spawning lanes | `ptah_agent_list` shows Claude. Spawn accepts it, forwards supported model and effort, and does not disturb Codex or other lanes. |
| Person who only uses today's local login | No moved credential files, and the existing default resolution of each runner path still works, including a directory that path already uses. |
| Dashboard reader | A tile per verified owner. The same identity is one tile. Distinct identities are not merged. Unknown stays unknown. |
| Release owner | Technical and mocked account work can proceed. Subscription enablement and release stay held until they supply authorization evidence. Scope is not reduced on their behalf. |

## Risks

| Risk | Mitigation |
| --- | --- |
| One-shot and chat env construction do not resolve the account directory the same way. One-shot spreads `process.env` (`sdk-query-runner.service.ts:600-615`). `buildSafeEnv` does not independently forward ambient `CLAUDE_CONFIG_DIR` (`build-safe-env.ts:46-85`). Identity-key clearing is not directory selection. | Criterion 3 requires a separate assertion per runner path. Criterion 10 forbids a foreign token or base URL without requiring an empty child env. |
| `CodexHomeResolver` and bench bootstrap write or prefer a single `CODEX_HOME`. | Phase 2 forbids host-process assignment. Default remains the resolver's current path until a profile is selected. |
| Resume by session id alone can reopen a transcript under another directory, a renamed profile, a new default, or a replaced identity. | Criterion 5. Legacy unbound records stay on the historical ambient route. Missing bound profiles fail closed. Sign-out does not silently switch identity. |
| Adding Claude to `SYSTEM_CLI_TYPES` changes spawn enums, CLI flags, and preferred order. | Derive those surfaces from the constant. Regression tests list the previous members and the new one. |
| A hardcoded model or a silently applied unsupported effort could look like lane parity. | Criterion 18. Preserve native-provider model and effort forwarding. Do not extend `modelTier` to this lane. |
| Subscription onboarding would over-claim approval, and dropping sign-in would under-deliver the request. | Criterion 11 and criterion 16. Mock the actions. Hold live subscription enablement and release. Do not infer clearance from the existing local login. |

## Tests the implementer must add or extend

- System CLI set contains the new Claude id and still contains `codex`, `copilot`, `cursor`, `antigravity`, `opencode`, `pi`, `grok`.
- Spawn builds a child env for account A that does not change host `process.env` and does not include account B's config dir. Directory metadata for A may be present. A's child env does not include B's token or base URL.
- Default resolution is asserted per runner path: native-auth auth object has no injected credential, one-shot keeps a preconfigured `CLAUDE_CONFIG_DIR` when that path already inherits it, and the safe child env is asserted against its own current forwarding rules rather than inferred from the empty auth object.
- Two profile records for one canonical directory are not treated as isolated. Two directories that return one verified identity share one quota owner. Two proven identities do not collapse. A read with no email stays unknown.
- Resume with a stored profile id uses that id after a label rename and after the selected default changes. Resume fails closed when the bound profile is deleted or its directory was retargeted into a different identity. A legacy record with no profile id uses the historical ambient route, not the new default. Sign-out does not silently attach the conversation to another known identity.
- Supported model and effort values are forwarded on the Claude lane. Omitted values follow the existing default and precedence. An unsupported model or effort is not reported as applied. `modelTier` remains ignored for the standard CLI lane. The native-provider model and effort path stays green.
- Claude owner key changes when email or organization changes, and a failed `accountInfo()` does not throw out of the lane.
- Mocked add, status, sign-in, and sign-out cover not-signed-in, signed-in, and signed-out without a live provider call.
- Phase 2: two Codex homes stay on their child env. Same verified account aggregates. An unverified credential store is refused for a second concurrent account.
- Electron component test: add, status, sign-in, sign-out, and select an account for the next main session and for a lane. The in-flight selection does not change. Dark and light both expose the actions.
- Existing specs for other adapters' detection, `agent-cli` selector derivation, and native-auth empty credential env stay green.
- When a shared library changes, the verification set lists each dependent host project and runs scoped typecheck and tests for it under the N4 caps.

Visual review of the Electron surface is a later gate. It needs an explicit launch permission. It is Electron only. It is not part of requirements authoring.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Phase 1 reuses the Agent SDK query runner for the Claude lane. | Reuse runner, or add a binary CLI adapter. | `SdkQueryRunner` already runs `query()` (`sdk-query-runner.service.ts:260`, env at `:586-615`) and installs an off-thread child spawner (`:295-316`). `claude-cli` already means native SDK auth (`claude-cli-provider-entry.ts:23-29`). T3 comparison in `context.md` says not to assume a separate stream protocol. | Yes. Architect records the broken contract and switches only that gap. |
| Account actions are add, status, sign-in, and sign-out, plus selection. A profile id points at a local directory. The product does not copy credentials. The sign-in mechanism is not chosen here. | Full account actions with a mocked seam, or directory selection only. | The user asked to implement the investigated account behaviour. `context.md` forbids live login during verification, not the product actions. `claude-cli-provider-entry.ts:15-16` only explains why a key must not be injected. | A later user decision can narrow the release. This revision does not. |
| Default, when no profile is selected, is each runner's current effective directory, including a configured directory that path already uses. Files are not moved. | One universal `~/.claude` claim, or per-path preservation. | Empty native auth is only the absence of injected credentials (`ptah-cli-registry.ts:1544-1551`). One-shot inherits `process.env`. `buildSafeEnv` does not independently forward ambient `CLAUDE_CONFIG_DIR`. | Yes, only with a later user request. |
| Profile id and quota owner are different keys. Same verified identity aggregates. Duplicate canonical directories are one account. | Owner per profile label, or owner per verified identity. | `ownerForClaudeAccount` keys email and organization (`provider-owner.resolver.ts:523-546`). Codex owner follows the observed account (`:553-575`), not one owner per directory name. | Yes. Storage layout stays with the architect. |
| Codex account work is Phase 2 inside this task and includes the same account actions. | Same task phased, or a follow-up task now. | User said Claude first, Codex next. | Phase split can move to a new task id only if the user asks. |
| No shadow home, rotation, cross-account resume, or silent rebinding. | Those features now, or later. | `decisions.md` D6. Review R4. No user sentence asks for them. | Yes. A later task can add them. |
| Subscription enablement and release stay unanswered. Technical and mocked work proceeds. Existing behaviour stays. Scope is not reduced. | Infer approval, block all technical work, ship directory selection only, or separate mocked implementation from release. | Official restriction recorded in `context.md` and decisions D7. Existing behaviour is not evidence of approval for new use. | The user can later supply evidence or accept a narrower release. This document does neither. |

## Uncertainties

- The exact CLI id string for the Claude lane is for the architect. It must be one new member of `SYSTEM_CLI_TYPES` and must not reuse the provider id `claude-cli` as if it were already a system lane.
- Which `CliAdapter` methods the SDK runner can satisfy, including permission, MCP, and resume, is an architecture check. Criterion 17 requires the declaration to match that check.
- How a child env receives directory metadata is for the architect. Criteria 3 and 10 require the observable per-path result, not a particular helper.
- How profile identity is compared across rename, retarget, sign-out, and external reauthentication is for the architect. Criterion 5 requires the observable refusal.
- Keyless Anthropic Console profiles are called out in research as an exception to `CLAUDE_CONFIG_DIR`. Phase 1 does not claim those profiles are isolatable. If one is selected and cannot be isolated, the run shall fail with that reason rather than fall back to another account.
- Which Electron screen holds the account surface is a design choice. The observable behaviour is criteria 15 and 16.
- Supported model ids are per CLI and change between vendor releases. Criterion 18 does not freeze a model list. It requires forwarding, existing precedence, and truthful unsupported-value behaviour.
- Phase 2 Codex file versus keyring versus auto versus ephemeral isolation is unverified in this repo. Criterion 14 is the fail-closed rule until that verification exists.
- `ptah_agent_*` tool schemas were not loaded in this authoring session. Citations for spawn and list come from `tool-description.builder.ts`. The architect confirms the live schema still derives the enum from `SYSTEM_CLI_TYPES`.

## Revision 1

| Finding | Change |
| --- | --- |
| R1 | Restored add, status, sign-in, and sign-out for Claude and then Codex. Criteria 15, 16, and 24. Live login during verification stays forbidden. Directory-only scope is not adopted. |
| R2 | Criteria 11 and the user-reserved section hold subscription enablement and release. Existing behaviour stays. Directory selection is not treated as approval. The licensing question is not answered. |
| R3 | Criteria 4, 6, 7, and 13 separate profile id from verified quota identity. Same identity aggregates. Distinct identities separate. Unknown stays unknown. Duplicate canonical directories are not isolated. |
| R4 | Criterion 5 covers rename, selection, default, deletion, directory retarget, legacy unbound records on the historical ambient route, and sign-out or external reauthentication. |
| R5 | Criteria 3 and 10 separate an empty credential env from effective directory resolution and require each runner path to be checked, including a configured directory. |
| R6 | Criteria 17 and 18 require model and effort forwarding, existing precedence, truthful unsupported values, unchanged native-provider tier behaviour, no `modelTier` expansion, and real messaging, permission, MCP, and resume declarations. |
| R7 | Criterion 25 and N4 require changed projects and dependent host projects, scoped typecheck and tests, and the existing caps. Visual evidence stays Electron only. |
