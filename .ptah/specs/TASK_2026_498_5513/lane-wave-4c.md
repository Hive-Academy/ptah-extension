## Q1. `@vscode/vsce` 3.9.2 -> 4.0.0

Verified with `npm view` that 3.9.2 declares `glob: ^13.0.6` and 4.0.0 declares `tinyglobby: ^0.2.17`. Inspection of the two published `out/package.js` files shows that this replacement does not change the matcher used for `.vscodeignore`:

- Both releases enumerate candidate files with the pattern `**` and explicitly set `dot: true` (`glob` in 3.9.2, `tinyglobby` in 4.0.0).
- Both releases parse `.vscodeignore` and test every candidate with `minimatch(file, pattern, { dot: true })`.
- Consequently, no listed `.vscodeignore` pattern is interpreted by `glob` in 3.9.2 or by `tinyglobby` in 4.0.0. The complete pattern list matches the same set in both versions.
- In the requested edge cases, `.gitignore`, `.DS_Store`, and `.git/**` match dot paths because `dot: true` is explicit. `LICENSE.md` and `Thumbs.db` are root-only bare-name matches. `*.log` and `*.vsix` are also root-only; neither becomes an any-depth match.

Patterns where the releases differ: **none**.

VERDICT: SAFE

1. None.

## Q2. `@openai/codex-sdk` 0.147.x -> 0.155.1

`npm view` verified published versions 0.147.0 and 0.155.1 and the declaration entry point `./dist/index.d.ts` for both. The published declaration blocks from `AgentMessageItem` through `ThreadEvent` are byte-for-byte equal (3,405 characters) between these versions. `ThreadEvent` therefore did not change. This includes the complete `ThreadItem` union and the event, usage, and error shapes used here.

The adapter reads these SDK event properties (the line shown is the first direct read; repeated reads are noted where useful):

