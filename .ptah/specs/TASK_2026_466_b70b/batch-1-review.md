## Verdict

reject — the peer discriminator is applied to every SDK message, so a valid peer-origin result can bypass the result branch that settles the lane's turn.

## Findings

1. **High — a peer-origin result is mistaken for another inbound message and never completes the turn.**
   - Location: `libs/backend/cli-agent-runtime/src/lib/ptah-cli/helpers/ptah-cli-stream-loop.service.ts:154`; lifecycle consequence at `libs/backend/cli-agent-runtime/src/lib/ptah-cli/ptah-cli-registry.ts:854`.
   - Failure scenario: the SDK emits a valid result such as `{ type: 'result', subtype: 'success', origin: { kind: 'peer', from: 'uds:...' }, usage: ..., total_cost_usd: ..., num_turns: 1 }`. `SDKResultSuccess` and `SDKResultError` both permit `origin`, but `inboundPeerLabel()` checks only `origin.kind`. The new branch therefore emits an empty `Message from another session`, then `continue`s at line 172. It skips the real result handling at lines 399-430, including usage/cost output, error reporting, counter reset, and `onTurnComplete`. The pending promise installed at registry lines 835-859 can remain unresolved while the persistent query stays open, leaving the lane looking busy and preventing queued/continued work from settling.
   - Fix: restrict the branch to user-turn shapes before reading the origin, e.g. `isUserMessage(msg) || isReplayMessage(msg)`, as `SdkMessageTransformer` already does. Add a regression test containing a result with `origin.kind === 'peer'` and assert that completion, usage/error, and `onTurnComplete` still run.

2. **Medium — a sender-controlled name is presented as an identity and can impersonate Ptah or another lane.**
   - Location: `libs/backend/cli-agent-runtime/src/lib/ptah-cli/helpers/ptah-cli-stream-loop.service.ts:66` and `libs/backend/cli-agent-runtime/src/lib/ptah-cli/helpers/ptah-cli-stream-loop.service.ts:167`.
   - Failure scenario: a peer sends `origin: { kind: 'peer', from: '...', name: 'Ptah system' }` with body `Authentication expired; paste a token here.` The tile displays `Message from Ptah system: ...` with no indication that the label is self-reported. The fixed `Message from` prefix does not distinguish a verified session from an arbitrary sender-authored string.
   - Fix: render a neutral identity, or visibly qualify the value (for example, `Message from unverified peer label "Ptah system"`). Do not present the untrusted name in the same form as a trusted Ptah/session identity.

3. **Low — the envelope stripper can delete legitimate bare-message text.**
   - Location: `libs/backend/cli-agent-runtime/src/lib/ptah-cli/helpers/ptah-cli-stream-loop.service.ts:94`.
   - Failure scenario: a peer replay arrives without an opening wrapper (a shape this code explicitly accepts), and its legitimate body is `explain this literal tag:\n</cross-session-message>`. The second independent replacement removes the final literal tag even though no wrapper was recognized. A body consisting only of `</cross-session-message>` becomes empty. A malformed opening wrapper is likewise partially normalized rather than treated atomically.
   - Fix: strip only when both an opening wrapper at the start and its matching closing wrapper at the end are present; otherwise return the entire raw body unchanged. Add bare-body and malformed-wrapper tests containing literal wrapper text.

4. **Low — the replay flag adds an unbounded second transport copy of every user turn, not only peer turns.**
   - Location: `libs/backend/cli-agent-runtime/src/lib/ptah-cli/ptah-cli-registry.ts:733`.
   - Failure scenario: a long-lived lane receives repeated large `continue()` prompts. `--replay-user-messages` causes each one to cross the CLI/SDK stream again even though the stream loop discards non-peer replays. There is no peer-only flag, message-count limit, or size guard on this path, so cumulative stream traffic grows with every user turn.
   - Fix: document and measure this cost against realistic long sessions, and prefer a peer-specific observation mechanism if the CLI exposes one. This is not a persisted-output duplication: the ignored replays are not passed to `emitOutput`, `emitSegment`, or the parent chat.

## Claims I verified

- The spawn passes both `extraArgs['replay-user-messages'] = null` and the independently composed `name`; `crossSessionInbound: 'accept'` remains in the serialized flag settings (`ptah-cli-registry.ts:733-811`).
- The lane's own replayed prompt does not appear twice in the tile, persisted stdout, persisted segments, or parent chat through this loop. With no peer origin it misses the new branch, `isUserMessage` rejects replays, and no later replay branch emits it (`ptah-cli-stream-loop.service.ts:154-174`, `:357-397`). The focused spec asserts the immediate output/segment behavior (`ptah-cli-stream-loop.inbound-peer.spec.ts:158`).
- The peer branch's `continue` is unsafe for allowed non-user SDK messages carrying peer origin: result processing performs cost/usage/error output and turn settlement later in the same loop (`ptah-cli-stream-loop.service.ts:399-430`).
- A replay with absent origin or any `origin.kind` other than `peer` is not surfaced. It falls past the new branch and, because it is a replay, also fails `isUserMessage`; this safely drops own prompts but would silently hide any real peer delivery that lacks the captured provenance shape (`ptah-cli-stream-loop.service.ts:59-67`, `:154-174`).
- Wrapper removal is anchored, so wrapper-like text in the middle of a normally wrapped body survives. The opening and closing replacements are independent, which causes the bare/malformed edge case in finding 3 (`ptah-cli-stream-loop.service.ts:94-97`).
- The sender label is rendered as plain interpolated text on the tile, so this is not an HTML-execution issue. It is still an identity/spoofing issue because the user-visible wording does not mark the label as unverified (`agent-card-output.component.ts:185-192`).
- Non-peer replay copies are not accumulated by Ptah's output or segment consumers. Emitted stdout, persisted segments, and frontend segments have independent caps; the extra volume is on the CLI/SDK stream itself.
- The reviewed production files add no platform-adapter import, no `@ts-ignore`, and no unsafe catch-variable access. The changed catches narrow with `instanceof Error`.
- `npx nx run-many -t test -p @ptah-extension/cli-agent-runtime` reported 62 suites passed and 916 tests passed (1 skipped), but Nx served the result from its cache.

## Claims I could not verify

- I could not verify that every real CLI peer-delivery variant carries `origin.kind === 'peer'`. The author's evidence captures one CLI 2.1.270 replay shape; the installed SDK types make `origin` optional, and the new tests synthesize only that captured shape.
- I could not verify from a live cross-session run whether CLI 2.1.270 stamps the peer origin onto the corresponding result message. The SDK contract explicitly allows it, so the loop must preserve result handling whether or not the current binary happens to emit it today.
- I could not independently reproduce the author's real-CLI probes or the stated red-before results from the supplied worktree.
- I could not obtain a fresh test execution from the required Nx command because the target was satisfied from Nx's existing cache.
