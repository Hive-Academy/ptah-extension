# Batch B report — write the scoped URL

Executor: backend-developer. Status: **COMPLETE, all verification green.**
No commit was made and no state-changing git command ran.

Every external consumer of Ptah's MCP server now states its workspace in the
URL as `http://localhost:PORT/workspace/{encodeURIComponent(root)}`. Home-scoped
config files keep the bare URL, because one home file serves every open folder
at once. The `.mcp.json` round trip stays byte-stable and still reads back as
transport `http` — evidence below.

## Files changed

### `libs/backend/vscode-lm-tools`

| File                                                                          | Change                                                                                                                                                                                                                                                                                                                                                |
| ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/code-execution/mcp-http/ptah-mcp-slots.ts`                           | New `ptahMcpUrl(port, workspaceRoot)` owns the URL grammar. `ptahMcpEntry(port)` became `ptahMcpEntry(port, workspaceRoot)`. Empty root (a home-scoped slot) yields the bare URL. Doc comments explain the grammar and the read-back rule.                                                                                                            |
| `src/lib/code-execution/mcp-http/http-mcp-server.service.ts`                  | The two call sites of the entry builders. `writeFacetEntry` passes `slot.workspaceRoot` into `ptahMcpEntry`. `writeMcpJsonEntry` gained a `workspaceRoot` parameter and builds its `.mcp.json` entry through `ptahMcpUrl`; `registerInSlot` passes `slot.workspaceRoot`.                                                                              |
| `src/lib/code-execution/mcp-http/ptah-mcp-slots.spec.ts`                      | New `ptahMcpUrl` specs (grammar, Windows-root encoding, bare home URL, the `/sse` non-leak). Updated `ptahMcpEntry` specs. New round-trip suite: a scoped entry written through a REAL facet reads back deep-equal and as `http`, and a second write of the same entry leaves identical bytes.                                                        |
| `src/lib/code-execution/mcp-http/http-mcp-server.service.spec.ts`             | Every `.mcp.json` assertion now expects the per-folder scoped entry (new `ptahEntryFor` helper). The "already holds the exact desired entry ⇒ no write" seed is now the scoped entry, so the no-rewrite property is still tested. One NEW spec: a pre-upgrade bare URL is rewritten to the scoped one exactly once, and the next pass writes nothing. |
| `src/lib/code-execution/mcp-http/http-mcp-server.service.concurrency.spec.ts` | The two real-facet assertions expect the scoped URL.                                                                                                                                                                                                                                                                                                  |

### `libs/backend/cli-agent-runtime`

| File                                                   | Change                                                                                                                                                                                                                                                                                                            |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/cli-agents/cli-adapters/ptah-mcp-url.ts`      | NEW. `ptahMcpServerUrl(port, workingDirectory)` — the one spawn-side definition of the grammar.                                                                                                                                                                                                                   |
| `src/lib/cli-agents/cli-adapters/ptah-mcp-url.spec.ts` | NEW. Grammar, Windows-root encoding, empty-directory bare URL, and the `/sse` non-leak.                                                                                                                                                                                                                           |
| `src/lib/cli-agents/cli-adapters/index.ts`             | Exports the helper (it flows to the public barrel through the existing chain).                                                                                                                                                                                                                                    |
| `codex-cli.adapter.ts:580`                             | SDK `config.mcp_servers.ptah.url` is now scoped to `options.workingDirectory`.                                                                                                                                                                                                                                    |
| `cursor-cli.adapter.ts:304`                            | `agentOptions.mcpServers.ptah.url` scoped the same way.                                                                                                                                                                                                                                                           |
| `copilot-sdk.adapter.ts:301`                           | The `--additional-mcp-config` JSON URL scoped the same way.                                                                                                                                                                                                                                                       |
| `opencode-cli.adapter.ts:356`                          | `buildMcpConfigContent` takes the working directory; the `OPENCODE_CONFIG_CONTENT` URL is scoped.                                                                                                                                                                                                                 |
| `antigravity-cli.adapter.ts:342`                       | `configureMcpServer` takes the working directory; the ephemeral facet write is scoped. It keeps `type: 'sse'`, keeps the facet, and keeps the prior-restore contract. See the antigravity note.                                                                                                                   |
| `ptah-cli-spawn-options.service.ts:174`                | The assembled `mcpServers.ptah.url` is scoped to the spawn's `cwd`.                                                                                                                                                                                                                                               |
| Adapter and service specs                              | `codex-cli.adapter.spec.ts`, `cursor-cli.adapter.spec.ts`, `copilot-sdk.adapter.spec.ts` (assertion strengthened from `toContain('ptah')` to the full scoped URL), `opencode-cli.adapter.spec.ts`, `antigravity-cli.adapter.mcp.spec.ts`, `ptah-cli-spawn-options.output-style.spec.ts` — all pin the scoped URL. |

`pi-cli.adapter.ts` is untouched on purpose: it has `supportsMcp = false` and
ignores `mcpPort`, so it builds no URL.

## The round-trip hazard — verified, then pinned

`inferTransportType` (`harness-sync/src/lib/targets/mcp/mcp-json-format.ts:122-127`)
returns `sse` **only when the URL contains the literal `/sse`**, and `http`
otherwise. `encodeURIComponent` encodes every `/` inside the workspace root as
`%2F`, so the only literal slashes in a scoped URL are `http://` and
`/workspace/` — a `/sse` substring is unreachable, even for a folder named
`sse`. A scoped entry therefore still reads back as `http`.

