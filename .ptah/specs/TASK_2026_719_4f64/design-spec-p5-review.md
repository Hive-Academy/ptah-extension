REVISE — 6/10

Reviewer: codex / Author: claude

Independent Gate 1.7 review of P5 against D39, the design, prototype, all 74 inventory rows, and targeted current frontend/host code. Read-only review except for this requested deliverable. No source/spec/prototype edits, git writes, builds, or tests. Inspected prototype source and `s2-list-dark.png`; did not execute the prototype in a browser or independently measure contrast. The screenshot fits the proposed 520px drawer, but does not establish keyboard behavior or narrower-window fit.

## User requests

1. **Met structurally:** account management moves into the Claude (Subscription) connection drawer. The extra account-count link on the base card is navigation, not the old account-management surface, but is an additional design choice.
2. **Partially met:** the existing login becomes one account row and the second account can be added. Both selects still display the same account name when both scopes use it; differentiated labels and assignment chips make that reasonable. The unconditional Connected state is unsupported, however, so this is not ready to implement as specified.
3. **Met for account Manage:** signed-out, failed, and pending accounts open Access; signed-in accounts open Overview. Connection-card Manage still opens connection Overview, consistent with the narrower D39 wording about account Manage. Preserve this distinction in the implementation.
4. **Met, with excess removals:** full UUID and Unknown owner disappear. Verified identity and UUID suffixes also disappear; those additional removals require explicit disposition rather than being bundled into the requested cleanup.

## Findings

1. **High — Unsupported ambient Connected state.** Spec §1, §3 S1/S2/S5, Decision 5; prototype `listView()` hardcodes the ambient green dot and Connected. `ProviderAccountsSnapshot` (`rpc-provider-accounts.types.ts:107`) contains named accounts and selections, not ambient authentication. `connection-check.ts:193` checks CLI availability only. Decision 5 calls this a copy-only change, which is false for the status badge. Add a real ambient read and unknown/loading/failure/signed-out states, or omit the status and say it has not been checked. Never infer authentication from installed CLI or an ambient selection. This also affects the account count's implied meaning and `card()`'s Connected label.

2. **High — Separate default capability is removed without equivalent behavior or user decision.** Spec §3 Profile, §6 and Decision 4. `ProviderAccountsStateService.setDefault()` (`provider-accounts-state.service.ts:398`) updates both scopes in one host transaction against both revisions. `setSelection()` writes one scope. Two selects can reach the same final values, but do not preserve the atomic both-scope action. A fallback shortcut named Use for new chats would also misdescribe a both-scope write. Retain a clearly named both-scope action pending the user's removal decision; architect confirmation alone cannot approve a removal.

3. **High — Parity reconciliation and failure behavior are incomplete.** Spec §6 explicitly predates the inventory and is not a complete mapping. Silent gaps include stale-snapshot warning/retry, unavailable stored selection, selection pending/refusal/unconfirmed outcomes, add validation/refusal/pending, global action busy behavior, neutral unavailable-result handling, and list-level active-run counts. The prototype immediately reports Saved and changes chips without demonstrating host acceptance. Preserve the stored selection on refusal; do not let a missing option silently become ambient. Update the design with the disposition ledger below and actual failure states before implementation.

4. **High — Manual fallback controls promise data unavailable in those states.** Spec §3 S3/S6 and prototype `detailView()` offer Window did not open? and Use a terminal instead. Current state-service fallback data is response-only, supplied when launch fails, retained only while pending, and dropped on terminal snapshots; status reads do not return a script (`provider-accounts-state.service.ts:200,365,523,639`). Merely revealing S4 cannot generate it for an apparently successful launch or failed account. Gate this UI on a real host fallback, or define a host operation that safely supplies a manual flow with its operation lifetime. The placeholder `FB` is explicitly illustrative, not a valid replacement for the host script. Do not fabricate a command from the display label.

