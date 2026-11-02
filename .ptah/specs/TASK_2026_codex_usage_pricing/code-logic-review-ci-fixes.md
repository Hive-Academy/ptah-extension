# Code Logic Review - CI fixes (codex usage pricing)

Verdict: APPROVE (one moderate note)

## Publish rule (codex-chat-turn-stream.ts:241-246)
- Terminal observed via observeUsage (:303-304) before projection.map (:434) and before the stop/drain publish (:421, :608), so every terminal (completed, failed, interrupted) publishes; markMissingEvidence (:197) makes coverage partial; turnCost null when no usage evidence (:256).
- No terminal and no usage: early return (:246), no zeros published. Terminal-less stream end (:405-408) publishes nothing: correct, unknown not $0.
- Result callback (:348-350) and stop/drain publish (:421, :608) are mutually exclusive (stopRequested continues before projection.map); no double publish found. Price recorded once via recordTurnPriceOnce (:228).
- Partial usage (only input or output) with no terminal returns early: correct.

## Spec change
Correct statement of batch 4 contract (terminal without usage -> unpriced turnCost null + partial lifetime), consistent with lifecycle spec; does not mask a bug.

## Moderate
- :256/:285 use turnUsageObserved only, not turnTerminalObserved. An early result after a usage event but before terminal publishes a non-null turnCost (not $0, but not final), contradicting the :225 comment; the terminal then republishes. Consider gating cost on turnTerminalObserved.

## Marker comments
Conversions to plain comments in adapter.ts:315, :603 and host-ports.ts:234 are behaviour-neutral; catches log or return unknown.
