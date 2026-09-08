# Silent-degradation triage — `libs/backend/rpc-handlers`

TASK_2026_383, Task 12.1. Worktree `D:/projects/ptah-extension/.claude-worktrees/task-383`,
branch `task/383-degradation-audit`. 40 flagged sites, all classified.

## Split counts

| Label                          | Count |
| ------------------------------ | ----- |
| legitimate optional capability | 39    |
| reported                       | 0     |
| defect                         | 1     |
| test-only                      | 0     |

No `DegradationReporter` (or any structured degradation-report call with a
stable code) exists anywhere in this library, so no site could be labelled
`reported`. Every non-defect site is a capability probe or an optional
enrichment whose fallback is the documented behaviour of the surrounding
method; 34 of the 39 also log the failure at `warn` or `debug`.

## Audit line

```
libs/backend/rpc-handlers: 1 ok (baseline 40)
```

`npx nx run degradation-audit:lint` — zero `bare-suppression`, zero
`orphaned-suppression` in this library. The one remaining unsuppressed site is
the recorded defect, reported as
`libs/backend/rpc-handlers/src/lib/handlers/agent-rpc.handlers.ts:952` (line
947 in the input rows; the five marker lines added above it in
`getCodexModelsFromAuth` shifted it).

## All 40 sites

Line numbers are the ones in the input rows file (pre-edit).

