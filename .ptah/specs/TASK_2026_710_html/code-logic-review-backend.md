# Code Logic Review — `TASK_2026_710_html` (backend)

Review family: grok reviewing codex

## Summary

| Metric              | Value            |
| ------------------- | ---------------- |
| Overall score       | 4/10             |
| Assessment          | NEEDS_REVISION   |
| Blocking issues     | 5                |
| Serious issues      | 3                |
| Moderate issues     | 4                |
| Minor issues        | 2                |
| Failure modes found | 8                |

Score is 4, not 5–6: five independent breaks sit on the only user path (in-app publish never has a workspace, the tool schema admits no arguments, a non-empty list cannot pass its own response schema, list scope is a different id from the one publish stores, and artifact script can leave the no-network document). It is not 1–3: the protocol allowlist, scheme registration order, atomic directory rename, permission checks, and fixed tool error strings do what they claim once a call reaches them. No tests, typecheck, or build were run (session hold on heavy commands). Ptah code tools were not available in this session; evidence is from the files named in the brief.

Batch 9 DI (dispatcher dependency wiring, DI guard specs) was not scored. Electron already registers the store at `libs/backend/platform-electron/src/registration.ts:190` and `ArtifactRpcHandlers` at `apps/ptah-electron/src/di/phase-4-handlers.ts:93`.

## Five logic questions

### 1. How does this fail silently?

- A cold `artifacts:list` whose metadata cannot be read returns `{ artifacts: [] }` with `success: true`. `readRecords` turns every `readdir` failure into `[]` (`libs/backend/platform-electron/src/artifacts/electron-artifact-store.ts:145-151`), and `list` does the same for `realpath` (`electron-artifact-store.ts:119-124`). The RPC returns that value (`artifact-rpc.handlers.ts:57-58`). The user sees no cards and no error.
- After a successful publish, `ArtifactListResponseSchema` is a Zod 4 `strictObject` (`catchall: never()`, `node_modules/zod/v4/classic/schemas.js:909-915`). Every stored record still carries `savedPath` (`electron-artifact-store.ts:96` and the list map at `125-129` strips only `workspaceRoot`). `parse` throws (`artifact-rpc.handlers.ts:58`). `RpcHandler` turns that into `success: false` and sends `errorObj.message` to the webview (`libs/backend/vscode-core/src/messaging/rpc-handler.ts:242-252`). The frontend reload logs and returns, so a restart shows an empty dock. The bytes are on disk.
- Notification failure after a committed publish is swallowed on purpose (`artifact-tool-handlers.ts:60-63`) and is not a silent publish failure. The card still depends on list-on-reload, which is the path above.

### 2. What user action produces unexpected behaviour?

- User asks the in-app Electron agent to publish. The interactive MCP URL is only `/session/{tabId}` (`libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts:1900-1904`). The HTTP handler copies workspace only from a `/workspace/` segment (`http-server.handler.ts:407-409`, `302-309`). `handleArtifactPublish` then rejects because `getCallerWorkspaceRoot()` is empty (`protocol-dispatcher.ts:2355-2360`, `artifact-tool-handlers.ts:39-41`). External `.mcp.json` clients have the opposite shape: workspace and no session (`http-mcp-server.service.ts:843-849`), so they fail the same check.
- User switches chats and expects each tab's cards. `artifacts:list` ignores the caller and uses `getActiveSessionIds()[0]` plus the global active folder (`artifact-rpc.handlers.ts:49-57`). `[0]` is the most recently active session's real SDK id when one is bound (`session-registry.service.ts:437-455`). Publish stored the routing tab id (`sdk-query-options-builder.ts:1853-1858`). The webview buckets and filters by `claudeSessionId` (`tab-manager.service.ts:515-519`, `libs/frontend/chat/src/lib/services/artifact.store.ts:19-21` and `62-66`, consumer evidence only). A visible tab that is not `[0]` gets another session's rows, the filter drops them, and that tab's own rows never load. The filter does stop tab A from rendering tab B's HTML.
- User opens a published page whose script sets `location` or a meta refresh to `https://…`. The iframe navigates. `will-navigate` does not run for subframes (`main-window.ts:71-78`). The follow-on document is not under `ARTIFACT_CSP`.

### 3. What input data produces a wrong answer?

