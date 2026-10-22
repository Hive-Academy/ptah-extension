# Code logic review — TASK_2026_711_3377 Part A

Review family: grok (implementer: codex)

Score: 5/10

Verdict: REVISE

The one-shot delivery path puts `PTAH_LANE_POLICY` on exactly one channel for each adapter that this review read. Two required resume paths then drop that policy and still return a normal turn: Pi deletes the append-system file when the first turn's `done` settles, and Codex `continue()` builds the task text before the argv fallback removes the policy from `developer_instructions`. That is below the 7–8 band, where a context-restoring resume keeps the block. It is above the 3–4 band, because first-turn channel choice, the 64 KiB guidance bound, the argv preamble order, and the instruction-store path checks match Part A for a fresh spawn.

No Jest, Nx, tsc, lint, or build was run. Diagnostics were not available in this session. Batch A1's reported spec runs were not re-executed.

## Scope examined

- `PTAH_LANE_POLICY` in `cli-adapter.utils.ts` (measured 2,556 UTF-8 bytes, canary `Lane policy id: ptah-lane-policy-v1` once).
- `buildTaskPrompt`, `fullPromptPreambles`, `buildArgvTaskPrompt`.
- Codex, Cursor, Copilot, Antigravity, OpenCode, Pi, ACP Grok (`acp-session-handle.ts`), and Ptah CLI system-prompt assembly.
- `LaneInstructionFileStore`, `AgentProcessManager` cleanup, DI registration, guidance cap, and the three host smoke assertions that resolve `LANE_INSTRUCTION_FILE_STORE`.

## Five logic questions

1. **Silent success.** Codex `continue()` can send a turn whose config no longer contains the policy and whose prompt never received it (`codex-cli.adapter.ts:847-865` then `:730`). Pi `continue()` re-spawns with `--append-system-prompt` after `handleExit` has already deleted that file (`agent-process-manager.service.ts:2346`, `pi-cli.adapter.ts:552-555`). Both turns still resolve through the normal prompt path.
2. **User action.** A follow-up message on a Pi lane, or a Codex follow-up whose resume argv crosses the Windows command-line limit only after the thread id is added.
3. **Wrong answer without an error.** A Pi resume with no instruction store treats any `resumeSessionId` as a restored delivery and omits the policy (`pi-cli.adapter.ts:527-532`). A Cursor resume always sets `resumeRestoresContext` and never records `resumeDeliveredPreambles`, so guidance and role are dropped while the policy is sent again (`cursor-cli.adapter.ts:329-331`).
4. **Dependency failure.** A failed `runSdk` removes the store (`agent-process-manager.service.ts:711-716`). `remove()` drops its claim before `delete` (`lane-instruction-file-store.ts:54-59`); a locked file or a `realpath` mismatch then leaks the directory and is not retried. `handleExit` logs that failure and continues (`agent-process-manager.service.ts:2346-2348`).
5. **Unspecified but required.** Part A item 4 requires the text block to be omitted only when that same thread already has it, and a fresh resume that lost context to receive it again. Pi's in-process re-spawn and Codex's late argv fallback do not meet that.

## Decisions

| Decision | Options | Evidence | Reversible? |
| --- | --- | --- | --- |
| Verdict REVISE, not APPROVED WITH FIXES | Approve the one-shot paths, or hold the batch for the two policy-loss paths | Context Part A item 4 and the approved plan both require the policy on a restored resume and again when context was lost. Both loss paths return a normal turn | Yes, if the spawner accepts one-shot-only delivery |

## Findings

### 1. Major — Pi follow-up spawns after the policy file is deleted

`agent-process-manager.service.ts:978-980` calls `handleExit` when the SDK `done` promise settles. `handleExit` at `:2345-2348` starts `instructionFiles.remove(agentId)` for every turn end, including a continuation-capable lane. Pi writes `pi-append-system.md` once inside `runSdk` (`pi-cli.adapter.ts:323-332`) and only passes that path from `runTurn` (`:396`). `continue()` at `:552-555` re-spawns with the raw user message and the same path. It does not write the file again.

Failure: turn 1 appends the policy through the file and omits it from the RPC prompt (`:334-336`, `:527-531`). The turn settles, `remove()` deletes `.ptah/lanes/<agentId>/`, and the follow-up process is started with `--append-system-prompt` pointing at a deleted file and a prompt that is only the new message. The lane runs without the policy. A fast follow-up can also race the in-flight delete.

