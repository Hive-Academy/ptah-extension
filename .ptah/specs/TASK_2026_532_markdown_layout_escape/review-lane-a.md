# Code Logic Review — `TASK_2026_532_markdown_layout_escape` (Lane A)

## Summary

| Metric              | Value                                |
| ------------------- | ------------------------------------ |
| Overall score       | 5/10                                 |
| Assessment          | REVISE (NEEDS_REVISION)              |
| Blocking issues     | 0                                    |
| Serious issues      | 4                                    |
| Moderate issues     | 2                                    |
| Minor issues        | 1                                    |
| Failure modes found | 4                                    |

---

## Executive Verdict

**Verdict: REVISE**

Lane A correctly identifies and addresses the two direct triggers reported for the `native-drawer.component.ts` symptom:
1. Converting orphan `tool-result`, `tool-result-error`, `command`, and `file-change` segments in [`agent-monitor-tree-builder.service.ts:327-338`](file:///D:/projects/ptah-extension/.claude-worktrees/markdown-layout-escape/libs/frontend/chat/src/lib/services/agent-monitor-tree-builder.service.ts#L327-L338) into `type: 'tool'` nodes rather than top-level `type: 'text'` markdown nodes.
2. Dynamically computing the code fence length (`max(3, longestRun + 1)`) in [`code-output.component.ts:113-118`](file:///D:/projects/ptah-extension/.claude-worktrees/markdown-layout-escape/libs/frontend/chat-ui/src/lib/molecules/tool-execution/code-output.component.ts#L113-L118) to prevent premature fence closing by inner backtick runs in non-markdown output.

However, the escape is **not closed across the broader execution and agent-card surfaces**. The review identified 4 serious issues and 2 moderate issues where raw tool inputs, tool outputs, CLI stdout, and agent errors continue to reach `<markdown [data]>` either completely unfenced or wrapped in fixed 3-backtick fences.

---

## Detailed Evaluation of Requested Checks

### 1. Correctness of Changes & Spec Test Verification
- **Tree Builder Fix** ([`agent-monitor-tree-builder.service.ts:327-338`](file:///D:/projects/ptah-extension/.claude-worktrees/markdown-layout-escape/libs/frontend/chat/src/lib/services/agent-monitor-tree-builder.service.ts#L327-L338)):
  Converting orphan tool result segments into `type: 'tool'` execution nodes prevents them from falling into the top-level message markdown stream. Setting `toolOutput: segment.content`, `content: null`, and `status: 'complete' | 'error'` routes the node through the tool-output pipeline (`ToolOutputDisplayComponent` → `CodeOutputComponent`).
- **Dynamic Fence Fix** ([`code-output.component.ts:113-118`](file:///D:/projects/ptah-extension/.claude-worktrees/markdown-layout-escape/libs/frontend/chat-ui/src/lib/molecules/tool-execution/code-output.component.ts#L113-L118)):
  The regex scan `str.matchAll(/`+/g)` and `Math.max(3, longestRun + 1)` correctly guarantees that no run of backticks inside `str` can equal or exceed the opening fence length. Under CommonMark §4.5, an inner fence of length $M < N$ cannot close an enclosing fence of length $N$. This eliminates fence breakouts for all languages routed through the fence generator.
- **Do the spec tests prove the escape is closed?**
  **NO, they do not.**
  - [`agent-monitor-tree-builder.service.spec.ts:293-319`](file:///D:/projects/ptah-extension/.claude-worktrees/markdown-layout-escape/libs/frontend/chat/src/lib/services/agent-monitor-tree-builder.service.spec.ts#L293-L319) is purely an in-memory service unit test. It verifies that `tree[1].type === 'tool'`, but never mounts Angular components or renders markdown, leaving rendering behavior unexercised.
  - [`code-output.component.spec.ts:88-100`](file:///D:/projects/ptah-extension/.claude-worktrees/markdown-layout-escape/libs/frontend/chat-ui/src/lib/molecules/tool-execution/code-output.component.spec.ts#L88-L100) tests a synthetic `Read` tool output without `toolInput` (which defaults to language `'text'`) and checks that `div.fixed` is null.
  - Crucially, [`code-output.component.spec.ts:108-118`](file:///D:/projects/ptah-extension/.claude-worktrees/markdown-layout-escape/libs/frontend/chat-ui/src/lib/molecules/tool-execution/code-output.component.spec.ts#L108-L118) explicitly tests that **markdown file output is left unfenced**:
    ```ts
    it('leaves markdown file output unfenced', () => { ... expect(outputFor({ ... file_path: '/tmp/notes.md' })).toBe(output); });
    ```
    If `/tmp/notes.md` contains `<div class="fixed inset-0 z-50">`, it is passed directly to `ngx-markdown` unfenced. Because DOMPurify hardening was left to Lane B, the escape remains completely open for all `.md` files and all MCP tool outputs.

---

### 2. Runtime Trace: `type: 'tool'` with `toolName: 'Tool'` & No `toolInput`
Traced through the component hierarchy:
1. **[`ExecutionNodeComponent`](file:///D:/projects/ptah-extension/.claude-worktrees/markdown-layout-escape/libs/frontend/chat/src/lib/components/organisms/execution/execution-node.component.ts#L147-L188)**:
   - Evaluates `sdkCardKind()`: `isWorkflowTool('Tool')`, `isTaskManagementTool('Tool')`, etc., all return `false`. `sdkCardKind` is `null`.
   - Hits `@default` (line 181) and instantiates `<ptah-tool-call-item [node]="node()">`.
2. **[`ToolCallItemComponent`](file:///D:/projects/ptah-extension/.claude-worktrees/markdown-layout-escape/libs/frontend/chat/src/lib/components/molecules/tool-execution/tool-call-item.component.ts#L64-L99)**:
   - Initializes `isCollapsed = signal(true)` (collapsed by default).
   - Renders `<ptah-tool-call-header [node]="node()" [isCollapsed]="isCollapsed()">`.
3. **[`ToolCallHeaderComponent`](file:///D:/projects/ptah-extension/.claude-worktrees/markdown-layout-escape/libs/frontend/chat-ui/src/lib/molecules/tool-execution/tool-call-header.component.ts#L57-L145)**:
   - `<ptah-tool-icon [toolName]="'Tool'">`: In [`tool-icon.component.ts:86`](file:///D:/projects/ptah-extension/.claude-worktrees/markdown-layout-escape/libs/frontend/chat-ui/src/lib/atoms/tool-icon.component.ts#L86), `'Tool'` hits the switch default and returns `TerminalIcon` with `text-base-content-muted`. No crash.
   - Badge: `getBadgeClass()` returns `badge-success` (status `complete`) or `badge-error` (status `error`). Text inside badge is `"Tool"`.
   - Description: `hasClickableFilePath()` is `false`. Falls to `getToolDescription()`. Lines 257–285 fail all input checks (`toolInput` is undefined). Line 286 returns `node.toolName || ''` (`"Tool"`).
   - Header renders: `[Tool] Tool`. It is slightly redundant visually, but does **not crash**, does **not render an empty header**, and displays a valid status indicator.
4. **When Expanded by User**:
   - `<ptah-tool-input-display>`: [`hasNonTrivialInput()`](file:///D:/projects/ptah-extension/.claude-worktrees/markdown-layout-escape/libs/frontend/chat-ui/src/lib/molecules/tool-execution/tool-input-display.component.ts#L216) checks `!toolInput` and returns `false`. `inputRetentionMessage()` is `null`. Safely renders nothing.
   - `<ptah-tool-output-display>`: `node().toolOutput` is truthy. `todoInput()` is `null`, `editInput()` is `null`. Routes via `@else` to `<ptah-code-output [node]="node()">`.
   - `<ptah-code-output>`: `detectLanguage()` evaluates `toolName: 'Tool'`, `toolInput: undefined`, which defaults to `'text'` (or `'json'` if parsing succeeds). Wraps output with `longestRun + 1` backticks and renders into `<markdown>`.
- **Conclusion**: There is no crash, no empty header, and routing to `CodeOutputComponent` functions properly.

---

### 3. Inventory of Remaining Unfenced or Brittle Markdown Paths

| # | Location | Data / Feed | Mechanism | Exploitable? |
| - | -------- | ----------- | --------- | ------------ |
| 1 | [`tool-input-display.component.ts:279-284`](file:///D:/projects/ptah-extension/.claude-worktrees/markdown-layout-escape/libs/frontend/chat-ui/src/lib/molecules/tool-execution/tool-input-display.component.ts#L279-L284) | Tool input parameter content (e.g. `Write` tool `content` param > 200 chars) | Returns `content` **unfenced** when `language === 'markdown'`. When non-markdown, wraps in **fixed 3-backtick fence** (`'```' + language ...`). | **YES (HIGH)**. When expanding Write input for any `.md` file containing HTML or any file containing ```` ``` ````, breaks out into live app layout. |
| 2 | [`cli-agent-output.component.ts:89-93`](file:///D:/projects/ptah-extension/.claude-worktrees/markdown-layout-escape/libs/frontend/chat/src/lib/components/molecules/agent-card/cli-agent-output.component.ts#L89-L93) & [`agent-card-output.component.ts:153, 281`](file:///D:/projects/ptah-extension/.claude-worktrees/markdown-layout-escape/libs/frontend/chat-ui/src/lib/molecules/agent-card/agent-card-output.component.ts#L153) | Raw stdout disclosure (`stdoutSegments()`) | Passes raw CLI stdout parsed as `tool-result` or `text` directly to `<markdown [data]="segment.content">` **completely unfenced**. | **YES (HIGH)**. The disclosure is open by default (`rawStdoutOpen = model(true)`). Any stdout matching `Tool result` with HTML breaks out immediately. |
| 3 | [`code-output.component.ts:112, 132-134, 140`](file:///D:/projects/ptah-extension/.claude-worktrees/markdown-layout-escape/libs/frontend/chat-ui/src/lib/molecules/tool-execution/code-output.component.ts#L112) | MCP tool outputs (`mcp__*`) and `.md` file reads | `detectLanguage()` returns `'markdown'`, and line 112 returns `str` **unfenced** to `<markdown [data]>`. | **YES (HIGH)**. Any MCP tool (e.g. web fetch, search) or `Read` of a markdown file containing HTML overlays the app. |
| 4 | [`agent-monitor-tree-builder.service.ts:346-353, 360-367`](file:///D:/projects/ptah-extension/.claude-worktrees/markdown-layout-escape/libs/frontend/chat/src/lib/services/agent-monitor-tree-builder.service.ts#L346-L353) | CLI agent `error` and `info` segments | Converted to `type: 'text'` ExecutionNodes, rendered by `ExecutionNodeComponent:140` directly as `<markdown [data]>`. | **YES (MODERATE)**. Error messages with HTML (e.g. 500 error pages, XML errors) render as live HTML. |
| 5 | [`diff-display.component.ts:130`](file:///D:/projects/ptah-extension/.claude-worktrees/markdown-layout-escape/libs/frontend/chat-ui/src/lib/molecules/tool-execution/diff-display.component.ts#L130) | `Edit` tool input (`old_string`, `new_string`) | Uses fixed fence `'```diff\n' + diffLines + '\n```'`. | **LOW**. `generateUnifiedDiff` prefixes each line with `- `, `+ `, or `@`, preventing lines from acting as bare closing fences under CommonMark. |
| 6 | [`thinking-block.component.ts:75`](file:///D:/projects/ptah-extension/.claude-worktrees/markdown-layout-escape/libs/frontend/chat-ui/src/lib/molecules/thinking-block.component.ts#L75) | Agent extended thinking (`node().content`) | Rendered directly as `<markdown [data]="node().content || ''">`. | **YES (MODERATE)**. Thinking blocks containing HTML code snippets break out when expanded. |
| 7 | [`agent-summary.component.ts:75, 103`](file:///D:/projects/ptah-extension/.claude-worktrees/markdown-layout-escape/libs/frontend/chat-ui/src/lib/molecules/agent-summary.component.ts#L75) | Claude summary stream (`<thinking>` and `<text>`) | Rendered directly into `<markdown [data]="block.content">`. | **YES (MODERATE)**. Summary blocks containing unescaped HTML break out. |

---

### 4. Regression Analysis for Commit `9c8a7d6e1`
In commit `9c8a7d6e1` (`refactor(chat): render every cli lane through one execution tree`), the per-CLI switch was replaced with `CliAgentOutputComponent` backed by `AgentMonitorTreeBuilderService`.

Prior to `9c8a7d6e1`, non-specialized CLIs (antigravity, opencode, cursor, pi) fell to `@default`, which rendered via `AgentCardOutputComponent`. In `AgentCardOutputComponent`:
- `case ('command')`: rendered via `<pre>{{ segment.content }}</pre>` (Angular-escaped text).
- `case ('file-change')`: rendered via `<code>{{ segment.content }}</code>` (Angular-escaped text).
- `case ('tool-result-error')`: rendered via `<pre>{{ segment.content }}</pre>` (Angular-escaped text).
- `case ('thinking')`: rendered via `<pre>{{ segment.content }}</pre>` (Angular-escaped text).
- `case ('error')`: rendered via `<pre>{{ segment.content }}</pre>` (Angular-escaped text).
- `case ('info')`: rendered via `<pre>{{ segment.content }}</pre>` (Angular-escaped text).

**What moved from escaped `{{ }}` text to markdown in `9c8a7d6e1`:**
1. **`thinking`**: Moved from `<pre>{{ segment.content }}</pre>` to `ThinkingBlockComponent` → `<markdown [data]="node().content">`.
2. **`error` segments**: Moved from `<pre>{{ segment.content }}</pre>` to `type: 'text'` ExecutionNodes in `agent-monitor-tree-builder.service.ts:348` → `<markdown [data]="renderedContent()">`.
3. **`info` segments**: Moved from `<pre>{{ segment.content }}</pre>` to `type: 'text'` ExecutionNodes in `agent-monitor-tree-builder.service.ts:362` → `<markdown [data]="renderedContent()">`.
4. **`command` segments**: In `9c8a7d6e1`, orphan commands became `type: 'text'` markdown nodes. Lane A shifted them to `type: 'tool'`, but without preserving exit codes or terminal styling.
5. **`file-change` segments**: In `9c8a7d6e1`, orphan file changes became `type: 'text'` markdown nodes. Lane A shifted them to `type: 'tool'`, losing the compact `changeKind` badge.
6. **`tool-result-error` segments**: Moved from safe `<pre>{{ segment.content }}</pre>` to `type: 'text'` in `9c8a7d6e1`. Lane A shifted them to `type: 'tool'`.

---

## Five Logic Questions

### 1. How does this fail silently?
- [`cli-agent-output.component.ts:89`](file:///D:/projects/ptah-extension/.claude-worktrees/markdown-layout-escape/libs/frontend/chat/src/lib/components/molecules/agent-card/cli-agent-output.component.ts#L89): When structured segments arrive, `CliAgentOutputComponent` auto-collapses the raw stdout disclosure. If an operator manually clicks "Raw stdout" to inspect raw execution, the legacy `AgentCardOutputComponent` mounts and immediately renders any `tool-result` lines through `<markdown [data]="segment.content">`, causing an unexpected layout escape silently during normal debugging.
- [`code-output.component.ts:112`](file:///D:/projects/ptah-extension/.claude-worktrees/markdown-layout-escape/libs/frontend/chat-ui/src/lib/molecules/tool-execution/code-output.component.ts#L112): When an agent inspects a markdown file containing HTML layout documentation, `detectLanguage()` returns `'markdown'`. The component renders without throwing any error, but the unescaped HTML escapes into the window layout.

### 2. What user action produces unexpected behaviour?
- **Expanding the "Input" parameter fold of a `Write` tool call**:
  In [`tool-input-display.component.ts:64-77`](file:///D:/projects/ptah-extension/.claude-worktrees/markdown-layout-escape/libs/frontend/chat-ui/src/lib/molecules/tool-execution/tool-input-display.component.ts#L64-L77), if a user clicks to expand a `Write` tool input writing a `.md` file or code with backticks, the input content is rendered via `<markdown>` with fixed 3-backtick fences or no fences at all, blowing out the webview.
- **Expanding "Extended Thinking"**:
  In [`thinking-block.component.ts:27-77`](file:///D:/projects/ptah-extension/.claude-worktrees/markdown-layout-escape/libs/frontend/chat-ui/src/lib/molecules/thinking-block.component.ts#L27-L77), clicking to expand thinking that mentions Tailwind classes immediately breaks window containment.

### 3. What input data produces a wrong answer?
- **File change segments**:
  In [`agent-monitor-tree-builder.service.ts:327`](file:///D:/projects/ptah-extension/.claude-worktrees/markdown-layout-escape/libs/frontend/chat/src/lib/services/agent-monitor-tree-builder.service.ts#L327), an incoming segment `{ type: 'file-change', content: 'src/app.ts', changeKind: 'modified' }` produces an ExecutionNode with `toolName: 'Tool'`, `toolOutput: 'src/app.ts'`. The user sees a tool execution card labeled "Tool" containing a file path as its output, rather than a file modification badge.

### 4. What happens when a dependency fails?
- **CLI error reporting**:
  If a CLI tool fails and outputs an error containing raw HTML (such as a 500 error page from an HTTP client, or an XML parse error), [`agent-monitor-tree-builder.service.ts:348`](file:///D:/projects/ptah-extension/.claude-worktrees/markdown-layout-escape/libs/frontend/chat/src/lib/services/agent-monitor-tree-builder.service.ts#L348) creates a `type: 'text'` node with `content: segment.content`. When [`ExecutionNodeComponent`](file:///D:/projects/ptah-extension/.claude-worktrees/markdown-layout-escape/libs/frontend/chat/src/lib/components/organisms/execution/execution-node.component.ts#L131-L141) receives it, it ignores the `error` property and renders the HTML directly into the DOM.

### 5. What is missing that the requirements never mentioned?
- Isolation of tool input rendering: While the task specification focused on tool output and orphan results, `ToolInputDisplayComponent` renders input parameters using the exact same vulnerable markdown pipeline.
- Parity between stream events and segment tree builder: `buildTree` (for Ptah CLI streaming) silently drops unassociated `tool_result` events, while `buildTreeFromSegments` synthesizes orphan nodes.

---

## Numbered Defects

### Defect 1: Unfenced and Fixed-Fence Markdown in Tool Input Display
- **File**: [`libs/frontend/chat-ui/src/lib/molecules/tool-execution/tool-input-display.component.ts:270-285`](file:///D:/projects/ptah-extension/.claude-worktrees/markdown-layout-escape/libs/frontend/chat-ui/src/lib/molecules/tool-execution/tool-input-display.component.ts#L270-L285)
- **Severity**: Serious
- **Scenario**: An agent calls the `Write` tool to create or update a `.md` file or any file containing triple backticks (e.g. `native-drawer.component.ts` with JSDoc HTML). The user expands the parameter in the tool card.
- **Impact**: `getFormattedParamContent` returns `content` unfenced for markdown, or with fixed ```` ``` ```` fences that break out on inner backticks, rendering live HTML directly into the DOM.
- **Fix**: Apply the same dynamic backtick fence logic (`max(3, longestRun + 1)`) to `ToolInputDisplayComponent.getFormattedParamContent`, and never return raw unfenced content for markdown inputs.

### Defect 2: Raw Stdout Disclosure Renders Unfenced `tool-result` in Markdown
- **File**: [`libs/frontend/chat/src/lib/components/molecules/agent-card/cli-agent-output.component.ts:89-93`](file:///D:/projects/ptah-extension/.claude-worktrees/markdown-layout-escape/libs/frontend/chat/src/lib/components/molecules/agent-card/cli-agent-output.component.ts#L89-L93) & [`libs/frontend/chat-ui/src/lib/molecules/agent-card/agent-card-output.component.ts:151-155`](file:///D:/projects/ptah-extension/.claude-worktrees/markdown-layout-escape/libs/frontend/chat-ui/src/lib/molecules/agent-card/agent-card-output.component.ts#L151-L155)
- **Severity**: Serious
- **Scenario**: `CliAgentOutputComponent` provides a "Raw stdout" disclosure that embeds `AgentCardOutputComponent`. In `AgentCardOutputComponent`, `case ('tool-result')` passes `segment.content` directly to `<markdown [data]="segment.content">`.
- **Impact**: When an agent runs without rich events or when the user expands "Raw stdout", tool output containing HTML escapes and overlays the application.
- **Fix**: Replace `<markdown [data]="segment.content">` in `AgentCardOutputComponent:153` with `<pre class="... whitespace-pre-wrap">{{ segment.content }}</pre>`, or wrap `segment.content` in dynamic code fences.

### Defect 3: `error` and `info` Segments Converted to `type: 'text'` Markdown Nodes
- **File**: [`libs/frontend/chat/src/lib/services/agent-monitor-tree-builder.service.ts:342-369`](file:///D:/projects/ptah-extension/.claude-worktrees/markdown-layout-escape/libs/frontend/chat/src/lib/services/agent-monitor-tree-builder.service.ts#L342-L369)
- **Severity**: Serious
- **Scenario**: An agent emits an `error` or `info` segment containing raw markup, stack traces, or error diagnostics.
- **Impact**: `agent-monitor-tree-builder.service.ts` converts them to `type: 'text'` nodes. In `ExecutionNodeComponent:140`, all `type: 'text'` nodes are rendered as live markdown (`<markdown [data]="renderedContent()">`). Raw HTML in errors escapes container boundaries.
- **Fix**: In `agent-monitor-tree-builder.service.ts`, format `error` and `info` segments as preformatted blocks or code blocks (or introduce an explicit `type: 'error'` execution node branch in `ExecutionNodeComponent`).

### Defect 4: Unfenced Markdown Branch in `CodeOutputComponent`
- **File**: [`libs/frontend/chat-ui/src/lib/molecules/tool-execution/code-output.component.ts:112, 132-134`](file:///D:/projects/ptah-extension/.claude-worktrees/markdown-layout-escape/libs/frontend/chat-ui/src/lib/molecules/tool-execution/code-output.component.ts#L112)
- **Severity**: Serious
- **Scenario**: An agent calls `Read` on a markdown file or invokes any MCP tool (`mcp__*`). `detectLanguage()` returns `'markdown'`.
- **Impact**: Line 112 returns `str` unfenced. Any HTML with Tailwind fixed classes inside a `.md` file or MCP response escapes containment.
- **Fix**: Code output for tools must ALWAYS be rendered within a fenced code block unless explicitly trusted and sanitized. Remove `if (language === 'markdown') return str;` from `CodeOutputComponent` (or gate it behind a strict plaintext code fence).

### Defect 5: Brittle Fixed 3-Backtick Fence in Diff Display
- **File**: [`libs/frontend/chat-ui/src/lib/molecules/tool-execution/diff-display.component.ts:130`](file:///D:/projects/ptah-extension/.claude-worktrees/markdown-layout-escape/libs/frontend/chat-ui/src/lib/molecules/tool-execution/diff-display.component.ts#L130)
- **Severity**: Moderate
- **Scenario**: Edit tool diff contains triple backticks in replacements.
- **Impact**: Uses `'```diff\n' + diffLines + '\n```'`. While currently mitigated by line prefixing in `generateUnifiedDiff`, it is architecturally inconsistent and fragile.
- **Fix**: Use dynamic fence calculation `max(3, longestRun + 1)` matching `CodeOutputComponent`.

### Defect 6: Extended Thinking and XML Summary Content Rendered Unfenced
- **File**: [`libs/frontend/chat-ui/src/lib/molecules/thinking-block.component.ts:75`](file:///D:/projects/ptah-extension/.claude-worktrees/markdown-layout-escape/libs/frontend/chat-ui/src/lib/molecules/thinking-block.component.ts#L75) & [`libs/frontend/chat-ui/src/lib/molecules/agent-summary.component.ts:75`](file:///D:/projects/ptah-extension/.claude-worktrees/markdown-layout-escape/libs/frontend/chat-ui/src/lib/molecules/agent-summary.component.ts#L75)
- **Severity**: Moderate
- **Scenario**: Extended thinking contains raw HTML snippets that the model is analyzing.
- **Impact**: Passed directly to `<markdown [data]>`. When expanded, it renders live HTML.
- **Fix**: Render thinking content as plaintext `<pre>` or sanitize HTML tags before passing to `<markdown>`.

### Defect 7: Semantic Degradation for Orphan `file-change` Segments
- **File**: [`libs/frontend/chat/src/lib/services/agent-monitor-tree-builder.service.ts:327-338`](file:///D:/projects/ptah-extension/.claude-worktrees/markdown-layout-escape/libs/frontend/chat/src/lib/services/agent-monitor-tree-builder.service.ts#L327-L338)
- **Severity**: Minor
- **Scenario**: `file-change` segments without a matching tool call are routed to `case 'tool-result': ... else createExecutionNode({ type: 'tool', toolName: 'Tool', toolOutput: segment.content })`.
- **Impact**: A file change notification appears as a full tool card titled "Tool" with a file path string in the code output block.
- **Fix**: Map `file-change` to an appropriate dedicated node type or pass `changeKind` to the tool node header.

---

## Data Flow Analysis

1. **CLI Process Output** → `AgentProcessManager` collects raw deltas & structured `CliOutputSegment[]`.
2. **Card Ingestion** → `AgentCardComponent` passes `agent().segments` and `parsedOutput()` (from stdout) to `CliAgentOutputComponent`.
3. **Tree Construction** → `AgentMonitorTreeBuilderService.buildTreeFromSegments`:
   - Orphan tool results: mapped to `type: 'tool'` with `toolOutput`. **[OK in Lane A]**
   - Error & Info segments: mapped to `type: 'text'`. **[GAP: Renders unfenced markdown]**
4. **Node Rendering** → `ExecutionNodeComponent`:
   - `type: 'tool'`: delegates to `ToolCallItemComponent` → `ToolOutputDisplayComponent` → `CodeOutputComponent`. **[OK in Lane A for non-md]**
   - `type: 'text'`: delegates to `<markdown [data]="renderedContent()">`. **[GAP for error/info]**
5. **Tool Output Rendering** → `CodeOutputComponent`:
   - Non-markdown language: wrapped in `max(3, longestRun + 1)` backtick fence. **[OK in Lane A]**
   - Markdown language / MCP: returned unfenced to `<markdown [data]>`. **[GAP: Layout escape]**
6. **Tool Input Rendering** → `ToolInputDisplayComponent`:
   - Write tool content: uses fixed 3-backticks or returns unfenced markdown. **[GAP: Layout escape]**
7. **Raw Stdout Disclosure** → `AgentCardOutputComponent`:
   - `case ('tool-result')`: renders `<markdown [data]="segment.content">` unfenced. **[GAP: Layout escape]**

---

## Requirements Fulfilment

| Requirement | Status | Gap |
| ----------- | ------ | --- |
| Prevent orphan tool output from escaping as HTML | PARTIAL | Addressed in `AgentMonitorTreeBuilderService` for tool results, but `ToolInputDisplayComponent` and `AgentCardOutputComponent` still leak orphan/raw results. |
| Prevent code fence breakout on nested backticks | PARTIAL | Fixed in `CodeOutputComponent` for non-markdown, but markdown branch bypasses fencing entirely, and `ToolInputDisplayComponent` was not updated. |
| Ensure `type: 'tool'` with `toolName: 'Tool'` renders stably | COMPLETE | Traced completely: defaults gracefully to TerminalIcon, `[Tool] Tool` header, clean input omission, and valid code output. |
| Spec tests verify containment | PARTIAL | Tests prove fence sizing and unit node construction, but explicitly assert that markdown remains unfenced, leaving the escape open. |

---

## Edge Cases

| Case | Handled | How | Concern |
| ---- | ------- | --- | ------- |
| Output contains 3 backticks | YES | Dynamic fence uses 4 backticks | None for non-markdown |
| Output contains 10 consecutive backticks | YES | Dynamic fence uses 11 backticks | None for non-markdown |
| Output is markdown file with HTML | NO | Returns unfenced | Escapes into app layout |
| Output is from MCP tool | NO | Returns unfenced | Escapes into app layout |
| Tool input has backtick runs | NO | Fixed 3-backticks in `ToolInputDisplayComponent` | Escapes into app layout |
| User opens Raw stdout disclosure | NO | Uses unfenced `<markdown>` in `AgentCardOutputComponent` | Escapes into app layout |
| CLI emits error segment with HTML | NO | Converted to `type: 'text'` markdown node | Escapes into app layout |

---

## Verdict

- **Recommendation**: REVISE
- **Confidence**: HIGH
- **Top risk**: An agent reading or writing a `.md` file, calling an MCP tool, expanding tool inputs, or having raw stdout inspected will trigger the exact same full-window layout overlay bug.
- **What a robust implementation must add**:
  1. Update [`tool-input-display.component.ts`](file:///D:/projects/ptah-extension/.claude-worktrees/markdown-layout-escape/libs/frontend/chat-ui/src/lib/molecules/tool-execution/tool-input-display.component.ts#L279-L284) to use dynamic code fencing and eliminate the unfenced markdown return.
  2. Replace `<markdown [data]="segment.content">` in [`agent-card-output.component.ts:153`](file:///D:/projects/ptah-extension/.claude-worktrees/markdown-layout-escape/libs/frontend/chat-ui/src/lib/molecules/agent-card/agent-card-output.component.ts#L153) with safe `<pre>` text formatting.
  3. Ensure all tool output in [`code-output.component.ts`](file:///D:/projects/ptah-extension/.claude-worktrees/markdown-layout-escape/libs/frontend/chat-ui/src/lib/molecules/tool-execution/code-output.component.ts#L112) is fenced inside a code block, removing the raw markdown pass-through for tool outputs.
  4. In [`agent-monitor-tree-builder.service.ts`](file:///D:/projects/ptah-extension/.claude-worktrees/markdown-layout-escape/libs/frontend/chat/src/lib/services/agent-monitor-tree-builder.service.ts#L346), ensure `error` and `info` segments are represented as safe preformatted text rather than raw markdown nodes.

---

## Re-review (round 1)

### Summary

| Metric              | Value                                |
| ------------------- | ------------------------------------ |
| Overall score       | 9/10                                 |
| Assessment          | APPROVED                             |
| Blocking issues     | 0                                    |
| Serious issues      | 0                                    |
| Moderate issues     | 0                                    |
| Minor issues        | 0                                    |
| Failure modes found | 0                                    |

---

### Scope & Orchestrator Triage Context

During triage, the orchestrator affirmed the scope separation between Lane A and the concurrent sanitizer lane:
- **Defects #1, #2, #3, #5, #7** were accepted and assigned to Lane A for remediation.
- **Defects #4** (markdown branch in `code-output` for `.md` reads and MCP output) and **#6** (thinking and agent-summary markdown) were intentionally retained as markdown rendering surfaces. These surfaces represent model prose and document content intended to render rich formatting. Containment for these intentional markdown elements is now enforced at the host container level by the concurrent lane via CSS containment (`markdown { contain: layout paint; isolation: isolate }`) and DOMPurify class allowlisting, which strictly neutralizes window-escaping classes (e.g. `fixed`, `inset-0`, `z-50`).

Accordingly, this re-review examines the resolution of Defects #1, #2, #3, #5, and #7, the correctness of the newly extracted `fenceCodeBlock` helper, the rendering of error and info nodes, and the test evidence across both packages.

---

### Defect Verification

#### Defect #1: Tool Input Dynamic Fencing — FIXED
- **Location**: [`libs/frontend/chat-ui/src/lib/molecules/tool-execution/tool-input-display.component.ts:283, 285`](file:///D:/projects/ptah-extension/.claude-worktrees/markdown-layout-escape/libs/frontend/chat-ui/src/lib/molecules/tool-execution/tool-input-display.component.ts#L283-L285)
- **Implementation**: Replaced brittle fixed 3-backtick fence strings (`'```' + language + ...`) with `fenceCodeBlock(content, language)` and `fenceCodeBlock(content, '')`.
- **Evidence & Testing**: [`tool-input-display.component.spec.ts:62-79`](file:///D:/projects/ptah-extension/.claude-worktrees/markdown-layout-escape/libs/frontend/chat-ui/src/lib/molecules/tool-execution/tool-input-display.component.spec.ts#L62-L79) mounts the component with `provideMarkdown()`, sets expanded state, and asserts that large content containing nested backticks and HTML tags is rendered into exactly one `pre code` block, with `querySelector('div.fixed')` returning `null`.

#### Defect #2: Raw Stdout Disclosure Tool-Result Escaping — FIXED
- **Location**: [`libs/frontend/chat-ui/src/lib/molecules/agent-card/agent-card-output.component.ts:153-156`](file:///D:/projects/ptah-extension/.claude-worktrees/markdown-layout-escape/libs/frontend/chat-ui/src/lib/molecules/agent-card/agent-card-output.component.ts#L153-L156)
- **Implementation**: Removed `<markdown [data]="segment.content" />` from `case ('tool-result')` and replaced it with safe `<pre>` text interpolation:
  ```html
  <pre class="text-[10px] font-mono text-base-content-muted whitespace-pre-wrap break-words m-0 leading-relaxed">{{ segment.content }}</pre>
  ```
  Removed obsolete `prose` classes from the container.
- **Evidence & Testing**: [`agent-card-output.component.spec.ts:18-28`](file:///D:/projects/ptah-extension/.claude-worktrees/markdown-layout-escape/libs/frontend/chat-ui/src/lib/molecules/agent-card/agent-card-output.component.spec.ts#L18-L28) asserts that raw `tool-result` markup stays literal text inside `<pre>`, instantiates no `<markdown>` element, and produces no `div.fixed`. Lines 30–39 verify that model prose text segments continue to render markdown as expected.

#### Defect #3: Fenced Error and Info Segments in Tree Builder — FIXED
- **Location**: [`libs/frontend/chat/src/lib/services/agent-monitor-tree-builder.service.ts:357, 372`](file:///D:/projects/ptah-extension/.claude-worktrees/markdown-layout-escape/libs/frontend/chat/src/lib/services/agent-monitor-tree-builder.service.ts#L357-L372)
- **Implementation**: Fences incoming `segment.content` for both `error` and `info` segment types using `fenceCodeBlock(segment.content, 'text')`. Preserves `error: segment.content` on the error node for downstream consumers (e.g. tree hashing, session compaction).
- **Evidence & Testing**: [`agent-monitor-tree-builder.service.spec.ts:333-356`](file:///D:/projects/ptah-extension/.claude-worktrees/markdown-layout-escape/libs/frontend/chat/src/lib/services/agent-monitor-tree-builder.service.spec.ts#L333-L356) tests both `error` and `info` segments containing backticks and HTML, verifying that:
  - `content` is safely fenced (`'````text\n' + content + '\n````'`).
  - Node identity (`id: 'seg-error-1'`), `type: 'text'`, and `status: 'complete'` are preserved.
  - `tree[1].error` retains the raw error string without fence prefixes.
  - Surrounding model prose segments remain unaltered.

#### Defect #5: Dynamic Fencing in Diff Display — FIXED
- **Location**: [`libs/frontend/chat-ui/src/lib/molecules/tool-execution/diff-display.component.ts:131`](file:///D:/projects/ptah-extension/.claude-worktrees/markdown-layout-escape/libs/frontend/chat-ui/src/lib/molecules/tool-execution/diff-display.component.ts#L131)
- **Implementation**: Replaced hardcoded `'```diff\n' + diffLines + '\n```'` with `fenceCodeBlock(diffLines, 'diff')`.
- **Evidence & Testing**: [`diff-display.component.spec.ts:7-30`](file:///D:/projects/ptah-extension/.claude-worktrees/markdown-layout-escape/libs/frontend/chat-ui/src/lib/molecules/tool-execution/diff-display.component.spec.ts#L7-L30) feeds input with runs of 3 and 10 backticks in `old_string` and `new_string`, verifying that the diff is safely enclosed in an 11-backtick fence.

#### Defect #7: Meaningful Fallback Labels for Orphan Segments — FIXED
- **Location**: [`libs/frontend/chat/src/lib/services/agent-monitor-tree-builder.service.ts:334-340`](file:///D:/projects/ptah-extension/.claude-worktrees/markdown-layout-escape/libs/frontend/chat/src/lib/services/agent-monitor-tree-builder.service.ts#L334-L340)
- **Implementation**: Instead of generic `'Tool'`, unnamed orphan segments receive semantic fallback labels:
  - `command` → `'Command'`
  - `file-change` → `'File change'`
  - `tool-result` / `tool-result-error` → `'Tool result'`
- **Evidence & Testing**: [`agent-monitor-tree-builder.service.spec.ts:321-331`](file:///D:/projects/ptah-extension/.claude-worktrees/markdown-layout-escape/libs/frontend/chat/src/lib/services/agent-monitor-tree-builder.service.spec.ts#L321-L331) parameterizes tests across all four segment types and validates their assigned `toolName` headers.

---

### Analysis of the Shared Helper: `fenceCodeBlock`

- **Location**: [`libs/frontend/chat-ui/src/lib/molecules/tool-execution/code-fence.ts:1-8`](file:///D:/projects/ptah-extension/.claude-worktrees/markdown-layout-escape/libs/frontend/chat-ui/src/lib/molecules/tool-execution/code-fence.ts#L1-L8)
- **Export**: Declared in public barrel [`libs/frontend/chat-ui/src/index.ts:85`](file:///D:/projects/ptah-extension/.claude-worktrees/markdown-layout-escape/libs/frontend/chat-ui/src/index.ts#L85), enabling clean cross-library import into `@ptah-extension/chat` without module boundary violations.

```ts
export function fenceCodeBlock(content: string, language: string): string {
  let longestRun = 0;
  for (const match of content.matchAll(/`+/g)) {
    longestRun = Math.max(longestRun, match[0].length);
  }
  const fence = '`'.repeat(Math.max(3, longestRun + 1));
  return fence + language + '\n' + content + '\n' + fence;
}
```

#### Specification Conformance & Edge Cases:
1. **CommonMark §4.5 Closing Fence Sizing**:
   The specification states: *“The closing code fence may be preceded by up to three spaces of indentation, and must consist of at least three backticks of the same character as the corresponding opening code fence, and of at least the same length as the opening code fence.”*
   Because `fence` has length $N = \max(3, \text{longestRun} + 1)$, every consecutive sequence of backticks in `content` has length at most $\text{longestRun} < N$. Therefore, no run inside `content` meets the $\ge N$ length threshold required to close the block.
2. **Lines with Space-Indented Backticks (`   ``` `)**:
   Any sequence of backticks following 0–3 spaces is captured by `/`+/g` and measured towards `longestRun`. Because the enclosing fence is strictly longer than this run, an inner indented backtick sequence cannot close the fence. (Lines with 4+ spaces are treated as indented text/code in CommonMark and cannot serve as closing fences regardless).
3. **Content Without Trailing Newlines**:
   The return expression `fence + language + '\n' + content + '\n' + fence` guarantees a preceding newline before the closing fence. Whether `content` ends with a newline, ends with text, or ends with backticks, the closing fence always sits on its own dedicated line.
4. **Empty Content**:
   When `content` is `""`, `longestRun` is `0`, generating ```` ```\n\n``` ````, which parses as a valid empty code block.

---

### Node Rendering Verification

- **Error and Info Nodes**:
  When `agent-monitor-tree-builder.service.ts` emits an `error` or `info` node, it has `type: 'text'` and `content: fenceCodeBlock(...)`. In [`ExecutionNodeComponent:131-141`](file:///D:/projects/ptah-extension/.claude-worktrees/markdown-layout-escape/libs/frontend/chat/src/lib/components/organisms/execution/execution-node.component.ts#L131-L141), `renderedContent()` delivers the fenced string to `<markdown>`. `marked` parses the fence into `<pre><code class="language-text">...</code></pre>`, rendering a clean, monospace, contained text box.
- **Consumer Compatibility**:
  The raw error string remains directly accessible at `node().error`. Consumers such as `mixString(hash, node.error ?? '')` in `execution-tree-builder.service.ts` or `node.error` in `compact-session-summary.ts` continue to function without modification.

---

### Verification Results

All scoped verification targets executed cleanly with cache skipped:

```text
npx nx run-many -t test,lint,typecheck -p @ptah-extension/chat @ptah-extension/chat-ui
```

| Project | test | lint | typecheck | Result |
| ------- | ---- | ---- | --------- | ------ |
| `@ptah-extension/chat` | PASS | PASS | PASS | **PASS** |
| `@ptah-extension/chat-ui` | PASS | PASS | PASS | **PASS** |

- **Test suites**: 100% passing across both projects (including all 5 new and updated spec files).
- **Lint**: Zero lint warnings or errors.
- **Typecheck**: Zero TypeScript diagnostic errors.
- **Regressions**: No functional or aesthetic regressions observed.

---

### Final Verdict

- **Recommendation**: APPROVE
- **Confidence**: HIGH
- **Remaining defects**: None within the scope of Lane A.