- Tool arguments that are a valid `{ title, html }` or `{ title, path }` do not match the advertised schema, because `properties` is replaced with `{}` and `additionalProperties` is `false` (`artifact-tools.ts:8-20`). A client that honors draft-07 rejects the call before the handler's Zod parse.
- A workspace HTML file that is a symlink to another in-workspace `.html` file is published. `realpath` plus `isPathWithinRoots` only rejects targets outside the root (`electron-artifact-store.ts:59-67`). The port text says symlinks are `INVALID_PATH` (`artifact-store.interface.ts:29-31`).
- A path file whose bytes are not UTF-8 (UTF-16, for example) and whose size is under 2 MiB is stored and served as `text/html; charset=utf-8` (`artifact-protocol.ts:7-8`). The requirement is UTF-8 HTML. The page is mojibake, not an error.
- Metadata with the six fields `readRecord` checks (`electron-artifact-store.ts:162-165`) but an oversized title or a non-ISO `createdAt` is returned as a record. One such file makes `ArtifactListResponseSchema.parse` throw for the whole list, so every sibling disappears from the RPC.

### 4. What happens when a dependency fails?

- Disk full, a locked `artifacts` path, or a failed rename on inline HTML becomes `ArtifactStoreError('INVALID_PATH')` (`electron-artifact-store.ts:110-113`). The tool text is "Artifact path must name a readable HTML file inside the caller workspace." (`artifact-tool-handlers.ts:24`). The agent retries the path. Nothing was committed; the temp directory is removed in that catch.
- The 500-record cap throws `INVALID_INPUT` (`electron-artifact-store.ts:81-85`), which the tool reports as "Invalid artifact input." (`artifact-tool-handlers.ts:23`). Two overlapping publishes can both pass the check; there is no lock.
- `openExternal` rejection becomes `{ opened: false }` (`artifact-rpc.handlers.ts:66-73`). That part is an observed failure, not a success.
- A missing store returns the fixed unsupported string (`artifact-tool-handlers.ts:42`). That part is truthful.
- Protocol resolver failures become HTTP 404 (`artifact-protocol.ts:62-64`). Fail closed. A corrupt URL becomes 404 without an audit comment (`artifact-protocol.ts:36-37`).

### 5. What is missing that the requirements never fully pinned?

- Acceptance 1 asks the tool result to include `savedPath`. The handler omits it (`artifact-tool-handlers.ts:65-73`). Keeping the userData path out of the model transcript is the safer choice; the criterion is still unmet. See Decisions.
- Acceptance 2's "new immutable revision" of a named artifact is unimplemented. Every publish is a new UUID at `revision: 1` (`electron-artifact-store.ts:87-91`).
- The plan's startup sweep of abandoned `*.tmp` directories is not implemented. Cleanup runs only in the publish `catch` (`electron-artifact-store.ts:110-112`). A killed process leaves `id.tmp`. Those names fail `ID_PATTERN` (the dot), so they are not listed.
- The plan says the link bridge reuses `isSafeExternalUrl` (`implementation-plan.md` preserve row for `navigation-policy.ts`). The RPC uses its own `http:`/`https:` check and then `shell.openExternal` (`artifact-rpc.handlers.ts:19`, `66-67`; `electron-user-interaction.ts:88-91`). `isSafeExternalUrl` is scheme-only and also allows `mailto:` (`navigation-policy.ts:18-19`, `67-69`). Artifact links are tighter on scheme and will not pick up a later host restriction added only to the navigation helper. The RPC body has no user-gesture field, so a script-initiated `open-link` that the shell forwards is indistinguishable from a click.
- `navigate-to` is correctly omitted if Chromium does not ship it (`implementation-plan.md` architecture paragraph). Nothing else cancels subframe navigations.

## Failure modes

### In-app publish never reaches the store

- Trigger: interactive agent calls `ptah_artifact_publish`. Its MCP URL has a session segment and no workspace segment.
- Symptom: tool error "Artifact publishing requires a trusted workspace and session." No file is written.
- Evidence: `sdk-query-options-builder.ts:1900`, `http-server.handler.ts:407-409`, `artifact-tool-handlers.ts:39-41`.
- Current handling: treated as a missing trusted scope.
- Recommendation: resolve the workspace with `resolveSessionWorkspaceRoot` (`workspace-root-resolver.ts:46-68`) from the caller session. Keep rejecting a workspace that appears only inside tool arguments.