Fix: keep the claimed directory until stop, timeout, or subprocess release for a continuation-capable handle, and rewrite the Pi file at the start of every `runTurn` (including `continue`) before spawn. Do not treat turn `done` as the end of the instruction file.

### 2. Major — Codex argv fallback updates config after the continue prompt is built

`turnOverrides` (`codex-cli.adapter.ts:600-615`) catches `CliCommandLineTooLongError`, sets `policyInTask`, and rebuilds config without `PTAH_LANE_POLICY`. The dry run at `:631` does this before the first prompt at `:643-646`, so the first turn of a spawn is consistent.

`continueTurn` (`:847-865`) calls `buildTaskPrompt` before `runTurn`. `runAttempt` then calls `openThread` (`:730`), which calls `turnOverrides` again. A fresh spawn's dry run has no thread id. The continue argv adds `resumeThreadId`. When that extra length is what crosses the limit, `policyInTask` flips only inside `openThread`. The prompt was already built with `lanePolicyDelivery: 'developer-instructions'`, so `buildTaskPrompt` omitted the policy (`cli-adapter.utils.ts:575`). The retry config also omits it. The turn still runs. `firstTurnPreambles.lanePolicy` stays false (`codex-cli.adapter.ts:651-652`), so a later continue may put the policy back; the overflow turn itself does not have it.

The spec at `codex-cli.adapter.spec.ts:1956-1970` only covers a command that is still too long after the policy is removed. It does not cover a continue that fits only after the strip.

Fix: build the continue prompt after `turnOverrides` returns, or have the fallback return a delivery flag and rebuild the prompt before `runStreamed`. Add a spec where the resume argv fits only after the policy leaves `developer_instructions`, and assert the canary is in that turn's prompt.

### 3. Minor — Pi resume without a file treats every session id as a delivered policy

`pi-cli.adapter.ts:527-532` sets `resumeRestoresContext` and `resumeDeliveredPreambles` whenever `resumeSessionId` is set. `fullPromptPreambles` then records `lanePolicy: true` for the task-prompt fallback (`cli-adapter.utils.ts:536-539`). `buildTaskPrompt` omits the policy (`:575`). The header at `pi-cli.adapter.ts:404-406` says `--session` under `--mode rpc` is unverified. A new process whose session did not restore history, and which had no instruction file because `instructionFileStore` or `agentId` was missing (`:323`), starts with neither the file nor the text block.

Production DI does register the store (`di/register.ts:144-148`) and agent ids are UUIDs, so this is the fallback, not the usual spawn. It is still the path Part A required for a lost-context resume.

Fix: pass `resumeDeliveredPreambles` only after a resume that actually restored the prior prompt. If `--session` fails or is unverified, keep the policy in the RPC text.

### 4. Minor — Cursor resume drops guidance and resends the policy

`cursor-cli.adapter.ts:329-331` always passes `resumeRestoresContext: true` and never `resumeDeliveredPreambles`. With a `resumeSessionId`, `buildTaskPrompt` therefore strips project guidance and the role (`cli-adapter.utils.ts:570-589`) but still prepends `PTAH_LANE_POLICY`, because `lanePolicyDelivery` is `'task-prompt'` and `delivered` is undefined (`:575`). `continue()` sends only the new message (`cursor-cli.adapter.ts:523-524`), so an in-session follow-up does not repeat it. A new process that resumes a live Cursor agent sends the policy a second time and does not send guidance. A resume that did not restore context still loses guidance and the role. Copilot (`copilot-sdk.adapter.ts:478-480`) and OpenCode (`opencode-cli.adapter.ts:623`) do not set the restore flag, so a resumed spawn sends the policy again rather than dropping it. That resend is safe; Cursor's split is not.

Fix: record `firstTurnPreambles` the way Codex does, and set `resumeRestoresContext` only when `Agent.resume` actually restored the thread. Omit the policy on that path and include guidance, role, and policy when it did not.

### 5. Minor — instruction cleanup forgets a directory whose delete fails

`lane-instruction-file-store.ts:51-59` removes the `owned` entry before `realpath` and `delete`. `agentId` cannot be `..` or contain a separator: `AgentId.create()` is a UUID (`agent-process.types.ts:25-26`) and `write()` rejects anything outside `^[a-zA-Z0-9_-]+$` (`lane-instruction-file-store.ts:17-20`). Parent `.ptah` and `lanes` symlinks are rejected via `lstat` (`:26-33`). If `delete` then throws (Windows lock while Pi is still exiting, or `realpath` string mismatch on the inequality at `:58`), the claim is already gone. Later `remove()` calls return at `:53`. `handleExit` only logs the error (`agent-process-manager.service.ts:2346-2348`). The guidance file, which can hold the project prompt, stays under the workspace `.ptah/lanes/` tree. No user-global path is written, and the store does not log file bodies.

