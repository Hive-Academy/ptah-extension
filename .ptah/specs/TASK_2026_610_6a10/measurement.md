# Measurement — TASK_2026_610_6a10 (PR A + PR B+C, Electron)

Measured by the orchestrator on 2026-10-05. Per the plan change recorded in `batches.md`, AM and BM were merged
into one measurement: one production build of the branch base against one of the final head.

- Base: `f314a4f8a` (merge-base with `origin/main`), built in a temporary detached worktree (since removed).
- Head: `148e60395` (all PR A and PR B+C batches committed, including Phase A fixes AF1-AF5).
- Command (both): `npx nx build ptah-extension-webview --configuration=production --skip-nx-cache --stats-json`

## Req 5.1 / 5.2 / 5.9 — initial bundle and eager closure

|                                                               | Base `f314a4f8a` | Head `148e60395` |     Delta |
| ------------------------------------------------------------- | ---------------: | ---------------: | --------: |
| Angular "Initial total" (raw)                                 |          3.21 MB |          3.22 MB | +~0.01 MB |
| Angular "Initial total" (transfer)                            |        668.15 kB |        673.12 kB |  +4.97 kB |
| Eager inputs (`eagerInputs`, `scripts/eager-closure-gate.js`) |              714 |              721 |        +7 |
| Initial chunk bytes (gate)                                    |        2,841,104 |        2,852,421 | +11,317 B |

`node scripts/eager-closure-gate.js dist/apps/ptah-extension-webview/stats.json --base <base stats>` exited 0:
no forbidden input is eager, and no unlisted eager growth.

The 7 added eager inputs (none removed):

| Input                                                           | Why it is eager                                                    |
| --------------------------------------------------------------- | ------------------------------------------------------------------ |
| `libs/frontend/chat/.../execution/ptah-ui-fence-line.ts`        | Zero-import line check that decides whether to load the lazy entry |
| `libs/frontend/chat/.../transcript/transcript-turns.ts`         | Turn grouping for the tests row and snapshots                      |
| `libs/shared/src/lib/utils/test-command-matcher.ts`             | Tests-row detection (Req 1.2)                                      |
| `libs/shared/src/lib/utils/turn-tests.utils.ts`                 | Tests-row detection                                                |
| `libs/shared/src/lib/utils/turn-sources.utils.ts`               | Per-turn source snapshot                                           |
| `libs/shared/src/lib/utils/usage-format.utils.ts`               | Formatters shared with the existing cost/duration badges           |
| `libs/frontend/chat-ui/src/lib/services/ptah-ui-live-window.ts` | Per-tab live cap (provided by the transcript)                      |

The parser, converter, resolver, pipeline, `PtahUiBlockComponent`, `PtahUiMessageTextComponent`,
`declarative-dashboard` and chart code are not eager. They load only through `@ptah-extension/chat-ui/ptah-ui`
behind `@defer`, after the fence-line check, on Electron.

The pre-existing warning "bundle initial exceeded maximum budget (2.50 MB)" is present at the base too; this
task adds ~0.01 MB raw.

## Req 5.10 — coding-profile tool list

No MCP tool definition changed: `git diff --stat f314a4f8a..HEAD -- libs/backend/vscode-lm-tools` is empty. The
coding profile's `tools/list` is therefore byte-identical to the base (54,471 chars, Electron-like, per
TASK_2026_595 `measurement.md`). The channel adds no tool schema, by user decision.

## Req 5.11 — system-prompt hint

- `PTAH_UI_HINT` (`libs/backend/agent-sdk/src/lib/prompt-harness/ptah-ui-hint.ts`): **77 tokens**
  (`gpt-tokenizer` `encode`), limit 100. Pinned by `ptah-ui-hint.spec.ts`.
- Sent only when `hostKind === 'electron' && (mcpToolProfile ?? 'coding') === 'coding' && ptahUiFence === true`
  (`sdk-query-options-builder.ts`), pinned by the 7-row truth table.
- `PTAH_CORE_SYSTEM_PROMPT` is unchanged and stays within its 4,000-token pin.

## Req 5.12 — host data never returns to the model

Pinned by `message-sender.host-data.spec.ts` (real `ChangeSetStore`, positive and negative controls, a resolved
`ptah-ui` block whose next `chat:continue` carries only the raw `$diff.files` text) and
`sdk-query-options-builder.host-data.spec.ts`.

## Req 5.13 — compactness (corpus, `gpt-tokenizer` 4.0.0)

| Corpus case                   | Fence tokens | JSON tokens | Fence / JSON |
| ----------------------------- | -----------: | ----------: | -----------: |
| turn-summary-sources-crlf     |           39 |         193 |        0.202 |
| literal-table-escapes-unicode |           41 |         123 |        0.333 |
| changed-files-columns         |           19 |         129 |        0.147 |
| test-run-list                 |            8 |          81 |        0.099 |
| coverage-trend-chart          |           35 |         109 |        0.321 |
| release-checklist-mixed       |           70 |         218 |        0.321 |

Source: `batch-B3-report.md`, pinned by `ptah-ui-compactness.spec.ts`. JSON counts use unresolved placeholders,
so the saving for host-bound blocks is larger in real use (the host fills rows the agent never types).

## Not measured here

- Per-PR split (PR A alone vs PR B+C): the branch interleaves A and B commits. Measure again at the PR cut if
  the PR A branch is created by cherry-pick.
- Colour contrast and rendered layout: deferred to the visual review in the running Electron app.
