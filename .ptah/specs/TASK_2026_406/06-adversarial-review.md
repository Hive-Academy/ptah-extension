# 06 — Adversarial Review of 05-architecture-proposal.md

Task: TASK_2026_406 (research only). Reviewer: Ollama Cloud worker (glm-5.3:cloud, opus tier).
Date of all repository reads, log reads, and git queries: **2026-09-10**.
Docs/web citations carry their own access dates inline.

## 0. Method and evidence tags

I tried to refute report 05 by reading the cited SDK type definitions, the cited
Ptah sources, and the Ptah log corpus at `C:\Users\abdal\AppData\Roaming\Ptah\logs`
(62 files, 127 MB at review time; report 02 inventoried 63 files / 124.8 MB —
rotation drift, same corpus). Log greps were read-only; no session, setting, or
product file was modified. No raw log content beyond short cited fragments with
timestamp + session id prefix appears in this report; no log content was sent to
any web service.

Tags: `[M]` measured fact (log or executed build), `[C]` documented contract
(SDK `.d.ts` / docs / repo source as authority), `[I]` inference (stated
reasoning), `[U]` unknown (needs live validation). Report 02's `[F]*` tag means
"forensics, provenance unverified"; where I re-measured the same numbers myself,
I cite my own counts as `[M]` and note agreement.

## 1. Verdict in one paragraph

Report 05 is substantially sound: its capability ground truth (§2), its hard
gates (no history-edit API, no compaction cancel API), its correction of report
01's `compactionControl` claim, its port placement, and its fail-closed usage
policy all survive adversarial reading. It is NOT ready to hand to an implementer
unchanged. It missed one decisive, easily-checkable fact — the bundled Claude
Code runtime version — which resolves its own Unknown #1 and overturns report
04's headline. It also states two liveness claims that its own cited source
contradicts (the watchdog provides NO bounded dwell for compaction in either
the pre- or post-PR#484 build), it understates the documented rollback surface
(`forkSession`/`resumeSessionAt` are typed contracts, not `[U]`), and its
"never trigger on a fabricated window" gate does not close the one fabrication
vector that actually exists in the code (`DEFAULT_CLOUD_CONTEXT`). The log
re-measurement confirmed report 02's headline numbers exactly, but found an
uncounted population of 51 auto-compact hook events and a causality error in the
session-not-found narrative that both 02 and 05 repeat.

## 2. Severity-ranked blockers

### B1 (HIGH) — The proposal missed the bundled runtime version; its Unknown #1 and report 04's headline are already answered by a file in `node_modules`

`node_modules\@anthropic-ai\claude-agent-sdk\manifest.json` (read 2026-09-10)
states `"version": "2.1.150"`, commit `28d4819e…`, buildDate `2026-05-23`. The
SDK wrapper package is `0.3.150` (`package.json`), but the runtime the SDK
spawns is **Claude Code 2.1.150** `[M]`.

Consequences, all checkable, none speculative:

- Report 04's headline ("auto-compact broken on every third-party provider",
  via GitHub issue #65585) cannot describe this install: that issue's regression
  was introduced in Claude Code v2.1.161 per the issue thread (accessed
  2026-09-10), and 2.1.150 predates it. `[C]` for the issue text, `[I]` for the
  conclusion.
- The logs prove the positive: native auto-compact **fires** on this build.
  I count 52 `trigger=auto` PreCompact hook events — 51 on `internal-query-*`
  sessions plus the one user-session event (b54b966f) that report 02 counted
  `[M]` (see B6 for the population gap).
- Report 05 §11 Unknown #1 ("does `Settings.autoCompactWindow` actually reach
  the runtime?") is half-answered: the flag-settings tier is a control request
  (`apply_flag_settings`, `sdk.d.ts:2178`) and the runtime predates the
  documented `--autocompact` CLI surface, whose docs state a v2.1.221 minimum
  (docs.claude.com, accessed 2026-09-10) `[C]`. Whether 2.1.150 honors a
  written `autoCompactWindow` is therefore **more** doubtful than 05 implies,
  not less: 05 proposes it as a "native backstop" (§5.3) without noting the
  version floor. The backstop may be a silent no-op on this runtime. `[U]` —
  live validation mandatory before any design leans on it.

Fix: add a "Runtime version" fact block to §2.1; demote the
`Settings.autoCompactWindow` backstop from load-bearing (§5.4 level 3 depends
on it) to best-effort; carry "runtime honors flag settings on 2.1.150" as a
Stage-0 gate, not an assumption.

### B2 (HIGH) — The watchdog gives compaction NO bounded dwell in ANY build; §5.2's "COMPACTING watchdog-covered 180s+overdue" and §5.9's "liveness is the existing watchdog's job, unchanged" are both wrong

`libs\backend\agent-sdk\src\lib\helpers\no-activity-watchdog.ts` (read in full,
2026-09-10), `arm()` (lines ~200-225 of the current file):

- While `compacting` is true, the timer callback builds
  `operations = [...tools, 'compaction']`, calls `onOverdue`, and **re-arms in a
  `finally` block, forever**. It never sets `fired`, never calls `onTimeout`.
  There is no maximum dwell and no escalation path. `[C]` (source)
- Measured corroboration: `"Operation overdue"` appears **0 times** in the
  entire 127 MB corpus `[M]` — the post-PR#484 accounting branch has never
  executed in practice, because every measured compaction event predates the
  PR #484 merge (`git log`: merge `a2397288`, 2026-09-09T22:18:35+03:00 =
  19:18:35 UTC; the b54b966f kill was 14:42:14 UTC, ~4.6 h earlier) `[M]`.
