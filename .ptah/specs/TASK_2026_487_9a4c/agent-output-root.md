+# TASK_2026_487 — process-tree reaper consolidation

## 1. Premise answers and evidence

### Dependency legality: yes

Every consumer already had a static dependency on `@ptah-extension/platform-core`, and the new imports preserve the existing legal direction.

| Project | Tags | Existing/static edge evidence |
| --- | --- | --- |
| `@ptah-extension/cli-agent-runtime` | `scope:extension`, `type:feature` | Existing platform-core types were already imported in the library; the Nx graph reports `cli-agent-runtime -> platform-core [static]`. |
| `@ptah-extension/vscode-core` | `scope:extension`, `type:util` | Existing `IProcessSpawner` import in `exec-git.ts`; the Nx graph reports `vscode-core -> platform-core [static]`. |
| `@ptah-extension/agent-sdk` | `scope:extension`, `type:feature` | Existing platform tokens/types imports; the Nx graph reports `agent-sdk -> platform-core [static]`. |
| `@ptah-extension/rpc-handlers` | `scope:extension`, `type:feature` | Existing platform-core exports in the public barrel; the Nx graph reports `rpc-handlers -> platform-core [static]`. |
| `@ptah-extension/platform-cli` | `scope:cli`, `type:feature` | Existing platform port imports throughout the adapter; the Nx graph reports `platform-cli -> platform-core [static]`. |
| `@ptah-extension/workspace-intelligence` | `scope:extension`, `type:feature` | Existing platform port imports; the Nx graph reports `workspace-intelligence -> platform-core [static]`. |

The project tags are at line 6 of each listed `project.json`; `platform-core` is `scope:shared`, `type:util`. The enforced matrix permits extension projects to consume shared scope (`eslint.config.mjs:240-241`), CLI projects to consume shared scope (`eslint.config.mjs:307-311`), feature projects to consume util projects (`eslint.config.mjs:345-351`), and util projects to consume util projects (`eslint.config.mjs:363-364`).

The generated Nx graph shows no reverse edge from platform-core to any of the six consumers, so none of the imports introduces a cycle. The exact seven-project lint run completed with zero errors, which exercises `@nx/enforce-module-boundaries` at severity error.

### Architectural home: platform-core is appropriate

Although platform-core is primarily the ports library, its local rules explicitly admit small shared concrete services (`libs/backend/platform-core/CLAUDE.md:16`) and state that transport-agnostic logic shared by multiple adapters belongs there rather than being copied (`libs/backend/platform-core/CLAUDE.md:224`). The reaper is not a host adapter: it implements one Node process-lifecycle algorithm over an already-known PID, with the only platform distinction contained inside that algorithm.

Putting this behind the existing `IProcessSpawner` port would be a worse boundary: it would expand a spawn port with post-spawn PID ownership, force all adapter implementations to add the same reaping behavior, and leave non-spawner call sites needing a collaborator solely to terminate a PID. A public, logic-light utility in platform-core matches the existing shared-helper precedent and keeps one implementation for every Node host.

Inventory note: the task text says seven implementations, but its location list contains six entries and the pre-change repository scan found six function definitions. All six were removed; a repository-wide post-change scan finds only the platform-core definition.

## 2. Copies removed

| file:line | copy removed | now imports from |
| --- | --- | --- |
| `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/cli-adapter.utils.ts:44` | Canonical async implementation and its local grace constant dependency | `@ptah-extension/platform-core` at current line 13 |
| `libs/backend/vscode-core/src/utils/exec-git.ts:541` | Windows-only local tree-kill helper | `@ptah-extension/platform-core` at current line 5 |
| `libs/backend/agent-sdk/src/lib/helpers/process-tree-reaper.ts:8` | Agent SDK mirror; file and colocated duplicate suite deleted | `@ptah-extension/platform-core` from the three former consumers |
| `libs/backend/rpc-handlers/src/lib/utils/skills-sh-cli.ts:52` | Boundary-local mirror and local timing constants | `@ptah-extension/platform-core` at current line 36 |
| `libs/backend/platform-cli/src/implementations/cli-user-interaction.ts:32` | Adapter-local mirror and local timing constants | `@ptah-extension/platform-core` at current line 24 |
| `libs/backend/workspace-intelligence/src/project-analysis/toolchain-probe.ts:35` | Probe-local mirror and local timing constants | `@ptah-extension/platform-core` at current line 22 |