| #   | Site                                                         | Label               | Reason / note                                                                                                                                                                                                                                                                                              |
| --- | ------------------------------------------------------------ | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `chat/ptah-cli/chat-ptah-cli.service.ts:384`                 | optional capability | Reading `~/.claude/projects` is a transcript-location probe; `'indeterminate'` is an explicit tri-state the caller handles. Warned.                                                                                                                                                                        |
| 2   | `chat/ptah-cli/chat-ptah-cli.service.ts:423`                 | optional capability | Transcript `access` existence probe; `ENOENT` → `'absent'`, anything else warned → `'indeterminate'`.                                                                                                                                                                                                      |
| 3   | `chat/session/chat-sdk-context.service.ts:62`                | optional capability | Enhanced prompts are an opt-in prompt overlay; `undefined` falls back to the default system prompt. Debug-logged.                                                                                                                                                                                          |
| 4   | `chat/session/chat-sdk-context.service.ts:97`                | optional capability | Plugin paths are an optional session input; `undefined` runs with no plugin directories. Debug-logged.                                                                                                                                                                                                     |
| 5   | `handlers/agent-rpc.handlers.ts:454`                         | optional capability | Host Language Model API is optional (its own doc comment says so); `[]` means the picker offers no Copilot models.                                                                                                                                                                                         |
| 6   | `handlers/agent-rpc.handlers.ts:471`                         | optional capability | Provider `/models` needs an authenticated, online account; `[]` leaves the adapter's curated list standing in.                                                                                                                                                                                             |
| 7   | `handlers/agent-rpc.handlers.ts:947`                         | **defect**          | See below.                                                                                                                                                                                                                                                                                                 |
| 8   | `handlers/config-rpc.handlers.ts:620`                        | optional capability | Tier overrides are a third-party remapping layer; `null` uses model ids as written — the Anthropic-direct path. Warned.                                                                                                                                                                                    |
| 9   | `handlers/file-rpc.handlers.ts:167`                          | optional capability | `fs.stat` supplies a display size only; `null` still attaches the picked file with size 0.                                                                                                                                                                                                                 |
| 10  | `handlers/harness-rpc.handlers.ts:785`                       | optional capability | Skill discovery is an optional prompt input; `[]` selects the generic Stage A contract, the documented fail-closed posture. Debug-logged.                                                                                                                                                                  |
| 11  | `handlers/plugin-rpc.handlers.ts:830`                        | optional capability | The harness copy is a derived artifact the next activation heals; the user's selection is already persisted. Warned.                                                                                                                                                                                       |
| 12  | `handlers/session-rpc.handlers.ts:1213`                      | optional capability | `access` existence probe for one transcript file; `null` = no session file for this id.                                                                                                                                                                                                                    |
| 13  | `handlers/session-rpc.handlers.ts:1241`                      | optional capability | The Claude CLI creates `~/.claude/projects` on first use; `null` = no sessions directory.                                                                                                                                                                                                                  |
| 14  | `handlers/session-rpc.handlers.ts:1294`                      | optional capability | Documented contract: `null` leaves `hasTranscript` undefined rather than marking every session expired. Debug-logged.                                                                                                                                                                                      |
| 15  | `handlers/setup-rpc.handlers.ts:150`                         | optional capability | Plugin paths are an optional analysis input. Debug-logged.                                                                                                                                                                                                                                                 |
| 16  | `handlers/setup-rpc.handlers.ts:939`                         | optional capability | Workspace fingerprinting is the optional memory-seeding step; returning skips seeding and leaves the wizard output intact. Warned.                                                                                                                                                                         |
| 17  | `handlers/setup-rpc.handlers.ts:1028`                        | optional capability | `MEMORY_WRITER` is unregistered on hosts without SQLite; `null` makes seeding a no-op (its doc comment says so).                                                                                                                                                                                           |
| 18  | `handlers/skills-sh-rpc.handlers.ts:702`                     | optional capability | `probeFileExists` — an `access` existence probe.                                                                                                                                                                                                                                                           |
| 19  | `handlers/skills-synthesis-rpc.handlers.ts:1913`             | optional capability | The workspace root is optional here; `undefined` reads the unscoped agent-clone base, which is what a host with no folder open gets.                                                                                                                                                                       |
| 20  | `handlers/skills-synthesis-rpc.handlers.ts:1943`             | optional capability | The origin sidecar is optional provenance; `false` renders the clone as not orphaned, as it rendered before the field existed.                                                                                                                                                                             |
| 21  | `handlers/skills-synthesis-rpc.handlers.ts:1968`             | optional capability | The clone body is optional detail content; `null` renders no body preview.                                                                                                                                                                                                                                 |
| 22  | `handlers/skills-synthesis-rpc.handlers.ts:2248`             | optional capability | Panel rationales are optional summary data; `null` is the "honest collapse" the 20-line block comment directly above already argues for.                                                                                                                                                                   |
| 23  | `handlers/voice-rpc.handlers.ts:365`                         | optional capability | Best-effort webview push of a provider error that is already logged; a failed broadcast costs only the toast.                                                                                                                                                                                              |
| 24  | `handlers/voice-rpc.handlers.ts:436`                         | optional capability | Best-effort TTS download-progress push; drops one percentage update, download unaffected.                                                                                                                                                                                                                  |
| 25  | `handlers/voice-rpc.handlers.ts:522`                         | optional capability | Same, for the STT model download.                                                                                                                                                                                                                                                                          |
| 26  | `handlers/wizard-generation-rpc.handlers.ts:814`             | optional capability | Plugin paths are an optional generation input. Debug-logged.                                                                                                                                                                                                                                               |
| 27  | `handlers/wizard-generation-rpc.handlers.ts:828`             | optional capability | The webview manager is absent on headless hosts; `null` runs generation with no progress broadcasts. Warned.                                                                                                                                                                                               |
| 28  | `handlers/wizard-generation-rpc.schema.ts:41`                | optional capability | Zod `.catch(undefined)`, not a promise catch. Dropping a malformed `analysisData` makes the orchestrator analyze the workspace itself, and `wizard-generation-rpc.handlers.ts:211-215` **warns whenever it drops one**, so the boundary rejection is not silent. `analysisDir` fully specifies generation. |
| 29  | `harness/health/harness-health-rpc.service.ts:276`           | optional capability | The webview messenger is an optional host capability (headless `ptah-cli` one-shots); the health report is still cached for a later pull.                                                                                                                                                                  |
| 30  | `harness/io/harness-fs.service.ts:150`                       | optional capability | Is-it-already-there probe; `false` = "not identical", so the caller writes — the safe direction. Non-`ENOENT` is warned.                                                                                                                                                                                   |
| 31  | `harness/selection/skill-catalog.ts:122`                     | optional capability | The user-layer skills root is created on demand; `[]` offers no catalog entries.                                                                                                                                                                                                                           |
| 32  | `harness/workspace/harness-workspace-context.service.ts:223` | optional capability | Root listing feeds language detection only; `[]` means "we learned nothing". Debug-logged.                                                                                                                                                                                                                 |
| 33  | `harness/workspace/harness-workspace-context.service.ts:243` | optional capability | `false` treats an unreadable root as non-empty — the non-destructive answer for a wizard hint. Debug-logged.                                                                                                                                                                                               |
| 34  | `harness/workspace/harness-workspace-context.service.ts:366` | optional capability | Skill discovery for the harness surface; `[]` offers no skills rather than a partial catalog. Debug-logged.                                                                                                                                                                                                |
| 35  | `skills-sh/skills-sh-legacy-adoption.ts:157`                 | optional capability | The skills.sh lockfile is optional legacy state; `null` = nothing to adopt.                                                                                                                                                                                                                                |
| 36  | `skills-sh/skills-sh-legacy-adoption.ts:202`                 | optional capability | `lstat`/`access` skill-directory probe; `false` skips the entry.                                                                                                                                                                                                                                           |
| 37  | `skills-sh/skills-sh-source-root.service.ts:230`             | optional capability | The plugins base directory is created on demand; `[]` = no source roots, which `listRoots`'s contract ("Never throws") already promises. Non-`ENOENT` is warned.                                                                                                                                           |
| 38  | `skills-sh/skills-sh-source-root.service.ts:360`             | optional capability | An absent `skills/` directory is an ordinary source-root layout; `[]` contributes no slugs.                                                                                                                                                                                                                |
| 39  | `skills-sh/skills-sh-source-root.service.ts:387`             | optional capability | The root metadata file is optional provenance; `null` downgrades `source` to the slug and never removes the skill.                                                                                                                                                                                         |
| 40  | `utils/custom-provider-probe.ts:579`                         | optional capability | The response body is diagnostic detail on a probe result; `''` reports the status with no body.                                                                                                                                                                                                            |

