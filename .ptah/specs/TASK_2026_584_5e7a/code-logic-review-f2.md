VERDICT: APPROVED

Score: 10/10
Defects: 0 blocking, 0 serious, 0 moderate, 0 minor

## Overview

This review evaluates the implementation of follow-ups **F2** (session read budget override) and **F3** (agent report tool description update for child sessions) alongside related pins and anti-drift specifications under `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/`.

All inspected changes adhere to the decisions recorded in [.ptah/specs/TASK_2026_584_5e7a/batches.md](file:///D:/projects/ptah-extension/.claude-worktrees/task-584/.ptah/specs/TASK_2026_584_5e7a/batches.md) (F2, F3, and O13 deviation 3). Specifically:

- `ptah_session_read` is given a dedicated override in `TOOL_RESULT_BUDGET_OVERRIDES` of 40,768 characters (10,192 tokens), calculated as the 32 KiB (32,768 chars) default tail plus the 8,000 character default budget to house the header line and held completion envelopes.
- All other session tools (`ptah_session_start`, `ptah_session_send`, `ptah_session_status`, `ptah_session_stop`) retain the default 8,000 char / 2,000 token budget.
- The 32 KiB tail constant is duplicated as a literal in `tool-result-budget.ts` to prevent pulling `tsyringe` from `@ptah-extension/cli-agent-runtime` into light consumers, backed by an anti-drift test in `session-tools.spec.ts`.
- The held completions block precedes the transcript in `handleSessionToolCall`, guaranteeing that budget reductions only truncate transcript tails while preserving critical completion envelopes.
- `ptah_agent_report` description accurately describes routing child session reports to the session that started them.
- All contract sweep pins and character budgets in `mcp-contract.sweep.spec.ts` have been verified for exact arithmetic correctness.

---

## Detailed Focus Area Analysis

### 1. Per-Tool Budget Override Mechanism & Scope (F2)

- **Files & Lines**:
  - [tool-result-budget.ts:81-101](file:///D:/projects/ptah-extension/.claude-worktrees/task-584/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/tool-result-budget.ts#L81-L101)
  - [tool-result-budget.ts:156-160](file:///D:/projects/ptah-extension/.claude-worktrees/task-584/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/tool-result-budget.ts#L156-L160)
  - [tool-result-budget.spec.ts:121-144](file:///D:/projects/ptah-extension/.claude-worktrees/task-584/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/tool-result-budget.spec.ts#L121-L144)
- **Implementation Verification**:
  - `SESSION_READ_DEFAULT_TAIL_CHARS = 32 * 1024` (32,768).
  - `SESSION_READ_CHARS = SESSION_READ_DEFAULT_TAIL_CHARS + DEFAULT_TOOL_RESULT_BUDGET_CHARS` (32,768 + 8,000 = 40,768).
  - Registered strictly in `TOOL_RESULT_BUDGET_OVERRIDES`:
    ```typescript
    export const TOOL_RESULT_BUDGET_OVERRIDES: Readonly<Record<string, TextBudget>> = Object.freeze({
      ptah_browser_content: charBudget(BROWSER_CONTENT_CHARS),
      ptah_session_read: charBudget(SESSION_READ_CHARS),
      ptah_surface_get_state: charBudget(SURFACE_LIMITS.maxStateReadBytes),
    });
    ```
  - `getToolResultBudget` routes through `Object.hasOwn(TOOL_RESULT_BUDGET_OVERRIDES, toolName)`:
    - `ptah_session_read` resolves to `{ chars: 40768, tokens: 10192 }`.
    - `ptah_session_start`, `ptah_session_send`, `ptah_session_status`, and `ptah_session_stop` are not in the map and cleanly fall back to `DEFAULT_BUDGET` (`{ chars: 8000, tokens: 2000 }`).
  - `tool-result-budget.spec.ts` explicitly asserts:
    - Keys of `TOOL_RESULT_BUDGET_OVERRIDES` are exclusively `['ptah_browser_content', 'ptah_session_read', 'ptah_surface_get_state']`.
    - Every other session tool resolves to `DEFAULT`.
  - In `protocol-dispatcher.ts:182-184`, the tool declaration sets `_meta['anthropic/maxResultSizeChars'] = getToolResultBudget(tool.name).chars`, which propagates `40768` directly to client declarations in `tools/list`.

---

### 2. Token Budget Calculation Following `charBudget`

- **Files & Lines**:
  - [tool-result-budget.ts:56-57, 85-87](file:///D:/projects/ptah-extension/.claude-worktrees/task-584/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/tool-result-budget.ts#L56-L57)
  - [mcp-contract.sweep.spec.ts:1397-1399, 1766-1774](file:///D:/projects/ptah-extension/.claude-worktrees/task-584/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/mcp-contract.sweep.spec.ts#L1397-L1399)
- **Arithmetic Check**:
  - `CHARS_PER_TOKEN = 4`.
  - `charBudget(chars)` calculates `tokens: Math.ceil(chars / CHARS_PER_TOKEN)`.
  - For `SESSION_READ_CHARS = 40,768`:
    $$\text{tokens} = \lceil 40,768 / 4 \rceil = 10,192$$
  - The token value is exact (no fractional truncation or rounding anomaly).
  - In `mcp-contract.sweep.spec.ts`:
    - `PINNED_BUDGET_OVERRIDES['ptah_session_read']` matches `{ chars: 40_768, tokens: 10_192 }`.
    - Unit test at line 1766 verifies `TOOL_RESULT_BUDGET_OVERRIDES['ptah_session_read'].tokens === Math.ceil(sessionReadChars / 4)`.

---

### 3. Headroom Verification: Default 32 KiB Read + 5 Realistic Held Completions

- **Files & Lines**:
  - [session-tool-handlers.ts:84-91, 258-268, 417-423](file:///D:/projects/ptah-extension/.claude-worktrees/task-584/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/session-tool-handlers.ts#L417-L423)
  - [session-tools.spec.ts:510-530, 567-581](file:///D:/projects/ptah-extension/.claude-worktrees/task-584/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/session-tools.spec.ts#L510-L530)
- **Format and Size Breakdown**:
  1. **Header Block (`body.head`)**:
     - Format: `Transcript of "<label>" (<uuid>), <status>; the tail is shown, earlier turns are cut.`
     - Realistic length: ~100 to 150 characters.
  2. **Held Completions Block (`held`)**:
     - Heading: `Held while this session was not live:\n\n` (~40 chars).
     - Each `<agent-lane-completed>` XML envelope:
       - XML tags, attributes (`agent-id`, `agent`, `cli`, `status`, `verdict`, `turn`): ~150 chars.
       - Settled summary, Task, Branch, Worktree, Deliverables, Reports count, Last message, and Steering guidance: ~450 to 650 chars.
       - Total per realistic envelope: ~600 to 800 chars.
       - For 5 concurrent held completions (the default `agentSessions.maxConcurrent` bound):
         $$5 \times 700\text{ chars} + 40\text{ chars} \approx 3,540\text{ chars}$$
  3. **Separator Whitespace**:
     - `joinBlocks(body.head, held, body.transcript)` joins non-empty blocks with `\n\n` (4 chars).
  4. **Total Non-Transcript Overhead**:
     - Head (~150) + 5 Envelopes (~3,540) + Spacing (4) = ~3,694 characters.
  5. **Headroom Margin**:
     - Budget allowance above 32 KiB: 8,000 characters.
     - Available unused headroom: $8,000 - 3,694 \approx 4,306$ characters (~53% safety margin).
- **Execution Proof**:
  - `session-tools.spec.ts` ("returns the default tail, the header and five held completions whole") calls `budgetedRead(SESSION_READ_DEFAULT_TAIL_KIB, held)` with 5 realistic envelopes and a 32,768-character transcript.
  - The test asserts `outcome.truncated === false`, `outcome.reducer === 'none'`, `outcome.spoolPath === undefined`, and `outcome.text.endsWith(transcript) === true`.
  - The assertion passed completely without cutting.

---

### 4. Spooling & Truncation Semantics on 256 KiB Read (Held Block Survival)

- **Files & Lines**:
  - [session-tool-handlers.ts:418-422](file:///D:/projects/ptah-extension/.claude-worktrees/task-584/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/session-tool-handlers.ts#L418-L422)
  - [tool-result-budget.ts:132, 335-370](file:///D:/projects/ptah-extension/.claude-worktrees/task-584/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/tool-result-budget.ts#L132)
  - [session-tools.spec.ts:583-596](file:///D:/projects/ptah-extension/.claude-worktrees/task-584/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/session-tools.spec.ts#L583-L596)
- **Mechanism Check**:
  - In `session-tool-handlers.ts:421`:
    ```typescript
    if (body.kind === 'read') {
      return {
        isError: false,
        text: joinBlocks(body.head, held, body.transcript),
      };
    }
    ```
    Placing `body.head` and `held` **before** `body.transcript` is deliberate (O13 deviation 3).
  - In `tool-result-budget.ts`:
    - `ptah_session_read` is mapped to `'preformatted'` in `TOOL_CONTENT_HINTS:132`.
    - No structural content reducer (such as markdown-outline) is applied; `reducer` remains `'none'`.
    - The budget engine applies `fitWithTrailer`, which preserves the prefix from offset 0 and trims the trailing text while appending the spool trailer.
  - Therefore, when `tailKiB` is requested up to the maximum (256 KiB):
    - Truncation trims only the trailing characters of `body.transcript`.
    - `body.head` and all held completion envelopes remain intact at the top of the output.
  - Tested in `session-tools.spec.ts` line 583:
    - Asserts `outcome.truncated === true`, `outcome.spoolPath` defined, `outcome.text.includes(HELD_COMPLETIONS_HEADING)`, and `outcome.text.length <= 40,768`.

---

### 5. Anti-Drift Guard Verification

- **Files & Lines**:
  - [tool-result-budget.ts:68-80](file:///D:/projects/ptah-extension/.claude-worktrees/task-584/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/tool-result-budget.ts#L68-L80)
  - [session-tools.spec.ts:9-14, 560-565](file:///D:/projects/ptah-extension/.claude-worktrees/task-584/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/session-tools.spec.ts#L560-L565)
  - [mcp-contract.sweep.spec.ts:1765-1774](file:///D:/projects/ptah-extension/.claude-worktrees/task-584/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/mcp-contract.sweep.spec.ts#L1765-L1774)
- **Decoupling and Guard Analysis**:
  - `tool-result-budget.ts` defines `SESSION_READ_DEFAULT_TAIL_CHARS = 32 * 1024` as a local literal. It intentionally does not import `SESSION_READ_DEFAULT_TAIL_KIB` from `@ptah-extension/cli-agent-runtime`, avoiding the transitive resolution of `tsyringe` and heavy DI containers in lightweight CLI/MCP consumers.
  - To prevent silent divergence, `session-tools.spec.ts` imports `SESSION_READ_DEFAULT_TAIL_KIB` from `@ptah-extension/cli-agent-runtime` and `DEFAULT_TOOL_RESULT_BUDGET_CHARS` from `./tool-result-budget`:
    ```typescript
    it("budgets the spawner's default tail plus the default budget (no drift)", () => {
      expect(getToolResultBudget('ptah_session_read').chars).toBe(SESSION_READ_DEFAULT_TAIL_KIB * 1024 + DEFAULT_TOOL_RESULT_BUDGET_CHARS);
    });
    ```
  - **Divergence Behavior**: If `SESSION_READ_DEFAULT_TAIL_KIB` in `libs/backend/cli-agent-runtime/src/lib/session-children/session-spawner.service.ts` is changed without updating `tool-result-budget.ts`, `session-tools.spec.ts` immediately fails on this assertion during CI and pre-commit checks. Additionally, `mcp-contract.sweep.spec.ts` validates the pin against `sessionReadChars`.

---

### 6. Tool Description Accuracy (`ptah_agent_report` - F3)

- **Files & Lines**:
  - [tool-description.builder.ts:865-866](file:///D:/projects/ptah-extension/.claude-worktrees/task-584/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/tool-description.builder.ts#L865-L866)
  - [tool-description.builder.spec.ts:331-335](file:///D:/projects/ptah-extension/.claude-worktrees/task-584/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/tool-description.builder.spec.ts#L331-L335)
  - [agent-report-router.service.ts:269-271, 404-530](file:///D:/projects/ptah-extension/.claude-worktrees/task-584/libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-report-router.service.ts#L404-L530)
- **Text Added**:
  `"A child session started by ptah_session_start can call it too; its report reaches the session that started it."`
- **Router Behavior Check**:
  - `agent-report-router.service.ts` checks `if (isSessionChildInput(input)) return this.deliverFromSessionChild(input);`.
  - In `deliverFromSessionChild`, the child is resolved via `this.sessionChildren?.get(reportedId)`.
  - The target parent session ID is retrieved from `child.parentSessionId` / `child.parentSdkSessionId`.
  - If active, the message is dispatched to `adapter.sendMessageToSession(parentSessionId, envelope, ...)`.
  - The tool description precisely describes reality: the report reaches the session that started it, without requiring an agent ID.

---

### 7. Contract Sweep Pins and Arithmetic Verification

- **Files & Lines**:
  - [mcp-contract.sweep.spec.ts:2202-2204, 2309-2320](file:///D:/projects/ptah-extension/.claude-worktrees/task-584/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/mcp-contract.sweep.spec.ts#L2202-L2204)
- **Report Description Budget Pin (799 -> 921)**:
  - Base rule across `mcp-contract.sweep.spec.ts`: $\lceil \text{measured length} \times 1.1 \rceil + 10$.
  - Measured character length of `buildAgentReportTool().description`: 828 characters.
  - Calculation:
    $$\lceil 828 \times 1.1 \rceil + 10 = \lceil 910.8 \rceil + 10 = 911 + 10 = 921$$
  - Pin updated from 799 to 921.
  - **Verdict**: Exact arithmetic match.
- **`tools/list` Byte Size Pin (130,357 -> 130,469)**:
  - Total byte size delta: $130,469 - 130,357 = +112$ bytes.
  - Component 1: In `buildAgentReportTool().description`, the added sentence plus spacing contributes exactly +111 UTF-8 bytes:
    - Space after `"running commentary. "` (+1 byte)
    - `"A child session started by ptah_session_start can call it too; its report reaches the session that started it."` (+110 bytes)
    - Subtotal = +111 bytes.
  - Component 2: In `ptah_session_read` metadata declaration:
    - `"anthropic/maxResultSizeChars"` changed from default `8000` (4 ASCII characters) to `40768` (5 ASCII characters).
    - Subtotal = +1 byte.
  - Total delta: $111 + 1 = +112$ bytes.
  - $130,357 + 112 = 130,469$ bytes.
  - In `mcp-contract.sweep.spec.ts:2320`, `expect(bytes).toBe(PINNED_TOOLS_LIST_BYTES_AT_HEAD)` strictly asserts byte-for-byte equality to 130,469.
  - **Verdict**: Exact arithmetic and byte-level match.

---

## Verification & Test Execution Results

All 4 relevant test suites under `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/` were executed and passed cleanly:

- `tool-description.builder.spec.ts`: PASS (13.09s)
- `tool-result-budget.spec.ts`: PASS (13.78s)
- `session-tools.spec.ts`: PASS (19.87s)
- `mcp-contract.sweep.spec.ts`: PASS (117.92s)
- **Suite totals**: 4 passed, 4 total; 220 tests passed, 0 failed.

Static analysis:

- `nx run @ptah-extension/vscode-lm-tools:lint`: 0 errors.
- `nx run @ptah-extension/vscode-lm-tools:typecheck`: Passed with 0 errors.

---

## Conclusion

The F2 and F3 implementations are completely sound, well-guarded against architectural regression and drift, and mathematically verified. The changes are approved without reservations.
