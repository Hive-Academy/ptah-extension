# TASK_2026_466 — Batch 1: inbound peer message to a busy ptah-cli lane

Defect 1 of `context.md`. Scope: `libs/backend/cli-agent-runtime/**`,
`libs/backend/agent-sdk/**`.

## Root cause

The message was delivered to the model and was never rendered by Ptah, so it
read as lost. A spawned ptah-cli lane already asks the CLI to admit an inbound
peer turn — `ptah-cli-registry.ts:790` passes `crossSessionInbound: 'accept'`
through `buildFlagSettingsArg`, and `sdk-query-options-builder.ts:455`
serialises that key onto `--settings`. What the lane never asked for is the
ECHO. The chat path sets `--replay-user-messages`
(`sdk-query-options-builder.ts:1044`, inside `buildExtraArgs`); the spawn path
built `extraArgs` with `name` and nothing else
(`ptah-cli-registry.ts:720`, before this change). Without that flag the CLI
emits no user message for the injected turn, so `PtahCliStreamLoop` receives
nothing to render, the lane's segment buffer and output buffer stay empty, and
the only account of the turn is whatever the lane's own model chooses to say —
which on 2026-09-17 was `INBOUND: none`. A second, independent gap sat behind
it: the CLI stamps that echo `isReply: true` **and** `isSynthetic: true`, and
`isUserMessage` excludes replays by design
(`claude-sdk.types.ts:376-378`), so even with the flag on, the stream loop's
only user branch (`ptah-cli-stream-loop.service.ts:97`, before this change)
would not have matched it. Both halves had to move for the turn to become
visible.

Measured directly, not inferred. Three probes ran the real pinned SDK against
the installed CLI 2.1.270 with the lane's own options (`--name`,
`crossSessionInbound: 'accept'`, `permissionMode: 'bypassPermissions'`,
`settingSources: ['user','project','local']`, `persistSession: true`), and a
real `SendMessage` was sent from this session while each probe was mid-turn:

| Probe | Options                                                | `SendMessage`                                     | What the lane did                                                                                                                                                                                                                                                 |
| ----- | ------------------------------------------------------ | ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | SDK default CLI (2.1.150)                              | `success: false`, "No agent named … is reachable" | Registry record carried no `messagingSocketPath` — an old CLI registers no inbox at all                                                                                                                                                                           |
| 2     | CLI 2.1.270, no echo flag                              | `success: true`, msg `289774ac-…`                 | Model answered `INBOUND: PROBE_PAYLOAD_7X: …` on the next turn. **No user message appeared on the SDK stream.**                                                                                                                                                   |
| 3     | CLI 2.1.270, no echo flag, host pushes NO further turn | `success: true`, msg `aca34eb4-…`                 | Lane read it MID-TURN and replied to this session unprompted: `SELF_STARTED_TURN_SAW_9Z`                                                                                                                                                                          |
| 4     | CLI 2.1.270, `--replay-user-messages`                  | `success: true`, msg `6f9b7949-…`                 | A user message DID appear on the stream: `origin: {"kind":"peer","from":"uds:\\\\.\\pipe\\LOCAL\\cc-msg-39c5…","msg_id":"6f9b7949-…"}`, `isReplay: true`, `isSynthetic: true`, content wrapped in `<cross-session-message from=… from-name=… from-mode="bypass">` |

Probe 3 settles the transport question: the message reaches the model without
any push from Ptah. Probe 4 settles the visibility question: the echo appears
only with the flag.

## Rejected hypotheses

1. **"The cross-session inbound setting is not enabled on ptah-cli spawns."**
   Refuted twice. In source: `ptah-cli-registry.ts:790` passes `'accept'` to
   `buildFlagSettingsArg`, and `ptah-cli-registry-auto-compact-argv.spec.ts:458`
   already pins `crossSessionInbound: 'accept'` on real argv through the pinned
   SDK. In the CLI: the settings precedence is
   `["policySettings","flagSettings","userSettings"]`, each gated by a source
   check that ALWAYS adds `flagSettings` and `policySettings` to the enabled
   set — so `settingSources: ['user','project','local']` cannot suppress the
   flag tier (read off the 2.1.270 binary, functions `w()`, `Fo()`, `Sr()`).
   Neither `.claude/settings.json` nor `~/.claude/settings.json` in this
   worktree sets `crossSessionInbound`, so no repo tightening applies. Probe 2
   then showed the model receiving the message with exactly these settings.
