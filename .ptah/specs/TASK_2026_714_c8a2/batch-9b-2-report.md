## Changes

- `libs/backend/codex-runtime/src/lib/codex-execution-profile.ts:142` — doc comment now says chat and gateway use D14; lane and usage keep the pre-8m-1 approval mapping.
- `libs/backend/codex-runtime/src/lib/codex-execution-profile.ts:144` — `resolveApprovalPolicy` flag renamed from `chat` to `d14`.
- `libs/backend/codex-runtime/src/lib/codex-execution-profile.ts:147` — D14 approval branch (`untrusted` for ask and auto-edit, `on-request` otherwise) keys off `d14`.
- `libs/backend/codex-runtime/src/lib/codex-execution-profile.ts:175` — `resolveCodexLevelPolicy` sets `d14` when `consumer === 'chat' || consumer === 'gateway'`.
- `libs/backend/codex-runtime/src/lib/codex-execution-profile.ts:179` — ask is workspace-write for D14 consumers (chat and gateway). Lane and usage ask stay read-only.
- `libs/backend/codex-runtime/src/lib/codex-execution-profile.ts:181` — approval policy is resolved with the `d14` flag.
- `libs/backend/codex-runtime/src/lib/codex-execution-profile.ts:287-290` — builder comment updated: D14 is chat and gateway; lane and usage keep pre-8m-1.
- `libs/backend/codex-runtime/src/lib/codex-context.ts:433-436` — `userInputAsync` question-card path includes `consumer === 'gateway'` as well as chat.

Places in `codex-execution-profile.ts` reviewed and left unchanged because they are not the D14 level mapping:

- `codex-execution-profile.ts:257` — lane settings still require a lane consumer.
- `codex-execution-profile.ts:270-278` — resume identity still rejects a consumer change.
- `codex-execution-profile.ts:313-314` — confirmed: `accountId` and `consumer` are not in the fingerprint digest. Comment left as written.

`codex-context.ts` has no other chat-vs-other branch for this mapping. `updateNextTurn` (~line 797) already passes `this.profile.consumer` into `resolveCodexLevelPolicy`, so gateway inherits D14 there with no local edit.

## Specs added

- `codex-execution-profile.spec.ts:37` — policy matrix includes `gateway` beside chat and lane.
- `codex-execution-profile.spec.ts:55-74` — expected approval and sandbox use the same `d14` rule (chat or gateway).
- `codex-execution-profile.spec.ts:119` and `:141` — pre-8m-1 auto-edit and ask cases are lane and usage only.
- `codex-execution-profile.spec.ts:557` — removed the old assertion that a gateway auto-edit profile differed in approval policy and fingerprint from chat.
- `codex-execution-profile.spec.ts:559-575` — `gives gateway the same %s policy, sandbox and fingerprint as chat` for ask, plan, auto-edit, and yolo. Fingerprints match because consumer is outside the digest (`codex-execution-profile.ts:313-314`).
- `codex-runtime.spec.ts:1159-1176` — gateway `userInputAsync` emits `presentation: 'card'` and calls `requestUserInput` like chat. Added to the existing `userInputAsync` coverage in `codex-runtime.spec.ts` (no new spec file).
- `codex-runtime.spec.ts:1178-1195` — lane still emits `userInputAsync` without a card and does not call `requestUserInput`. Replaces the old case that denied cards to both gateway and lane.

## Decisions

- The shared flag is named `d14` because it means “use the D14 approval and sandbox mapping,” which is now chat and gateway, not chat alone.
- Plan and yolo already matched between chat and the pre-8m-1 mapping (on-request; plan read-only; yolo workspace-write). Ask and auto-edit are the levels that change for gateway: ask becomes `untrusted` plus workspace-write; auto-edit becomes `untrusted` (sandbox was already workspace-write).
- Gateway fingerprint equality is asserted against a chat profile built with the same settings, not only against `codexProfileFingerprint` of the gateway profile itself.
- Lane question-card coverage stays in `codex-runtime.spec.ts` next to the other `userInputAsync` cases. `codex-event-translator.spec.ts` only covers translation, not the consumer card gate.

## Not done

- No verify, test, lint, typecheck, or `ptah_get_diagnostics` run. The coordinator owns those checks.
- No commit, push, or edits outside the four scoped source files plus this report.
- `libs/backend/codex-runtime/src/lib/di/registration.ts` still limits the dev-route override to `consumer === 'chat'` (`registration.ts:119`). That is routing, not the D14 level mapping, and another lane owns that file.
- Ptah MCP tools (`ptah_agent_report`, `ptah_code_search_symbols`, and the rest) were not on the connected tool list. Search returned only the `tasks` server. File reads used ripgrep and the native file reader. `ptah_agent_report` could not be called.
- No matching skill applies to this Codex execution-profile change. Skill discovery did not surface a codex-runtime or gateway skill to load.
