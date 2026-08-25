# Context

## How this was found

An audit of what each Marketplace provider installs and where it lands. The
question was whether an install reaches all CLIs or only the Claude SDK. The
answer differed per surface, and one surface reached nothing at all.

| Surface                  | Skills             | MCP                      |
| ------------------------ | ------------------ | ------------------------ |
| External marketplace     | every detected CLI | **nothing**              |
| MCP directory / Smithery | —                  | user-selected targets    |
| Harness builder          | every detected CLI | `claude` + `vscode` only |

Skills from an external plugin were already correct: `plugins:install-external`
adds the id to `enabledPluginIds` and propagates, so the plugin dir enters the
overlay and reaches every detected target. Its declared MCP servers went
nowhere.

## The seam, and why it is not in `plugin-marketplace`

`McpInstallService` lives in `cli-agent-runtime`. `plugin-marketplace` depends on
neither it nor `harness-sync` — the whole dependency set is `shared` +
`vscode-core`. Adding that edge to buy one call would put the consent flow
downstream of the CLI runtime.

`PluginRpcHandlers` already sat downstream of both, already imported
`McpInstallService` (`harness/io/harness-mcp-install.service.ts`), and already
called `reconcileHarness` right after `activateExternalPlugin`. The intent
recording slots in immediately before that reconcile. **No new lib edge was
created.**

## Decisions worth not re-litigating

- **Record intent, then reconcile.** The reconciler's desired MCP state IS
  `~/.ptah/mcp-installed.json`, so recording after the pass leaves it unapplied
  until some later trigger. Same ordering `mcp:install` uses.
- **The server list comes from the CONSENT RECORD**, never a fresh manifest
  read. That record is the exact set the dialog showed, so installing from it
  cannot widen the consent surface even if upstream moved between plan and
  confirm.
- **Targets are `claude` + `vscode` + the rivals the detector actually finds**,
  using the same `IHarnessCliDetector` the reconciler gates on. Deliberately not
  `HARNESS_DEFAULT_MCP_TARGETS` (`['claude','vscode']`), which exists for the
  harness BUILDER, where an AI-designed preset names servers with no knowledge
  of the machine. A plugin install is a real user action on a real machine, and
  a user whose day job is Codex should not get the servers only in the two files
  Ptah can always write. Not "all six" either: an undetected target is skipped by
  the reconciler, so asking for one makes `McpInstallService` report a cheerful
  success for a file it never touched.
- **A key an unowned server occupies is REPORTED here and REFUSED there.** The
  service probes the config files BEFORE recording anything — recording flips
  `managedByPtah` for the very key in question and would hide the collision —
  and turns each occupied key into an `mcpWarnings` entry. The refusal itself
  stays the reconciler's existing `foreign`/`blocked` rule; re-deciding ownership
  at this layer would be a second copy of a rule that must have exactly one
  owner.
- **Uninstall reads the record BEFORE the installer deletes it.** Afterwards
  nothing says which keys were the plugin's, and its servers would outlive it in
  every config file. Pinned by an ordering assertion.

## Where it lives

- `libs/backend/rpc-handlers/src/lib/handlers/external-plugin-mcp.service.ts`
- `libs/backend/rpc-handlers/src/lib/handlers/plugin-rpc.handlers.ts`
  (`installDeclaredMcpServers` before the reconcile, `uninstallDeclaredMcpServers`
  after a confirmed removal)
- `libs/shared/src/lib/types/rpc/rpc-plugin-marketplace.types.ts`
  (`mcpServersInstalled`, `mcpWarnings`, all optional — no frontend change
  required)

## Follow-up not done here

The consent dialog still does not let the user CHOOSE targets; it displays the
servers and the install decides. Offering per-target selection at consent time is
a UI change worth considering separately.