5. **Medium — Added drawer tab and sizing constraint do not match the existing connection pattern.** Spec §2 and prototype `drawer()` add Advanced and require five one-word tabs. `connection-kind.ts:17-27` gives Claude only Overview & Used By, Credentials, Models & Tiers; Advanced is custom-only. Add Accounts to those applicable tabs. Remove the unsupported Advanced tab or justify its content separately. Shortened labels and mandatory single-line layout are optional design choices, not D39 requirements. Keep Used By and Tiers capabilities and specify behavior below 520px and with text zoom. A same-drawer detail view is otherwise a feasible improvement and avoids stacking drawers.

6. **Medium — Accessibility promises are not demonstrated and some are unspecified.** Spec §5; prototype `drawer()`, `detailView()`, add/back/manage handlers. Tabs have roles but no roving tabindex, arrow/Home/End behavior, or tab-to-panel associations. Replacing `innerHTML` discards focused elements; Manage does not focus an account heading (the account name is a `b`), Back/Cancel do not restore focus, and modal focus is not trapped. The proposed removal confirmation does not appear on button activation. The fallback `pre` loses the current keyboard focusability. Specify preservation of native drawer/tab behavior, initial focus, post-save focus, confirmation Cancel focus and return targets, and demonstrate these in the prototype or explicitly mark them unverified. The outer drawer retaining its native implementation will not automatically implement inner-view focus handling.

7. **Medium — Add flow changes behavior and imposes an unproved limit.** Spec §3/§4, Decision 7; prototype `listView()` and `addForm.onsubmit`. Add and sign in chains two actions, while the old Add writes only a label and never selects. Specify successful add followed by refused/failed sign-in, retaining the new account, and never silently selecting it. The prototype accepts an empty label by substituting Second account, whereas the current dialog uses `isSafeProviderAccountLabel` and disables invalid submission. It also always disables adding after one named account with One extra account for now. No count-cap contract is shown in the inspected snapshot. Remove that artificial limit unless supported by a real host capability; preserve existing validation and add feedback.

8. **Medium — State copy is overconfident and the copy contract contradicts itself.** Spec §3 S6 and cancelled copy promise Nothing was changed / No changes were made, even though an operation may change account state or have an unconfirmed outcome. Use the safe host result and preserve the existing unconfirmed-write warning. Failed/refused operations need distinct outcomes from generic sign-in failure. Spec §4 retires profile and route, yet retains the visible Profile tab and §6 proposes main route copy. Use plain explanations consistently, including the API-route qualification under Use for. The prototype omits that qualification entirely. No actual secrets were observed in the artifact; real labels must be rendered as text (the prototype interpolates its editable name into HTML), and fallback scripts must remain text, never markup.

## Proposed removals (user decision)

These are explicit dispositions for the user, not reviewer approval. Items directly requested by D39 are distinguished from additional proposals.

| Removal/replacement | Basis and proposed destination |
| --- | --- |
| Card full profile UUID | D39 item 4; remove the line. |
| Overview Local profile ID row | D39 item 4; remove the row. |
| Card Unknown owner badge | D39 item 4; remove the unknown branch. |
| Overview Usage owner: Unknown owner and owner-evidence explainer | Inventory's D39 proposal; remove unknown block/explainer. |
| Repeated Use existing default / Existing Claude login card presentation | D39 item 2; replace with named selects plus a single ambient account row. Ambient selection remains available. |
| Old empty-list No named Claude accounts yet copy | Inventory's D39 proposal; replace with ambient row and add guidance, including honest unknown/unavailable ambient status. |
| Separate Set as default control and its success toast | Additional, Decision 4; removes the atomic both-scope action unless retained elsewhere. User decision required. |
| Card Verified identity badge | Additional, §1/§4; not requested by D39's Unknown owner cleanup. |
| Overview Verified identity owner block and associated explanation | Additional, §1/§4; not requested by D39. |
| Named routing-cell UUID suffix | Additional, inventory flagged item; absent from new selects. Explicitly decide. |
| Named chooser-row UUID suffix | Additional, inventory flagged item; absent from new selects. Explicitly decide; labels must still distinguish choices adequately. |
| Separate Change buttons and chooser modal, including chooser empty-state wording and modal-specific Cancel | Decision 3; selection capability moves to native selects. Preserve current-value semantics, keyboard behavior, and write feedback. |
| Separate add dialog and add-only primary action | §2/§4; replaced by inline form and Add and sign in. This changes workflow, not merely location; retain label-only persistence and no automatic selection. |
| Separate account drawer wrapper | Decision 2; replace with in-drawer detail view, retaining accessible name, close behavior and focus recovery. |
| Always-Overview initial account tab | D39 item 3; replace with Access for non-signed-in states. |
| Base-page Accounts mount | D39 item 1; move into Claude drawer, not a capability removal. |

