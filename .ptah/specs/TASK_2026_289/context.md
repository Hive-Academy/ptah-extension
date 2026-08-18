# Context

## How this was found

While auditing what each Marketplace provider actually installs and where it
lands, the question was asked directly: Smithery installs skills as well — do we
have the same cross-CLI install as with skills.sh?

The answer is that we do not install Smithery skills at all. Every Smithery file
in the repo is under `libs/backend/cli-agent-runtime/src/lib/mcp-directory/`:

- `smithery-registry.source.ts`
- `smithery-connection-resolver.ts`
- `smithery-installed-manifest.ts`
- `smithery-override-resolver.ts`
- `smithery-errors.ts`, `smithery-wire.constants.ts`

All MCP. There is no skills fetch, no skills listing, no skills install path.

## Why this is a decision and not just a task

The Marketplace presents four providers as peers — Plugins, MCP Registry,
Skills (skills.sh), Smithery. A user who knows Smithery publishes both skills
and MCP servers will read the tile as covering both. It covers one.

Three honest options:

1. **Implement Smithery skills.** Real work: provider-specific fetch, auth
   (Smithery needs an API key, already handled for MCP), listing and version
   handling.
2. **Say so in the UI.** Label the Smithery tile as MCP-only. Cheapest, and
   removes the false impression immediately.
3. **Leave it.** Accept that the tile under-delivers relative to the platform.

Option 2 is worth doing regardless of whether 1 ever happens.

## What makes the implementation cheaper than it looks

TASK_2026_288 routes skills.sh installs into a Ptah-owned source root under
`~/.ptah/plugins/ptah-skillssh-*`, which `resolveCurrentPluginPaths()` already
treats as a first-class overlay source. From there the reconciler carries the
skill into every detected CLI, hash-gated and manifest-owned.

A second skills provider does not need to re-solve any of that. It needs:

- a fetch/auth path against Smithery's skills API,
- a source-root naming convention alongside `ptah-skillssh-*`,
- listing and uninstall,

and then it inherits propagation, updates, reaping and health reporting for
free. The propagation half — historically the expensive and defect-prone half —
is already built.

## Related

- TASK_2026_286 — the agents consent gate in `harness-sync`
- TASK_2026_287 — external marketplace plugins' declared MCP servers were never
  installed
- TASK_2026_288 — skills.sh installs routed through a Ptah-owned source root

## Status

Deferred 2026-08-18. Recorded so the gap is not rediscovered from scratch.
