# Code Logic Review — `TASK_2026_533` Batch 8 (View-model mappers, C5 remainder)

Scope: `provider-row.ts`, `provider-filtering.ts`, `attention.ts`, `coverage.ts` and their
`.spec.ts` files, under `libs/frontend/marketplace/src/lib/data/` in the executor worktree
`agent-a6359901a5e46186d-427837245f23`. Read in full. Cross-checked against
`implementation-plan.md` C5/R3/A5, `batches.md` Batch 8 + Decomposition defaults, and the
backend files A5 cites (`chat-session.service.ts`, `sdk-agent-adapter.ts`,
`session-query-executor.service.ts`, `sdk-query-options-builder.ts`) in the same worktree.

## Summary

| Metric               | Value            |
| --------------------- | ---------------- |
| Overall score          | 7/10             |
| Assessment             | NEEDS_REVISION   |
| Blocking issues        | 0                |
| Serious issues         | 1                |
| Moderate issues        | 2                |
| Failure modes found    | 3                |

## Five logic questions

### 1. How does this fail silently?

A status can be shown as `connected` (or any live status) for a row that is not the row
the session actually reported on. `toProviderRow` (`provider-row.ts:239-276`) builds one
shared `sessionByKey` map keyed only by normalized server name
(`provider-row.ts:231-235`), and `reachesPtahSessions` (`provider-row.ts:300-302`) gates
borrowing the session status only for `harness-config` rows without a `claude` target. Any
other origin (`claude-user`, and in principle two same-named rows of different origins)
unconditionally reaches the session lookup. If a server with the same name exists as both
a `harness-config` row (reaching the session via `.mcp.json`/`claude` target) and a
`claude-user` row (`~/.claude.json`), or as `claude-user` alone when `settingSources`
excludes `'user'` but a same-named `harness-config`/other entry legitimately reports, both
rows key-match the one session entry and both display it as their own live status. See
Finding S-1 below — this is silent because nothing errors; the wrong row simply shows a
status it did not earn.

### 2. What user action produces unexpected behaviour?

Configuring (or having Ptah/Claude CLI already configure) the same server name in two
places at once — e.g. project `.mcp.json` and the user's own `~/.claude.json`, or a
`harness-config` entry and an OAuth/Smithery connection sharing a display name — makes one
of the two rows show a session-derived status (possibly `connected`) that belongs to the
other row's config, not its own. There is no origin check in the session match.

### 3. What input data produces a wrong answer?

Two `InstalledServerGroup`s of different `origin` with the same `serverKey`, where at
least one of them legitimately reaches the session. `toProviderRows` has no de-duplication
or origin-aware key for `sessionByKey`, so the second, unrelated row is answered from the
same map entry (Finding S-1).

### 4. What happens when a dependency fails?

`statusOf` (`provider-row.ts:322-337`) and `known` (`:339-347`) are total: an unrecognised
session or Smithery status degrades to `unknown` with the raw text preserved, never a
throw — correct per plan "Failure behaviour: total functions." `summarizeConfig` handles
`config === undefined` (connector rows) with an empty `ConfigSummary`
(`provider-row.ts:403-405`). `buildCoverageMatrix` and `needsAttention` are pure and total
over empty inputs (`coverage.spec.ts:222-224`, `attention.spec.ts` quiet-input cases).

### 5. What is missing that the requirements never mentioned?

- The plan never specifies what a row should show when two origins share a server name;
  the executor solved the one instance it found (`harness-config` non-`claude` target) but
  not the general cross-origin case (Finding S-1).
- `maskArgs` (`provider-row.ts:461-483`) cannot mask a bare positional secret that follows
  a flag whose own name does not match `SECRET_NAME` (e.g. `['--config', 'sk-live-xxx']`);
  this is an inherent limit of name-based heuristics, undocumented in the file's own
  masking contract comment (`provider-row.ts:9-13` only claims flag/assignment/URL
  coverage). Not new to this batch's URL/arg masking, but worth naming (Finding M-1).