Fix: delete the claim only after `delete` resolves. On failure, keep the claim and surface the error to the stop/timeout/release caller instead of only the turn-exit warning.

## Checks that held

- Canary once, at `cli-adapter.utils.ts:416`. UTF-8 size 2,556, under 3,500. The constant's own roster scan list (codex, copilot, cursor, antigravity, opencode, pi, grok, gemini, claude, openai, anthropic, and the other names in `cli-adapter.utils.spec.ts:126`) does not appear as a word. No messaging mode is described as available. The tool table, skill-first rule, in-workspace `file://` render plus screenshot rule, and cost plus memory-safe rules are in `:416-437`.
- Fresh spawn, one channel: Codex `developer_instructions` unless the pre-prompt check moves it into the task (`codex-cli.adapter.ts:541`, `:643-646`); Ptah CLI system-prompt append only (`ptah-cli-spawn-options.service.ts:199-205`); Pi file when the store and agent id exist, omitted from RPC text (`pi-cli.adapter.ts:334-336`); Copilot, Cursor, OpenCode, Antigravity, and ACP Grok task text. Antigravity uses the full prompt on stdin and `buildArgvTaskPrompt` only for `--print` (`antigravity-cli.adapter.ts:690-701`, `:767-772`). ACP omits the policy only when `attachExistingSession` succeeds, and includes it when resume fails open (`acp-session-handle.ts:556-571`, `:718-722`).
- `buildArgvTaskPrompt` (`cli-adapter.utils.ts:634-667`) reserves the whole policy, fits the role before guidance, truncates on UTF-8 code points, and leaves `assertCommandLineWithinLimit` on Copilot (`copilot-sdk.adapter.ts:369`), OpenCode (`opencode-cli.adapter.ts:692`), Antigravity (`antigravity-cli.adapter.ts:699-702`), and `spawnCli` (`cli-adapter.utils.ts:315`).
- Project guidance is bounded at 64 KiB including the truncation notice (`enhanced-prompts.service.ts:74-109`). Non-argv `buildTaskPrompt` callers receive that full string. Argv callers pass through `buildArgvTaskPrompt`.

## Remaining uncertainty

Pi's `--session` restore and a live Codex continue that sits just over the command-line limit were not executed. Whether `fs.realpath` on Windows can make `remove()`'s path inequality fire for a directory this process just created was not executed either.

## Re-review round 1

Review family: grok (implementer: codex)

Score: 8/10

Verdict: APPROVED WITH FIXES

Findings 1–5 are fixed on the paths that drop the policy during an ordinary follow-up. What remains is two edge prompts in the new fallback code: a Pi continue whose instruction write never succeeded sends only the user message, and every Codex continue after an argv strip repeats the policy because the delivery record is not updated. That is below the 9–10 band. It is above the 5–6 band, because a continuation-capable lane now keeps the instruction directory until release, Codex chooses the task-text channel before building the continue prompt, and Cursor's external resume sends guidance, role, and policy together.

No Jest, Nx, tsc, lint, or build was run. The regression specs named in `batch-a2-report.md` were read and not executed. `as unknown as` remains on the pre-existing Codex and Cursor dynamic SDK imports (`codex-cli.adapter.ts:200`, `cursor-cli.adapter.ts:156`); the round-1 edits do not add `any`, `@ts-ignore`, or a new cast. Cleanup logs the error message and agent id only (`agent-process-manager.service.ts:2340-2341`).

### Finding status

1. **RESOLVED.** `handleExit` removes the instruction directory only when `supportsContinuation()` is not true (`agent-process-manager.service.ts:2356-2359`). A continuation-capable lane is removed on stop (`:1971-1972`), timeout (`:2223-2224`), failed `runSdk` (`:716-718`), and subprocess release (`:2337-2338`), with a second attempt when release is entered again (`:2298-2300`). Pi `continue` rewrites `pi-append-system.md` before `runTurn` (`pi-cli.adapter.ts:558-568`) and, when that rewrite fails after a successful first write, sends the policy in the RPC prompt and omits `--append-system-prompt` (`:569-572`). One channel on that path.