## Defects

### D-1 — `libs/backend/rpc-handlers/src/lib/handlers/agent-rpc.handlers.ts:947`

```ts
private async resolveDefaultPtahCliId(): Promise<string | undefined> {
  try {
    const agents = await this.ptahCliRegistry.listAgents();
    const enabled = agents.find((a) => a.enabled && a.hasApiKey);
    ...
    return enabled?.id;
  } catch {
    return undefined;
  }
}
```

**What is masked.** A failure of `ptahCliRegistry.listAgents()` — a corrupt or
unreadable agent registry, a settings-store failure, a disk error — is
indistinguishable from "the registry read fine and no enabled agent has an API
key". There is no log line at all on this path, unlike its two siblings at
:454/:471 which are genuinely optional host capabilities.

**What the user sees.** The sole caller is `agent:resumeCliSession`
(`agent-rpc.handlers.ts:785-797`): `undefined` falls through to

```ts
throw new Error('No Ptah CLI agents configured. Add one in Agent Orchestration settings.');
```

So a registry read failure is presented to the user as a configuration
_absence_, directing them to a settings page where their agent already exists.
The failure is not silent to the extent that the session does abort — it is
silent about _why_, in a way that is actively misleading and leaves no
diagnostic anywhere.

**Suggested fix.** Do not fix at this site by widening the message. Either:

1. (preferred) let the failure propagate — `listAgents()` failing is not an
   optional capability, and `agent:resumeCliSession` already has a `try/catch`
   at :436 that logs and rethrows, which would surface the real cause; or
2. keep the fallback but make it distinguishable: log the caught error at
   `warn` with the method name, and return a discriminated result
   (`{ kind: 'none' } | { kind: 'unavailable' }`) so :794 can raise "Could not
   read the Ptah CLI agent registry" rather than "No Ptah CLI agents
   configured".

Option 1 is one deletion and needs no new type; option 2 is the right shape if
a registry outage must not block the non-`ptah-cli` branches. Either way a spec
should pin the two messages apart — there is no coverage of the throwing
`listAgents()` path today.

## Verification

```
cd D:/projects/ptah-extension/.claude-worktrees/task-383
npx nx run degradation-audit:lint
```

- `libs/backend/rpc-handlers: 1 ok (baseline 40)` — equals the one recorded defect.
- No `bare-suppression` and no `orphaned-suppression` reported for this library.
- `git diff -U0 -- libs/backend/rpc-handlers` filtered to non-comment changed
  lines is empty: every edit is a `//` marker comment. No behavioural change, no
  reformatting, no spec edits.
- The test suite was not run (the orchestrator runs it at reconcile).