Not explicit removal proposals in the design, but silently absent or ambiguous and requiring retention or an added user-decision entry: list active-run badge, whole-card keyboard activation, stale-snapshot warning, unavailable selection, signed-in-first choice ordering, validation and all action feedback detailed below. They are not approved removals.

## Lane-introduced constraints

- Accounts must be a second-position tab rather than a section; detail must be inside the same drawer; add must be inline; selectors must be native selects. Reasonable design proposals, not user mandates.
- Base connection card gains account-count/needs-sign-in navigation. Define how it loads its count if accounts now load only when the drawer opens; do not invent pre-load counts.
- Claude gets Advanced; five tabs must fit one line at 520px and have one-word labels. Unsupported by the current kind mapping and not requested.
- One extra account for now. The spec makes this conditional on a host limit, but the prototype enforces it unconditionally. D39 asking to add a second account does not impose a maximum.
- Add automatically proceeds to sign-in. D39 did not require this workflow change.
- Ambient account cannot be managed here. This follows current named-account-only RPC scope, not an express user restriction; give honest status/help if ambient is signed out.
- Verified identity and all ID suffixes are removed, and the atomic default action is dropped. These exceed the requested cleanup and belong in user decisions.
- Electron-only gating, disabling unsigned named choices, new-sessions-only changes, and keeping credentials private already exist; they are inherited constraints, not new user restrictions.

## Backend needs

Minimum for the specified Connected badge: add a bounded, read-only ambient authentication probe, exposed through a new RPC or an additional snapshot field. It must inspect the effective ambient Claude login used by this host, distinguish authenticated, signed-out and unknown/unavailable (including timeout, parse failure and missing CLI), and return only UI-safe state. Frontend loading is separate from those outcomes. A timestamp/refresh contract is needed so a stale positive is not presented as a fresh check. Do not send raw CLI output, identity references, email, organization, config paths or credentials to the row.

The existing `claude auth status --json` parser can inform this implementation, but `ClaudeAccountCommand.status()` guards a reserved named route (`claude-account-command.ts:322-329`). It cannot simply be called with a fabricated ambient profile, nor should those guards be weakened. Add a dedicated ambient read path. No account-class badge is requested, so class data need not be exposed.

Without that addition, the honest downgrade is an Existing Claude login row with explanatory text and no Connected badge (or explicit Status not checked), while retaining the ambient selection option. The present design does not specify that downgrade. Explicitly represent ambient signed-out/unavailable too; S1 currently means no *named* accounts, not no working login.

Manual-fallback availability must follow the existing response/operation contract or gain an explicitly designed host operation; a UI link alone cannot supply the missing script. Retaining the atomic default action needs no new backend API. The account-count cap has no demonstrated data source. Existing named-account operations and host-pushed snapshots should remain unchanged.

## Full parity disposition

Rows 1–74 below correspond, in order, to the capability tables in inventory §§1–6 (including its ambient-entry row). **Gap** means no adequate design disposition, not permission to remove. **Proposed** refers to the user-decision list above. Prototype omissions are distinguished from promises already present in the spec.