### Advertised tool schema accepts no fields

- Trigger: a schema-faithful MCP client builds the arguments object.
- Symptom: the call is invalid before `ArtifactPublishInputSchema` runs, or the client sends `{}` and the handler returns the invalid-input string.
- Evidence: `artifact-tools.ts:20`.
- Current handling: handler Zod is correct and never consulted.
- Recommendation: spread the `toJSONSchema` result and do not overwrite `properties`.

### Reload cannot return a committed artifact

- Trigger: any successful publish, then `artifacts:list`.
- Symptom: RPC `success: false` with a Zod unrecognized-key message. Cold start shows no cards. Bytes remain under `userData/artifacts/<id>/`.
- Evidence: `electron-artifact-store.ts:96`, `electron-artifact-store.ts:129`, `artifact.schemas.ts:53-70`, `artifact-rpc.handlers.ts:58`, `rpc-handler.ts:249-252`.
- Current handling: the store test expects `savedPath` on list items (`electron-artifact-store.spec.ts:29`). The RPC schema rejects it.
- Recommendation: map each row to the six `ArtifactRecord` fields and `safeParse` per item. Drop a bad row. Do not fail the page.

### List scope is not the publishing session

- Trigger: two chats, or one chat after the SDK id is bound.
- Symptom: the visible tab's reload does not return that tab's artifacts. Tab B's HTML is not painted into tab A, because the client filters (`artifact.store.ts:62`). The dock stays empty or stale. `merge` keeps old rows when the filtered page is empty (`artifact.store.ts:72-83`), so a wrong response also does not clear the tab.
- Evidence: `artifact-rpc.handlers.ts:49-57`, `session-registry.service.ts:437-455`, `sdk-query-options-builder.ts:1853-1858`, consumer `tab-manager.service.ts:515-519`.
- Current handling: empty or unrelated page, then a client-side filter.
- Recommendation: contract fix under Decisions. Do not keep `getActiveSessionIds()[0]`.

### Artifact script performs a network navigation

- Trigger: inline script assigns `location`, or a `<meta http-equiv="refresh">`, to an `https:` URL. `fetch`, XHR, WebSocket, and remote images stay blocked by `ARTIFACT_CSP` (`artifact-protocol.ts:6`).
- Symptom: the iframe loads that URL. That response is not under the artifact CSP. Query strings carry page data out. Sandbox stays `allow-scripts` only, so top navigation and `window.open` stay blocked. `setWindowOpenHandler` is not the control for this path (`main-window.ts:80-83`).
- Evidence: `main-window.ts:71-78` (top-level `will-navigate` only), `artifact-protocol.ts:6` (no navigation directive). Parent `frame-src ptah-artifact:` (`copy-renderer.js:171`) governs the shell embedding the frame. It is not a substitute for a subframe guard.
- Current handling: top-level navigations are cancelled and `http:`/`https:` are opened outside. Subframes are not observed.
- Recommendation: `webContents.on('will-frame-navigate', …)` allow only `GET`-equivalent loads of `ptah-artifact://<id>/index.html` with the same host, path, and empty query/hash rules as `createArtifactHandler`. `preventDefault` for everything else. Do not call `openExternal` for a cancelled subframe (that is a second exfil path).

### Symlink swap between check and read

- Trigger: `path` publish. `realpath` says the target is inside the workspace. Before `readFile`, that path is replaced with a symlink to an outside file.
- Symptom: outside bytes are copied into the artifact store and served to the iframe.
- Evidence: `electron-artifact-store.ts:59-73`. `isPathWithinRoots` is lexical (`path-containment.ts:19-26`) and does not close this window. The non-race escape is rejected (`electron-artifact-store.spec.ts:56-67`).
- Current handling: check-then-read by path.
- Recommendation: open with `O_NOFOLLOW` where the platform has it, `fstat` the fd, and refuse a non-regular file. Compare device and inode with the `lstat` taken before the open.

### One bad metadata file hides the workspace

