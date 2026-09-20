# Phase A step 1 — the `agy` stream-json input schema, probed

Run by the orchestrator on 2026-09-19. Machine: win32, this worktree.
`agy --version` reports **1.2.7**. The task context was written against 1.2.5,
so the version floor in scope item 6 must be re-derived, not copied.

`--help` documents the FLAG and not the message schema. Everything below is
observed output, not vendor documentation.

## The command line, and a trap in it

```bash
agy --print='' --input-format stream-json --output-format stream-json
```

`--print` takes an OPTIONAL value, and the parser is positional about it. With
`--print` written last, or before another flag, agy takes the next flag as the
prompt:

```
$ agy --print --input-format stream-json --output-format stream-json
Error: --print took "--input-format" as its prompt, so the intended prompt was
left as an argument and ignored.

$ ... | agy --input-format stream-json --output-format stream-json --print
flag needs an argument: -print
```

The value must be ATTACHED and empty: `--print=''`. The adapter must build the
argv this way, and a spec should pin it — the failure is a startup error, not a
silent one, but it is not obvious from `--help`.

## The input schema

One NDJSON object per line. The discriminator is `event`, NOT `type`:

```json
{ "event": "user", "message": { "content": "<prompt text>" } }
```

Derived by probing, each error quoted verbatim:

| Line sent                                                 | Answer                                                              |
| --------------------------------------------------------- | ------------------------------------------------------------------- |
| `{"type":"user","message":{...}}` (the Claude Code shape) | `error: stream input message is missing the "event" field`          |
| `{"event":"ping"}`                                        | `warning: ignoring unsupported stream input message event "ping"`   |
| `{"event":"user"}`                                        | `error: stream input "user" message is missing the "message" field` |
| `{"event":"user","message":{"unexpected":1}}`             | `error: stream input "user" message has no content`                 |
| `{"event":"user","message":{"content":"…"}}`              | runs a turn                                                         |

**The two failure classes are not alike, and the adapter must not treat them
alike.** An unknown `event` is a WARNING and the process continues. A known
event with a missing field is FATAL: agy emits a `result` with
`status: "ERROR"` and ends the process. A malformed queued message therefore
kills the lane rather than being skipped.

## The output schema

Three event kinds observed.

`init`, once, before any turn:

```json
{"event":"init","conversation_id":"…","init":{"cwd":"…","tools":[…],"permission_mode":"request-review"}}
```

`step_update`, repeatedly. `step_index` increments across the WHOLE process,
not per turn, and `step_type` is `user_input` or `agent_response`:

```json
{"event":"step_update","step_update":{"conversation_id":"…","step_index":1,"state":"DONE","step_type":"agent_response","text_delta":"PROBE_ONE\n","duration_seconds":2.49,"usage":{…}}}
```

`result`, **once per turn, not once per process**:

```json
{ "event": "result", "result": { "conversation_id": "…", "status": "SUCCESS", "response": "PROBE_ONE\n", "duration_seconds": 2.58, "num_turns": 1, "usage": { "total_tokens": 11767 } } }
```

## The two-turn run that proves the design

Two lines written to one stdin, one process:

```
{"event":"user","message":{"content":"Reply with exactly: PROBE_ONE"}}
{"event":"user","message":{"content":"Reply with exactly: PROBE_TWO"}}
```

Output, `tools` array elided:

```
{"event":"step_update","step_update":{"conversation_id":"59d36b30-…","step_index":0,"state":"DONE","step_type":"user_input"}}
{"event":"step_update","step_update":{"conversation_id":"59d36b30-…","step_index":1,"state":"DONE","step_type":"agent_response","text_delta":"PROBE_ONE\n","duration_seconds":2.4954026,"usage":{"input_tokens":11731,"output_tokens":36,"thinking_tokens":32,"cache_read_tokens":0,"total_tokens":11767}}}
{"event":"result","result":{"conversation_id":"59d36b30-…","status":"SUCCESS","response":"PROBE_ONE\n","duration_seconds":2.5859787,"num_turns":1,"usage":{"total_tokens":11767}}}
{"event":"step_update","step_update":{"conversation_id":"59d36b30-…","step_index":2,"state":"DONE","step_type":"user_input"}}
{"event":"step_update","step_update":{"conversation_id":"59d36b30-…","step_index":3,"state":"DONE","step_type":"agent_response","text_delta":"PROBE_TWO\n","duration_seconds":1.4796758,"usage":{"total_tokens":11867}}}
{"event":"result","result":{"conversation_id":"59d36b30-…","status":"SUCCESS","response":"PROBE_TWO\n","duration_seconds":4.1757133,"num_turns":2,"usage":{"total_tokens":23634}}}
```

What this establishes, and it is the whole basis of Phase A:

1. **One process serves many turns.** Both turns ran in one `agy`, and the
   second needed no respawn and no `--conversation`.
2. **The conversation is continuous.** One `conversation_id` across both, and
   turn 2's `total_tokens` (11,867) exceeds turn 1's (11,767), showing that
   the history is carried.
3. **The mode is `queue-next-turn`, not `steer`.** agy consumed the second line
   only after turn 1 reached its `result`. Nothing reached the model mid-turn.
   This matches what `--help` says and is now measured.
4. **The process exits when stdin closes**, after the last queued line settles.
   That is scope item 5, and it needs no extra signal.

## What the adapter must handle, that a text-mode adapter does not

- **`result` is per turn.** Treating the first `result` as process completion
  would end the lane after turn 1 with a queue still pending.
- **`usage` accumulates on `result` but is per turn on `step_update`.** Turn 2's
  `result` reports 23,634 total tokens, which is both turns. Reporting the
  `result` figure per turn would double-count.
- **`num_turns` is cumulative**, same reason.
- **A malformed queued line kills the lane.** Validate every queued message
  against the schema BEFORE writing it to stdin, and refuse the send rather than
  writing a line agy will die on.

## Two things the probe noticed that are outside this task

`init.tools` lists `send_message` and `manage_inbox`. agy has messaging
primitives of its own. Nothing here establishes what they address or whether
they can reach a Ptah lane, and this task does not need them — the stdin queue
is the delivery channel. Recorded so the next reader does not have to re-find
them.

`init.permission_mode` reported `request-review` on this run, with no
`--dangerously-skip-permissions`. A lane that needs to write files will need
that flag, as the current one-shot path already passes it.

## Not established here

- The version floor. This machine has 1.2.7. `--input-format` is absent from
  older builds, and I did not install one to find the first version that has it.
  Scope item 6 still needs that number, or a capability probe instead of a
  version compare.
- Behaviour when a line is written to stdin WHILE a turn is running. The probe
  wrote both lines before agy started. The queue claim above rests on the order
  of the output, which is consistent with queueing but does not separate
  "queued on arrival" from "read from a pipe buffer after the turn".
- Whether `--conversation <id>` can re-attach a NEW process to a conversation
  this mode started.
