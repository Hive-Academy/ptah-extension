# Audit — ptah-cli-usage (TASK_2026_435 batch 2a)

Scope: `ptah-core/skills/ptah-cli-usage/**` (packaged master under
`apps/ptah-extension-vscode/assets/plugins/ptah-core/skills/`) plus its
`.claude/skills/ptah-cli-usage/` copy. Line numbers refer to the original
SKILL.md (239 lines) or the original `references/agent-cli.md`
(239 lines), prefixed by file.

## Findings (rubric rule → line refs)

| # | Rubric rule | Finding |
| - | ----------- | ------- |
| 1 | SKILL.md routes | Body otherwise sound: four "Hard rule" sections are exactly the silently-breaking rules (NDJSON/stderr SKILL.md`:112–129`, flag placement `:132–157`, secrets `:160–173`, unattended approval `:176–192`), and the reference index `:195–205` carries load conditions. 239 lines still over target; the violations below are the excess. |
| 2 | One home per rule | "Quick don'ts" `:209–225`: all eight items are paraphrases of existing homes — interactive UI → intro `:16–17` + surface table `:19–29`; global-flag placement → hard rule `:132–157` (the item literally said "see above"); concurrent `task.submit` → `:106–108`; roster discovery → agent-cli.md`:15–18`; `--cli glm` → agent-cli.md`:26` + provider blockquote; `--ptah-cli-id` with a system CLI → agent-cli.md`:55–58`, `:208–211`; `resume` without `--task` → agent-cli.md §8; `ptah run` deprecation → blockquote `:91–93` (the command-map row `:41` kept as a terse pointer). The suspected "family exceptions in entry text" are all already homed in agent-cli.md. |
| 3 | Cut model education | n/a — round-2 keep applies: the wire contracts (in-process backend, stdin/stdout/stderr roles, exit codes, `PTAH_AUTO_APPROVE` scope) are unfamiliar-contract and failure-case material. Kept intact. |
| 4 | One example per mechanism | No repeated examples found. |
| 5 | No history | agent-cli.md`:35–40` blockquote "Earlier versions of this skill said only `glm` was accepted… Both claims were false"; `:73–77` "`ptah_agent_message` replaces the retired `ptah_agent_steer`"; `:222–224` "The CLI used to substitute an empty string…". |
| 6 | Contracts over narrative | No violations beyond those above. |
| 7 | No rosters/counts/versions | SKILL.md`:204` "51 tools with every namespace on"; `:205` "the 7 MVP tools"; `:201` "schema `0.2`" (all three are supplied at runtime by the tool surface / serve surface / `system.schema.version`). agent-cli.md`:22–27` selector table named all six system CLIs — a roster `SYSTEM_CLI_TYPES` supplies. |
| 8 | Role-gated | n/a. |
| 9 | No hardcoded brand | n/a — the skill's subject is the Ptah CLI; naming Ptah is correct (rubric 9 covers generic skills). |
| 10 | Measure what loads | Measured below. |

## Cuts and moves

- **SKILL.md**: cut the whole "Quick don'ts" section (`:209–225` plus one
  separator). No move needed — every family exception already has a home
  in `references/agent-cli.md`, which the "Where to read next" index
  routes to. Cut the "51 tools" and "7 MVP tools" counts and the
  "schema `0.2`" version from index rows (the rows still name
  `system.schema.version`, so schema-version readers still route
  correctly).
- **agent-cli.md**: cut the history blockquote (`:35–40`) — the current
  contract is fully stated by the selector table and the provider
  blockquote above it; trimmed the retired-`ptah_agent_steer` clause
  (`:73–77`) to the four delivery modes as runtime facts; trimmed the
  "CLI used to substitute" clause (`:222–224`) to the failure case
  (passing `--task ""` exits `2`); cut §9 "Don'ts" (`:228–239`) — all
  four items paraphrase homes in the same file; collapsed the six system
  CLIs into one "System CLI" row with the `SYSTEM_CLI_TYPES` pointer and
  the `agent-cli detect` discovery route.
- No teaching change: each cut rule remains at its home (verified per
  item above).

## Trigger-time KB (bytes of SKILL.md = what loads at trigger)

| File                       | Before              | After              |
| -------------------------- | ------------------- | ------------------ |
| SKILL.md                   | 13,058 B / 239 ln   | 12,283 B / 220 ln  |
| references/agent-cli.md    | 11,232 B / 239 ln   | 9,896 B / 216 ln   |
| references/ (other six)    | 63,656 B            | 63,656 B (untouched) |
| **Dir total**              | **87,946 B**        | **85,835 B**       |

Trigger-time KB: 13,058 → 12,283 (−6 %). Selected-reference KB for the
agent-cli path: 11,232 → 9,896 (−12 %).

## cmp results

`diff -r` packaged vs `.claude/skills/ptah-cli-usage/` after copying:
IDENTICAL (all eight files match byte-for-byte; no file set change).

## Checks

- `skill-description-shape.spec.ts` (vscode-lm-tools, the guard pinning
  the frontmatter): 6/6 passed — frontmatter untouched.
- harness-sync `-t "skill"`: the sibling-links guard that walks
  ptah-core skills passed. One suite failed —
  `harness-reconciler.skill-consent.spec.ts` (7 tests,
  `skillSyncMode` state logic). That spec never references
  `assets/plugins` or these skill files, so the failure is pre-existing
  on this branch and unrelated to these edits.

## Decisions

- Trim limited to the rubric violations the audit table suspected
  ("hard rules repeated in Quick don'ts; family exceptions in entry
  text") — both confirmed and fixed by deletion; nothing needed moving
  because agent-cli.md already homed every family exception.
- The other six references (setup, auth-and-providers, jsonrpc,
  internal-mcp, mcp-serve, harness) were not audited this batch: they are
  on-demand loads and outside the suspected-issue scope. A later pass
  can apply rules 2/5/7 inside them the way agent-cli.md was treated.
- The command-map row for `run` (`:41`) kept as a terse DEPRECATED
  annotation; the normative home is the `:91–93` blockquote.
- "Requires a real TTY" appears in both routing tables (`:29`, `:52`);
  kept — inline failure-case annotations, not paraphrase sections.
- `content-manifest.json` (repo root) NOT regenerated — outside the
  allowed edit set. No new files here, so only its content hash goes
  stale; regenerate once after all batch-2 trims land.