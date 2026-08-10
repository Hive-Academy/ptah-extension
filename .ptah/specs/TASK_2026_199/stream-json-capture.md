# `agy --output-format stream-json` — observed event schema

Empirically captured **before** any parser was written, per the task's step-1
requirement. Nothing here is inferred from documentation — the shipped reference
doc (`~/.gemini/antigravity-cli/builtin/skills/antigravity_guide/references/cli.md`)
contains no schema at all; it only tells the reader to fetch
`https://antigravity.google/docs/cli/reference`.

## Provenance

Binary: `C:\Users\abdal\AppData\Local\agy\bin\agy.exe`, 175,861,400 bytes,
version 1.1.11.

Two runs, both exit code 0, both with empty stderr:

```bash
# run 1 — read-only, one tool call
agy.exe --dangerously-skip-permissions --output-format stream-json \
        --add-dir "D:\projects\ptah-extension" \
        --print "list the files in the repo root, then say DONE"

# run 2 — a failing shell command + a file read, plus the two new flags
agy.exe --dangerously-skip-permissions --output-format stream-json \
        --effort low --mode plan \
        --add-dir "D:\projects\ptah-extension" \
        --print "run the shell command 'cat /definitely/missing/file' and then
                 read the file D:\projects\ptah-extension\nx.json.
                 Report what happened."
```

`--effort low --mode plan` were accepted without complaint (exit 0), confirming
both flags are live on 1.1.11.

Field names were cross-checked against the Go struct tags embedded in the
binary, which confirms the set and rules out fields the two runs happened not to
exercise:

```
StepUpdate json:"step_update,omitempty"
StepType   json:"step_type,omitempty"
ToolName   json:"tool_name,omitempty"
ToolInfo   json:"tool_info,omitempty"
TextDelta  json:"text_delta,omitempty"
ConversationID json:"conversation_id"
ThinkingTokens json:"thinking_tokens"
```

`text_delta` is the **only** `*_delta` field in the binary — there is no
`thinking_delta` / `reasoning_delta`. The adjacent step-type literal blob
contains `agent_response` and `system_message`.

## Envelope

Every line is one JSON object shaped `{"event": <name>, ...}`, with the payload
nested under a key of the same name. Three event names were observed: `init`,
`step_update`, `result`.

### `init`

```json
{
  "event": "init",
  "conversation_id": "917bf234-79d8-496b-88b0-c3d7e376d066",
  "init": {
    "cwd": "D:\\projects\\ptah-extension",
    "tools": ["ask_permission", "list_dir", "run_command", "view_file", "..."],
    "permission_mode": "always-proceed"
  }
}
```

`conversation_id` is at the **top level**, not inside `init`. This is the answer
to the task's step-3 question: **the conversation id IS on the stream**, so
`resolveSessionId()`'s mtime scan of `~/.gemini/antigravity-cli/conversations/`
(which races when two agents run concurrently) has been deleted.

### `step_update`

```json
{
  "event": "step_update",
  "step_update": {
    "conversation_id": "917bf234-...",
    "step_index": 3,
    "state": "ACTIVE",
    "step_type": "tool",
    "tool_name": "list_dir",
    "tool_info": {
      "name": "list_dir",
      "parameters": { "DirectoryPath": "D:\\projects\\ptah-extension" }
    }
  }
}
```

| field                     | notes                                                                                                            |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `state`                   | `ACTIVE` \| `DONE` observed                                                                                      |
| `step_type`               | `user_input`, `unknown`, `agent_response`, `tool`, `checkpoint` observed; `system_message` present in the binary |
| `tool_name` / `tool_info` | only on `step_type: "tool"`                                                                                      |
| `tool_info.output`        | only on the `DONE` update                                                                                        |
| `text_delta`              | only on `step_type: "agent_response"`                                                                            |
| `duration_seconds`        | on `DONE` updates                                                                                                |
| `usage`                   | `{input_tokens, output_tokens, thinking_tokens, cache_read_tokens, total_tokens}`                                |

Two behaviours that drove parser decisions:

1. **`text_delta` is incremental.** Successive `agent_response` events for the
   same `step_index` each carry only the newly appended chunk; concatenating
   them reproduces `result.response` exactly. No last-seen-text diffing (the
   opencode adapter's `textTracker`) is needed.

2. **A tool failure is not flagged.** The failing `run_command` produced a
   `DONE` update whose `tool_info.output` is the PowerShell error text, with no
   error boolean and no exit code:

   ```
   "output": "cat : Cannot find path 'D:\\definitely\\missing\\file' because it
    does not exist.\r\nAt line:1 char:1\r\n+ cat /definitely/missing/file\r\n..."
   ```

   So the adapter emits `tool-result`, never `tool-result-error`, and never
   synthesizes a `command` segment with a fabricated exit code.

3. **Reasoning text is never streamed.** Run 1's step 2 was an `agent_response`
   that finished `DONE` with `usage.thinking_tokens: 125` and **no**
   `text_delta`. Combined with the absence of any `thinking_delta` field in the
   binary, this means `agy` exposes thinking only as a token count. The adapter
   therefore emits **no** `thinking` segments — the previous `NARRATION_PREFIX`
   regex was guessing them out of ordinary prose.

### `result`

```json
{
  "event": "result",
  "result": {
    "conversation_id": "917bf234-...",
    "status": "SUCCESS",
    "response": "Here are the files located in the repository root ...",
    "duration_seconds": 6.7213283,
    "num_turns": 1,
    "usage": {
      "input_tokens": 25269,
      "output_tokens": 2562,
      "thinking_tokens": 1418,
      "cache_read_tokens": 16297,
      "total_tokens": 27831
    }
  }
}
```

`response` is byte-identical to the concatenation of the `text_delta`s already
streamed, so re-emitting it would duplicate the whole answer. The adapter emits
only a usage `info` segment on `SUCCESS`; a non-`SUCCESS` status becomes an
`error` segment carrying `response`.

Only `SUCCESS` was observed for `status`. Non-success values are handled
generically (`status !== 'SUCCESS'` → error) rather than by guessing literals.

## Full `agy --help` (1.1.11)

```
  --add-dir                       Add a directory to the workspace (repeatable) (default [])
  --agent                         Agent for the current CLI session
  -c / --continue                 Continue the most recent conversation
  --conversation                  Resume a previous conversation by ID
  --dangerously-skip-permissions  Auto-approve all tool permission requests without prompting
  --disable-slash-commands        Disable slash command and skill expansion in print mode
  --effort                        Reasoning effort for the current CLI session (low|medium|high)
  -i / --prompt-interactive       Run an initial prompt interactively and continue the session
  --json-schema                   Optional JSON schema string or path to a schema file to enforce
                                  structured output (for stream-json, only applicable to the final result)
  --log-file                      Override CLI log file path
  --mode                          Set the agent execution mode for this session (accept-edits, plan)
  --model                         Model for the current CLI session
  --new-project                   Create a new project for this session
  --output-format                 Output format for print mode (text, json, stream-json) (default text)
  -p / --print / --prompt         Run a single prompt non-interactively and print the response
  --print-timeout                 Timeout for print mode wait (default 5m0s)
  --project                       Project ID for the current CLI session
  --sandbox                       Run in a sandbox with terminal restrictions enabled

Subcommands: agent(s), changelog, help, install, models, plugin(s), update
```