## Failure modes

### S-1: Cross-origin session-status borrowing

- Trigger: two `ProviderRow`s of different `origin` (e.g. `harness-config` + `claude-user`,
  or `harness-config` + `oauth`) share a normalized `serverKey`, and at least one of them
  is a row that legitimately reaches the session.
- Symptom: the unrelated row also displays the session's status (possibly `connected`),
  `statusSource: 'session'`, even though the session's report describes the *other* row's
  config.
- Evidence: `provider-row.ts:231-235` (single name-keyed map, first-wins, origin-blind),
  `provider-row.ts:300-302` (`reachesPtahSessions` only excludes `harness-config` rows
  missing the `claude` target; every other origin returns `true` unconditionally).
- Current handling: none — the existing spec `provider-row.spec.ts:240-247` ("never
  borrows a session status for a row no Ptah session loads") only covers the
  single-origin, non-`claude`-target case; no case with two origins sharing a key.
- Recommendation: scope `sessionByKey` (or the lookup) by the row's own reachability
  contract per origin — at minimum, when `claude-user` and `harness-config` rows collide
  on `serverKey`, decide which one (if either) is entitled to the session's answer, and
  add a spec pinning it.

### M-1: Heuristic arg masking cannot catch a bare positional secret

- Trigger: `args` contains a secret value immediately following a flag whose name does not
  match `SECRET_NAME` (`/key|token|secret|passw|pwd|auth|credential|bearer|cookie/i`), e.g.
  `['--config', 'sk-live-...']` or a secret with no preceding flag at all.
  Evidence: `maskArgs` (`provider-row.ts:461-483`) only sets `maskNext` from the current
  arg's own name; it never inspects the value's shape.
- Symptom: the raw secret string reaches `ConfigSummary.args` and therefore the view.
- Current handling: none; not covered by any spec (all masking specs use a
  secret-recognizable flag or assignment).
- Recommendation: document this as an explicit, accepted limitation next to the masking
  doc comment (`provider-row.ts:9-13`), matching how the URL-path limitation is already
  called out — so a future reader does not assume arg masking is exhaustive.

### M-2: `TARGET_RANK` duplicates an unexported order with no drift guard

- Trigger: chat-ui's `TARGET_LABELS` order (`installed-mcp-groups.ts:37-50`) changes
  without a corresponding edit to the local `TARGET_RANK` (`provider-row.ts:194-202`).
- Symptom: `MCP_TARGET_ORDER`, `compareTargets`, coverage columns and the target filter
  option order silently diverge from chat-ui's own list order; no compile error, since the
  `Record` only enforces completeness over the union, not the order.
- Current handling: accepted, documented deviation #5 in `batch-8-report.md`, with a
  spec pinning today's order (`provider-row.spec.ts:408-428`) and a stated follow-up to
  export the order from chat-ui. Not a regression introduced here, but the guard is a
  frozen assertion, not a structural prevention.
- Recommendation: track the follow-up; no action required to approve this batch.

## Blocking issues

None.

## Serious issues

### Cross-origin session-status borrowing

- File: `provider-row.ts:231-235`, `:300-302`
- Scenario: a server name is configured both via a `harness-config` target that reaches
  the session (i.e. includes `claude`) and separately via `claude-user` (`~/.claude.json`),
  or via `oauth`/`smithery` with a display name matching a `harness-config` entry. Only one
  of the two actually corresponds to what the session's `SessionMcpServerEntry` describes.
- Impact: the "status honesty" invariant this batch's own header comment states
  ("Nothing here answers `connected` without one of those live sources") is not fully
  upheld — a row is shown `connected`/`failed`/etc. based on a live source that belongs to
  a *different* row's configuration, not its own. This is the exact class of bug the
  executor already fixed for the single-origin case (deviation #1, VS Code-only row), left
  open for the cross-origin case.
- Fix: origin-aware (or config-identity-aware) session matching, plus a spec with two
  same-named rows of different origin.

## Moderate and minor issues

- M-1 `maskArgs` cannot catch a bare positional secret with a non-suspicious flag name —
  `provider-row.ts:461-483`. Document as an accepted limit alongside the existing URL-path
  note.
- M-2 `TARGET_RANK` (`provider-row.ts:194-202`) is a hand-duplicated, unexported-source
  order with only a snapshot spec as a drift guard — accepted deviation #5, follow-up
  already recorded.

## Data flow

1. `toProviderRows(groups, sources)` builds one origin-blind `sessionByKey` map from
   `sources.sessionServers` — OK for the common case, gap noted at S-1.
2. Per group: `reachesPtahSessions` gates the lookup for `harness-config` only — partial
   coverage of the actual reachability contract (S-1).
3. `statusOf` applies session → OAuth → Smithery → `configured` precedence, each branch
   total via `known()` — OK, matches plan text (implementation-plan.md:337) and A5-verified
   producer/consumer chain.
4. `removalOf` builds the removal kind from the wire `removal` enum; `removalLockOf` is
   called only inside the `'none'` branch for non-connector origins, so `fixCommand` cannot
   appear on a removable row — OK, verified against `marketplace-inventory.store.ts:124-130`
   and the "ignores removalFixCommand on every removable row" spec.
5. `summarizeConfig`/`maskUrl`/`maskArgs` strip values into `ConfigSummary` — OK for
   env/header keys, URL userinfo/query and name-recognizable args; residual gap at M-1.
6. `filterProviderRows`/`sortProviderRows` operate only on the already-masked `ProviderRow`
   — no new leak surface; stability verified by spec (tie → name → original index).
7. `needsAttention` limits itself to the four documented sources; session items are
   de-duplicated against connection items by `target.ref`
   (`attention.ts:99-109`) — this reuses the same origin-blind row lookup
   (`rowForSessionKey`, `provider-row.ts`-adjacent `attention.ts:274-281`) as S-1, so in the
   same cross-origin collision scenario a session item could point at the wrong row and
   fail to de-duplicate against its connection item. Not spec-covered; same root cause as
   S-1, not filed as a second finding.
8. `buildCoverageMatrix` renders one merged "Ptah sessions" cell for every non-`config`
   `kind` — OK, and the A5 citations were independently re-read in the executor worktree:
   `chat-session.service.ts:339-368` (resolvers), `:536` (only caller),
   `sdk-agent-adapter.ts:643-668,726` (consumer), `session-query-executor.service.ts:101`
   (destructure), `sdk-query-options-builder.ts:922-926,967,1549-1557` (merge into
   `options.mcpServers`), `:988-991` (`settingSources` always includes `'project'`,
   conditionally `'user'`) — all confirmed to read as cited. `resumeSession`
   (`sdk-agent-adapter.ts:766-776`) confirmed to have no `mcpServersOverride` field in its
   config type.

## Requirements fulfilment

| Requirement                                                          | Status  | Gap                                              |
| ---------------------------------------------------------------------- | ------- | ------------------------------------------------- |
| Status precedence session → OAuth → Smithery → `configured` (C5)       | PARTIAL | Cross-origin key collision (S-1)                   |
| `ConfigSummary` carries no secret value, only keys (R3)                | PARTIAL | Bare positional secret bypass (M-1), documented gap |
| R3 acceptance: real store → real mapper, no secret in any view string  | COMPLETE | Verified real `TestBed`/`MarketplaceInventoryStore` path, real RPC mock, real `SessionMcpStatusRegistry` |
| Removal kinds; `fixCommand` only on blocked rows                       | COMPLETE | Verified against `removalLockOf` gating            |
| Attention limited to the four listed sources                          | COMPLETE | No fifth source found in `attention.ts`             |
| Coverage columns in `TARGET_LABELS` order, merged session cell (A5)    | COMPLETE | A5 citations re-verified in worktree                |
| Filtering/sort stability                                              | COMPLETE | Verified tie-break chain (key → name → index)       |

Implicit requirements not addressed: origin-aware disambiguation when two rows share a
`serverKey` (never stated in the plan, but the batch's own "session-only for reachable
rows" rule implies it should have been).

## Edge cases

| Case                                                        | Handled | How                                             | Concern                                    |
| ------------------------------------------------------------- | ------- | -------------------------------------------------- | --------------------------------------------- |
| Unrecognised session/Smithery status                           | YES     | `known()` → `unknown` + raw text                    | none                                          |
| VS Code-only `harness-config` row + same-named session entry   | YES     | `reachesPtahSessions` excludes it                   | none                                          |
| Same `serverKey` across two different origins                  | NO      | `sessionByKey` is origin-blind                      | S-1                                           |
| Secret value with a non-suspicious flag name                   | NO      | `maskArgs` only inspects flag/assignment names      | M-1, undocumented                             |
| Blocked row with no fix command                                | YES     | `removalLockOf` returns `{ reason }` only           | none                                          |
| Empty inventory (coverage/attention/filter)                    | YES     | Verified by spec (`toEqual([])`/`{columns:[],rows:[]}`) | none                                      |
| `MarketplaceInventoryStore` will gain a `TabManagerService` dependency in Batch 12b | N/A (future) | `batches.md` Wave E already schedules 12b to add the stub to this spec's `TestBed` | Not a defect of Batch 8 — flagged per orchestrator instruction only |

## Verdict

- Recommendation: REVISE
- Confidence: HIGH
- Top risk: a row can display a session-derived status (including `connected`) that
  actually describes a different, same-named row from another origin — this undercuts the
  batch's own stated "status honesty" guarantee in a case adjacent to the one it already
  fixed.
- What a robust implementation would add: an origin- or config-identity-aware session
  match (or an explicit, tested policy for which origin wins on a `serverKey` collision),
  a spec for that collision, and a one-line doc addition noting the positional-secret
  masking limit next to the existing URL-path limitation note.

---

## Round 2 (revise round 1)

Scope: re-read `provider-row.ts`, `provider-row.spec.ts`, `attention.ts`, `attention.spec.ts`
in full (same worktree). Independently re-derived the scope-precedence claim against the
cited sources in this worktree (not taken on the executor's word):
`node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts:6964` (settings precedence
`user < project < local < flag < policy`, stated for `enabledPlugins` but the same ladder
the SDK documents generally), `:6544` (`--mcp-config` / SDK `mcpServers` option treated as
one trust flow), `:1191-1197` (`McpServerStatus.scope`/`source` vocabulary includes
`dynamic`, `claudeai`, confirming the naming is not invented);
`libs/backend/cli-agent-runtime/src/lib/mcp-directory/claude-user-mcp.reader.ts:88-93`
(project overrides user for the same key, confirming the two-scope span claim); and
`libs/shared/src/lib/types/messages/session-mcp-status.ts:42-56,110-121` — confirmed the
parser keeps only `{ name, status }` from the SDK's `mcp_servers[]` array and drops
`scope`/`source` entirely, which is *why* `sessionOwners` has to infer ownership instead of
reading it off the wire. Ran the two changed suites directly
(`npx jest --config libs/frontend/marketplace/jest.config.ts --testPathPatterns
"provider-row|attention"`): 2 suites, 96 tests, all passed — independently reproduces the
claimed verification.

### S-1 — Cross-origin session-status borrowing: FIXED, accept

`sessionOwners` (`provider-row.ts:378-401`) with `SCOPE_RANK` (`:322-328`) and
`sessionScopeOf` (`:354-366`) replaces the single origin-blind lookup. A group owns the
session's report for its name only when its scope range strictly outranks every other
same-name candidate's range in full (`candidate.scope.low > other.scope.high` for every
other candidate, `:392-396`); when two ranges can overlap — `harness-config` (`project`,
exact) beside `claude-user` (`user..local`, a range because the wire does not say which —
verified true against the reader above) — neither owns, and both fall back to
`configured`. This is the safe direction (a status not proven is withheld, never invented),
matches the file's own restated invariant (`:21-25`), and is verified by four
table-driven cases (`provider-row.spec.ts:293-388`) that were not present in round 1:
ambiguous-neither, resolved-when-one-side-unreachable, dynamic-beats-config in both
orderings, and same-scope-tie (OAuth vs Smithery, each kept on its own live status). The
companion fix in `attention.ts` (`rowForSessionKey`, `:279-290`) now falls back to
`{ kind: 'servers' }` instead of guessing `matches[0]` when several rows share a key and
none owns the report — closes the related gap noted in round 1's data-flow step 7, with its
own spec (`attention.spec.ts:403-412`). No gap found in an independent re-derivation of the
scope ladder or a re-read of the ownership predicate. Round-1 Serious finding S-1: resolved.

### M-1 — Heuristic arg masking bare-secret bypass: FIXED, accept

`SECRET_SHAPES` (`provider-row.ts:507-525`) and `looksLikeSecret` (`:527-529`) add a
shape-based check ahead of the existing name-based one, applied to a bare arg
(`maskArgs:595`) and to an assignment's value (`:604-611`), independent of the flag or key
name. Re-checked the regex set for both false negatives and false positives:
- Every vendor pattern anchors the full string (`^...$`) and its character class excludes
  `:`, `/`, `?`, `@` (except where a literal vendor prefix contains `-`/`_`), so a URL or
  path argument cannot accidentally satisfy one — verified against the "ordinary argument"
  negative list (`provider-row.spec.ts:670-693`), which deliberately includes adversarial
  near-misses (`AKIA-not-a-key`, `github_pat_` with an empty tail, `sk-mcp`,
  `skill-creator`, a dash-delimited UUID, an all-uppercase env-style token) — traced each
  by hand against the regex set and confirmed none matches.
- The mixed-case long-token rule requires a digit, a lowercase letter and an uppercase
  letter all present (`provider-row.ts:521`); the two hex rules require a digit and a
  same-case hex letter present (`:523-524`) — this is why a UUID (all lowercase hex plus
  dashes, no uppercase) and an all-caps env-style name are correctly excluded.
- The residual gap from round 1 (a short or free-form secret after a semantically neutral
  flag, e.g. `--config hunter2`) is now an explicit, tested, documented limit
  (`provider-row.ts:15-20` file header, `provider-row.spec.ts:695-700`) rather than a silent
  one. This is the correct ceiling for a heuristic, name/shape-only masker — closing it
  fully would need semantic knowledge of the arg's meaning, out of scope for this file.
Round-1 Moderate finding M-1: resolved (documented residual accepted, not a defect).

### New defects

None found. No false-negative regression (every round-1-passing case still masks) and no
new false positive on a normal argument (traced the full negative list against the new
`SECRET_SHAPES` set by hand; independently ran the suite rather than trusting the executor's
report).

### M-2 status

Unchanged, out of scope for this revision (`TARGET_RANK` duplication, accepted deviation
#5, follow-up already tracked). Not re-touched in round 1.

### Round 2 summary

| Metric               | Value      |
| --------------------- | ---------- |
| Overall score          | 9/10       |
| Assessment             | APPROVED   |
| Blocking issues        | 0          |
| Serious issues         | 0          |
| Moderate issues        | 1 (M-2, pre-existing, tracked, non-blocking) |
| Failure modes found    | 0 new      |

- Recommendation: APPROVE
- Confidence: HIGH
- Top risk: none blocking; M-2 (`TARGET_RANK` drift guard) remains a tracked follow-up, not
  a defect of this batch.
