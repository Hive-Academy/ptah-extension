# TASK_2026_375 — Batch report B5

**Batch**: B5 — Docs + CLAUDE.md
**Status**: complete.

---

## Files changed

| File                                                            | Change                                                                                                                                                                                                                      |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/ptah-docs/src/content/docs/marketplace/connected-apps.md` | Added a Smithery-hosted-server tip under "Two kinds of OAuth servers"; rewrote "When a connection takes effect" to say explicitly no restart is needed.                                                                     |
| `apps/ptah-docs/src/content/docs/marketplace/smithery.md`       | New "Your Smithery account" section (Account row + Connections list, badges, Managed by Ptah); extended "Installing a server" with the Needs authorization / Error badge and the single-`smithery`-server tool-prefix note. |
| `apps/ptah-docs/src/content/docs/marketplace/connectors.md`     | **NEW.** Catalog, three kinds, four status badges, custom-server disclosure, MCP chip, claude.ai connectors section.                                                                                                        |
| `apps/ptah-docs/src/content/docs/marketplace/index.md`          | Added Connectors to the provider table (first row) and its own subsection; noted it is the first tab; added it to Next steps.                                                                                               |
| `apps/ptah-docs/src/content/docs/chat/cost-and-tokens.md`       | Added an "MCP chip" section after the existing cost-bar content, linking to `connectors.md#the-mcp-chip-in-chat`.                                                                                                           |
| `apps/ptah-docs/astro.config.mjs`                               | Added `{ label: 'Connectors', slug: 'marketplace/connectors' }` to the Marketplace sidebar `items`, right after Overview.                                                                                                   |
| `libs/backend/cli-agent-runtime/CLAUDE.md`                      | Three new Guidelines bullets: manifest freshness, path-aware OAuth discovery, the Connections API namespace override.                                                                                                       |
| `libs/backend/rpc-handlers/CLAUDE.md`                           | One new Guidelines bullet: `SessionMcpStatusRegistry` + the four new `mcpDirectory` methods.                                                                                                                                |
| `libs/backend/agent-sdk/CLAUDE.md`                              | One new Guidelines bullet: `SessionMcpStatusCallbackRegistry`, why it is a DI fan-out, and why the direct channel is allowed for it.                                                                                        |
| `libs/frontend/chat/CLAUDE.md`                                  | One new Guidelines bullet (item 7): `McpStatusChipComponent`, why it is a smart molecule, and its Authorize routing.                                                                                                        |

`libs/frontend/marketplace/CLAUDE.md` does not exist and was not created, per instructions.

No file outside this list was touched. No git state command was run. The other engineer's uncommitted edits (`getting-started/*`, `providers/index.md`, `SCREENSHOTS.md`, `agent-sdk`, `memory-curator`, `chat-streaming`, `vscode-lm-tools` source files) were left untouched.

---

## Facts documented, sourced from the four batch reports

- **F1 / B1.1** — both manifest stores now re-read on every call via a `loadedSignature` (`mtimeMs:size`) check; an install/uninstall from another window is visible to the next session with no restart. Documented in `connected-apps.md`.
- **F2 / B1.2** — path-aware OAuth discovery (RFC 9728 path form, RFC 8414 path-insert form, 401 challenge fallback) is why a Smithery-hosted URL now works directly in Connected Apps. Documented in `connected-apps.md` and the `cli-agent-runtime` CLAUDE.md bullet.
- **B2** — Smithery Connections API: Account row (namespace), Connections list (`connected | needs-auth-ish states collapsed to "Needs authorization" | error`), `managedByPtah`/"Managed by Ptah", the single `smithery` session override, tool names prefixed `<connectionId>.<tool>`, legacy records unaffected until reconnect. Documented in `smithery.md` and the `cli-agent-runtime` CLAUDE.md bullet. Verified the exact tool-prefix example (`hubspot.search_contacts`, not `smithery.hubspot....`) against the B2 report's endpoint table.
- **B3** — catalog (21 entries, probe-verified, `oauth-dcr` / `oauth-app` / `smithery` kinds with the exact hint strings from `ptahConnectorKindHint()` in `ptah-connectors.catalog.ts`), four `ConnectorStatus` badges (`connected | needs-auth | error | not-connected`) read from `connectors-surface.component.ts`/`.html`, the "Connect a custom server" `<details>` embedding `OAuthSurfaceComponent`, Connectors placed first in `providers.registry.ts`. Documented in `connectors.md` and `index.md`. I did not name the `github` catalog entry's URL anywhere, per the B3 report's explicit warning about that trademarked host name.
- **B4** — the MCP chip: read `mcp-status-chip.component.ts` in full to confirm the exact `chipLabel`/`chipClasses` logic (plain count vs `connected/total`, and that the amber state and the fraction format are two independent conditions — `notices.length > 0` alone turns the chip amber without switching to a fraction). Authorize routing verified line-by-line: `smithery`/`smithery*` key → Marketplace Smithery surface, no RPC; `oauth-`-prefixed key with a matching `listOAuthConnected` record → `connectOAuth`; everything else (including an `oauth-` key with no record) → Connectors. claude.ai-connectors notice wording verified against the component template. Documented in `connectors.md`, `cost-and-tokens.md`, and the `chat` CLAUDE.md bullet.