Pinned from three sides, all passing:

1. `ptah-mcp-slots.spec.ts` — "the scoped entry round-trips through a real
   facet": writes `ptahMcpEntry(51820, ws)` through `createMcpFacet('cursor')`,
   reads it back deep-equal with `type === 'http'`, and asserts a second write
   of the same entry leaves the file bytes identical.
2. `ptah-mcp-slots.spec.ts` and `ptah-mcp-url.spec.ts` — a path that CONTAINS
   `sse` (`/projects/sse/tools`) encodes to `%2Fsse%2F` and the URL carries no
   `/sse`.
3. `http-mcp-server.service.spec.ts` — the "already holds the exact desired
   entry" spec now seeds the scoped entry and asserts zero writes; the new
   "upgrades a pre-TASK_2026_364 bare URL" spec asserts the one-time rewrite
   and then byte-identical stability.

## Notes and decisions

- **`http-mcp-server.service.ts` and its two specs are outside the batch file
  list, and touching them was unavoidable.** The plan's F2 says `ptahMcpEntry`
  produces "the `.mcp.json` entry", but the claude entry is actually built
  inline in `writeMcpJsonEntry` — so the primary bug vector (the `.mcp.json`
  an external CLI reads) required that method too, and the signature change
  forced its callers regardless. No batch owns that file (Batch A owns
  `http-server.handler.ts`, a different file), so there is no concurrent-edit
  collision.
- **Two definitions of the grammar, not one.** `ptahMcpUrl` (vscode-lm-tools)
  and `ptahMcpServerUrl` (cli-agent-runtime); each doc comment names the other
  and the parser. One shared definition would live in `libs/shared` (Batch C's
  territory, and a dirty `index.ts` merge hotspot) or force
  `ptah-mcp-slots.ts` to import the `cli-agent-runtime` barrel, which would
  drag that lib's whole transitive import graph into the `mcp-http` jest
  suites. The grammar is three lines; the cross-references are the cheaper
  guard.
- **Antigravity.** The adapter still passes `type: 'sse'` and still writes
  through the facet with the prior-restore contract; only the URL gained the
  segment. The "same bytes as the file writer" property from
  `ptah-mcp-slots.ts:219-230` holds in its load-bearing form: the facet drops
  the discriminant, and the encoded URL cannot flip the transport inference on
  read-back. One deliberate divergence: WHILE a Ptah-spawned `agy` run is in
  flight, the home file holds the run's scoped URL instead of the persistent
  bare one, so a registration pass landing inside that window would rewrite it
  bare (one write; cleanup then restores the captured prior, which equals it).
  That window existed before for the PORT; it now also covers the path
  segment. Scoping the ephemeral entry is what the batch instructs, and it is
  what gives a Ptah-spawned `agy` workspace attribution at all — the home slot
  itself cannot carry a folder.
- **The adapters declare the working directory verbatim.** A spawn into a
  subfolder declares the subfolder. Mapping a declared directory onto an open
  workspace folder is the reader's half (Batch A's parser, Batch C's
  resolver), same as E14's `resolveHarnessWorkspaceRoot` precedent.
- The `.mcp.json` upgrade cost is as the plan states: one rewrite per
  workspace on the first pass after this change, then stable (pinned by the
  new upgrade spec).

## Verification (verbatim tail)

Command: `npx nx run-many -t typecheck,lint,test -p @ptah-extension/vscode-lm-tools @ptah-extension/cli-agent-runtime`

```
> nx run @ptah-extension/cli-agent-runtime:typecheck
> tsc --noEmit --project libs/backend/cli-agent-runtime/tsconfig.lib.json

> nx run @ptah-extension/cli-agent-runtime:test
Test Suites: 40 passed, 40 total
Tests:       507 passed, 507 total
Snapshots:   0 total
Time:        53.387 s
Ran all test suites.

> nx run @ptah-extension/vscode-lm-tools:typecheck
> tsc --noEmit --project libs/backend/vscode-lm-tools/tsconfig.lib.json

> nx run @ptah-extension/vscode-lm-tools:test
Test Suites: 45 passed, 45 total
Tests:       958 passed, 958 total
Snapshots:   0 total
Time:        40.2 s, estimated 54 s
Ran all test suites.

> nx run @ptah-extension/vscode-lm-tools:lint
✖ 21 problems (0 errors, 21 warnings)

 NX   Successfully ran targets typecheck, lint, test for 2 projects
```

`cli-agent-runtime` lint: `✖ 35 problems (0 errors, 35 warnings)`. All
warnings on both libs are pre-existing (empty methods, non-null assertions in
old specs, `max-lines` on files already past the soft ceiling); none is in a
line this batch added — confirmed by re-running lint and reading the per-file
warning locations.

The vscode-lm-tools test run printed jest's generic "worker process has failed
to exit gracefully" warning. It appears on this suite independent of this
change (open-handle noise from the http-server specs) and all 45 suites passed.

## Not done, with reasons

- No change to `mcp-http/http-server.handler.ts`, `mcp-core/*`, or
  `workspace-root-resolver.ts` — Batch A owns the parser half.
- No normalization of a subfolder cwd to its workspace root on the spawn side
  — the reader's job (Batches A and C), per the plan.
- `pi-cli.adapter.ts` untouched — no MCP support, no URL to scope.