- Trigger: crash, hand edit, or a future writer leaves `metadata.json` that passes the manual `typeof` checks and fails `ArtifactRecordSchema`.
- Symptom: `artifacts:list` throws. No artifact in that store root is returned.
- Evidence: `electron-artifact-store.ts:157-166` (`as Partial<StoredArtifact>`, then `as StoredArtifact`), `artifact-rpc.handlers.ts:58`.
- Current handling: corrupt JSON becomes `null` (that part is fine, `167-169`). A shape that is merely off-schema is returned and then fails the batch.
- Recommendation: `ArtifactRecordSchema.safeParse` inside `readRecord` after stripping unknown keys. Skip the bad id.

### Cap and disk errors describe the wrong fault

- Trigger: 500 parsed records for the workspace, or any `fs` error after validation.
- Symptom: the model is told the input or the path is illegal.
- Evidence: `electron-artifact-store.ts:81-85`, `110-113`, `artifact-tool-handlers.ts:22-27`.
- Current handling: typed code, wrong user string. `NOT_FOUND` is in the map and never thrown.
- Recommendation: add a `QUOTA` or `IO` code with a fixed sentence. Do not put the path or HTML in it.

## Blocking issues

### 1. In-app and external callers both fail the scope check

- File: `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/artifact-tool-handlers.ts:39`
- Scenario: Electron chat publishes through `/session/{tabId}` with no `/workspace/` segment. A workspace-only external client has no session.
- Impact: `ptah_artifact_publish` does not publish on the path the product uses.
- Fix: for a caller session id, resolve that session's workspace through `resolveSessionWorkspaceRoot`. Do not read workspace from tool args. Session-less external clients keep a truthful error until a real session id exists.

### 2. MCP input schema forbids the documented fields

- File: `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/artifact-tools.ts:20`
- Scenario: `inputSchema` sets `properties: {}` and `additionalProperties: false` on top of the union schema.
- Impact: a conforming client cannot send `title` and `html` or `path`.
- Fix: remove the `properties` and `additionalProperties` overrides and publish the `toJSONSchema` object (minus `$schema`).

### 3. `artifacts:list` throws on every real record

- File: `libs/backend/platform-electron/src/artifacts/electron-artifact-store.ts:129` and `libs/backend/rpc-handlers/src/lib/handlers/artifact-rpc.handlers.ts:58`
- Scenario: `savedPath` is still on the object. `ArtifactListResponseSchema` / `ArtifactRecordSchema` are strict (`libs/shared/src/mcp-apps-contracts/artifact.schemas.ts:53-70`).
- Impact: reload and restart cannot show a committed artifact. The Zod message is returned to the renderer (`rpc-handler.ts:251`) and the error object is logged and sent to Sentry (`rpc-handler.ts:244-247`).
- Fix: return only `ArtifactRecord` fields. Parse per item.

### 4. List binds the wrong session and the wrong workspace

- File: `libs/backend/rpc-handlers/src/lib/handlers/artifact-rpc.handlers.ts:49-57`
- Scenario: scope is `getActiveFolder()` (or the global workspace root) paired with `getActiveSessionIds()[0]`. Publish stored the routing tab id. The webview filters with `claudeSessionId`.
- Impact: the tab the user is looking at does not receive its artifacts. This is a silent empty result, not a cross-paint of the other tab's HTML.
- Fix: see Decisions. Stop using `[0]`.

### 5. No-network stops at the first document

- File: `apps/ptah-electron/src/windows/main-window.ts:71-78`
- Scenario: artifact script navigates the iframe to `https:`.
- Impact: network load and query-string exfil of the page the user asked the agent to render. Response CSP does not apply to the next document.
- Fix: cancel non-artifact subframe navigations in `will-frame-navigate`, including the initial load's allowlist so `ptah-artifact://<id>/index.html` still loads. Do not hand cancelled subframe URLs to `shell.openExternal`.

## Serious issues

### 6. Path publish is check-then-read

- File: `libs/backend/platform-electron/src/artifacts/electron-artifact-store.ts:59-73`
- Scenario: the checked `realSource` is replaced with an escaping symlink before `readFile`.
- Impact: bytes from outside the workspace are stored and served.
- Fix: read through a no-follow fd and refuse anything that is not a regular file inside the root.

### 7. Metadata is cast, not parsed

- File: `libs/backend/platform-electron/src/artifacts/electron-artifact-store.ts:157-166`
- Scenario: JSON with the manually checked fields and a value `ArtifactRecordSchema` rejects.
- Impact: one file fails the entire list RPC. `as StoredArtifact` is an unchecked cast. No `as unknown as` was added on the artifact dispatch path. Pre-existing `as unknown as` casts in `protocol-dispatcher.ts` (around `1006`, `1014`, `1040`) belong to other tools and are not scored here.
- Fix: `safeParse` the record schema and skip failures.

