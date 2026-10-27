# Code review

**Verdict: REVISE — 6/10.** Two major findings; no blocking, minor, or nit findings. Two concrete failure modes.

This review supersedes the earlier reports. **Replay-flag concern: resolved by revert**, as directed by the coordinator; it is not an open finding. The remaining ordering and attribution failures keep the score below 7; the implemented peer insertion, UUID guard, shared history builder, and focused passing tests distinguish it from the 3–4 band (streaming-handler.service.ts:462,523,530; history-message-builder.service.ts:97; streaming-handler.inbound-peer.spec.ts:387,459).

## Scope and artifact

Final scope confirmed by the coordinator: the worktree is frozen, and the only source change during review was reverting sdk-query-options-builder.ts and its spec to main. This report is complete for that scope; no further snapshot clarification is pending.

Reviewed the supplied 18-file diff, including its new files, against the previously read implementation and surrounding execution paths. Following the coordinator's correction, the options builder and its spec are excluded as reverted, leaving the other 16 files under review. Also read fix-plan.md, investigation.md, repository instructions, and relevant tests. Traced active/background routing, history/live-seed handling, finalizer placement, SDK user-message filtering, and CLI/TUI consumers. References are worktree-relative.

A read-only comparison of every supplied new-side hunk against disk found that all hunks match for the 16 remaining files. The coordinator confirmed that sdk-query-options-builder.ts and its spec were reverted to main, making their task.diff hunks stale. This verdict evaluates the remaining diff with those two hunks' files excluded; the mismatch is explained and requires no reconciliation for this review. The coordinator also confirmed that no caller passes `enableFileCheckpointing: false`, so replay was already enabled on the application's current call paths. That caller inventory is coordinator-provided evidence, not an independent exhaustive search by this reviewer.

No git commands were run because the reviewer role prohibits git operations. The supplied diff now establishes the requested scope, including untracked additions. message-finalization.service.ts is an unchanged dependency in this diff; its placement behavior was inspected to determine the impact of the new insertion helper.

## Findings

1. **Major — an older unstamped prompt is mistaken for a prompt queued behind the new peer.**

   **Location:** `libs/frontend/chat-streaming/src/lib/inbound-peer-message.ts:12` and :41.

   **Scenario:** An earlier user prompt U has a client-generated non-UUID id and no `nativeUuid`. Its turn is interrupted before an assistant reply becomes renderable, leaving U at the transcript tail. The finalizer retains existing messages on its early/empty-tree exits (message-finalization.service.ts:184,228-260). Ordinary replay echoes do not guarantee a stamp because the backend discards them (sdk-message-transformer.ts:296). A later peer turn P arrives. The new helper infers “queued behind P” solely from U's missing stamp and client id and returns `[P, U]`, although U preceded P.

   When P's reply A is finalized, `placeFinalizedTrees` anchors at P and places the root messages ahead of the existing suffix (message-finalization.service.ts:85-95), leaving `[P, A, U]`. It cannot correct the initial mistaken order. Chronological persisted replay instead places U before P. Requirements 1 and 2 fail.

   **Suggested fix:** Use explicit pending-queue/turn ownership to determine insertion position, not absence of a native UUID. Preserve older settled/interrupted prompts ahead of new peers. Add a regression for an interrupted empty turn followed by a peer, alongside the genuinely queued prompt test. The existing ordering spec starts from a finalized assistant response and covers only the latter case (streaming-handler.inbound-peer.spec.ts:486).

   This is a deterministic code-path finding; an interactive cancellation reproduction was not run.

2. **Major — a human-typed envelope becomes a peer message after reload.**

   **Location:** `libs/backend/agent-sdk/src/lib/helpers/history/session-replay.service.ts:199`.

   **Scenario:** A human sends this ordinary root user message, for example while asking about the protocol:

   ```xml
   <agent-report agent-id="lane-1" agent="Reviewer" cli="codex">
   Please explain this example.
   </agent-report>
   ```

   Live classification uses peer origin in the SDK transformer (sdk-message-transformer.ts:220). The ordinary optimistic user bubble has no `inboundPeer`, so the component does not parse it as a lane envelope (message-bubble.component.ts:452). On reload, the added replay code classifies any matching root text as a peer and supplies its self-reported label at :212. The same human message now displays as “codex · Reviewer,” gets the caption “Sent from another session,” and renders the compact envelope body (message-bubble.component.html:198,223,232). Reloading changes attribution and presentation. The “unverified” caption does not fix the false assertion that another session sent it.

   **Suggested fix:** Persist authoritative message-origin metadata keyed by transcript UUID when accepting injected messages and use it for both live and replay classification. Any syntax-only fallback for older history must be represented as inferred formatting, not asserted peer provenance, with consistent live/history treatment. Test a human-typed valid envelope through replay conversion and bubble rendering. Current tests only reject plain ordinary text (session-replay.service.spec.ts:453; message-bubble.component.spec.ts:543).

   This finding concerns attribution and parity. No authorization bypass or executable XSS is claimed.

## Required behavior and test evidence

| Requirement | Evidence and limitation |
| --- | --- |
| 1. Separate compact live peer turns | Root user completion inserts the peer (streaming-handler.service.ts:523,571); the component renders its heading/body (:452 and template :232). Finding 1 breaks position for an earlier unstamped prompt. |
| 2. Reload/resync/hidden reveal parity | User construction is shared (history-message-builder.service.ts:97,239). The parity spec (:387) compares synthetic pre-labeled events, not persisted JSONL replay plus the live-seed handoff. Both findings violate parity. |
| 3. Release queued users only at turn end | The completion gate excludes user roots (streaming-handler.service.ts:530); spec :442 covers peer echo followed by reply. The harness mocks TurnStateApplier (:349) and manually finalizes (:361), so it does not prove real terminal-state/revision races. |
| 4. Never stamp a peer UUID onto a user | The explicit `!inboundPeer` guard (streaming-handler.service.ts:462) and focused spec :459 support this case. |
| 5. Working/Worked and final selection per turn | transcript-turns.inbound-peer.spec.ts:237,248 exercise grouping and last-assistant contexts. They do not prove browser collapse behavior after resync or the ordering failure in finding 1. |

