# Task Context - TASK_2026_561_9e57

## User Request

(2026-09-26, during TASK_2026_559 Batch 9b) "don't you think those tasks needs to be added in one task? that we target
after this one? can you sort that out and add missing follow up we made in this task as well"

"Those tasks" = the separate compaction work (TASK_2026_406 research, the TASK_2026_411 B8 / TASK_2026_414 settings
work, and the tokaudit Wave 3 compaction layer). This task collects all open compaction work in one place and adds every
unscheduled follow-up and known issue recorded by TASK_2026_559.

## Order

Start after TASK_2026_559_8ca9 merges. Track A needs the `tool-output-reducers` library (559 Batches 2a-2f) on `main`.
Track B edits the same files as 559. TASK_2026_560_2ae5 (per-caller / per-workspace tool sets) is independent and may
land before or after.

## Task Type

FEATURE (Track A) + BUGFIX (Track B). Complex. Full orchestration depth; the architect decides whether Track A and
Track B stay one task or split at planning time.

## Sources consolidated here

| Source                 | Where                                                                      | State                                       | What this task takes                                                                       |
| ---------------------- | -------------------------------------------------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------ |
| TASK_2026_406          | main `.ptah/specs/TASK_2026_406/07-final-research.md`                      | research done, `in_progress`, nothing built | Phases 0-3 (§7), buildable-now list (§4.1), open questions (07:181-188)                    |
| TASK_2026_411 B8       | deleted folder; `git show 89830ebf4^:.ptah/specs/TASK_2026_411/...`        | moved to TASK_2026_414 / PR #493            | the unfinished default (see A1)                                                            |
| TASK_2026_414          | main `.ptah/specs/TASK_2026_414/`                                          | `done` (PR #493)                            | nothing open, except that the 2026-09-25 audit still sees `autoCompact {}` in 88/88 builds |
| TASK_2026_557_tokaudit | `.ptah/specs/TASK_2026_557_tokaudit/research-report.md` (this branch only) | recommendations                             | Wave 3 (:270-300); W1.6 pairing (:238)                                                     |
| TASK_2026_559_8ca9     | `.ptah/specs/TASK_2026_559_8ca9/batches.md`                                | in progress                                 | known issues and "follow-ups (not blocking)" (Track B)                                     |

Not merged here (tracked elsewhere or not compaction): TASK_2026_400 and TASK_2026_418_a91c are `in_review` (status
flip only); TASK_2026_376 F6 (compaction hooks on one-shot queries) stays in 376; TASK_2026_362 owns the native pi-ai
loop compaction. Tokaudit Waves 2 and 4 (proxy allowlist, lane prefix, spec split, resume gate) are open but are not
compaction; they need their own task. Tokaudit Wave 0 is user-owned settings (`~/.codex/config.toml`) — never edited
by an agent.

## Track A — Ptah-owned compaction layer

Design stance (406 verdict): coordinate and observe native compaction; do not replace it. Tokaudit :274: budgeted
threshold compaction + entry-time capping + session rotation; not `clear_tool_uses`, not a proxy stub pass.

- A0. Phase 0 experiments (406 §7): E2 (`autoCompactWindow` honoured by SDK 0.3.150?), E3, E4 (fork/resume rollback),
  E5. Answer the six Remaining Questions (07:181-188). Fix the fabricated 128k Ollama Cloud window first (406
  prerequisite)
- A1. Budget resolver, Claude (W3.1, :277-281): default `autoCompactWindow` when the user has not set one.
  **Open decision:** tokaudit says default 200000 after one live session; 406 says do not wire it until E2 passes. Gate
  on E2. Also resolves why `ptah.compaction.*` is "dead configuration" (406) and the 88/88 `autoCompact {}` audit result
- A2. Budget resolver, Codex (W3.2, :283): `model_auto_compact_token_limit` in `codex-cli.adapter.ts` runSdk config,
  new setting `agentOrchestration.codexAutoCompactTokens`
- A3. Entry-time capper, Claude (W3.3, :286-289): `PostToolUseHookHandler` returns `updatedToolOutput` for built-in
  Bash/PowerShell/Grep/MCP/Read output over budget. **Reuse** `libs/backend/tool-output-reducers` (`reduceOutput`, the
  token budget and the spool) from TASK_2026_559 — do not write a second head/tail capper. Oversized whole-file Read →
  outline pointing at the full-file path (W1.6 pairing, :238)
- A4. Entry-time capper, Codex (W3.4, :291): `tool_output_token_limit` in the adapter config
- A5. Subagent budget (W3.5, :293): hand off and spawn fresh at about 150k; resume policy; selective
  `subagentPromptCacheTtl: '1h'`
- A6. Session rotation (W3.6, :298): offer "rotate session from spec + summary" at about 300k
- A7. Guardrails (W3.7, :300): coalesce the curator PreCompact trigger (`memory-trigger-config.ts:74-76`) behind a
  per-session watermark
- A8. Coordinator (406 §4.1): CompactionCoordinator state machine (IDLE / ARMED / TRIGGERED / COMPACTING / COOLDOWN /
  BACKOFF / OBSERVE_ONLY); `/compact` path with no `endSession` first, rebinding to the new session id; bounded 180 s
  dwell in `no-activity-watchdog.ts arm()`; auto/manual dedup; `IContextUsagePort` with provenance; keep the curator
  PreCompact reactor; telemetry. Fork/resume rollback only after E4
- Not buildable on SDK 0.3.150 (406 §4.3): cancel/edit of a running compaction, history replacement, Codex parity —
  record, do not attempt

## Track B — TASK_2026_559 follow-ups and known issues

Line numbers are as recorded in `TASK_2026_559_8ca9/batches.md`; re-check them at planning time.

### B1. tool-output-reducers known issues (Track A depends on these being safe)

- KI-2b-1 (Blocking): Markdown outline — an unclosed inline HTML wrapper (`<a hidden>`, `b`, `i`, `em`, `strong`, `s`,
  `font`, `u`) exposes a hidden heading. Refuse (`markdown-unchanged`) on inline HTML in non-code raws
- KI-2c-1..KI-2c-4 (Blocking): HTML extractor — character-reference decoding differs from the browser; hidden table
  ancestry drops fostered visible content; CSS NBSP / `all:` reset visibility; closed `<details>` content emitted.
  Direction for all: refuse when unsure
- KI-2c-5 (Serious): anchor comparison decodes whole text nodes before its bound (2,203 ms at 2 MiB)
- KI-2c-6, KI-2c-7 (Moderate): unfinished anchor comparison treated as inequality; whitespace-only `<pre>` dropped
- Minor: `html-tree.ts:65` collects `class` with no consumer
- KI-2d-2 (Moderate): multi-line non-brace arrow bodies under-compress at boundary rows (`code-outliner.adapter.ts:232-245`)

### B2. `.tsx` / `.jsx` grammar (one fix, three gaps)

- Package `tree-sitter-tsx.wasm` (`scripts/copy-wasm.js`, the three `verify-packed-wasm` scripts, the
  `TreeSitterParserService` grammar set, `SupportedLanguage`). Closes KI-2d-1 (JSX never outlined), Batch 7
  follow-up (b) (`.tsx` enrich summaries) and Batch 8 follow-up (a) (`.tsx` definition fallback)
- Batch 7 (c): add `.mts/.cts/.mjs/.cjs` to `EXTENSION_LANGUAGE_MAP`, then delete the local alias

### B3. ptah_context_enrich_file (Batch 7)

- KI-7-4 first: keep the property keys of elided pure-data objects over 400 chars (or refuse)
- KI-7-1..KI-7-3: decorator-installed members, instance-field initialisers, getter/template coercion in kept literals
- (d) `types.ts` `ContextNamespace.enrichFile` JSDoc still says "Optional language hint"
- (e) the pure-declaration gate refuses many ordinary files; use the TASK_2026_559 Batch 20 harness numbers to decide

### B4. Dependency graph (Batch 9 / 9b)

- 9b: a single file whose synchronous Tree-sitter parse exceeds the 1.5 s bound still delays the response — move
  parsing to a worker thread
- 9b: empty-workspace rediscovery runs on every sequential call with no cooldown or file-watcher invalidation
- 9b: readiness awaits `workspace.getInfo()` before the graph timer; no end-to-end bound for a slow provider
- 9b: `execute_code` `getDependencies` / `getDependents` / `getSymbolIndex` answer `[]` when no graph is built — add a
  `building`-style hint
- 9b: `resolveDependencyQueryPath` — a declared root that equals a host folder but is spelled differently (case) can
  miss multi-graph prefix routing
- 9 (a): listing every file before the 5,000 cap may cost memory on 100k+ file repositories (benchmark it)
- 9 (b): `ptah-system-prompt.constant.ts` bullet shows `getSymbolIndex()` with no arguments — needs a user decision,
  because TASK_2026_559 Decision 4 freezes the shared prompt constants
- (Update this list with any residuals the Batch 9b post-cap review records.)

### B5. Code-symbol index (Batch 5 / 6)

- Batch 5 (a)/(b) and KI-5-1: indexed `symbol_name_lower` column with a persistence-sqlite migration and backfill;
  removes the O(workspace) non-ASCII miss scan, the two-scan ASCII miss (43.7 ms at 100k rows) and the U+212A gap
- Batch 6 (a): the VS Code startup index run (`wire-runtime.ts:207`) is outside the namespace in-flight latch
- Batch 6 (c): `internal-mcp.md` always-on tool count is out of date (12 listed vs 15 served)

### B6. MCP transport and dispatcher

- Batch 3 (a) (Moderate): `http-server.handler.ts` `extractCaller*` call `decodeURIComponent` unguarded (:248, :274,
  :306); a malformed escape returns `-32700` with `id:0` instead of the `anonymous` caller
- Batch 3 (c): `protocol-dispatcher.ts` is far over the 700-line soft ceiling — facade split (tool catalogue, budget /
  spool, telemetry, graph readiness, per-tool handlers)
- Batch 2f: an error thrown inside `execute_code` reaches the agent as "Code execution failed: Unknown error" (sandbox
  errors are not host-realm `instanceof Error`)
- Batch 2f / 2e: `ptah_browser_content` HTML section is cut or omitted by the 32 KiB + 1 KiB override
- Batch 8 (b): `ptah_lsp_references` description needs the "once the dependency graph is built" qualifier
- Batch 8 (c): `safeReadFile` logs a file path and raw error text; (d) `phase-3-storage.ts:203` "via symbol index" log
  text is out of date
- Batch 4 (a): per-host server instructions filtered by the served tool set (was not approved scope in 559 — needs a
  user decision); (b) specs in other projects that import `protocol-dispatcher.ts` must load `reflect-metadata` first

### B7. Release and smoke checks

- Packaged Electron host and installed `ptah-cli`: confirm `marked` in the generated manifest and load the reducer
  pipeline; packaged-app startup after the externals change; live concurrent spool writes. Carried to 559 Batch 21 /
  release — move them here if 559 closes without them
- `http-server.handler.spec.ts:220` real-port lifecycle spec fails in sandboxes that deny port binding

### Accepted, not scheduled (recorded so nothing is lost)

- Batch 6 (b): `ptah_code_reindex` bypasses the governor per-batch wait (accepted by the 559 batch spec)
- Batch 8 (e): TOCTOU between realpath containment and read (local tool; accepted)
- Batch 2x-audit: 4 historic over-length commit subjects are not rewritten
- Batch 2d minors: no spec for a nested local `variable_declarator` focus symbol; `render()` run-cost off by one char

## Decisions needed before planning

1. A1 default: tokaudit 200000 vs 406 "gate on E2" (recommend: gate on E2).
2. Keep Track A and Track B in one task, or split Track B into its own task at planning time.
3. B4 prompt bullet and B6 per-host instructions: both touch surfaces TASK_2026_559 froze.