- So the two builds bracket a no-win choice for §5.9's "unchanged" policy:
  pre-#484, the watchdog killed a session mid-auto-compaction at exactly 180 s
  (b54b966f, below) `[M]`; post-#484, a hung compaction (provider never
  returns, no `compact_result`) holds the session open with only a repeating
  warn log and **no termination** `[C]`+`[I]`.

Report 05's own transition table (§5.2) needs a COMPACTING dwell bound and an
abort path that the COORDINATOR owns — the watchdog cannot supply one in the
current build. Note also §5.10's "Watchdog abort during coordinator compaction
→ BACKOFF": in the current build that transition can never fire (the watchdog
will not abort while `compacting` is accounted); after a user abort it can. The
state machine's failure edge is dead code as written.

Fix: coordinator-owned max COMPACTING dwell (e.g. 180 s hard, configurable),
enforced by the coordinator aborting the session's `AbortController` (the same
controller `session-query-executor.service.ts:116` creates), with cleanup-first
permission resolution per the existing abort invariant. Do not rely on
`onOverdue` as a dwell signal — it is a log line, not a bound.

### B3 (HIGH) — The fabrication gate (§5.3 "Never trigger on a fabricated window") does not close the actual fabrication vector; §5.4 level 2's trust rule is not implementable on the current tracker surface

Two distinct problems:

1. **Window fabrication.** `libs\backend\auth-providers\src\lib\providers\local\ollama-cloud-metadata.service.ts:71`
   defines `DEFAULT_CLOUD_CONTEXT = 128_000`, substituted at :382, :404, :426
   whenever `context_length` is unknown `[C]`. Separately,
   `libs\shared\src\lib\utils\pricing.utils.ts:311` (`getModelContextWindow`)
   returns 0 for unknown non-Claude models `[C]`. Report 05's gate says "if
   `windowTokens` is unknown → no auto-trigger", but the registry does not
   return "unknown" — it returns a **plausible default**. A coordinator that
   reads the registry cannot tell 128_000-measured from 128_000-fabricated.
   On Ollama Cloud (Ptah's measured primary path, report 02), the trigger math
   would run on a fabricated window. `[I]`
   Fix: the usage port must expose provenance (`measured | default | pricing`),
   or the coordinator must read the model's declared `context_length` upstream
   of the default substitution.
2. **Usage-presence.** §5.4 level 2 says "Trust only when the live slot is
   populated (nonzero)". `LiveUsageTracker.getCumulativeTokens`
   (`libs\backend\agent-sdk\src\lib\helpers\live-usage-tracker.ts:105-165`)
   returns a bare number: a live snapshot that sums to 0 wins over the resume
   baseline by documented design ("a live snapshot always wins, even if it sums
   to 0" — class doc) `[C]`. The caller cannot distinguish
   snapshot-exists-and-is-0 from no-data-at-all. The proposed
   `IContextUsagePort` returning `{usedTokens, windowTokens} | null` cannot be
   implemented correctly over this surface; it needs a presence/has-snapshot
   signal (new tracker method or port-level `null` semantics defined at the
   adapter, not guessed). `[C]`+`[I]`

### B4 (MEDIUM) — The /compact injection seam tears down the session record; 05 inherits a measured race it mis-attributes to the runtime

`libs\backend\agent-sdk\src\lib\helpers\session-lifecycle-manager.ts:517`
(`executeSlashCommandQuery`): `await this._control.endSession(sessionId)` runs
**before** the new resumed query `[C]`. Two consequences:

- Mid-turn injection is structurally impossible (endSession kills the stream),
  which independently supports 05's turn-boundary design — but 05 does not cite
  this as the reason; it should, because it is a hard constraint, not a
  preference. `[C]`
- The measured "session-not-found 23 ms after PostCompact" (dd3a115a, report 02
  §, repeated in 05 §5.10) is **Ptah's own metadata store**, and the log shows
  the same `session-not-found … not in metadata store` error at
  **13:25:25 UTC — 6.5 minutes BEFORE the /compact command was issued**
  (13:31:57) `[M]`. PostCompact fired 13:34:41.365; the not-found lines follow
  at 13:34:41.422 (57 ms by my line pair; report 02 said 23 ms — same event,
  different anchor line) `[M]`. The error therefore predates compaction and is
  a property of that session's store state, not a PostCompact race. Both 02's
  causality framing and 05 §5.10's "Session-not-found after PostCompact →
  treat session as ended" recovery rule are built on a misread measurement.
  The rule may still be sensible defensive behavior, but its justification is
  wrong and its measured frequency ("once") is not evidence of a compaction
  race at all. `[M]`+`[I]`

### B5 (MEDIUM) — Rollback is a typed, documented SDK surface; 05's "[U] forkSession behavior unverified" understates it, and 03's adjacent claim is wrong

`sdk.d.ts:655-670` (`forkSession(sessionId, {upToMessageId})` — "Slice
transcript up to this message UUID (inclusive)") and `sdk.d.ts:1666`
(`resumeSessionAt?: string`, "Use with `resume`") are documented contracts of
the pinned SDK 0.3.150 `[C]` (read 2026-09-10). Also `Options.forkSession`
boolean at `sdk.d.ts:1388`.

- 05 §5.11 says "host-side rollback … not available … `forkSession` behavior
  unverified `[U]`". The honest scope is narrower: **in-place history
  replacement** is unavailable (correct, hard gate), but **pre-compact
  rollback** = fork at the last pre-compact message + resume at the fork is a
  designed-for combination the SDK documents. What is `[U]` is only whether
  2.1.150's `upToMessageId` slicing behaves as documented on third-party
  providers. 05 gates rollback behind the wrong claim.
- Report 03's statement that `resumeSessionAt` "cannot be combined with
  `resume` without `forkSession`" misreads the type: the mutual-exclusion
  constraint in the docs belongs to the `sessionId` option, not `resume`.
  03 should be corrected in passing; 05 did not catch it. `[C]`

Fix: re-gate rollback as "live-validate `forkSession`+`resumeSessionAt` on
2.1.150 third-party path" (a Stage-3 experiment, not a hard wall), and keep
the hard wall only for in-place replacement.

### B6 (MEDIUM) — Log population gap: report 02's "35 manual / 1 auto" describes only one logging surface; the real auto population is 52, and auto-completion has zero measured evidence

`"Compaction started:"` is emitted only by the **[electron RPC]** handler (the
user-facing slash-command path) `[M]` — first sample line names the source. My
re-count on 2026-09-10: 36 starts, 35 manual / 1 auto, 23/36 `preTokens=0`,
29 unique sessions — report 02's headline verified exactly `[M]`.

But `CompactionHookHandler` logs PreCompact hook events for ALL queries,
including internal ones. I count **51 additional `trigger=auto` PreCompact
events on `internal-query-*` sessions** (dates spread across 2026-08-09 →
2026-09-09) `[M]`. Report 02's population misses them; 05's §2.4 inherits the
undercount and its §5.8 dedup design reasons from "auto is rare" — on this
install, auto-compact hook events are the majority population (52 vs 35).

More important: **zero** `compact_boundary` or `compact_result` log lines exist
for any `internal-query-*` session, and the single user-session auto compaction
(b54b966f) ended in the 180 s watchdog kill with no observed completion `[M]`.
Caveat: Ptah does not log SDK `system/status` messages anywhere (0 hits for
`"compacting"`/`compact_result` in the whole corpus `[M]`), so absence of log
lines is not proof the runtime never completed a compaction — but there is no
measured evidence that an auto compaction ever completed in this environment,
and the only one that reached the user surface failed. Report 04's corrected
position should be "auto-compact fires on 2.1.150; completion unmeasured", not
"broken everywhere".

### B7 (LOW) — §5.4's `[F]*` framing of `preTokens=0` conflates two causes

23/36 starts with `preTokens=0` `[M]` is real, but the mechanism is known, not
mysterious: `preTokens` is sampled lazily from `LiveUsageTracker`
(`compaction-hook-handler.ts:170-230`, `ensurePreTokens()` →
`getCumulativeTokens`) `[C]`, and `getCumulativeTokens` returns 0 when no usage
frame was ever observed for the session (live snapshot absent, no resume
baseline) `[C]`. Provider paths that do not emit usage frames (measured:
openai-codex proxy on b54b966f and dd3a115a, model `gpt-6-astra` `[M]`) produce
0 by construction. So level-2 fallback will read 0 **always** on those paths —
not "sometimes". The design should treat provider-without-usage-frames as a
static capability bit per session, not a per-read reliability judgment. `[I]`

## 3. Claims verified as correct (no action)

For completeness, the following 05 claims I attempted to refute and could not:

- All cited `sdk.d.ts` lines/types: `autoCompactWindow` :5183, `autoCompactEnabled`
  :5373, `applyFlagSettings` :2178, `getContextUsage` :2218,
  `autoCompactThreshold?` :2764, Pre/PostCompact hook inputs ~:2081/:2009,
  `SDKCompactBoundaryMessage` ~:2587-2613, `SDKStatusMessage` ~:3521-3532,
  `Options.settings` :1726. `[C]`
- The zod bound `autoCompactWindow: number().int().min(1e5).max(1e6)` with
  `.catch(void 0)` — **silent drop** of out-of-range values, confirming 05's
  clamp-not-reject policy. `sdk.mjs` (grep, 2026-09-10). `[C]`
- `compactionControl` is dead configuration on the ptah-cli path: assembled in
  `ptah-cli-spawn-options.service.ts:221-227`, passed at
  `ptah-cli-registry.ts:752` through an `as Options` cast at :753 — `Options`
  declares no such field; the property rides a type-erased cast and the runtime
  ignores it. 05's §3.2 correction of report 01 stands, with these exact cites. `[C]`
- `resolveContextWindowOverride` (`sdk-query-options-builder.ts:912-924`)
  returns `{}` for first-party Anthropic, already-set env, and
  `getModelContextWindow() <= 0` — 05's reuse-don't-rederive instruction is
  sound. `[C]`
- `CompactionConfigProvider` defaults (enabled true, threshold 100 000, `<1000`
  rejected with warn) — `compaction-config-provider.ts:30-33, :71-86`. `[C]`
- `SessionReplay` compact_boundary slicing — `session-replay.service.ts:90-94`
  scans backwards for the LAST boundary and slices forward. `[C]`
- `ICompactionCallbackRegistry` non-blank `sessionId` invariant and its
  rationale — `memory-contracts/src/lib/compaction-callback.port.ts` (whole
  file). `[C]`
- `NATIVE_COMMANDS = {'clear'}`, `/compact` → `'new-query'` routing and the
  RPC→`executeSlashCommand` chain — `slash-command-interceptor.ts`,
  `chat-slash-command-router.service.ts:104-149`. `[C]`
- Curator reaction latency: b54b966f PreCompact 14:39:14.789 → curator
  transcript-split log 14:39:14.852 = 63 ms `[M]` (05 says ~62 ms — agree).
- Manual compaction duration: dd3a115a PreCompact 13:32:04.033 → PostCompact
  13:34:41.365 = 157.3 s `[M]` (05/02 say 157 s — agree). Note: this is only
  ~23 s under the pre-#484 180 s watchdog — see B2 for why that margin is
  design-relevant.
- Watchdog timeout population: `"produced no stream activity"` = 303 lines `[M]`
  (report 02: 303 — exact match). Report 02's label "watchdog timeouts" is
  correct for this phrase; my earlier suspicion that the count mixed in
  `supportedModels() timed out` lines was wrong — those are separate (~2 hits).
- Slash-command queries arm the watchdog on `start()` without the
  endTurn+hold taken by normal turns — `session-query-executor.service.ts:150-240`
  (`if (!isSlashCommand && !initialContent) { endTurn(); hold(); }`). `[C]`
- `getContextUsage` control requests require streaming input/output mode;
  Ptah runs `streamInput` — plausible but unmeasured on 2.1.150. `[C]`+`[U]`

## 4. Missing evidence and the minimal experiments to get it

Ordered by information value; all are read-only or throwaway-session probes
(except E1, which is a pure artifact read). None requires implementation of the
coordinator.

| # | Question | Minimal experiment |
|---|----------|--------------------|
| E1 | Which Claude Code runtime does each surface spawn? | Read `manifest.json` in every vendored SDK copy (`agent-sdk`, `cli-agent-runtime` node_modules if separate). Zero-risk, do first — B1 depends on it. |
| E2 | Does 2.1.150 honor `Settings.autoCompactWindow` written via flag-settings? | Throwaway session on the Ollama Cloud path: set `autoCompactWindow: 200_000` via `Options.settings`, hold a long transcript, observe whether PreCompact(auto) fires near the clamped level. One session, one evening. Gates §5.3/§5.4 level 3. |
| E3 | Does `Query.getContextUsage()` return real numbers on a third-party provider (Ollama Cloud, codex proxy)? | Throwaway streamed session: call `getContextUsage()` at turn boundaries, log `{usedTokens, autoCompactThreshold}` for ~10 turns on each provider path. Gates the whole `IContextUsagePort`. |
| E4 | Does `forkSession` + `resumeSessionAt` restore pre-compact history on 2.1.150 + third-party provider? | One throwaway session: compact manually, fork at the pre-compact message id, resume the fork, read `getSessionMessages` and confirm the pre-compact tail is present. Gates B5's re-scoped rollback. |
| E5 | Does an auto compaction ever COMPLETE here, and does the post-#484 watchdog behave during one? | Instrument (log-only patch on a branch, or manual test build): one long internal query forced past the window; observe `compact_boundary` arrival and whether `Operation overdue` ever logs. Resolves B2's unmeasured branch and B6's completion gap. |
| E6 | Which providers emit usage frames into `LiveUsageTracker`? | Existing logs already answer most of this: correlate the 13 nonzero `preTokens` starts with their provider/model fields (`gpt-6-astra` and similar are all zero). A one-hour log query, no new runs. Feeds B7's capability bit. |

## 5. Go / no-go per integration

| Integration (05 §) | Verdict | Conditions |
|---|---|---|
| Turn-boundary injection via existing `/compact` seam (§5.2, §5.6, §5.7) | **GO**, design-level | The seam exists end-to-end and mid-turn injection is impossible by construction (B4), which the design already assumes. Requires: coordinator-owned COMPACTING dwell bound (B2), and the injection must tolerate the endSession/resume session-record cycle (B4) — new session id handling in coordinator state. |
| `IContextUsagePort` over `Query.getContextUsage()` (§5.1, §5.4 level 1) | **GO, gated on E3** | If E3 fails on third-party paths, the port degrades to level 2 on those paths — and level 2 needs the presence fix (B3.2). Port must also expose window provenance (B3.1). |
| `LiveUsageTracker` as fallback source (§5.4 level 2) | **CONDITIONAL GO** | Only after the tracker surface exposes snapshot presence (new method) and the coordinator treats provider-without-usage-frames as a static per-session bit (B7). As specified, not implementable. |
| `Settings.autoCompactWindow` native backstop (§5.3, §5.4 level 3) | **NO-GO until E2** | 2.1.150 predates the documented flag surface (B1). Level 3's "fail-closed" promise currently rests on an unvalidated assumption. Do not let level 3 be the only safety net in the staged plan. |
| Native-auto deduplication via `CompactionCallbackRegistry` (§5.8) | **GO** | Mechanism verified (`compaction-callback.port.ts`, registry token shared). Design note: auto is the majority population (B6) — the dedup window is the common path, not the edge case; test it as such. |
| Coordinator COOLDOWN/BACKOFF/OBSERVE_ONLY recovery (§5.10) | **GO with edits** | Delete the "watchdog abort during coordinator compaction" edge (dead in current build, B2); re-base the session-not-found rule on B4's corrected causality (keep the defensive behavior, fix the justification); add a hung-compaction edge (no `compact_result`, dwell exceeded) — currently missing entirely because 05 assumed the watchdog owns it. |
| Rollback / checkpoint (§5.11) | **GO to experiment (E4), not to implement** | Re-scope from "unverified `[U]`" to "typed contract, live-validate on 2.1.150 third-party" (B5). In-place replacement stays a hard gate. |
| Memory-curator pre-compact reactor as preservation (§5.11, §5.12) | **GO** | 63 ms measured reaction `[M]`; port invariant verified. 05's "ensure reactor ran before injecting" is sound. |

## 6. Completeness assessment of report 05

**What 05 covers well:** capability ground truth with exact type cites; hard
gates stated without wishful thinking; the correction of report 01's
`compactionControl` claim; port placement consistent with the repo's hexagonal
rules (`memory-contracts` zero-dep port, registry fan-out reuse); fail-closed
usage philosophy; an honest unknowns register.

**Gaps found by this review:**

1. Runtime version fact (B1) — decisive, missed, and it rewrites two other
   reports' conclusions.
2. Watchdog dwell analysis (B2) — read the cited file's `arm()` loop; the
   "180s+overdue" bound does not exist.
3. Window provenance / tracker presence (B3) — two implementability holes in
   the load-bearing data path.
4. Seam teardown as a design constraint and the corrected not-found causality
   (B4).
5. Rollback re-scoping (B5).
6. Log inventory: 51 internal-query auto events uncounted (B6); zero
   `Operation overdue` / zero `compact_result` / zero status-`compacting` log
   lines anywhere — report 02 should note that Ptah never logs SDK system
   status messages, so "no evidence of auto completion" is a logging gap as
   much as a behavior gap (B6/B2). Report 02's other headline numbers (36/35/1,
   23/36, 29, 303, 157 s, 62-63 ms, b54b966f 180 s kill) all re-verify `[M]`.
7. Minor: 05 §5.4 quotes report 02's "23 ms" not-found gap; my line pair gives
   57 ms, and the error also fired 6.5 min before the compaction — the number
   was never the point (B4).

**Conflicts with sibling reports, resolved here:**

- 04's headline vs 02's measured auto fire vs 05's Unknown #1 → all three
  resolve against 04 once the runtime version is known (B1, B6).
- 03's `resumeSessionAt` mutual-exclusion claim → wrong as stated (B5).
- 01's "ptah-cli is the only compactionControl consumer" → 05 already
  corrected it; this review confirms with exact cites (§3).

## 7. Bottom line

Report 05's architecture (thin coordinator over runtime-owned compaction,
fail-closed usage, registry-based dedup) survives review. Before any
implementation hand-off, apply the seven fixes above — B1 and B2 are
non-negotiable because they change what the design is allowed to assume — and
run experiments E1-E3. E1 is free and answers a question three reports got
wrong. No product code was changed by this review.