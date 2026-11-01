# B2 review fixes, round 1

Status: review defects fixed; the required full chat verify is red from two transcript test timeouts outside this batch's scope.

## Defects addressed

1. **Component scope:** removed the root provider at `libs/frontend/chat/src/lib/services/composer-attachments.service.ts:11`. All four mounted hosts already provide the service; direct chat-input specs now provide it at `chat-input.component.spec.ts:225,808`. Two test-only component overrides also provide it (`chat-input.streaming-fold.spec.ts:208`, `chat-input.command-center-lock.spec.ts:199`). The service and tray specs provide it explicitly (`composer-attachments.service.spec.ts:26`, `attachment-tray.component.spec.ts:11`), as do the direct onboarding specs.
2. **Safe clear after send:** `snapshotForSend` captures attachment objects and `removeSent` removes only those objects (`composer-attachments.service.ts:180,187`). Answer dock, intake and team start use the snapshot (`answer-dock.component.ts:246`, `new-project-intake.page.ts:304`, `team-builder-start.page.ts:145`), including the conflict-resolution path. Specs at `answer-dock.component.spec.ts:110`, `new-project-intake.page.spec.ts:114`, and `team-builder-start.page.spec.ts:59` add attachments during the await and assert that they survive.
3. **Reused session:** an accepted same-hash session with new attachments returns a visible failed outcome (`harness-session.controller.ts:294`), which `ProposalFlowStore.start` presents through `actionError`; the tray stays for a later reply. Spec: `harness-session.controller.spec.ts:106`.
4. **Drop handling:** `onDrop` calls `preventDefault` only for image files, lets text drops reach the textarea, and reports unsupported non-image files (`composer-attachments.service.ts:47`). Spec: `composer-attachments.service.spec.ts:59`.
5. **Unaccepted first send:** same-hash starts retry only when reconciliation finds no accepted first send (`harness-session.controller.ts:290,298`). Concurrent retries serialize and send once after the original failure. Spec: `harness-session.controller.spec.ts:133`; the existing accepted-reuse spec at line 98 proves no resend after acknowledgement.
6. **FileReader race:** `pendingReads` counts reads (`composer-attachments.service.ts:18,65,87,94`); all onboarding send buttons and methods and chat-input send stay disabled while positive (`answer-dock.component.ts:66,244`, `new-project-intake.page.ts:217,290`, `team-builder-start.page.ts:99,143`, `chat-input.component.ts:1003,1628`). Service and three onboarding specs cover the pending state (`composer-attachments.service.spec.ts:73`, `answer-dock.component.spec.ts:110`, `new-project-intake.page.spec.ts:114`, `team-builder-start.page.spec.ts:59`).
7. **Accessibility:** each textarea describes its persistence hint (`answer-dock.component.ts:53,135`, `new-project-intake.page.ts:109`, `team-builder-start.page.ts:72`); the drop zone has a group role and label (`attachment-tray.component.ts:46`). The dock and tray specs check the attributes (`answer-dock.component.spec.ts:110`, `attachment-tray.component.spec.ts:34`).
8. **Degradation audit:** the FileReader `onerror` handler has an inline reported annotation and shows the failure beside the composer (`composer-attachments.service.ts:90-94`); the synchronous reader catch has an audit suppression (`:97-102`). The service spec covers error display and pending-read completion. The audit lint passes.

## Verification

- `npm run verify -- -p @ptah-extension/chat,@ptah-extension/harness-builder,@ptah-extension/onboarding` first run: `NX   9 tasks: 8 succeeded, 1 failed`. Two chat-input test overrides lacked the scoped service provider; fixed. One transcript spec timed out.
- Same command after the provider fix: `NX   9 tasks: 8 succeeded, 4 cached, 1 failed`. Chat test result: `Test Suites: 2 failed, 321 passed, 323 total`; `Tests:       2 failed, 2 skipped, 5664 passed, 5668 total`. The failures were five-second timeouts in `chat-transcript.change-set.spec.ts` and `chat-transcript.display.spec.ts`, both outside the attachment code. All chat-input suites passed.
- `npm run verify -- -t typecheck -p ptah-extension-webview`: `NX   1 task: 1 succeeded`.
- `npm run verify -- -t lint -p degradation-audit` first run: `NX   1 task: 0 succeeded, 1 failed`. The scanner flagged the `reader.onerror` comment as an orphaned suppression because it only attaches standalone markers to `catch`/`.catch` constructs. After moving this annotation inline, the same command returned `NX   1 task: 1 succeeded`.
- `npm run verify -- -t test -p @ptah-extension/chat -- --runInBand --runTestsByPath src/lib/components/organisms/transcript/chat-transcript.change-set.spec.ts src/lib/components/organisms/transcript/chat-transcript.display.spec.ts`: `NX   1 task: 1 succeeded`. Both timeout suites pass in isolation.
- `git diff --check` for the B2 frontend scope passed.

## Decisions

- A reused, already-accepted brief with new attachments reports an actionable error. Sending the brief again would duplicate user text; C2 requires attachments to remain available after a failed send.
- A failed first send may retry in `start` because the saved record has no acknowledgement. The controller serializes starts, and the new spec proves concurrent retries do not double-send.
- Dropped non-image files show the existing unsupported-format error. The browser `File` drop does not provide the stable workspace path required by the file attachment contract, so files continue through `file:pick`.
- Attachment snapshots compare object identity, preserving files and images added or re-added while the send is pending.
- The audit scanner recognizes standalone suppression markers only for catch sites. The FileReader event handler reports failures to the UI and carries an inline explanatory annotation; its actual synchronous catch retains a standalone marker.

## Anything not done

The required full three-library verify is not green: two transcript specs timed out under the full chat test load, then passed in isolation. Those specs and their runtime code are outside this batch's attachment scope, so they were not changed. Electron visual review remains with the coordinator. Unrelated backend, shared, and `.gitignore` changes made by other lanes were left untouched.