The single implementation is now `libs/backend/platform-core/src/utils/process-tree-reaper.ts:16`, its canonical 5,000 ms grace is at line 4, and the public exports are in `libs/backend/platform-core/src/index.ts:235-238`.

## 3. Verification

### Tests

Command:

```text
npx nx run-many -t test -p @ptah-extension/platform-core @ptah-extension/cli-agent-runtime @ptah-extension/vscode-core @ptah-extension/agent-sdk @ptah-extension/rpc-handlers @ptah-extension/platform-cli @ptah-extension/workspace-intelligence
```

Literal Nx header lines:

```text
NX   Running target test for 7 projects:
NX   Successfully ran target test for 7 projects
```

Observed aggregate: 417 passing suites, 2 skipped suites; 8,832 passing tests, 8 skipped tests, and 7 todo tests. The new platform-core suite covers Windows `taskkill /T /F`, POSIX escalation after 5,000 ms, and POSIX early exit without SIGKILL.

### Lint

Command:

```text
npx nx run-many -t lint -p @ptah-extension/platform-core @ptah-extension/cli-agent-runtime @ptah-extension/vscode-core @ptah-extension/agent-sdk @ptah-extension/rpc-handlers @ptah-extension/platform-cli @ptah-extension/workspace-intelligence
```

Literal Nx header lines:

```text
NX   Running target lint for 7 projects:
NX   Successfully ran target lint for 7 projects
```

Observed aggregate: 0 errors and 134 warnings. The warnings are non-blocking existing lint findings; no module-boundary error was reported.

### Typecheck

Command:

```text
npx nx run-many -t typecheck -p @ptah-extension/platform-core @ptah-extension/cli-agent-runtime @ptah-extension/vscode-core @ptah-extension/agent-sdk @ptah-extension/rpc-handlers @ptah-extension/platform-cli @ptah-extension/workspace-intelligence
```

Literal Nx header lines:

```text
NX   Running target typecheck for 7 projects:
NX   Successfully ran target typecheck for 7 projects
```

Observed aggregate: all 7 typecheck targets passed with no TypeScript errors.

`git diff --check` also passed.

## 4. Deviations

- `libs/backend/agent-sdk/src/lib/helpers/process-tree-reaper.spec.ts` was deleted because its subject moved. Its two POSIX lifecycle cases were preserved in the new `libs/backend/platform-core/src/utils/process-tree-reaper.spec.ts`, and the required Windows case was added there.
- `libs/backend/vscode-core/src/utils/exec-git.spec.ts` previously mocked the module-local `child_process.spawn('taskkill', ...)` implementation. It now mocks the public `@ptah-extension/platform-core` reaper and asserts the PID passed to that boundary. This is the one existing call-site assertion whose mechanism necessarily changed.
- The CLI adapter specs `antigravity-cli.adapter.spec.ts`, `antigravity-cli.adapter.mcp.spec.ts`, `copilot-sdk.adapter.spec.ts`, `opencode-cli.adapter.spec.ts`, and `pi-cli.adapter.spec.ts` previously replaced `killProcessTree` on `./cli-adapter.utils`. They now replace the shared platform-core export because the adapters import the owner directly.
- `agent-process-manager.service.spec.ts` extends its existing partial platform-core mock with the shared reaper so fake PIDs can never reach a real OS kill.
- The behavior-level escalation specs in `cli-user-interaction.spec.ts`, `skills-sh-cli.spawn.spec.ts`, and `toolchain-probe.spawn.spec.ts` were not rewritten and pass unchanged.
- During verification, an initial aggregate run exposed eager `promisify(execFile)` initialization as incompatible with existing narrow `child_process` mocks. The Windows promise is now created lazily inside the function; runtime behavior is unchanged. A later aggregate run encountered transient Windows `EPERM` cleanup failures in an unrelated temporary Git review spec. The unchanged exact command was rerun after workers exited and passed with the totals above.

