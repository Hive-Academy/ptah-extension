# Command Source Report: Autocomplete Contract Discriminator

## What changed

- `libs/shared/src/lib/types/rpc/rpc-misc.types.ts:119-123` — Added required `source: 'builtin' | 'command' | 'skill'` field to `AutocompleteCommandInfo` interface, accompanied by documentation explaining that `scope` describes WHO supplied the entry while `source` describes WHAT KIND of entry it is.
- `libs/backend/workspace-intelligence/src/autocomplete/command-discovery.service.ts:135` — Added `readonly source: 'builtin' | 'command' | 'skill';` to internal `CommandInfo` interface.
- `libs/backend/workspace-intelligence/src/autocomplete/command-discovery.service.ts:378-405` — Tagged each hardcoded builtin entry in `getBuiltinCommands()` with `source: 'builtin'`.
- `libs/backend/workspace-intelligence/src/autocomplete/command-discovery.service.ts:498` — Tagged markdown commands parsed from `.claude/commands/` in `parseCommandFile()` with `source: 'command'`.
- `libs/backend/workspace-intelligence/src/autocomplete/command-discovery.service.ts:585` — Tagged discovered workspace skills in `scanWorkspaceSkills()` with `source: 'skill'`.
- `libs/backend/rpc-handlers/src/lib/handlers/autocomplete-rpc.schema.ts` — Evaluated schema. `autocomplete-rpc.schema.ts` validates request parameters only (`AutocompleteAgentsParamsSchema`, `AutocompleteCommandsParamsSchema`) and does not validate RPC result payloads; left untouched per instructions.
- `libs/backend/rpc-handlers/src/lib/handlers/autocomplete-rpc.handlers.ts` — The handler forwards `commandDiscovery.searchCommands(...)` results directly to the RPC client, carrying the `source` discriminator through unmodified without schema rejection or data transformation.
- `libs/backend/workspace-intelligence/src/autocomplete/command-discovery.service.spec.ts:43,63-204` — Extended unit tests to pin each source discriminator (`source: 'builtin'`, `source: 'command'`, `source: 'skill'`) individually as well as in a multi-source discovery run.
- `libs/backend/rpc-handlers/src/lib/handlers/autocomplete-rpc.handlers.spec.ts:42-45,268-307` — Extended RPC handler tests to verify that `autocomplete:commands` carries `source` through over the wire for all three sources.

## Contract

```typescript
export interface AutocompleteCommandInfo {
  name: string;
  description: string;
  /**
   * Describes WHO supplied the entry (scope) vs WHAT KIND of entry it is (source).
   * The two are orthogonal and neither replaces the other.
   */
  scope: 'builtin' | 'project' | 'user' | 'mcp' | 'plugin';
  /**
   * Describes WHAT KIND of entry it is: a hardcoded built-in command,
   * a markdown command from `.claude/commands/`, or a skill from `.claude/skills/`.
   */
  source: 'builtin' | 'command' | 'skill';
  argumentHint?: string;
}
```

## Verification

Pending execution of:
1. `npx nx run-many -t test -p @ptah-extension/workspace-intelligence @ptah-extension/rpc-handlers @ptah-extension/shared`
2. `npx nx run-many -t typecheck -p @ptah-extension/workspace-intelligence @ptah-extension/rpc-handlers @ptah-extension/shared`

## Risks

- Any external consumer or test constructing mock `AutocompleteCommandInfo` literals must supply `source: 'builtin' | 'command' | 'skill'` now that `source` is a required non-optional field.
- Frontend consumers under `libs/frontend/` were intentionally not modified per scope boundary instructions; if any frontend code constructs an `AutocompleteCommandInfo` literal, it must be updated by the frontend lane owner.
