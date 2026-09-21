# Child-prompt two-way messaging guidance — implementation record

Branch `feat/task-477-child-messaging-guidance`, off `main` at `32f28f79d`.

## 1. The adjacent defect, diagnosed before anything was written

`context.md` asked for one look at `agent-output-root.md` before more prompt
text went into the same builder. The cause is not a broken substitution. There
was no substitution at all.

`buildTaskPrompt` emitted the seven characters `{agentId}` as a LITERAL. A
repository-wide search for `{agentId}` found exactly two occurrences: the
builder line and the spec that pinned it. Nothing anywhere replaced it, on any
path. The spawned agent is never told its own agent id either — the id reaches
the child only as the `/agent/{id}` segment of its MCP URL, which the child
does not read and must not name (`ptah_agent_report` takes no id for exactly
that reason).

So the agent was handed a template hole with no value to put in it, and
invented one. `root` is the invention it settled on.

The second half of `context.md`'s guess is also real and independent: the line
said "use convention", which does not yield to the explicit filename most task
prompts already give, so a lane that read both wrote both files.

### Fix

`cli-adapter.utils.ts`, `buildTaskPrompt`:

- The real `options.agentId` is substituted. It is already on
  `CliCommandOptions` and `AgentProcessManager` mints it before `runSdk`, so
  every production spawn has it.
- Without an id the line is OMITTED. An unfillable placeholder is worse than no
  instruction.
- The wording is now subordinate to the task: "If the task above names no
  deliverable file, write the main deliverable to … Do not invent another
  name."

## 2. The child-side guidance

`TWO_WAY_MESSAGING_GUIDANCE`, a module constant in `cli-adapter.utils.ts`,
appended as its own `---`-delimited section. It covers the three gaps
`context.md` measured: `ptah_agent_report` and what `delivered: false` means, a
message arriving mid-run, and that the child may itself be a parent.

It is emitted only when the run has BOTH an `mcpPort` and an `agentId`. Without
a port the tools it names do not exist; without an id a report cannot be
attributed and would be refused. Telling an agent to call a tool it does not
have is the same failure the task was held back to avoid.

### The three binding constraints

| Constraint | How it is held | Pinned by |
| --- | --- | --- |
| Name no vendor | Text points at `ptah_agent_list` and says any name in a document is an illustration | a spec looping `SYSTEM_CLI_TYPES` with word boundaries over the rendered prompt |
| Describe no mode as available | Text says the tool returns the mode it used and to read that | a spec asserting none of the four mode names appears |
| Measure the bytes | 826 bytes added, delimiter included | a spec differencing the rendered prompt with and without the section |

### Measured cost

**826 bytes**, delimiter included. The relevant budget is the Windows `.cmd`
fallback limit of 8,191 used by `assertCommandLineWithinLimit`, so this is
about 10% of the tightest budget. Recorded as a fact, not as a ceiling to grow
into — the spec asserts the exact figure, so any later edit to the text has to
restate the number deliberately.

## 3. One source of truth

`TWO_WAY_MESSAGING_GUIDANCE` is the source. The other two copies now reference
it rather than restating it:

- `.claude/skills/agent-lanes/SKILL.md` §7 names the constant and its file, and
  says a lane does not need to be told any of this in its `task`.
- `ptah-system-prompt.constant.ts` keeps the parent-side tool table. Its
  `ptah_agent_message` row gained the two facts that had drifted: the
  capability is probed per run rather than fixed per vendor (TASK_2026_465),
  and a message to a ptah-cli lane is echoed into that lane's own output
  (TASK_2026_466 defect 1), which is the observable that answers "did it
  arrive?".

## 4. Verification

All runs with `--skip-nx-cache`, from the worktree.

| Target | Result |
| --- | --- |
| `test @ptah-extension/cli-agent-runtime` | 961 passed, 1 skipped, 62 suites — baseline 949 plus 12 new |
| `test @ptah-extension/vscode-lm-tools` | 1161 passed, 50 suites |
| `typecheck` + `lint`, both projects | succeeded, 0 errors (39 pre-existing spec-file warnings) |

The byte count was measured by the test rather than asserted from a draft: the
first run reported 826 against a guessed 875, and the constant's doc comment
and the spec were both corrected to the measured figure.

## 5. Acceptance criteria

| # | Criterion | State |
| --- | --- | --- |
| 1 | A spawned agent calls `ptah_agent_report` without being told how in the task text | Text shipped; needs a live spawn to observe |
| 2 | A message is acted on and a refusal is not retried | Text shipped; needs a live spawn to observe |
| 3 | The three copies agree, or two reference the first | Done — §3 |
| 4 | No vendor name in the added text | Done, pinned by a spec |
| 5 | Added child-prompt bytes measured and recorded | Done — 826 bytes |

Criteria 1 and 2 are behavioural and cannot be closed from a unit test. They
belong with the TASK_2026_465 Phase A live verification, which needs the same
running host.
