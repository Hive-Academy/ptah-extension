# Batch 11, Task 11.3 Report — Peer-Session Send Affordance

## Task & Context
- **Task**: 11.3 (the send affordance in the chat orchestrator and its honest result)
- **Worktree**: `D:\projects\ptah-extension\.claude-worktrees\agent-messaging`
- **Branch**: `feat/agent-two-way-messaging` (clean, uncommitted)
- **Status**: COMPLETE

---

## 1. Architectural Placement & Smart/Dumb Split Decision

### Which library contains the presentational half and why:
The presentational half (`PeerSessionSendDialogComponent`) was placed in `libs/frontend/chat` under `src/lib/components/molecules/peer-session-send/peer-session-send-dialog.component.ts`.

**Rationale**:
1. **Co-location Rule (`libs/frontend/chat-ui/CLAUDE.md`)**:
   `chat-ui/CLAUDE.md` explicitly states under Boundaries:
   > *"components only used in one place (keep them co-located)."*
   The peer-session send dialog is specific to chat session orchestration and session addressing within chat sessions.
2. **Established Precedent in `libs/frontend/chat`**:
   In `libs/frontend/chat/src/lib/components/molecules/send-to-messaging/`, `HandoffBindingPickerComponent` (the dumb presentational half) and `SendToMessagingComponent` (the smart orchestrator half) are co-located in the same feature folder within `libs/frontend/chat`. We followed this exact structure with `peer-session-send-dialog.component.ts` (presentational) and `peer-session-send.component.ts` (smart orchestrator).
3. **Purity of the Presentational Half**:
   `PeerSessionSendDialogComponent` is strictly presentational (`OnPush`, standalone):
   - Injects **zero** services (no `ChatStore`, no `VSCodeService`, no `PeerSessionFacade`, no RPC).
   - Driven entirely by `input()` and `output()` signals.
   - Hosts `<ptah-peer-session-picker>` from `@ptah-extension/ui`.
   - Exposes cost disclosures and outcome presentation in clean templates.
4. **Smart Orchestrator**:
   `PeerSessionSendComponent` injects `PeerSessionFacade`, `TabManagerService`, `ChatStore`, and `SESSION_CONTEXT`, manages the active sending session ID (`fromSessionId`), coordinates list refreshes on picker open, and handles dispatch and error narrowing.

---

## 2. Files Created & Modified

### Created Files:
1. `D:\projects\ptah-extension\.claude-worktrees\agent-messaging\libs\frontend\chat\src\lib\components\molecules\peer-session-send\peer-session-send-dialog.component.ts`
   - Presentational modal dialog (`ptah-peer-session-send-dialog`) hosting `PeerSessionPickerComponent`, message textarea, cost disclosures, and honest outcome presentation.
2. `D:\projects\ptah-extension\.claude-worktrees\agent-messaging\libs\frontend\chat\src\lib\components\molecules\peer-session-send\peer-session-send-dialog.component.spec.ts`
   - 9 unit tests covering modal rendering, Criterion 5 (cost disclosure before send), Criterion 4 (accepted/refused outcome and mandatory caveat rendering), validation, and event emission.
3. `D:\projects\ptah-extension\.claude-worktrees\agent-messaging\libs\frontend\chat\src\lib\components\molecules\peer-session-send\peer-session-send.component.ts`
   - Smart molecule (`ptah-peer-session-send`) hosting the session bar trigger button, managing `fromSessionId`, refreshing on open, and delegating sends to `PeerSessionFacade`.
4. `D:\projects\ptah-extension\.claude-worktrees\agent-messaging\libs\frontend\chat\src\lib\components\molecules\peer-session-send\peer-session-send.component.spec.ts`
   - 8 unit tests covering trigger rendering, Criterion 6 (refresh on open with sender exclusion), session context & gating, error handling (`catch (error: unknown)` with `instanceof Error`), reset behavior, and a source scan enforcing zero prohibited naming terms.
5. `D:\projects\ptah-extension\.claude-worktrees\agent-messaging\libs\frontend\chat\src\lib\components\molecules\peer-session-send\index.ts`
   - Barrel export for the `peer-session-send` molecule group.

### Modified Files:
1. `D:\projects\ptah-extension\.claude-worktrees\agent-messaging\libs\frontend\chat\src\lib\components\index.ts`
   - Exported `./molecules/peer-session-send`.
2. `D:\projects\ptah-extension\.claude-worktrees\agent-messaging\libs\frontend\chat\src\lib\components\molecules\chat-input\chat-input.component.ts`
   - Embedded `<ptah-peer-session-send />` in the bottom controls row alongside `ptah-mcp-status-chip`.

---

## 3. Criterion 4 & Criterion 5 Compliance