- `event.type` — `D:\projects\ptah-extension\libs\backend\cli-agent-runtime\src\lib\cli-agents\cli-adapters\codex-cli.adapter.ts:718` (also 741, 744, 801)
- `event.thread_id` — `D:\projects\ptah-extension\libs\backend\cli-agent-runtime\src\lib\cli-agents\cli-adapters\codex-cli.adapter.ts:719`
- `event.item` — `D:\projects\ptah-extension\libs\backend\cli-agent-runtime\src\lib\cli-agents\cli-adapters\codex-cli.adapter.ts:803` (also 807, 816)
- `event.item.type` — `D:\projects\ptah-extension\libs\backend\cli-agent-runtime\src\lib\cli-agents\cli-adapters\codex-cli.adapter.ts:842`
- `event.item.command` — `D:\projects\ptah-extension\libs\backend\cli-agent-runtime\src\lib\cli-agents\cli-adapters\codex-cli.adapter.ts:851`
- `event.item.id` — `D:\projects\ptah-extension\libs\backend\cli-agent-runtime\src\lib\cli-agents\cli-adapters\codex-cli.adapter.ts:857`
- `event.item.server` and `event.item.tool` — `D:\projects\ptah-extension\libs\backend\cli-agent-runtime\src\lib\cli-agents\cli-adapters\codex-cli.adapter.ts:865`
- `event.item.arguments` — `D:\projects\ptah-extension\libs\backend\cli-agent-runtime\src\lib\cli-agents\cli-adapters\codex-cli.adapter.ts:866`
- `event.item.text` — `D:\projects\ptah-extension\libs\backend\cli-agent-runtime\src\lib\cli-agents\cli-adapters\codex-cli.adapter.ts:924`
- `event.item.aggregated_output` — `D:\projects\ptah-extension\libs\backend\cli-agent-runtime\src\lib\cli-agents\cli-adapters\codex-cli.adapter.ts:971`
- `event.item.exit_code` — `D:\projects\ptah-extension\libs\backend\cli-agent-runtime\src\lib\cli-agents\cli-adapters\codex-cli.adapter.ts:977`
- `event.item.changes` — `D:\projects\ptah-extension\libs\backend\cli-agent-runtime\src\lib\cli-agents\cli-adapters\codex-cli.adapter.ts:994`
- `event.item.changes[].kind` and `.path` — `D:\projects\ptah-extension\libs\backend\cli-agent-runtime\src\lib\cli-agents\cli-adapters\codex-cli.adapter.ts:996`
- `event.item.status` — `D:\projects\ptah-extension\libs\backend\cli-agent-runtime\src\lib\cli-agents\cli-adapters\codex-cli.adapter.ts:1006`
- `event.item.error` — `D:\projects\ptah-extension\libs\backend\cli-agent-runtime\src\lib\cli-agents\cli-adapters\codex-cli.adapter.ts:1014`
- `event.item.result` — `D:\projects\ptah-extension\libs\backend\cli-agent-runtime\src\lib\cli-agents\cli-adapters\codex-cli.adapter.ts:1022`
- `event.item.query` — `D:\projects\ptah-extension\libs\backend\cli-agent-runtime\src\lib\cli-agents\cli-adapters\codex-cli.adapter.ts:1043`
- `event.item.items` — `D:\projects\ptah-extension\libs\backend\cli-agent-runtime\src\lib\cli-agents\cli-adapters\codex-cli.adapter.ts:1058`
- `event.item.items[].completed` and `.text` — `D:\projects\ptah-extension\libs\backend\cli-agent-runtime\src\lib\cli-agents\cli-adapters\codex-cli.adapter.ts:1059`
- `event.item.message` — `D:\projects\ptah-extension\libs\backend\cli-agent-runtime\src\lib\cli-agents\cli-adapters\codex-cli.adapter.ts:1086`
- `event.usage` — `D:\projects\ptah-extension\libs\backend\cli-agent-runtime\src\lib\cli-agents\cli-adapters\codex-cli.adapter.ts:1110`
- `event.usage.input_tokens` and `.output_tokens` — `D:\projects\ptah-extension\libs\backend\cli-agent-runtime\src\lib\cli-agents\cli-adapters\codex-cli.adapter.ts:1111`
- `event.error.message` — `D:\projects\ptah-extension\libs\backend\cli-agent-runtime\src\lib\cli-agents\cli-adapters\codex-cli.adapter.ts:1123`
- `event.message` — `D:\projects\ptah-extension\libs\backend\cli-agent-runtime\src\lib\cli-agents\cli-adapters\codex-cli.adapter.ts:1136`

VERDICT: SAFE

1. None.

## Q3. `@workos-inc/node` -> 10.13.0

`npm view` verified version 10.13.0 and declaration entry point `./lib/index.d.cts`. The published 10.13.0 declarations accept every current call shape. All SDK calls are in one file:

| File and line                                                                                     | Current call shape                                                                                                                      | Required WorkOS 10.13.0 shape                                                                                                                                                                                                    |
| ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `D:\projects\ptah-extension\libs\api\identity\src\lib\services\workos\workos-user.service.ts:78`  | `userManagement.authenticateWithPassword({ clientId, email, password })`                                                                | Same: one `AuthenticateWithPasswordOptions` object; `email` and `password` required, `clientId` accepted.                                                                                                                        |
| `D:\projects\ptah-extension\libs\api\identity\src\lib\services\workos\workos-user.service.ts:101` | `userManagement.authenticateWithCode({ clientId, code, codeVerifier })`                                                                 | Same: one `AuthenticateWithCodeOptions` object; `code` required and `clientId`/`codeVerifier` accepted.                                                                                                                          |
| `D:\projects\ptah-extension\libs\api\identity\src\lib\services\workos\workos-user.service.ts:129` | `userManagement.createUser({ email, password, firstName, lastName, emailVerified: false })`                                             | Same: one `CreateUserOptions` object; every supplied field is declared. `CreateUserResponse` extends `User`, so returning it as `User` remains valid.                                                                            |
| `D:\projects\ptah-extension\libs\api\identity\src\lib\services\workos\workos-user.service.ts:149` | `userManagement.verifyEmail({ userId, code })`, destructuring `{ user }`                                                                | Same: `verifyEmail({ userId, code }): Promise<{ user: User }>` exactly matches.                                                                                                                                                  |
| `D:\projects\ptah-extension\libs\api\identity\src\lib\services\workos\workos-user.service.ts:166` | `userManagement.sendVerificationEmail({ userId })`; return ignored                                                                      | Same input object. WorkOS 10 returns `Promise<{ user: User }>`; ignoring the resolved value is valid.                                                                                                                            |
| `D:\projects\ptah-extension\libs\api\identity\src\lib\services\workos\workos-user.service.ts:183` | `userManagement.listUsers({ email })`, then `response.data?.[0]`                                                                        | Same: `listUsers(options?: ListUsersOptions)` accepts `email` and returns an auto-paginatable response with `data`.                                                                                                              |
| `D:\projects\ptah-extension\libs\api\identity\src\lib\services\workos\workos-user.service.ts:203` | `userManagement.getAuthorizationUrl({ provider: 'authkit', clientId, redirectUri, state, codeChallenge, codeChallengeMethod: 'S256' })` | Same single options object. WorkOS 10 requires `redirectUri`; it accepts the other supplied fields and requires `codeChallenge` plus `codeChallengeMethod: 'S256'` together, which this call does. Return type remains `string`. |
| `D:\projects\ptah-extension\libs\api\identity\src\lib\services\workos\workos-user.service.ts:229` | Same call with `provider: providerMap[provider] as any` (`GitHubOAuth` or `GoogleOAuth`)                                                | Same `UserManagementAuthorizationURLOptions` object. In 10.13.0 `provider?: string`, so the values are accepted and the `as any` cast is unnecessary but not a migration requirement.                                            |

The provider construction at `D:\projects\ptah-extension\libs\api\identity\src\lib\providers\workos.provider.ts:56`, `new WorkOS(apiKey)`, also remains the documented 10.13.0 server-side constructor shape.

VERDICT: SAFE

1. None.

## Q4. Astro 6 -> 7.3.3 with `@astrojs/starlight` 0.42.2

`npm view @astrojs/starlight@0.42.2 peerDependencies` returns:

```text
{ astro: '^7.2.10', '@astrojs/markdown-remark': '^7.3.0' }
```

Therefore Astro 7.3.3 satisfies Starlight's required Astro range. `@astrojs/markdown-remark` is marked as an optional peer by the same published package metadata.

Only these Astro 7 breaking defaults apply to the configuration actually present in `D:\projects\ptah-extension\apps\ptah-docs\astro.config.mjs`:

- New Markdown processor: the config has no `markdown.processor` override, so Astro 7 uses Satteri instead of the Astro 6 remark/rehype default. Starlight 0.42.2 explicitly depends on `@astrojs/markdown-satteri ^0.4.0` and supports this path; the config needs no migration edit.
- New whitespace handling: the config has no `compressHTML` setting, so its effective default changes from `true` in Astro 6 to `'jsx'` in Astro 7. This can remove inter-element whitespace between adjacent inline elements. It is a behavior change, not an invalid config/API use. If exact Astro 6 whitespace is required, add `compressHTML: true`; otherwise no change is required.

No configured key in this file is removed or renamed. It has no `vite`, `experimental`, `cache`, `routeRules`, `fetchFile`, Container API, `@astrojs/db`, or transition-internals usage, so those migration items do not apply. Its `site`, `redirects`, `integrations`, and shown Starlight options remain valid.

VERDICT: SAFE

1. None. Optional compatibility pin only: add `compressHTML: true` at `D:\projects\ptah-extension\apps\ptah-docs\astro.config.mjs:9` if preserving Astro 6 whitespace semantics is a requirement.