### 8. Store IO failure looks like an empty library

- File: `libs/backend/platform-electron/src/artifacts/electron-artifact-store.ts:145-151` and `:119-124`
- Scenario: `userData/artifacts` exists but `readdir` or workspace `realpath` fails for a reason other than a not-yet-created directory.
- Impact: RPC success with no rows. The audit comment says the directory is absent before the first publish. The `catch` does not check the error code.
- Fix: return `[]` only for `ENOENT`. Surface other codes as a typed store error the RPC maps to a fixed `RpcUserError`.

## Moderate and minor issues

### 9. Moderate — link open path is a second allowlist

- File: `libs/backend/rpc-handlers/src/lib/handlers/artifact-rpc.handlers.ts:66-67`
- `http:` and `https:` are enforced (`artifact.schemas.ts:91-96`). `javascript:`, `file:`, and `ptah-artifact:` are rejected (handler spec). `ElectronUserInteraction.openExternal` does not call `isSafeExternalUrl` (`electron-user-interaction.ts:88-91`). No gesture bit is required.
- Fix: call `isSafeExternalUrl` and keep the `http(s)` refinement. Add an explicit gesture or single-click nonce at the RPC boundary if the shell cannot prove one.

### 10. Moderate — caps are silent or racy

- File: `libs/backend/platform-electron/src/artifacts/electron-artifact-store.ts:19-21` and `:81-85` and `:128`
- List returns 200 of 500 with no `truncated` flag. The 500 check is a non-atomic read of every metadata file. Quota uses `INVALID_INPUT` (see failure mode above). Inline disk failures use `INVALID_PATH` (`:110-113`).
- Fix: a `QUOTA` code, a lock or atomic counter around publish, and a list flag when older rows exist.

### 11. Moderate — leftovers, in-root symlinks, e2e file root

- File: `electron-artifact-store.ts:65-67` and `:98-112`; `apps/ptah-electron/src/main.ts:122-133`
- In-root symlinks to `.html` are followed. `*.tmp` is not swept on startup. When `PTAH_E2E=1` and `PTAH_E2E_ARTIFACT_FIXTURE_DIR` is set, the resolver reads `${id}.html` from that directory before the store, with no `app.isPackaged` guard. The id is already limited by the protocol regex, so this is not a `..` traversal. `readFile` still follows a symlink inside the fixture directory.
- Fix: reject any symlink (`lstat`), sweep `*.tmp` at store construction, and ignore the fixture env unless the process is unpackaged or an e2e-only binary.

### 12. Moderate — republish and `savedPath` in the tool result

- File: `electron-artifact-store.ts:87-91`; `artifact-tool-handlers.ts:65-73`
- A second publish of the same title allocates a new id at revision 1. The tool success JSON does not include `savedPath`, which acceptance 1 names.
- Fix: either document new-id as the revision policy and drop `savedPath` from the acceptance text, or return it only on a host that does not write tool transcripts into logs. Do not add the absolute path to the error strings.

### 13. Minor — shell CSP unit expectation is stale

- File: `apps/ptah-electron/src/windows/shell-csp.spec.ts:164`
- Runtime policy is `frame-src ptah-artifact:` (`copy-renderer.js:171`), which is the change the plan requires. The spec still expects `frame-src 'none'`.
- Fix: expect `ptah-artifact:` and no other frame targets.

### 14. Minor — URL parser catch has no audit comment

- File: `apps/ptah-electron/src/artifacts/artifact-protocol.ts:36-37`
- Malformed `request.url` becomes 404. The resolver `catch` at `62-64` has the required comment. This one does not.
- Fix: add the `degradation-audit` comment. Behavior can stay fail-closed.

## Data flow