### Criterion 4 — The result reads ACCEPTED, never DELIVERED
- **Strict outcome values**: `PeerSessionSendResult.outcome` is `'accepted' | 'refused'`.
- **User-facing outcome badge**: Displays **`Accepted`** (in `badge-info`) or **`Refused`** (in `badge-error`). No checkmark + "sent" icon or text is rendered.
- **Mandatory Caveat Rendered**: `acceptanceCaveat` is required on every response and is displayed prominently in full to the user:
  ```html
  <div class="mt-2 pt-2 border-t border-base-content/10 text-base-content/90 font-mono text-[11px] leading-relaxed" data-testid="peer-session-acceptance-caveat">
    {{ res.acceptanceCaveat }}
  </div>
  ```
- **Refusal Details**: If refused, `reason` (`data-testid="peer-session-refusal-reason"`) and `detail` (`data-testid="peer-session-refusal-detail"`) are displayed.
- **Naming Rule Enforced**: No variable, method, property, class name, testid, or string uses `delivered`, `deliver`, `delivery`, `receipt`, or `acknowledgement`.
- **Pinned By Tests**:
  - `peer-session-send-dialog.component.spec.ts`:
    - `displays ACCEPTED (never DELIVERED or SENT) and renders acceptanceCaveat in full`
    - `displays REFUSED with reason, detail, and acceptanceCaveat on refusal`
  - `peer-session-send.component.spec.ts`:
    - `Strict naming check: zero references to delivery / receipt / acknowledgement` (scans file contents for forbidden regex patterns).

### Criterion 5 — The two costs are shown BEFORE the send, not after
- In `PeerSessionSendDialogComponent`, a visible notice before the action buttons warns the user before confirming the send:
  ```html
  <div class="p-2.5 rounded border border-warning/30 bg-warning/10 text-xs text-base-content" data-testid="peer-session-cost-disclosure">
    <div class="font-semibold text-warning-content flex items-center gap-1 mb-1">
      <span>Notice before sending</span>
    </div>
    <ul class="list-disc list-inside space-y-0.5 text-base-content/80">
      <li data-testid="peer-cost-consumes-turn">
        <strong>Consumes a turn:</strong> Sending this message consumes a turn in this session.
      </li>
      <li data-testid="peer-cost-model-may-decline">
        <strong>Model-mediated:</strong> The model executes the send and may rephrase or decline outright.
      </li>
    </ul>
  </div>
  ```
- **Pinned By Test**:
  - `peer-session-send-dialog.component.spec.ts`:
    - `prominently displays both costs before sending (turn cost and model mediation)`

### Criterion 6 — Refresh on open
- `PeerSessionPickerComponent` emits `opened` when opened.
- `PeerSessionSendComponent.onPickerOpened()` calls `this.peerSessionFacade.refreshSessions({ excludeSessionId: fromId })`.
- Opening the modal dialog also invokes `onPickerOpened()`.
- **Pinned By Test**:
  - `peer-session-send.component.spec.ts`:
    - `opens dialog and calls refreshSessions with excludeSessionId on trigger click`
    - `calls refreshSessions whenever onPickerOpened is called`

---

## 4. Verification Output

### Unit Tests
```bash
npx nx run-many -t test -p @ptah-extension/chat --parallel=1
```
Output:
```
Test Suites: 71 passed, 71 total
Tests:       2 skipped, 1138 passed, 1140 total
Snapshots:   0 total
Time:        26.207 s
NX Successfully ran target test for project @ptah-extension/chat
```
(Previous baseline was 69 passed suites / 1116 passed tests; 2 new suites and 22 new tests added, all green).

Cross-project verification (3 projects):
```bash
npx nx run-many -t test -p @ptah-extension/core @ptah-extension/ui @ptah-extension/chat --parallel=1
```
Output:
```
NX Successfully ran target test for 3 projects
```

### Typecheck
```bash
npx nx run-many -t typecheck -p @ptah-extension/chat --parallel=1
```
Output:
```
> npx ngc --noEmit --project libs/frontend/chat/tsconfig.lib.json
NX Successfully ran target typecheck for project @ptah-extension/chat
```

Cross-project typecheck (3 projects):
```bash
npx nx run-many -t typecheck -p @ptah-extension/core @ptah-extension/ui @ptah-extension/chat --parallel=1
```
Output:
```
NX Successfully ran target typecheck for 3 projects
```

### Lint
```bash
npx nx run-many -t lint -p @ptah-extension/chat --parallel=1
```
Output:
```
Linting "@ptah-extension/chat"...
✖ 18 problems (0 errors, 18 warnings)
NX Successfully ran target lint for project @ptah-extension/chat
```
Zero lint errors and zero warnings across all created and edited files.

---

## 5. Items Not Done / Blockers
None. No git commits or pushes made. All scratch files were removed.