2. **RESOLVED.** `continueTurn` calls `turnOverrides(threadId)` before `buildTaskPrompt` (`codex-cli.adapter.ts:852-865`). The resume id is therefore part of the length check that sets `policyInTask`. The prompt then uses `task-prompt` exactly when the rebuilt config has dropped `PTAH_LANE_POLICY` (`:585`, `:862`). `openThread` calls `turnOverrides` again (`:620`), but the flag is already set, so the spawned config and the prompt agree. The overflow turn no longer has an empty channel.

3. **RESOLVED.** A resumed Pi process sets `resumeRestoresContext` only when the instruction file exists (`pi-cli.adapter.ts:535-536`). With no file, `buildTaskPrompt` keeps the policy in the RPC text. The spec `includes the policy in a new resumed process when no instruction file proves delivery` covers that spawn (`pi-cli.adapter.spec.ts:451-455`).

4. **RESOLVED.** The first prompt of a Cursor handle is built with no restore flag (`cursor-cli.adapter.ts:331-335`), so an external `resumeSessionId` still gets policy, guidance, and role. `continue` sets `resumeRestoresContext` only when this handle captured an agent id, and passes `firstTurnPreambles` (`:527-535`). `fullPromptPreambles` records `lanePolicy: true` for `task-prompt`, so the follow-up omits the block. The external-resume spec asserts all three pieces (`cursor-cli.adapter.spec.ts:425-442`).

5. **RESOLVED.** `remove` deletes the owned claim only after `files.delete` resolves (`lane-instruction-file-store.ts:58-59`). A throw from `realpath`, the path check, or `delete` leaves the claim in place. `releaseSubprocess` logs the failure and rethrows (`agent-process-manager.service.ts:2337-2343`); the early branch at `:2298-2300` retries while the claim exists. Stop, timeout, dispose, and the TTL release all call `remove`. No instruction body is logged.

### Five logic questions

1. **Silent success.** Still possible on the two new edges below: a Pi follow-up whose file channel never successfully wrote, and it is not a success-looking loss on the ordinary rewrite or Codex overflow path anymore.
2. **User action.** A second Codex message after the resume argv has already forced the policy into the task, or a Pi follow-up when `.ptah` / `.ptah/lanes` is rejected as a symlink.
3. **Wrong answer.** The Codex delivery record stays `lanePolicy: false` after the policy has moved into the task, so later turns prepend it again. The Pi predicate treats "never wrote a file" as "send the raw message".
4. **Dependency failure.** A failed delete keeps the claim and is retried from the terminal callers. A failed Pi write is caught with no log (`pi-cli.adapter.ts:334-336`, `:565-567`); the first turn still carries the policy in text, and a later failed write does not.
5. **Unspecified but required.** Part A item 4 (omit the text block only when that same thread already has it) holds for the repaired resume paths and fails for the Codex turns after the strip.

### New findings

#### 6. Minor — Pi text fallback does not run when the file was never written

`pi-cli.adapter.ts:569-571` uses `instructionPath && !turnPath`. `instructionPath` is set only when the write inside `runSdk` succeeds (`:331-336`). If that write throws (symlinked `.ptah` or `.ptah/lanes`, `lane-instruction-file-store.ts:26-33`) and the follow-up write throws again (`:562-567`), `turnPath` is undefined and the condition is false. `runTurn` then gets the raw user message and no `--append-system-prompt` (`:401`, `:572`). Turn 1 did include the policy, because `resumeRestoresContext` is false without a file (`:535-536`). `--session` is still marked unverified (`:410-411`). The follow-up process can finish with neither channel. The new spec only rejects the write after a successful one (`pi-cli.adapter.spec.ts:426-448`), so `instructionPath` is already set.

Fix: when `fileChannel` is set and this turn has no path, build the RPC prompt with the policy. Keep the raw message only when the path was written for this spawn.

#### 7. Minor — Codex keeps resending the policy after the argv strip

`firstTurnPreambles` is captured once (`codex-cli.adapter.ts:651-652`). For a first turn that used `developer-instructions`, `fullPromptPreambles` stores `lanePolicy: false` (`cli-adapter.utils.ts:539`). The continue that flips `policyInTask` correctly puts the policy in that turn's task (`codex-cli.adapter.ts:854-864`), because the resumed thread's user text never contained it. `policyInTask` stays true, and `firstTurnPreambles` is not updated. The next `continueTurn` still sees `delivered.lanePolicy === false` and `lanePolicyDelivery: 'task-prompt'`, so `omitToolPolicy` is false (`cli-adapter.utils.ts:571-597`). Every later turn prepends `PTAH_LANE_POLICY` again. The config channel stays stripped (`codex-cli.adapter.ts:585`), so a single turn still has one channel. The same thread already has the block from the previous user message.

