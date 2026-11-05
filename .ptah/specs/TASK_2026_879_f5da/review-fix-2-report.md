# Review fix 2 report

## Changes

- `libs/backend/rpc-handlers/src/lib/handlers/file-view-rpc.handlers.ts:133,214,350-373`: Both RPC methods now require usable dev/ino identity from the opened handle and the current contained path. Zero or unavailable inode/device returns the existing generic `unreadable` refusal. Different identity returns `outside-roots`. Only a reason code is logged. Removed the size/mtime/birthtime fallback.
- `libs/backend/agent-sdk/src/lib/prompt-harness/ptah-ui-hint.ts:55-65,99`: Visual nouns within four words of a code term or code-extension token route compact. The existing Electron gate and Codex guidance are unchanged.

## Spec cases

- `libs/backend/rpc-handlers/src/lib/handlers/file-view-rpc.handlers.spec.ts:167-214`: Both `file:viewContent` and `file:viewBinary` cover opened ino 0, current ino 0, unavailable dev, equal dev/ino, differing ino, and differing dev. Failure checks include generic error text and no path in logs.
- `libs/backend/agent-sdk/src/lib/prompt-harness/ptah-ui-hint.spec.ts:114-132`: Adds all five requested code-request negatives and explicitly retains the report/dashboard positives. Existing positives and negatives remain.

## Decisions

- Unavailable file identity fails closed as `unreadable`; mismatched usable identity retains `outside-roots`. This uses existing public failure reasons, adds no path to error text, and is reversible.
- A code term within four words of a visual noun indicates a code request. This is a local heuristic and is reversible.

## Verification

- `ptah_get_diagnostics` was called twice for all four changed TypeScript files. It reported TypeScript compiler unavailable after 45 seconds and all four files unchecked. No npm, Nx, Jest, Node, git, or process-spawn commands were run, as requested. CI must execute the specs.
