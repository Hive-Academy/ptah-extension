# Phase B — `opencode serve`, probed

Run 2026-09-21 on win32. `opencode --version` reports **2.0.11**, installed by
the user at `C:\Users\abdal\AppData\Roaming\npm\opencode`. No adapter was
changed; Phase B is a probe, and this file is its deliverable.

Everything below is observed output from a live server on this machine. None of
it is vendor documentation.

## The question, and the answer

> Send a message to an opencode session WHILE a turn is running. Does it queue,
> abort the turn, or fail?

**It queues, and the caller chooses how.** The v2 server has an explicit
per-session inbox with a two-value delivery mode, and both values were measured:

| `delivery` | Measured behaviour | Ptah's name for it |
| --- | --- | --- |
| `steer` (the DEFAULT) | Delivered at the next step boundary INSIDE the execution in flight. Work already done is kept. | `steer` |
| `queue` | Delivered after the original request's last step, then answered as a further step. | `queue-next-turn` |
| — (`POST /interrupt`) | Execution aborted, partial step discarded. | `interrupt-resume` |

Nothing failed, nothing was rejected, and no send aborted a turn unless
`interrupt` was called explicitly. The open question in `context.md` — carried
from anomalyco/opencode#11424 — is closed for 2.0.11.

## Reaching the server

```
opencode serve --port 4199 --hostname 127.0.0.1 --print-logs
server listening on http://127.0.0.1:4199
server password jS0baSH5D8yzaw7ls6I7N-Cw_3qCMn8IZuH2_SuSrd8
```

- **HTTP Basic, username `opencode`, password as printed.** A `Bearer` header
  and an `x-opencode-password` header were both refused with 401. Basic
  returned 200.
- `opencode serve` does NOT accept `--standalone` (it prints help and exits 1);
  the flag belongs to other subcommands.
- A background service already runs without `serve` being called. `opencode
  pair` prints its URL and password — on this machine
  `http://127.0.0.1:49374`. Every measurement below was taken against it.
- **The OpenAPI document is at `/openapi.json`, and only with an explicit
  `Accept: application/json`.** Without that header this path, `/doc` and every
  unknown path return the 6 KB SPA HTML shell with status 200. A probe that
  reads the status alone will conclude an endpoint exists when it does not.
- `opencode api <operation.id>` (dotted operation ids, e.g. `session.list`)
  talks to the background service and handles its credential. `opencode api GET
  /session` — the method-and-path form the help text documents — was refused
  with `Expected an operation name or an HTTP method and path`. The dotted form
  worked. `opencode api --server http://127.0.0.1:4199 …` against my OWN served
  instance failed with `did not provide a compatible V2 health response`
  (`UnsupportedContentType`), which is consistent with the HTML-shell behaviour
  above; I did not pursue it, because the background service answered
  everything this probe needed.

## The surface that matters

From `/openapi.json`, with `{sessionID}` elided:

| Operation | Path |
| --- | --- |
| `session.create` | `POST /api/session` |
| `session.prompt` | `POST /api/session/{}/prompt` |
| `session.interrupt` | `POST /api/session/{}/interrupt` |
| `session.inbox.list` | `GET /api/session/{}/inbox` |
| `session.inbox.cancel` | `DELETE /api/session/{}/inbox/{inboxID}` |
| `session.inbox.update` | `PATCH /api/session/{}/inbox/{inboxID}` |
| `event.subscribe` | `GET /api/event` (SSE) |

`session.prompt` takes `{ text, files?, agents?, skills?, metadata?, delivery?,
resume? }`. The schema that answers this task is one line:

```
Session.Inbox.Delivery = "steer" | "queue"
```

Two structural facts follow, and both matter more than they look:

1. **`POST /prompt` returns in 8–10 ms with the inbox record, not with the
   turn's answer.** It is an enqueue. The turn is observed on `GET /api/event`.
   A caller that treats the POST response as "the turn finished" will be wrong
   by the whole duration of the turn.
2. **Every prompt goes through the inbox, including the first one on an idle
   session.** The opening prompt of each run below emitted
   `session.inbox.enqueued` → `session.execution.started` →
   `session.inbox.delivered` within ~5 ms. There is no separate "start" path to
   model: a mid-turn message is the same call as the first message.

## Run 1 — `delivery: "queue"`, single-step turn

Second message sent 4.0 s into a turn that was streaming text.

```
+4597ms  session.inbox.enqueued        <- sent here, mid-stream
+5110ms  session.text.started
+5213…+6436ms  session.text.delta ×13   <- turn 1 keeps streaming
+6436ms  session.text.ended
+6489ms  session.step.ended
+6489ms  session.inbox.delivered       <- at the step boundary, not before
+9185ms  session.step.started          <- second step answers the message
+10667ms session.execution.succeeded   <- ONCE, covering both
         inbox AFTER: {"data":[]}
```

Nothing was discarded. One execution carried both.

## Run 2 — no `delivery` field, single-step turn

The server's echo of the created inbox record reads `"delivery":"steer"`.
**`steer` is the default when the field is omitted.**

```
+4584ms  session.inbox.enqueued        <- sent 2.5 s into the turn
+4927…+7941ms  reasoning/text continue  <- turn 1 unaffected
+7941ms  session.text.ended
+8059ms  session.step.ended
+8059ms  session.inbox.delivered
```

On a single-step turn `steer` and `queue` are indistinguishable: both land at
the one step boundary there is. Separating them needs a multi-step turn.