---

## Marketplace-scanner wording

Per the hard rule, no docs markdown names GitHub's MCP URL, and none of the five forbidden product names (`copilot`, `codex`, `claude` outside the fixed phrase, `openai`, `anthropic`) appears anywhere. The one exception — **"claude.ai connectors"** — appears exactly four times, all as that fixed phrase, in `connectors.md` (×3) and `cost-and-tokens.md` (×1). An earlier draft of the `connectors.md` "claude.ai connectors" section used "claude.ai login" and "claude.ai account" outside the fixed phrase; both were rewritten to avoid any standalone "claude.ai" before this report was written.

---

## Build

```
npx nx build ptah-docs --skip-nx-cache
```

Tail:

```
 NX   Successfully ran target build for project ptah-docs

Your AI agent configuration is outdated. Run "nx configure-ai-agents" to update.
```

(The "AI agent configuration is outdated" line is an unrelated Nx notice, not a build warning — 157 pages built, 158 HTML files indexed by Pagefind, in the run immediately before this one.)

---

## Grep for forbidden words

Case-insensitive search for `copilot|codex|claude|openai|anthropic` across every edited file under `apps/ptah-docs`:

```
apps\ptah-docs\src\content\docs\marketplace\connectors.md:39:  … your claude.ai connectors are unavailable — see below.
apps\ptah-docs\src\content\docs\marketplace\connectors.md:47:## claude.ai connectors
apps\ptah-docs\src\content\docs\marketplace\connectors.md:49:If the popover shows a note about **claude.ai connectors**, …
apps\ptah-docs\src\content\docs\chat\cost-and-tokens.md:64:  … what the chip does when your claude.ai connectors are unavailable.
```

`connected-apps.md`, `smithery.md`, `index.md`, and `astro.config.mjs` returned **no matches** — the full grep result for those files was empty. Every match above is the fixed phrase "claude.ai connectors"; no bare `claude`, `claude.ai` alone, `codex`, `copilot`, `openai`, or `anthropic` appears in any edited docs file. The GitHub catalog entry's URL (`api.githubcopilot.com`, flagged in the B3 report) was not pasted anywhere.

---

## Not done / could not verify in code

- **Screenshots**: `connectors.md` has no screenshot, unlike `smithery.md` and `connected-apps.md`. No Connectors-surface screenshot exists in `apps/ptah-docs/public/screenshots/`, and generating one was out of scope for this batch (no running app to capture from, and the task did not ask for one). A later pass can add `![Connectors](/screenshots/marketplace-connectors.png)` once one exists.
- **`docsUrl`**: the B3 report notes no catalog entry sets `docsUrl` — nothing to link to per-provider docs from `connectors.md`, consistent with the catalog itself.
- **`smithery-surface.component.ts`'s 1262-line size** (noted as pre-existing/undone in the B3 report) has no docs implication and was not addressed here — out of scope for a docs batch.
- Everything else in this batch was verified directly against the implementation (`mcp-status-chip.component.ts`, `connectors-surface.component.ts` / `.html`, `smithery-surface.component.ts` template sections, `ptah-connectors.catalog.ts`) rather than taken from the batch reports alone.
- Nothing was committed.
