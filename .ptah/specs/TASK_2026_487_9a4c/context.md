# Context — one reaper, not seven

## What TASK_2026_484 left behind

TASK_2026_484 fixed eight spawn sites that orphaned process trees on Windows.
It could not import `killProcessTree` at most of those sites, so it wrote
faithful local copies instead. The result is seven implementations of one
function:

| Location | Why it is a copy |
| --- | --- |
| `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/cli-adapter.utils.ts:44` | The canonical one. Not exported from the library's public `index.ts`. |
| `libs/backend/vscode-core/src/utils/exec-git.ts:541` | Pre-existing copy, older than TASK_2026_484. |
| `libs/backend/agent-sdk/src/lib/helpers/process-tree-reaper.ts` | `agent-sdk` is consumed BY `cli-agent-runtime`; importing it would form a cycle. |
| `libs/backend/rpc-handlers/src/lib/utils/skills-sh-cli.ts` | Would import a non-public internal module. |
| `libs/backend/platform-cli/src/implementations/cli-user-interaction.ts` | A platform adapter must not depend on a concrete runtime library. |
| `libs/backend/workspace-intelligence/src/project-analysis/toolchain-probe.ts` | `workspace-intelligence` is upstream of `cli-agent-runtime`; importing it would invert the graph. |

Each reason is individually correct. Together they point at the real problem:
the function lives in the wrong library.

## Why this is not cosmetic

The adversarial review of TASK_2026_484 found that the first round of copies had
all silently dropped the canonical `SIGKILL` escalation. Each sent one
`SIGTERM` and returned as though the tree were dead. That defect was possible
only because there were copies to diverge. Seven copies means seven chances for
the next person to fix one and miss six.

## The target

`libs/backend/platform-core` is the ports library. Every library in the table
above already depends on it, in the legal direction, with no cycle. One
implementation there, exported from the public API, replaces all seven.

## Behaviour that must not change

The canonical lifecycle, which every copy now implements:

1. Windows: `taskkill /pid <pid> /T /F`, best effort, never throws.
2. POSIX: `SIGTERM` to the process group (`-pid`), falling back to the single
   pid if the group signal fails.
3. Poll liveness with `process.kill(pid, 0)` every 100 ms.
4. Return as soon as the process is gone.
5. After the 5000 ms grace period, escalate to `SIGKILL` the same way.

`KILL_GRACE_PERIOD` is 5000 ms and is the canonical value.