2. **"The message is queued into a prompt mailbox that the turn loop never
   drains."** Refuted. The peer path never touches Ptah's mailbox — it is a
   CLI-to-CLI named pipe (`messagingSocketPath` in
   `~/.claude/sessions/<pid>.json`). Ptah's own mailbox is separately proven to
   drain: `TASK_2026_402_a5c7/test-report.md` case 4 PASSED on this same
   `ollama cloud` lane (`queue-next-turn` → `QUEUED_ACK: ollama cloud lane
received the queued message` → `completed` exit 0), and
   `ptah-cli-prompt-mailbox.spec.ts` covers the generator directly.
3. **"End-of-turn handling drops the queue instead of starting a new turn."**
   Refuted. `AgentProcessManager.handleExit` sets the terminal status BEFORE
   calling `flushPending` (`agent-process-manager.service.ts:1533-1580`), and
   `continueConversation` resets `hasExited` and re-arms the record
   (`agent-process-manager.service.ts:1085-1100`) — so a parked message is
   delivered on the next settle. The same case 4 above exercises that path end
   to end. The queue is discarded only in `releaseSubprocess`, and that is
   logged at `error` with the dropped count
   (`agent-message-router.service.ts:278-291`), which the live run did not show.

## Change

1. `libs/backend/cli-agent-runtime/src/lib/ptah-cli/ptah-cli-registry.ts:714-731`
   — `extraArgs` is now seeded with `'replay-user-messages': null` instead of
   starting empty. This is what makes the CLI echo the injected peer turn back
   on the SDK stream. It is a null-valued flag, not a value argument. The
   comment records why it cannot double-render the lane's own prompts.
2. `libs/backend/cli-agent-runtime/src/lib/ptah-cli/helpers/ptah-cli-stream-loop.service.ts:43-75`
   — new `inboundPeerLabel(msg)`: reads `origin.kind === 'peer'` and returns the
   sender's self-reported name, or `another session` when it sent none. The
   provenance stamp is the only reliable discriminator, because `isUserMessage`
   excludes the replay and the transformer's `isSynthetic` drop would take it.
   The label is never the address: both are sender-authored, so a label that
   reads as a label cannot be mistaken for a verified identity — the same rule
   `SdkMessageTransformer.resolveInboundPeerLabel` already follows.
3. `libs/backend/cli-agent-runtime/src/lib/ptah-cli/helpers/ptah-cli-stream-loop.service.ts:77-105`
   — new `peerMessageBody(msg)`: strips the `<cross-session-message …>`
   envelope. A payload without the envelope is returned unchanged rather than
   rejected; the wrapper is the vendor's shape, and losing a real message
   because that shape moved is worse than one extra line of markup.
4. `libs/backend/cli-agent-runtime/src/lib/ptah-cli/helpers/ptah-cli-stream-loop.service.ts:130-149`
   — the loop now surfaces an inbound peer turn before every other branch and
   then `continue`s: one `emitOutput` line, one `info` segment carrying
   `Message from <peer>: <body>`, and one `info` log. It is deliberately NOT
   handed to the stream transformer — it is not a turn this lane took, so none
   of the assistant/tool state the transformer keys on applies to it.

Items 2, 3 and 4 describe the shape this batch first landed. Revision 1 below
changed all three — the label wording and its untrusted-name handling
(finding 2), the envelope stripping (finding 3), and the order of the shape
check against the origin read (finding 1). Read that section for the current
behaviour; the line numbers here are the pre-revision ones.

No new dependency, no new DI registration, no new lib. Nothing outside
`libs/backend/cli-agent-runtime/**` changed; `agent-sdk` needed no edit because
`isReplayMessage` and the `origin` stamp are already on its public barrel.

## Tests

Two new specs, both red before the change and green after.

