# B2 frontend attachments report

Status: implementation and required scoped verification complete.

## Preserved chat-input capabilities

| Capability | Current owner |
| --- | --- |
| Clipboard image paste, image drag and drop, 5 MB limit, supported media type validation | `ComposerAttachmentsService.onPaste`, `onDrop`, and `readImage` |
| Native `file:pick` and `file:pick-images`, path deduplication, picker guard | `ComposerAttachmentsService.pickFiles` and `pickImages` |
| Transient four-second attachment error | `ComposerAttachmentsService.error` and `showError`; `AttachmentTrayComponent` renders it in the original composer position |
| File chips, image thumbnails, labelled remove buttons | `AttachmentTrayComponent`; chat keeps its existing attachment menu |
| File suggestion attachment, remove, per-tab draft restoration, send payload conversion, clear | `ComposerAttachmentsService.addFile`, `remove`, `restore`, `toSendOptions`, `clear`; chat input retains draft coordination |
| Compact composer content detection | `ChatInputComponent` reads the service signals, preserving `ComposerCompactStore` behavior |

## Files changed

- Chat: `libs/frontend/chat/src/index.ts`, `libs/frontend/chat/src/lib/components/molecules/chat-input/chat-input.component.ts`, new `libs/frontend/chat/src/lib/services/composer-attachments.service.ts` and spec, new `libs/frontend/chat/src/lib/components/molecules/attachment-tray/attachment-tray.component.ts` and spec.
- Harness builder: `libs/frontend/harness-builder/src/lib/services/harness-session.controller.ts` and spec.
- Onboarding: `libs/frontend/onboarding/src/lib/proposal/new-project-intake.page.ts` and spec, `team-builder-start.page.ts` and spec, `answer-dock.component.ts` and spec.
- This report: `.ptah/specs/TASK_2026_ONBOARDING_SHARING/b2-report.md`.

## Verification

- `npm run verify -- -p @ptah-extension/chat,@ptah-extension/harness-builder,@ptah-extension/onboarding`: first run returned `NX   9 tasks: 6 succeeded, 3 failed`. All three failed targets were Jest tests. Most suites failed to load because the worktree lacked the `node_modules/marked` path expected by the existing Jest mapper. A local, ignored `node_modules` symlink to the repository install now supplies that dependency. The new attachment service spec also hit a FileReader timing assertion under load; it now uses a deterministic FileReader stub. Exact retry summary: `NX   9 tasks: 9 succeeded`.
- `npm run verify -- -t typecheck -p ptah-extension-webview`: `NX   1 task: 1 succeeded`.
- `npm run verify -- -t lint -p degradation-audit`: `NX   1 task: 1 succeeded`.
- `ptah_get_diagnostics` on changed source files: unavailable after 45 seconds; TypeScript check continued in background. Native scoped verify is the fallback.
- `git diff --check` for scoped tracked files: passed.

## Decisions

- The attachment service is provided by each composer or onboarding component. A root provider also supports existing direct-instantiation chat-input specs; mounted components use their own instance.
- Session start attachments are forwarded only with the first send and retries. Intake hash remains text-only, and session records do not contain attachments.
- `HarnessSessionStart` and `HarnessModeSession` are declared in `harness-session.controller.ts`; this branch has no separate harness session types file to edit.
- Onboarding attachment state clears after a successful send and stays after a failed send. A reused session does not clear unsent attachments.
- The chat composer keeps its existing attachment menu, while onboarding trays show pick buttons and an image drop area. Both use native buttons and theme token classes.
- `composer-compact.store.ts` was read and left unchanged. Chat input continues to feed its `hasContent` source from the attachment signals.

## Anything not done

- Electron visual review is assigned to the coordinator by the task brief.
- Concurrent backend and shared file changes visible in `git status` were not made or touched by this lane.