| # | Inventory capability | Disposition / location in P5 |
| --- | --- | --- |
| 1 | Base-page mount | Moved: Accounts tab, §2. |
| 2 | Electron-only owner/surface | Kept: §2/§6; preserve inert owner and no RPC on other hosts. |
| 3 | First-render load | Gap: define drawer-entry load and count-link pre-load behavior. |
| 4 | Host-pushed snapshots | Kept via existing state owner; explicitly preserve subscription lifetime across view changes. |
| 5 | Accounts heading and local-credentials intro | Heading moved to list; credentials statement only in prototype signed-in Access. Preserve equivalent introductory privacy copy. |
| 6 | Loading/no-workspace copy; Add disabled without snapshot | Partial: §6 retains loading; no-workspace and disabled Add need explicit mapping. |
| 7 | First-read failure and Retry | Moved: top of Accounts, §6; not demonstrated in prototype. |
| 8 | Stale snapshot and Retry | Gap: top of Accounts must retain last-loaded warning. |
| 9 | Section busy/name semantics | Gap: add labelled Accounts region and aria-busy for reads. |
| 10 | Add/select/default/remove/unconfirmed toast region | Partial: prototype live region and select success; other outcomes unspecified, default proposed removal. |
| 11 | Two scope cards with state/context | Replaced: Use for selects and row chips, §3; unavailable state needs retention. |
| 12 | Duplicate ambient card copy | Proposed replacement: single ambient row and two labelled selects. |
| 13 | Main API-route qualification | Moved: under Use for, §6; missing in prototype and contains retired jargon. |
| 14 | Routing UUID suffix | Proposed removal, not recorded in design's parity list. |
| 15 | Unavailable named selection | Gap: disabled unavailable placeholder, not implicit ambient. |
| 16 | Scope-specific Change buttons | Proposed replacement: labelled native selects. |
| 17 | Scoped chooser modal/context | Proposed replacement: Use for hints; retain one-scope writes. |
| 18 | Always-available ambient option | Kept: each select's Existing Claude login option. |
| 19 | Named options sorted signed-in first; state and disabling | Partial: §3 retains disabling; sorting and full state distinctions unspecified. |
| 20 | Chooser UUID suffix | Proposed removal. |
| 21 | Current selection; no implicit selection | Native selected value/chips replace badge; gap for missing/omitted/refused values. |
| 22 | Chooser no-named-account copy | Proposed replacement: S1 add guidance. |
| 23 | One-scope write; pending/refusal; remains available | One-scope prototype handler; pending/refusal and rollback behavior are gaps. |
| 24 | Selection success toast | Kept: S5 live Saved sentence; must await confirmed outcome. |
| 25 | Chooser keyboard/cancel/focus | Native-select replacement; post-write focus and escape behavior need definition. |
| 26 | Empty list explanation | Proposed replacement: S1 ambient row/add guidance; unknown ambient missing. |
| 27 | Labelled list, one card per account | Rows kept; list accessible name absent in prototype. |
| 28 | Ambient account row (new) | Added in §3; blocked on honest state/data contract. |
| 29 | Initials avatar | Kept in rows; prototype hardcodes W for editable named label. |
| 30 | Account label | Kept in rows/detail. |
| 31 | Full card UUID | Proposed removal, requested. |
| 32 | State dot/text, all seven states | §3/§4 keep mappings; prototype lacks signed-out/disconnected fixtures and labels. |
| 33 | Failed/disconnected attention spine | Partial: failed kept; disconnected not specified/shown. |
| 34 | Owner badge, both branches | Proposed removals; Verified identity exceeds D39. |
| 35 | Main/lane assignment badges | Kept as Used for chips. |
| 36 | List active-run count badge | Gap: spec moves counts only into Overview, without explicit list-badge disposition. |
| 37 | Whole-card Enter/Space/details action | §6 says Manage / row, but prototype row is not interactive; reconcile or propose removal. |
| 38 | Manage accessible action, one open | Kept: button opens inline detail, §3/§5. |
| 39 | Add button | Moved: Accounts bottom; prototype extra-account cap needs removal/justification. |
| 40 | Add local-label validation/max/disabled state | Inline replacement; max exists in mock but validation/invalid-disable missing. Preserve shared validator/limit. |
| 41 | Add label only; no selection; feedback | Changed to Add and sign in; no automatic selection in mock, but persisted/partial-failure feedback missing. |
| 42 | Add pending/refusal alert | Gap: inline form needs both. |
| 43 | Add focus/empty-on-open/close | §5 specifies initial focus and Cancel return; prototype only initial focus works; Escape/committed-close behavior unspecified. |
| 44 | Named native detail drawer, conditional account | Wrapper proposed replacement; accessible detail region/name needed within existing drawer. |
| 45 | Account tabs keyboard/hidden panels | Tabs kept; keyboard and associations not implemented in prototype. |
| 46 | Overview on every open | Proposed change: Access unless signed in. |
| 47 | Return focus/Escape; close does not cancel | §5 retains drawer behavior; explicitly preserve operation on close and detail focus recovery. |
| 48 | Polite action/rename/default feedback | Partial: save live region promise; rename/pending mapping missing, default proposed removal. |
| 49 | Safe refusal alert | S6 covers sign-in only; gap for rename/remove/select/etc. |
| 50 | Neutral unavailable result, visible actions | Gap: keep neutral fallback in detail; generic failed sign-in is not equivalent. |
| 51 | Overview UUID | Proposed removal, requested. |
| 52 | Overview state row | State moved to detail header in prototype; retain all states there. |
| 53 | Overview owner block/explainer | Proposed removal; verified branch is additional. |
| 54 | Active-run count and unchanged-running-work note | Moved/kept: Overview Running now, §3. |
| 55 | Resume-unavailable notice | Kept: Overview, §3; positive-running example not demonstrated. |
| 56 | No-bound-runs notice | Kept: Overview Running now empty state. |
| 57 | Access state heading/detail | Kept in §3 mappings; prototype does not cover all states. |
| 58 | Sign in/again/retry | Kept: Access, §3/§6. |
| 59 | Pending window instructions | Kept: Access S3. |
| 60 | Explicit Cancel sign-in | Kept: Access S3/S4. |
| 61 | Signed-in-only Sign out | Kept: Access. |
| 62 | Non-pending status refresh | Renamed Check status in §6; absent in prototype signed-in/signed-out/failed Access. Restore. |
| 63 | Host fallback script/copy/status | Kept in S4; manual-entry availability and keyboard-focusable script need correction. |
| 64 | Pending profile lock | Kept: disabled Profile fields/actions and explanatory text. |
| 65 | Rename/hint/save/result | Kept: Profile; result, validation and refusal details need mapping. |
| 66 | Atomic both-scope Set as default | Proposed removal; no equivalent in two selectors. |
| 67 | Metadata-only removal confirmation/focus | §3 retains inline confirmation; prototype only has inert Remove button, confirmation focus unspecified. |
| 68 | Every in-flight action disables actions and announces | Gap: pending sign-in profile lock is not the general action-busy state. |
| 69 | No identity/secrets in detail | Preserve inherited constraint; host fallback remains intentional plain text. Never interpolate editable labels as HTML. |
| 70 | Unconfirmed write/reload warning | Gap: retain dedicated warning, never Saved or Nothing was changed. |
| 71 | Connection tabs by kind | Changed beyond request: Accounts valid; Advanced invalid for Claude; preserve Used By/Tiers bodies. |
| 72 | Reset connection tab on connection change | No explicit replacement; retain existing effect, with a deliberate Accounts deep-link override. |
| 73 | CLI detection/login command/Check again | Claimed unchanged by prototype; preserve Credentials body. Detection is not account authentication. |
| 74 | Open drawer from Providers | Kept: Manage; added count link opens Accounts. |

Inventory §8's two rows describe existing missing fixture/reachability coverage, not removed user capabilities; keep them as implementation validation needs. Inventory §9's lane header/session labels and state-service RPC contracts remain out of scope and must stay intact. No tests were run for this review.

Gate 1.7 should remain REVISE until the ambient-state contract, atomic-default decision, complete parity outcomes, fallback availability, and accessible state transitions are concrete. The requested layout direction itself is feasible.