- `libs/backend/cli-agent-runtime/src/lib/ptah-cli/ptah-cli-registry-inbound-peer.spec.ts`
  — drives the real `spawnAgent()` to the SDK `queryFn()` call and asserts
  `extraArgs['replay-user-messages'] === null`, that it rides ALONGSIDE
  `--name` rather than instead of it, and that `crossSessionInbound: 'accept'`
  is still sent (the echo is useless if the turn is held).
- `libs/backend/cli-agent-runtime/src/lib/ptah-cli/helpers/ptah-cli-stream-loop.inbound-peer.spec.ts`
  — feeds the loop the exact message shape probe 4 captured and asserts the
  segment and the raw output line, the neutral-label fallback, the
  envelope-free payload case, that the lane's OWN replayed prompt renders
  nothing, and that the peer turn never reaches the transformer.

**Red, before the change** (source stashed, specs kept):

```
$ npx jest --config libs/backend/cli-agent-runtime/jest.config.ts --testPathPatterns "inbound-peer"
  ● PtahCliRegistry.spawnAgent — inbound peer visibility › asks the CLI to echo user turns so an inbound peer turn is observable
    expect(received).toBe(expected) // Object.is equality
    Expected: true
    Received: false
    > 158 |     expect(extraArgs && 'replay-user-messages' in extraArgs).toBe(true);
  ● PtahCliRegistry.spawnAgent — inbound peer visibility › sends the echo flag alongside --name, never instead of it
    expect(received).toBeNull()
    Received: undefined
    > 172 |     expect(extraArgs?.['replay-user-messages']).toBeNull();

Test Suites: 2 failed, 2 total
Tests:       6 failed, 3 passed, 9 total
```

**Green, after the change:**

```
$ npx jest --config libs/backend/cli-agent-runtime/jest.config.ts --testPathPatterns "inbound-peer"
Test Suites: 2 passed, 2 total
Tests:       9 passed, 9 total
Snapshots:   0 total
Time:        3.868 s
Ran all test suites matching inbound-peer.
```

**Both libs, full target:**

```
$ npx nx run-many -t test -p @ptah-extension/cli-agent-runtime @ptah-extension/agent-sdk
 NX   Running target test for 2 projects:
Test Suites: 2 skipped, 111 passed, 111 of 113 total      (agent-sdk)
Tests:       3 skipped, 1984 passed, 1987 total
Test Suites: 62 passed, 62 total                          (cli-agent-runtime)
Tests:       1 skipped, 916 passed, 917 total
 NX   Successfully ran target test for 2 projects
```

**Typecheck and lint:**

```
$ npx nx run-many -t typecheck -p @ptah-extension/cli-agent-runtime @ptah-extension/agent-sdk
 NX   Successfully ran target typecheck for 2 projects

$ npx nx lint @ptah-extension/cli-agent-runtime
✖ 38 problems (0 errors, 38 warnings)
 NX   Successfully ran target lint for project @ptah-extension/cli-agent-runtime
```

The only warning touching a changed file is the pre-existing
`max-lines (1081)` on `ptah-cli-registry.ts`; the file was already over the
700-line soft ceiling before this change, and the change adds ten lines of
comment and one object key.

## Open risks

- **The end-to-end proof used a probe lane, not a real `ptah_agent_spawn`
  lane.** The probe reproduces the lane's SDK options
  (`--name`, `crossSessionInbound: 'accept'`, bypass permissions,
  `settingSources`, `persistSession`, the installed CLI binary) but not its MCP
  servers, hooks, system-prompt assembly or translation proxy. Re-running
  Batch 8 case 1 against a real lane is still required, and `context.md`
  acceptance criterion 6 already asks for it.
- **The 2026-09-17 lane ran a non-Claude model behind the ollama-cloud
  translation proxy.** Probes 2-4 ran on Claude. A weaker model could read the
  injected turn and still answer `INBOUND: none`. This change makes that case
  DISTINGUISHABLE — the segment appears on the tile whatever the model says —
  but it cannot make a model act on what it read.
- **A ptah-cli lane spawned with `systemPromptMode: 'standalone'` loses the
  CLI preset's own peer-messaging instructions**, so its model is never told
  that a `<cross-session-message>` wrapper is a peer and not its user. Not
  touched here: it is a spawn-assembly decision, not a delivery defect.
