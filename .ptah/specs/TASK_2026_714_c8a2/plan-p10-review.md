# Review of plan-p10.md (session 29)

- Author: codex lane (gpt-6-sol, CLI side). Reviewer: coordinator (in-process side, Claude).
- Verdict: **APPROVED WITH AMENDMENTS** (R1-R4 below are binding on every P10 batch; they
  override the plan text where they differ).

## Checked

- Preserve list: 23 rows cover detection/binary, credentials, model catalog, effort, budgets,
  config and model rejection, Ptah + user MCP, role/preamble/policy canary, events/usage,
  rollout usage, resume identity, messaging flags, abort, Windows hide, approval/sandbox,
  suppressions, plan limits, report contract. Spot-checked anchors: codex-execution-profile.ts
  :142-188 and :257-260, parity-inventory.md:7,12,24-25,67. They match.
- Removal B boundary: only the lane owner (`cli-agent-runtime`) drops the SDK; root, agent-sdk,
  app package/externals and the windows-hide patch stay until P15. Agreed.
- Native default per host in 10d, proof in 10d.P before 10e. Agreed (D5).

## Amendments

R1 (blocking, resolved by the user as D26). The plan did not define the lane level or who
answers lane approval requests. Binding rule: native lanes use `consumer: 'lane'`, workspace-write
limited to the lane working directory, `networkAccess: false`; the 10b adapter declines every
App Server approval request (command, file change, permissions, MCP elicitation) at once, writes
one lane-output line with kind + names only (no command text, path or cwd), and the turn
continues. No `explicitFullAccess`, no parent-chat cards. Specs: each request kind is declined
once, the turn reaches its terminal status, the output line carries no command text. The 10d.P
proof row "Approval and sandbox selection" records the accepted reduction (shell network,
writes outside the working directory) with reference D26.

R2. 10b.0a and 10b.0b change `@ptah-extension/codex-runtime`, which main chat and gateways use.
Verify lists for both: codex-runtime, cli-agent-runtime, agent-sdk, rpc-handlers,
gateway-chat-bridge, ptah-electron; typecheck ptah-cli, ptah-tui, ptah-extension-vscode. Add a
spec that a chat and a gateway profile built from the same inputs keep the same
`codexProfileFingerprint` as before the change (a changed fingerprint makes saved chats refuse
to resume, D14a).

R3. Lane contexts never share a `CodexContext` with chat; the 10d.E spec proves that a lane
profile change does not change an open chat context's policy, and the reverse.

R4. Executors follow the routing rule: codex implements -> grok reviews; grok implements ->
Kimi Code reviews (fallback codex). The plan's executor per batch stands.