## Run 3 — `delivery: "steer"`, three-tool-call turn

Turn 1 was forced multi-step: three separate `bash` calls, then `DONE_ALL_THREE`.
The session was created with `permissions: [{action:'*', resource:'*', effect:'allow'}]`.

```
+6489ms  session.step.ended            <- step 1 (echo STEP_ONE) done
+6495ms  session.inbox.enqueued        <- sent here
+7430ms  session.step.started          <- step 2 (echo STEP_TWO)
+9068ms  session.step.ended
+9069ms  session.inbox.delivered       <- MID-TASK, one step boundary later
+40085ms session.text.ended "Pending STEP_THREE from the original sequence must
         complete before handling the new request — running it now as its own
         separate call."
+49308ms session.text.ended "DONE_ALL_THREE"
+49406ms session.execution.succeeded
```

`steer` reaches the model INSIDE the running execution, at the next step
boundary — with two steps of the original task still to come. It is not an
interrupt: the model saw the new instruction, said so, and finished the original
work anyway. **What the model does with an injected message is the model's
choice, not the transport's.** This one deferred it; another may drop the
original task. A caller cannot promise either outcome.

## Run 4 — `delivery: "queue"`, same three-tool-call turn

```
+6233ms  session.step.started          <- step 2 running
+6496ms  session.inbox.enqueued        <- sent here
+7779ms  session.step.ended            <- step 2  (steer would have landed HERE)
+10133ms session.step.ended            <- step 3
+11469ms session.text.ended "DONE_ALL_THREE"   <- original request complete
+11554ms session.inbox.delivered       <- only now
+15846ms session.text.ended "PROBE_TWO"
+15887ms session.execution.succeeded
         inbox AFTER: {"data":[]}
```

`queue` waits for the whole request, not the next step. Runs 3 and 4 are the
same prompt, the same model and the same send timing, and they differ only in
this field — so the distinction is measured, not inferred.

## Run 5 — `POST /interrupt`

```
+4592ms  interrupt RESPONSE 200 {"interrupted":true}
+4604ms  session.step.failed
+4604ms  session.execution.interrupted
```

12 ms, mid-reasoning. The step is `failed`, the execution `interrupted`, and no
further step ran. This is Ptah's `interrupt-resume` shape: partial work is lost.

## Conditions

- Model `opencode/muse-spark-1.3-contributor-free`, the session default.
  `opencode auth list` reports **No authenticated integrations** and turns still
  ran, so the free tier needs no configured provider. `opencode models` returns
  9 ids, all `opencode/*` free or `ollama/*:cloud`.
- Session working directory `C:\Users\abdal` (the server's own), not this
  worktree. The three `echo` tool calls in runs 3 and 4 ran there.
- All five probe sessions were deleted afterwards (`DELETE /api/session/{id}`,
  204 each). The extra server on port 4199 was stopped; the user's own
  background service was left running.

## What this means for the adapter — and what it does not

`OpencodeCliAdapter.capabilities()` returns
`{ steer: false, interrupt: false, continuation: false }`, and that is CORRECT
for what the adapter does today: one-shot `opencode run` per turn with stdin
closed, no server, no session to address. The capability is a property of the
transport, not of the binary.

This probe establishes that a server-backed opencode lane could report all
three — and that unlike antigravity, where `queue-next-turn` is the only
reachable mode, opencode could offer `steer` as well. Turning that into a
`SessionAdapter` is a separate task with its own cost: a per-lane server or a
shared one, the Basic credential, SSE parsing in place of line parsing, and a
completion signal that is `session.execution.succeeded` rather than process
exit. **Phase B changes nothing. Do not read this file as a design.**

## Not established here

- The version floor. 2.0.11 has the inbox. Which earlier version introduced it
  is unknown, and the same argument as antigravity applies: probe the surface,
  do not compare version strings.
- Whether `steer` can land mid-step rather than at a step boundary. Every
  delivery observed — five of five — landed on a `session.step.ended`.
- `session.inbox.cancel` / `session.inbox.update`. Both exist; neither was
  called. A queued message that has not been delivered is therefore
  retractable, which no other Ptah lane can do, but that is a schema reading and
  not a measurement.
- Whether one `opencode serve` can host several concurrent lanes safely, and
  what MCP config a server-hosted session reads. The current adapter passes
  `OPENCODE_CONFIG_CONTENT` per process, which a shared server has no equivalent
  for.
- Multi-turn history retention across a queued delivery. Run 4's second answer
  was a literal token, so it proves ordering, not context carry-over.

## Adjacent observation — the model picker

The user reports that an opencode lane cannot be given a model and shows no
model list, unlike the codex and Claude CLI lanes. Two facts measured here:

- `opencode models` exits 0 with 9 ids, which is the exact shape
  `OpencodeCliAdapter.listModels` parses (one `provider/model` per line).
- Spawning the bare name `opencode` with `cross-spawn` from this repo's
  `node_modules` returns the same 9 lines, exit 0 — so the probe path
  `listModels` uses is not broken on this machine.

`listModels` resolves through `resolveCliPath('opencode')` (the npm shim) while
the run path prefers `resolveOpencodeNativeBinary` (the bundled `.exe`); that
asymmetry is the first thing to look at if the symptom survives. It was NOT
reproduced from the code here, and the running Ptah host is known to predate
`32f28f79d` (see `phase-a-live-verification.md`), so the symptom needs one
re-check on a rebuilt host before anything is filed.