The duplicate-delivery test repeats the same event sequence (streaming-handler.inbound-peer.spec.ts:428). The background test (:532) checks peer insertion, without revealing the tab and comparing its completed transcript. No integrated test found here combines real replay conversion, buffered/live events, background finalization, and reveal. These are coverage limitations, not additional asserted runtime defects.

## Resolved by revert: replay flag and other consumers

The coordinator reverted the unconditional `--replay-user-messages` change and its spec to main. The current builder retains the checkpoint conditional at sdk-query-options-builder.ts:1471. Per the coordinator, no application caller disables checkpointing, so the proposed flag change was unnecessary for existing call paths. **Disposition: resolved by revert; no open finding and no request to restore unconditional replay.** The corresponding task.diff sections are stale and are excluded from this verdict.

Ordinary `isReplay: true` human echoes are discarded by sdk-message-transformer.ts:296-301, after the peer-specific branch at :220. Therefore enabling replay does **not**, by itself, establish that a user's own prompt is double-rendered by CLI/TUI consumers. The earlier concern about this is withdrawn. Role-blind text aggregation downstream is insufficient evidence of reachability past the filter. An actual CLI session was not run to independently validate its echo flags.

## Five logic questions

1. **How can failure look successful?** Missing ordering metadata silently produces a valid-looking reordered transcript (finding 1). Neither insertion nor placement reports an error (inbound-peer-message.ts:47; message-finalization.service.ts:124).
2. **Which user action produces unexpected behavior?** Reloading a human-pasted valid envelope changes its sender/presentation (finding 2). Interrupting a prompt before a renderable reply leaves the trailing state involved in finding 1.
3. **Which input gives a wrong answer rather than an error?** Valid human envelope text is misclassified at session-replay.service.ts:199. A trailing client-id user message without a native UUID is treated as evidence of queue position at inbound-peer-message.ts:12, even though that evidence is insufficient.
4. **What if a dependency fails, times out, or returns an unexpected shape?** Interruption before a root tree leaves existing messages in place (message-finalization.service.ts:184,228). Missing start metadata prevents insertion (streaming-handler.service.ts:576). Malformed envelope syntax falls back to ordinary rendering (lane-envelope.ts:39; message-bubble.component.html:272). Reconnection and malformed transport payloads were not experimentally exercised; no further defect is asserted.
5. **What requirements were missing?** The insertion contract needs an authoritative distinction between pending and previously interrupted prompts. Replay needs a provenance policy for human-authored envelopes. Exact parity also needs a combined persisted-history/live-seed test, rather than only synthetic pre-labeled input (streaming-handler.inbound-peer.spec.ts:387).

## Rendering, parser, and accessibility

No executable XSS was verified: heading/preview use Angular interpolation (message-bubble.component.html:239,255), expanded text goes through toUserMessageMarkdown (message-bubble.component.ts:483), and the shared renderer installs its sanitizer (provide-markdown-rendering.ts:229,491). This was code inspection, not an exploit test.

The parser anchors both ends, requires matching closing-tag kind, and rejects missing required attributes (lane-envelope.ts:39,65). Its tests cover plain text, prefix/suffix text, mismatched tags, missing cli, and attribute unescaping (lane-envelope.spec.ts:39,47). These syntax checks cannot establish provenance; finding 2 remains.

The disclosure uses a native button with `aria-expanded` and `aria-controls` (message-bubble.component.html:260). The enclosing article still says `aria-label="You"` at :186 for peers, potentially misidentifying the sender during article navigation. The supplied template diff begins at :229 and does not change that article or the existing peer caption. This is pre-existing behavior, not a finding introduced by this diff.

## Verification

- Previously ran exactly `npm run verify -- -t test -p @ptah-extension/chat-streaming -- --output-style=static`.
- **30 suites passed; 699 tests passed, 1 skipped; exit 0.** Log: `C:\Users\abdal\AppData\Local\Temp\lane-report-logic-tests.log`.
- All supplied chat-streaming hunks still match the tested working files. No suite was rerun solely to reread its result.
- Scoped `ptah_get_diagnostics` reported TypeScript still running after 45 seconds and requested files unchecked. This is **unavailable**, not a clean diagnostic result.
- Did not run shared, agent-sdk, or chat suites, build, e2e, or an interactive host session. The options-builder change and its new expectation were reverted; no claim is made that the stale diff's test passed in this workspace.
- Only code-review.md was written; no reviewed source or git state was modified.

## Decisions

- **Apply the coordinator's scope correction.** Review the supplied diff except the reverted options builder and spec. Evidence: the prior hunk comparison identified exactly those two differing files, and the coordinator confirmed their revert to main. Reversible if those changes are reintroduced.
- **Close the replay-flag concern as resolved by revert.** The coordinator reports no caller disabling checkpointing. Independently, sdk-message-transformer.ts:220,296 distinguishes peers before discarding ordinary replays, so the earlier own-prompt duplication concern was never verified. No source change or further flag change is requested by this review.
- **Treat envelope syntax as formatting, not proof of sender.** Options: content-only classification, persisted provenance, or explicitly inferred legacy rendering. Recommend persisted provenance with a clearly inferred legacy fallback. Evidence: session-replay.service.ts:199 versus message-bubble.component.ts:452. No security policy was changed.

