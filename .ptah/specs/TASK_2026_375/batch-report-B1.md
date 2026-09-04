# TASK_2026_375 — Batch report B1

**Batch**: B1 — Manifest freshness + path-aware OAuth discovery
**Scope**: `libs/backend/cli-agent-runtime/src/lib/mcp-directory/**` only
**Status**: complete. Typecheck, lint and test pass for both projects.

---

## Files changed

| File                                                                                              | Change                                                                                                                                                                                                      |
| ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `libs/backend/cli-agent-runtime/src/lib/mcp-directory/smithery-installed-manifest.ts`             | B1.1 — added `loadedSignature` + private `refresh()`. Called at the top of `list()`, `getConfig()`, `install()` and `uninstall()`. `save()` adopts a fresh signature. New module-private `statSignature()`. |
| `libs/backend/cli-agent-runtime/src/lib/mcp-directory/smithery-installed-manifest.spec.ts`        | B1.1 — new `describe('freshness (TASK_2026_375 B1.1)')` block, 7 cases.                                                                                                                                     |
| `libs/backend/cli-agent-runtime/src/lib/mcp-directory/oauth/mcp-oauth-installed-manifest.ts`      | B1.1 — same pattern. `refresh()` on `list()`, `has()`, `get()`, `record()` and `remove()`.                                                                                                                  |
| `libs/backend/cli-agent-runtime/src/lib/mcp-directory/oauth/mcp-oauth-installed-manifest.spec.ts` | **NEW FILE.** The store had no spec at all. 8 cases: two for the base contract, six for freshness.                                                                                                          |
| `libs/backend/cli-agent-runtime/src/lib/mcp-directory/oauth/mcp-oauth-metadata.ts`                | B1.2 — path-aware discovery. See below.                                                                                                                                                                     |
| `libs/backend/cli-agent-runtime/src/lib/mcp-directory/oauth/mcp-oauth-metadata.spec.ts`           | B1.2 — 13 new cases; every pre-existing case kept unchanged and still passes.                                                                                                                               |

No file outside `mcp-directory/` was touched. No git state command was run.

---

## B1.1 — manifest freshness

Both stores keep `loadedSignature: string | null`. `refresh()` calls
`fs.statSync`, builds `` `${mtimeMs}:${size}` `` and re-parses only when that
string differs from the one held in memory. A missing or unreadable file gives
`null`, which is the "file is absent" state and yields an empty manifest.

Two decisions worth naming:

1. **The signature carries the size, not the mtime alone.** The batch text asks
   for mtime. `mtimeMs` on Windows and on Linux `tmpfs` can be identical for two
   writes inside the same millisecond, and the second write would then be
   invisible for the life of the process. The size closes that hole at no cost.
   A spec pins it in each store (`re-parses when a same-millisecond write
changed the file size`, which forces both writes to one mtime with
   `fs.utimesSync`).
2. **`refresh()` also runs at the top of the MUTATING methods** (`install`,
   `uninstall`, `record`, `remove`), which the batch text does not name. Without
   it, instance A's `install()` serialises its own stale map over the whole
   file and silently deletes any record instance B wrote in the meantime — the
   same defect F1 describes, with data loss instead of a missed read. One spec
   per store pins it (`does not clobber a record written by another instance`).

I did **not** add `get()`/`has()` to `SmitheryInstalledManifestStore`. The batch
text names those read methods generically; that store only has `list()` and
`getConfig()`, and adding unused public methods for B2's benefit would be dead
code in this batch. B2 can add them.

**JSDoc**: the sentence "reads the manifest on each `buildOverrides()` so
installs/uninstalls take effect on the next session start without restarting"
appears verbatim in `rpc-handlers/.../chat-session.service.ts:174-178` and
`215-218`. It is now true, so per the batch instruction I left both comment
blocks exactly as they are. `smithery-override-resolver.ts` does not contain
that sentence, so it was not touched.

---

## B1.2 — path-aware OAuth discovery

`FetchLike`'s response type gained `headers?: { get(name: string): string | null }`.
It is optional, so every existing caller and every existing test fake still
compiles unchanged. A spec pins that a fake without `headers` is still a valid
`FetchLike` and still resolves.

`discoverAuthorizationServer(serverUrl, fetchImpl)` candidate order:

1. `${origin}/.well-known/oauth-protected-resource${path}` (RFC 9728 §3.1),
   only when the server URL has a non-root path.
2. `${origin}/.well-known/oauth-protected-resource`.
3. `GET serverUrl` with `Accept: application/json, text/event-stream`. On a
   401, `WWW-Authenticate` is parsed for `resource_metadata="<url>"` and that
   document is fetched.
4. The server origin, unchanged.

`discoverAuthServerMetadata(authServer, fetchImpl)` candidate order, with
`base = issuer.origin` and `path` the trailing-slash-stripped pathname:

1. `${base}/.well-known/oauth-authorization-server${path}` (RFC 8414 §3.1).
2. `${base}/.well-known/openid-configuration${path}`.
3. `${base}${path}/.well-known/oauth-authorization-server` and
   `${base}${path}/.well-known/openid-configuration` (OIDC Discovery 1.0 §4).
4. The two root documents.

Steps 1–3 are emitted only for a non-root path, so a root issuer produces the
exact two-candidate list it produced before. `OAuthDiscoveryError` now carries
the original `authServer`, path included, instead of its origin.

The challenge parser is exported as `parseResourceMetadataChallenge` for direct
unit testing. It is NOT added to the lib barrel (`mcp-directory/index.ts` is
unchanged).

Specs pin the measured shapes from `context.md` F2: the path-form
protected-resource document at `/hubspot/mcp`, the path-insert
authorization-server document at `/hubspot`, and a full assertion on the
candidate ORDER (`never asks for the issuer-suffix form before the path-insert
form`). The HubSpot-direct root shape is pinned to make exactly one request and
to report no `registration_endpoint`.

No URL, key or token is logged anywhere in the changed code. The two discovery
functions log nothing at all.

---

## Verification

```
npx nx run-many -t typecheck lint test -p @ptah-extension/cli-agent-runtime @ptah-extension/rpc-handlers --skip-nx-cache
```

Header: `NX  Running targets typecheck, lint, test for 2 projects`
Result: `NX  Successfully ran targets typecheck, lint, test for 2 projects`

| Project                             | Test suites    | Tests                              | Lint                                   |
| ----------------------------------- | -------------- | ---------------------------------- | -------------------------------------- |
| `@ptah-extension/cli-agent-runtime` | 46 passed / 46 | **590 passed / 590**               | 36 problems, **0 errors**, 36 warnings |
| `@ptah-extension/rpc-handlers`      | 91 passed / 91 | **2641 passed, 31 skipped / 2672** | 19 problems, **0 errors**, 19 warnings |

This batch adds 31 test cases: 7 in the Smithery manifest spec, 8 in the new
OAuth manifest spec, and 16 in the discovery spec (5 for
`discoverAuthorizationServer`, 6 for `parseResourceMetadataChallenge`, 5 for
`discoverAuthServerMetadata`). Every lint warning is pre-existing and in a file
this batch did not touch (grepping the lint output for
`mcp-oauth-metadata` and `installed-manifest` returns nothing). Both typecheck
targets are clean.

**One flaky failure, not caused by this batch.** The first run of the command
above reported
`rpc-handlers › skills-sh-source-root.service.spec.ts › writes every slug of a
whole-repo install and unions the record on re-install` as
`Exceeded timeout of 5000 ms`. That spec is in `src/lib/skills-sh/`, imports
nothing this batch changed, and passed on the two subsequent runs (2641 passed,
0 failed). It is a 5 s timeout on a slow first run, not a regression. Worth a
separate look; out of scope here.

---

## Live probe

Ran once against the real Smithery endpoint through the two exported functions
with `globalThis.fetch` (scratch file bundled with esbuild, then deleted —
Node 24 strip-only TypeScript cannot handle the `readonly serverUrl` parameter
property in `OAuthDiscoveryError`).

Input: `https://server.smithery.ai/hubspot/mcp`

```json
{
  "serverUrl": "https://server.smithery.ai/hubspot/mcp",
  "authorizationServer": "https://auth.smithery.ai/hubspot",
  "issuer": "https://auth.smithery.ai/hubspot",
  "authorizationEndpoint": "https://auth.smithery.ai/hubspot/authorize",
  "tokenEndpoint": "https://auth.smithery.ai/hubspot/token",
  "registrationEndpoint": "https://auth.smithery.ai/hubspot/register"
}
```

**`authorizationEndpoint`** = `https://auth.smithery.ai/hubspot/authorize`
**`registrationEndpoint`** = `https://auth.smithery.ai/hubspot/register`

`registrationEndpoint` is present, which confirms F2: every Smithery-hosted
server is a standard OAuth MCP server with RFC 7591 dynamic client
registration, and Ptah can now discover it. `scopes_supported` is absent from
the document, so `scopesSupported` is `undefined`. Both scratch files
(`tmp-b1-probe.ts`, `tmp-b1-probe.mjs`) were deleted; `git status` confirms no
leftover.

---

## Notes for later batches

- **B3.1 catalog probe**: the probe script above is a working template. Node's
  strip-only TypeScript loader cannot import this module directly; bundle with
  `npx esbuild <file>.ts --bundle --platform=node --format=esm` first, or write
  the probe as the Jest spec B3.1 already asks for.
- **B2** may want `get(serverKey)` / `has(serverKey)` on
  `SmitheryInstalledManifestStore` for the `connectionId` lookup. Add them with
  a `this.refresh()` first line, matching the two methods that exist.
- Nothing was committed.
