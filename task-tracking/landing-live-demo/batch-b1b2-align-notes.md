# B1/B2 live demo alignment

- Moved the optional `sessionId` and `sessionName` fields into the shared `ViewChangedPayload` in `system.ts` and removed the temporary payload-map alias. Existing message-map users now resolve the shared definition.
- Ran Prettier on `app-state.service.ts`, `payload-map.ts`, and `system.ts`. The app-state edit is formatting only relative to the existing session-open implementation.
- Removed all nine `$activeTabId` timeline fields from `chat-tool-call.json`, retaining the boot `switchView` message and the scenario session UUID on all 10 timeline payloads. Regenerated `chat-tool-call.scenario.generated.ts` with `node scripts/landing/generate-live-demo-types.mjs`.
- Switched replay `switchView` typing to the shared `ViewChangedPayload`. The scenario contract now checks that chat timeline payloads and `session:turnEnded` use the boot session ID and omit `tabId`; the `$activeTabId` exception is gone.

## Verification

- Fixture inspection: 10 timeline messages; 0 session ID mismatches; 0 timeline payloads with `tabId`.
- `npm run verify -- -p web-landing,@ptah-extension/core,@ptah-extension/shared`: passed (exit 0): 9 lint/test/typecheck tasks succeeded across the three requested projects, with 1 cache hit. The verifier waited 188 seconds for a slot, then ran for 159 seconds. Nx marked `web-landing:lint` and `web-landing:test` as flaky tasks, but both succeeded in this run.
- Scoped Ptah diagnostics found no errors in the five requested TypeScript files. Its broader sibling-file scan reported 104 errors in unrelated core spec files, including `auth-state.service.spec.ts` and `electron-layout.service.spec.ts`; those files are outside this lane's edit scope. The requested scoped verifier passed despite that broader diagnostic result.