1. MCP `tools/call` → URL identity only (`http-server.handler.ts:407-409`). OK that the body cannot forge scope. Gap: in-app URL has no workspace, so step 2 fails closed for the main caller.
2. `protocol-dispatcher.ts:2354-2360` passes `getCallerWorkspaceRoot()` and `getCallerSessionId()` and not argument fields. OK as a trust boundary. Gap: those two getters are not the session's workspace, and the session id is the tab routing id.
3. `handleArtifactPublish` validates with `ArtifactPublishInputSchema`, refuses a missing scope, refuses a missing store, and does not put HTML into the error text (`artifact-tool-handlers.ts:37-78`). OK. Gap: tool schema at step 0 already dropped the fields.
4. `ElectronArtifactStore.publish` validates again, `realpath`s the workspace, copies path bytes or encodes `html`, enforces 2 MiB, writes `id.tmp` then renames onto `id` (`electron-artifact-store.ts:34-114`). OK for atomic visibility. Gaps: TOCTOU, wrong error codes, no lock, `savedPath` retained.
5. Notification parse failure logs a fixed warning and still returns success (`artifact-tool-handlers.ts:49-74`). OK.
6. Protocol: `registerArtifactScheme()` runs at `main.ts:58` before `app.whenReady`. `registerArtifactHandler` runs at `main.ts:140` before `createMainWindow`. Privileges are `standard` and `secure` only (`artifact-protocol.ts:20-26`). Handler allows `GET`, scheme `ptah-artifact:`, hostname `/^[a-z0-9][a-z0-9-]{0,127}$/`, pathname exactly `/index.html`, and rejects search, hash, userinfo, and port (`artifact-protocol.ts:39-51`). `randomUUID()` fits that regex and the record regex `/^[A-Za-z0-9_-]{16,128}$/` (`artifact.schemas.ts:39`). Hostname case-folding does not change a UUID. `readBytes` joins only that id (`electron-artifact-store.ts:133-138`) and does not use `savedPath`. OK for traversal of the URL itself.
7. Response headers match the planned CSP, `nosniff`, `no-store`, and `text/html; charset=utf-8` (`artifact-protocol.ts:5-12`). Gap: the next navigation is outside this response.
8. Shell `frame-src` is only `ptah-artifact:` (`copy-renderer.js:171`). Top-level `will-navigate` still cancels non-reload loads and will not `openExternal` a `ptah-artifact:` URL (`navigation-policy.ts:67-69`). `setWindowOpenHandler` denies the new window (`main-window.ts:80-83`). Permission requests must come from the shell renderer document (`permission-policy.ts:145-148`), so an artifact origin does not get microphone or clipboard. Those three do not need to allow the custom scheme. Gap: no `will-frame-navigate`.
9. `artifacts:list` → store `list` → strict parse. Gap: `savedPath`, session id, active folder.
10. `artifacts:openLink` → `http(s)` → `shell.openExternal`. Gap: shared allowlist and gesture not applied. Failure returns `{ opened: false }`.

## Requirements fulfilment

| Requirement | Status | Gap |
| ----------- | ------ | --- |
| Publish title plus html or path, 2 MiB, no partial record | PARTIAL | Atomic rename is real. In-app call never gets that far. Schema advertises no fields. |
| Scope from trusted caller only | PARTIAL | Args are not trusted. Caller workspace is not resolved from the session. |
| Reload restores the card | MISSING | List throws on `savedPath` and queries the wrong session id. |
| New revision of a named artifact | MISSING | New id, revision always 1. |
| CSP denies network; shell `frame-src` only `ptah-artifact:` | PARTIAL | Header string and shell directive match. Subframe navigation is open. |
| Tool error without HTML or paths; notification failure keeps the publish | COMPLETE | Fixed strings. Notify `catch` is audited. |
| Unsupported host is truthful | COMPLETE | Missing store returns `UNSUPPORTED` text. Hosts other than Electron were not re-scored (Batch 9). |
| `open-link` http(s) only, via main-process allowlist | PARTIAL | Scheme check holds. It is not `isSafeExternalUrl`. |
| Register scheme before ready; handler before the window | COMPLETE | `main.ts:58` and `:140`. `esbuild.config.cjs:49` lists `protocol` so the CJS named-import plugin exposes Electron's `protocol`. That is wiring, not a logic defect. |
| Symlink and `..` cannot be published | PARTIAL | Escape after `realpath` is rejected. TOCTOU and in-root symlinks remain. |
| No `any` / unaudited swallow on the new paths | PARTIAL | Artifact dispatch has no new `any`. `readRecord` casts. URL `catch` at `artifact-protocol.ts:36` has no audit comment. |

