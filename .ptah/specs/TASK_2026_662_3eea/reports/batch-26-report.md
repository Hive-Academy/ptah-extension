## Changed files

- `apps/ptah-extension-webview/src/app/app.config.ts:81`: removed the `SkillSynthesisLiveService` import; its `MESSAGE_HANDLERS` provider was removed near line 297.
- `apps/ptah-extension-webview/src/app/thoth-message-routing.spec.ts:39`: removed the live service import and its model refresh test setup; removed its provider, injection, constant assertion, and event delivery case. Remaining routing assertions start near line 143.

## Post-cut grep

- `rg -n 'SkillSynthesisLiveService|SKILL_SYNTHESIS_EVENT|skillSynthesis:event' apps/ptah-extension-webview` → zero hits.
- Before editing, the service class occurred only in the two assigned webview files. No outside webview consumer was found.
- `ptah_get_diagnostics` on the two changed files: zero requested-file errors. It reported 12 sibling errors outside this batch; no test or typecheck command was run, per assignment.

## Preserve check

- `libs/shared/src/lib/types/messages/message-constants.ts:273` still defines `SKILL_SYNTHESIS_EVENT`; `payload-map.ts:174` remains. Neither shared file was edited.
- The webview keeps gateway, memory, status, and back-office `MESSAGE_HANDLERS` providers and routing assertions.
- Both edited files use LF line endings.

## Decisions

- Removed the spec's literal skill event and shared constant assertion with the delivery case because they were only checks for the retired webview route. The shared contract remains for the later batch. This is reversible by restoring the provider and case.
- Removed `provideModelRefreshControl()` from this spec because it supported the removed live service; other routing setup remains. This is reversible.

## Proposed Removals

- None in this batch. The live service export and shared push constant remain owned by later batches.