- **`--replay-user-messages` now echoes every user turn on the lane's stream,
  not only peer turns.** Non-peer replays are dropped by the stream loop (the
  new branch admits `origin.kind === 'peer'` only) and by
  `SdkMessageTransformer`, and a spec pins the lane's own prompt rendering
  nothing. The cost is stream volume, which the lane already buffers.
- **A peer message that arrives after the lane's process is released is still
  lost, and always will be.** `AgentProcessManager.releaseSubprocess` aborts the
  handle after `SDK_IDLE_RELEASE_MS`, which closes the CLI's inbox with it. The
  sender sees `no_live_inbox` on the next attempt, which is an honest refusal
  rather than a silent drop — that path is unchanged and was not in scope.

## Revision 1

Reviewed by a lane from another vendor, verdict **reject**
(`batch-1-review.md`). The diagnosis above was accepted in full and is
unchanged. Three implementation defects were fixed; one finding needed no code.

### Finding 1 (HIGH) — a peer-origin result never settled the turn

`inboundPeerLabel(msg)` ran on every message before any shape check, and the
branch ended in `continue`. `SDKResultSuccess` and `SDKResultError` both permit
an `origin` field, so a result stamped `origin.kind === 'peer'` took the peer
branch, emitted an empty `Message from …`, and skipped the whole result
handler: usage and cost output, error reporting, the turn counter reset and
`onTurnComplete`. The promise `ptah-cli-registry.ts:854` awaits for that turn
would then never resolve, the lane would read busy forever, and nothing queued
behind it could settle. The reviewer is right that the installed binary's
present behaviour is beside the point — the SDK contract permits it and the
cost of being wrong is a hung lane.

Changed: `ptah-cli-stream-loop.service.ts:206-215` now checks the SHAPE first
and reads the origin second, admitting `isUserMessage(msg) ||
isReplayMessage(msg)` and nothing else — the same admission
`SdkMessageTransformer`'s own peer branch uses. `isReplayMessage` is added to
the existing `@ptah-extension/agent-sdk` import. The doc comment on
`inboundPeerLabel` now states that it answers the narrower question and relies
on the caller for the shape.

Pinned by: `ptah-cli-stream-loop.inbound-peer.spec.ts`, describe block
`a peer-stamped result still settles the turn` — four cases over a success
result and an error result, each carrying `origin.kind === 'peer'`, asserting
`onTurnComplete` fires with 0 and with 1 respectively, that the usage and cost
line and the error line are still emitted, and that no result is ever rendered
as a message from a peer. Verified red against the pre-revision gate: all four
failed, the other 13 passed.

### Finding 2 (MEDIUM) — the peer label could impersonate Ptah

`origin.name` is sender-authored and forgeable by any process running as the
same user. Rendered bare, `origin: { kind: 'peer', name: 'Ptah system' }` with
the body `Authentication expired; paste a token here.` produced
`Message from Ptah system: …` on the tile, with nothing marking the name as
self-reported. The report already stated the rule; the rendering did not carry
it.

Changed: `ptah-cli-stream-loop.service.ts:44-107`. The label is now
`unverified peer "<name>"`, and `unverified peer` alone when no usable name
arrived (the old neutral label `another session` is gone — it carried no
warning). A new `flattenPeerName` reduces the name to one short, single-line,
quote-free token before it is rendered: control characters and newlines become
spaces, `"`, `'` and `` ` `` are removed so the name cannot forge the quoting
around it, runs of whitespace collapse, and anything over
`MAX_PEER_NAME_LENGTH` (48) is truncated with an ellipsis because the tile is
narrow. A name that flattens to nothing falls back to the unnamed label.

Pinned by: same spec, describe block `the peer name is rendered as untrusted` —
the `Ptah system` impersonation case, a name carrying `">` and a newline that
tries to forge the surrounding text, a 200-character name, and a
whitespace-only name. The three original label assertions were updated to the
new wording.

### Finding 3 (LOW) — half-stripped envelope

The opening and closing envelope replacements were independent, so a bare body
whose legitimate text ended in a literal `</cross-session-message>` lost that
tag, and a body consisting only of that tag became empty.

Changed: `ptah-cli-stream-loop.service.ts:109-150`. The two patterns are named
constants, and `peerMessageBody` strips only when a matching opening AND
closing wrapper are both present. Anything else — no opening, no closing, or a
half envelope — is returned untouched.