Implicit requirements not addressed: startup temp sweep, explicit storage eviction (code refuses at 500 instead, which is safer than silent delete), user-gesture on open-link.

## Edge cases

| Case | Handled | How | Concern |
| ---- | ------- | --- | ------- |
| Empty title, both sources, extra keys | YES | `ArtifactPublishInputSchema` strict union | Advertised JSON schema undoes it |
| `..`, absolute path, non-html, oversize | YES | realpath, extension, 2 MiB | TOCTOU |
| Unknown protocol id, bad method, query, hash | YES | 404 | — |
| Concurrent publishes of different ids | YES | UUID directories | Cap check races |
| Process kill mid-write | YES | `id.tmp` not listed | Never swept |
| Missing artifact directory | YES | `[]` | Same catch hides other IO errors |
| Two tabs | NO | `[0]` and tab-id vs real id vs `claudeSessionId` | Empty dock |
| iframe `location = https://…` | NO | no subframe guard | Network |
| E2E fixture id | YES | protocol regex before `join` | Env not packaged-gated; symlink followed |

## Decisions

- Verdict is NEEDS_REVISION, not REJECTED. The URL allowlist, registration order, atomic rename, and permission binding are sound. The defects are specific and local.
- Cross-tab display: denied as "tab A shows tab B's HTML". Confirmed as "tab A cannot load its own rows". Options were (a) leave `[0]` because the contract says the client sends no scope, (b) trust a client session id blindly, (c) accept a session id only when the registry resolves it. Chose (c). Evidence: `ArtifactListRequest` is `{}` by design (`artifact.types.ts:21-22`, `artifact.schemas.ts:68`) and the handler spec rejects a client `sessionId` (`artifact-rpc.handlers.spec.ts:47-49`), while `getActiveSessionIds()[0]` is defined as most-recently-active for spawn attribution (`session-registry.service.ts:437-441`), and publish stores the tab routing id (`sdk-query-options-builder.ts:1853-1858`) which is not `claudeSessionId`. Reversible: yes, it is a request-schema change.
- Contract fix: change `ArtifactListRequest` to `{ sessionId: string }` with a max length. The handler resolves that string through the session registry as either a tab id or a real SDK id. Unknown ids return an empty list or `INVALID_PARAMS`, not another session's rows. `store.list` uses the registry record's routing tab id (the value publish writes) and that record's `projectPath`, not `getActiveFolder()` and not `[0]`. The webview sends the same id it buckets by, and publish must persist that same id (or the host translates both ways through one registry record). Do not let the model choose the id.
- `savedPath` stays out of the model-facing tool text until the acceptance line is changed. The list bug is the extra field on the RPC object, which is a separate fix (strip it). Reversible.
- `navigate-to` is not required in the CSP header. Electron's subframe event is the control the plan already assigned to the main window.
- Batch 9 unwired providers are out of this verdict.

## Unknowns

- Containment Playwright specs were not executed. Header CSP enforcement on `protocol.handle` is taken from the response construction, not from a live Electron load.
- Whether current Chromium also applies the parent's `frame-src` to a child-initiated navigation was not treated as a substitute for `will-frame-navigate`. If it does, finding 5 is defense-in-depth rather than a confirmed live bypass. The guard is still missing, and the plan named it as the control.
- Windows reserved device names (`con`, `nul`) inside `userData/artifacts` were not probed. Node often prefixes `\\?\`, which disables that Win32 parsing. Not scored.
- `fs.realpath` prefix differences (`\\?\`) between the stored workspace root and a later `list` root could make equality fail on Windows. Not observed here. Not scored.
- MCP HTTP authentication of who may open the localhost port is outside this diff. The artifact handler does not add a new way to pass scope in the tool body.

## Verdict

- Recommendation: REVISE
- Confidence: HIGH for findings 1–4 and 6–8 (code path read). MEDIUM for finding 5 until a subframe navigation is observed in Electron.
- Top risk: a published page can navigate the iframe onto the network, and the list/publish session contract cannot show the page the user just published.
- What a robust implementation would add: session-scoped workspace resolution, a schema that matches `ArtifactPublishInputSchema`, record projection before the list parse, registry-checked `artifacts:list` params, `will-frame-navigate` allowlist, no-follow reads, per-item metadata parse, and IO/quota error codes with fixed text.