Fix: once a continue prompt includes the policy, record `lanePolicy: true` on that handle's delivered preambles before the following turn.

## Decisions

| Decision | Options | Evidence | Reversible? |
| --- | --- | --- | --- |
| APPROVED WITH FIXES, not REVISE | Hold the batch for findings 6–7, or accept them as follow-ups | Both are outside the successful write and the single overflow turn. Findings 1–5 match the code at the cited lines | Yes |
| Score 8, not 7 | Treat the two edges as another logic pass, or as residual | Ordinary Pi, Codex, and Cursor resumes now keep exactly one policy channel | Yes |

## Re-review round 2 (final)

Review family: grok (implementer: codex)

Score: 9/10

Verdict: APPROVED

Findings 6 and 7 are fixed. A Pi follow-up whose instruction file was never written now carries the policy in RPC text and does not pass `--append-system-prompt`. A Codex continue that had to move the policy into the task records that delivery, and the next continue leaves it out while the developer channel stays stripped. No new defect with a located loss path. This is below 10 because the delivery flag is stored before `runTurn` returns, and the new specs were not executed here.

No Jest, Nx, tsc, lint, or build was run. `pi-cli.adapter.ts` has no `any`, `@ts-ignore`, or `as unknown as`. The Codex `as unknown as` at `codex-cli.adapter.ts:200` is the pre-existing SDK import cast, not part of this edit.

### Finding status

6. **RESOLVED.** `continue` chooses the text fallback from `fileChannel && !turnPath` (`pi-cli.adapter.ts:569-571`), not from the first write's path. When the store and agent id exist and this spawn's write fails, `buildTaskPrompt` gets the follow-up with no `lanePolicyDelivery`, so the policy is in the RPC text, and `runTurn` is called without a file path (`:572`). When the write returns a path, the message stays raw and the file is the only policy channel. The spec rejects every write and asserts the follow-up text contains the canary and the argv does not (`pi-cli.adapter.spec.ts:451-462`).

7. **RESOLVED.** The preamble record is mutable (`codex-cli.adapter.ts:651-652`). After a continue prompt is built, `policyInTask && prompt.includes(PTAH_LANE_POLICY)` sets `deliveredPreambles.lanePolicy` (`:868-869`). The following `continueTurn` passes that record (`:864`). `omitToolPolicy` is then true (`cli-adapter.utils.ts:575`), and `developerInstructions` stay without the policy (`codex-cli.adapter.ts:585`). One channel on the overflow turn, and no second copy on the turn after it. The spec asserts the canary on call 1 and its absence on call 2 (`codex-cli.adapter.spec.ts:931-935`).

### Five logic questions

1. **Silent success.** The repaired paths no longer return a normal follow-up with neither channel. Pi text and Codex task text are the fallback, and the later Codex turn omits text only after the previous prompt contained the policy.
2. **User action.** A Pi follow-up after both writes fail, and a second Codex message after the resume argv overflow. Both now match the channel rule.
3. **Wrong answer.** No remaining input that drops the policy or puts it on two channels in one turn was found in these two edits.
4. **Dependency failure.** A failed Pi write is still swallowed (`pi-cli.adapter.ts:565-567`) and the text path replaces it. A Codex `runTurn` that fails after `:868` still records delivery before the turn returns (`:871`). Whether a config rejection persists that prompt on the thread was not proven, so the next omit is not filed as a loss.
5. **Unspecified but required.** Part A item 4 holds for these two follow-ups: the text block is present when this process has no file or no prior task copy, and absent on the next Codex turn of that same thread.

### New findings

None.

## Decisions

| Decision | Options | Evidence | Reversible? |
| --- | --- | --- | --- |
| APPROVED, not APPROVED WITH FIXES | File the pre-`runTurn` delivery flag as a minor, or accept it | The flag matches a prompt that `runTurn` then submits. A loss needs an unproven "thread forgot the prompt" step | Yes |
| Score 9, not 10 | Treat unreadiness of the specs and the flag order as a defect, or as residual uncertainty | Both cited success paths are in the source and the specs. The failure-before-accept path was not executed | Yes |