Pinned by: same spec, describe block `envelope stripping needs both halves` —
a body ending in the literal closing tag, a body that is nothing but the
closing tag, and an opening tag with no closing tag.

### Finding 4 — no code change

The reviewer weighed the extra user-turn volume `--replay-user-messages` puts
on the CLI stream, confirmed that Ptah's own consumers do not accumulate it,
and accepted the cost. This report already recorded it under Open risks; two
reviewers have now agreed it is the right trade. The code is unchanged.

### Verification after revision

```
$ npx jest --config libs/backend/cli-agent-runtime/jest.config.ts --testPathPatterns "inbound-peer"
Test Suites: 2 passed, 2 total
Tests:       20 passed, 20 total

$ npx nx run-many -t test -p @ptah-extension/cli-agent-runtime --skip-nx-cache
 NX   Running target test for project @ptah-extension/cli-agent-runtime:
Test Suites: 62 passed, 62 total
Tests:       1 skipped, 927 passed, 928 total
 NX   Successfully ran target test for project @ptah-extension/cli-agent-runtime

$ npx nx typecheck @ptah-extension/cli-agent-runtime
 NX   Successfully ran target typecheck for project @ptah-extension/cli-agent-runtime

$ npx nx lint @ptah-extension/cli-agent-runtime
✖ 38 problems (0 errors, 38 warnings)
 NX   Successfully ran target lint for project @ptah-extension/cli-agent-runtime
```

The warning count is unchanged from before this revision, and none of the 38
sits on a line this batch wrote. The `agent-sdk` target was re-run in the
previous round and this revision touches no file in that library, so it was not
re-run here.

## Revision 2 — applied by the orchestrator

`batch-1-review-round-2.md` returned `accept with fixes`: findings 1, 3 and 4
resolved, finding 2 (peer-name spoofing) only partly. The residue was real. The
flattener removed U+0000-U+001F and U+007F, so the Unicode FORMAT characters
survived — U+202A-U+202E and the isolates U+2066-U+2069. An unterminated RLO in
a name reorders the closing quote, the colon and the body inside the `<pre>`,
which can put sender-authored text AHEAD of the `unverified peer` warning. That
defeats the qualifier the round-1 fix added.

`flattenPeerName` now replaces `/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]+/gu`. `Cc` is the
old ASCII-control class. `Cf` is the class that carries the bidi overrides and
isolates. `Zl` and `Zp` are the two non-ASCII line separators, which `\s` did
cover but which belong with the rest of the rule.

The cap also moved from UTF-16 units to code points (`Array.from`), so a cut at
48 cannot leave a lone surrogate in the tile.

Pinned by `strips bidirectional controls so a name cannot reorder the warning`
(`ptah-cli-stream-loop.inbound-peer.spec.ts`).

## Revision 3 — applied by the orchestrator

`orchestrator-fixes-review.md` accepted the bidi strip and found something the
round-2 review had not: the label does not only reach the tile.

`emitSegment` is safe, and the reviewer proved it — `agent-card-output.component.ts:185`
binds an `info` segment as `{{ segment.content }}` inside a `<pre>`, which is an
Angular text interpolation with full escaping. No markdown is evaluated there.

`emitOutput` is the other consumer, and the raw-stdout fallback path renders it
through `ngx-markdown`. A peer name of
`[Ptah Security](https://evil.test/login)` therefore became a LIVE clickable
link, inside a line that reads `**Message from unverified peer "…":**`. An
unauthenticated sender could put a link of its choosing in front of the user
under Ptah's name. That is a worse outcome than the reordering the previous
revision fixed.

`flattenPeerName` now also removes:

- `[\p{Pi}\p{Pf}"'`]` — every quote character, not only the three ASCII ones.
  The name sits in a quoted slot and a curly or angle quote reads as a close.
- `[[\]()*_~<>|\]` — the markdown structural set. A peer name legitimately
  needs none of these.

Pinned by `strips markdown structure so a name cannot forge a link` (which
asserts on the `emitOutput` text, not only on the segment) and `strips curly
quotes, not only the ASCII ones`.
