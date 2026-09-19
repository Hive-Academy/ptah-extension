import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideMarkdown } from 'ngx-markdown';
import { Clipboard } from '@angular/cdk/clipboard';
import { By } from '@angular/platform-browser';
import type {
  ExecutionChatMessage,
  ExecutionNode,
  PermissionRequest,
  PermissionResponse,
  AskUserQuestionRequest,
  AskUserQuestionResponse,
  TextDeltaEvent,
  ThinkingStartEvent,
  ThinkingDeltaEvent,
  ToolStartEvent,
  ToolResultEvent,
  AgentStartEvent,
} from '@ptah-extension/shared';
import {
  createEmptyStreamingState,
  AccumulatorKeys,
  type StreamingState,
} from '@ptah-extension/chat-types';
import { CompactSessionActivityComponent } from './compact-session-activity.component';

describe('CompactSessionActivityComponent', () => {
  let fixture: ComponentFixture<CompactSessionActivityComponent>;
  let copySpy: jest.Mock<boolean, [string]>;

  beforeEach(async () => {
    copySpy = jest.fn().mockReturnValue(true);

    await TestBed.configureTestingModule({
      imports: [CompactSessionActivityComponent],
      providers: [
        provideMarkdown(),
        { provide: Clipboard, useValue: { copy: copySpy } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(CompactSessionActivityComponent);
  });

  // HARD CONSTRAINT #3: Must keep passing unchanged.
  it('renders a cost badge for a genuinely zero-cost agent entry', () => {
    const agentNode: ExecutionNode = {
      id: 'agent-1',
      type: 'agent',
      status: 'complete',
      content: null,
      agentType: 'local-agent',
      toolCallId: 'tool-1',
      tokenUsage: { input: 100, output: 50 },
      cost: 0,
      children: [],
      isCollapsed: false,
    };
    const message: ExecutionChatMessage = {
      id: 'message-1',
      role: 'assistant',
      timestamp: 1,
      streamingState: agentNode,
    };

    fixture.componentRef.setInput('messages', [message]);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('$0.0000');
  });

  describe('Empty and default feed behavior', () => {
    it('displays "Waiting for activity..." when feed is empty', () => {
      fixture.componentRef.setInput('messages', []);
      fixture.detectChanges();

      expect(fixture.nativeElement.textContent).toContain(
        'Waiting for activity...',
      );
    });

    it('skips non-assistant messages and messages without streamingState', () => {
      const messages: ExecutionChatMessage[] = [
        {
          id: 'user-1',
          role: 'user',
          timestamp: 1,
          rawContent: 'Hello',
        },
        {
          id: 'system-1',
          role: 'system',
          timestamp: 2,
          rawContent: 'System prompt',
        },
        {
          id: 'assistant-1',
          role: 'assistant',
          timestamp: 3,
          streamingState: undefined,
        },
      ];

      fixture.componentRef.setInput('messages', messages);
      fixture.detectChanges();

      expect(fixture.nativeElement.textContent).toContain(
        'Waiting for activity...',
      );
    });

    it('slices feed entries to maxEntries input limit', () => {
      const rootNode: ExecutionNode = {
        id: 'root',
        type: 'message',
        status: 'complete',
        content: null,
        children: [
          {
            id: 't1',
            type: 'text',
            status: 'complete',
            content: 'Message 1',
            children: [],
          },
          {
            id: 't2',
            type: 'text',
            status: 'complete',
            content: 'Message 2',
            children: [],
          },
          {
            id: 't3',
            type: 'text',
            status: 'complete',
            content: 'Message 3',
            children: [],
          },
        ],
      };

      const message: ExecutionChatMessage = {
        id: 'msg-slice',
        role: 'assistant',
        timestamp: 1,
        streamingState: rootNode,
      };

      fixture.componentRef.setInput('maxEntries', 2);
      fixture.componentRef.setInput('messages', [message]);
      fixture.detectChanges();

      const entries = fixture.componentInstance.feedEntries();
      expect(entries.length).toBe(2);
      expect((entries[0] as { textContent?: string }).textContent).toBe(
        'Message 2',
      );
      expect((entries[1] as { textContent?: string }).textContent).toBe(
        'Message 3',
      );

      const markdowns = fixture.debugElement.queryAll(By.css('markdown'));
      expect(markdowns.length).toBe(2);
    });
  });

  describe('Agent entry rendering and cost formatting', () => {
    it('formats non-zero cost badge to 4 decimal places', () => {
      const agentNode: ExecutionNode = {
        id: 'agent-cost',
        type: 'agent',
        status: 'complete',
        content: null,
        agentType: 'coder',
        toolCallId: 't-cost',
        cost: 0.123456,
        children: [],
      };

      fixture.componentRef.setInput('messages', [
        {
          id: 'm-cost',
          role: 'assistant',
          timestamp: 1,
          streamingState: agentNode,
        },
      ]);
      fixture.detectChanges();

      expect(fixture.nativeElement.textContent).toContain('$0.1235');
    });

    it('omits cost badge when cost is null or undefined', () => {
      const agentNodeNullCost: ExecutionNode = {
        id: 'agent-null',
        type: 'agent',
        status: 'complete',
        content: null,
        agentType: 'coder',
        toolCallId: 't-null',
        cost: null,
        children: [],
      };
      const agentNodeUndefinedCost: ExecutionNode = {
        id: 'agent-undef',
        type: 'agent',
        status: 'complete',
        content: null,
        agentType: 'coder',
        toolCallId: 't-undef',
        cost: undefined,
        children: [],
      };

      fixture.componentRef.setInput('messages', [
        {
          id: 'm-null',
          role: 'assistant',
          timestamp: 1,
          streamingState: agentNodeNullCost,
        },
        {
          id: 'm-undef',
          role: 'assistant',
          timestamp: 2,
          streamingState: agentNodeUndefinedCost,
        },
      ]);
      fixture.detectChanges();

      expect(fixture.nativeElement.textContent).not.toContain('$');
    });

    it('renders agent status variants for running and error states', () => {
      const runningAgent: ExecutionNode = {
        id: 'agent-running',
        type: 'agent',
        status: 'streaming',
        content: null,
        agentType: 'worker',
        toolCallId: 't-running',
        children: [],
      };
      const errorAgent: ExecutionNode = {
        id: 'agent-error',
        type: 'agent',
        status: 'error',
        content: null,
        agentType: 'worker',
        toolCallId: 't-error',
        children: [],
      };

      fixture.componentRef.setInput('messages', [
        {
          id: 'm-running',
          role: 'assistant',
          timestamp: 1,
          streamingState: runningAgent,
        },
        {
          id: 'm-error',
          role: 'assistant',
          timestamp: 2,
          streamingState: errorAgent,
        },
      ]);
      fixture.detectChanges();

      const spinner = fixture.nativeElement.querySelector('.loading-spinner');
      expect(spinner).not.toBeNull();

      const errorIcon = fixture.nativeElement.querySelector(
        'lucide-angular.text-error',
      );
      expect(errorIcon).not.toBeNull();
    });

    it('renders agent description, agentType name fallback, and tool count badges', () => {
      const agentWithFallback: ExecutionNode = {
        id: 'agent-fallback',
        type: 'agent',
        status: 'complete',
        content: null,
        agentType: undefined,
        toolCallId: 't-fallback',
        agentDescription: 'Resolving test coverage',
        children: [
          {
            id: 'tc-1',
            type: 'tool',
            status: 'complete',
            toolName: 'Read',
            children: [],
          },
        ],
      };
      const agentWithPluralTools: ExecutionNode = {
        id: 'agent-plural',
        type: 'agent',
        status: 'complete',
        content: null,
        agentType: 'specialist',
        toolCallId: 't-plural',
        children: [
          {
            id: 'tc-2',
            type: 'tool',
            status: 'complete',
            toolName: 'Read',
            children: [],
          },
          {
            id: 'tc-3',
            type: 'tool',
            status: 'complete',
            toolName: 'Write',
            children: [],
          },
        ],
      };

      fixture.componentRef.setInput('messages', [
        {
          id: 'm-fb',
          role: 'assistant',
          timestamp: 1,
          streamingState: agentWithFallback,
        },
        {
          id: 'm-pl',
          role: 'assistant',
          timestamp: 2,
          streamingState: agentWithPluralTools,
        },
      ]);
      fixture.detectChanges();

      const text = fixture.nativeElement.textContent;
      expect(text).toContain('agent');
      expect(text).toContain('— Resolving test coverage');
      expect(text).toContain('1 tool');
      expect(text).not.toContain('1 tools');
      expect(text).toContain('2 tools');
    });

    it('renders agent token usage and duration badges', () => {
      const agentStats: ExecutionNode = {
        id: 'agent-stats',
        type: 'agent',
        status: 'complete',
        content: null,
        agentType: 'profiler',
        toolCallId: 't-stats',
        tokenUsage: { input: 1500, output: 500 },
        duration: 3200,
        children: [],
      };

      fixture.componentRef.setInput('messages', [
        {
          id: 'm-stats',
          role: 'assistant',
          timestamp: 1,
          streamingState: agentStats,
        },
      ]);
      fixture.detectChanges();

      const text = fixture.nativeElement.textContent;
      expect(text).toContain('2,000 tok');
      expect(text).toContain('3.2s');
    });

    it('extracts agent text content from summaryContent and child text nodes with truncation', () => {
      const longSummary = 'A'.repeat(550);
      const agentSummary: ExecutionNode = {
        id: 'agent-summary',
        type: 'agent',
        status: 'complete',
        content: null,
        agentType: 'reporter',
        toolCallId: 't-sum',
        summaryContent: longSummary,
        children: [],
      };

      const agentWithTextChildren: ExecutionNode = {
        id: 'agent-children',
        type: 'agent',
        status: 'complete',
        content: null,
        agentType: 'concatenator',
        toolCallId: 't-cat',
        children: [
          {
            id: 'part-1',
            type: 'text',
            status: 'complete',
            content: 'First part of analysis',
            children: [],
          },
          {
            id: 'part-2',
            type: 'text',
            status: 'complete',
            content: 'Second part of analysis',
            children: [],
          },
        ],
      };

      fixture.componentRef.setInput('messages', [
        {
          id: 'm-sum',
          role: 'assistant',
          timestamp: 1,
          streamingState: agentSummary,
        },
        {
          id: 'm-cat',
          role: 'assistant',
          timestamp: 2,
          streamingState: agentWithTextChildren,
        },
      ]);
      fixture.detectChanges();

      const entries = fixture.componentInstance.feedEntries();
      expect(entries.length).toBe(2);
      const first = entries[0] as { textContent?: string };
      expect(first.textContent?.length).toBe(500);
      expect(first.textContent).toContain('...');
      const second = entries[1] as { textContent?: string };
      expect(second.textContent).toBe(
        'First part of analysis\nSecond part of analysis',
      );

      const markdowns = fixture.debugElement.queryAll(By.css('markdown'));
      expect(markdowns.length).toBe(2);
    });
  });

  describe('Standalone text and thinking nodes from messages', () => {
    it('renders standalone text nodes and skips whitespace-only text', () => {
      const rootNode: ExecutionNode = {
        id: 'root-text',
        type: 'message',
        status: 'complete',
        content: null,
        children: [
          {
            id: 'valid-text',
            type: 'text',
            status: 'complete',
            content: 'Verified text response',
            children: [],
          },
          {
            id: 'empty-text',
            type: 'text',
            status: 'complete',
            content: '   \n\t  ',
            children: [],
          },
          {
            id: 'long-text',
            type: 'text',
            status: 'complete',
            content: 'T'.repeat(1050),
            children: [],
          },
        ],
      };

      fixture.componentRef.setInput('messages', [
        {
          id: 'm-texts',
          role: 'assistant',
          timestamp: 1,
          streamingState: rootNode,
        },
      ]);
      fixture.detectChanges();

      const entries = fixture.componentInstance.feedEntries();
      expect(entries.length).toBe(2);
      expect((entries[0] as { textContent?: string }).textContent).toBe(
        'Verified text response',
      );
      expect(
        (entries[1] as { textContent?: string }).textContent?.length,
      ).toBe(1000);
      expect((entries[1] as { textContent?: string }).textContent).toContain(
        '...',
      );

      const markdowns = fixture.debugElement.queryAll(By.css('markdown'));
      expect(markdowns.length).toBe(2);
    });

    it('renders standalone thinking nodes with truncation and skips whitespace-only', () => {
      const rootNode: ExecutionNode = {
        id: 'root-think',
        type: 'message',
        status: 'complete',
        content: null,
        children: [
          {
            id: 'valid-think',
            type: 'thinking',
            status: 'complete',
            content: 'Deep reasoning chain',
            children: [],
          },
          {
            id: 'empty-think',
            type: 'thinking',
            status: 'complete',
            content: '    ',
            children: [],
          },
          {
            id: 'long-think',
            type: 'thinking',
            status: 'complete',
            content: 'R'.repeat(4050),
            children: [],
          },
        ],
      };

      fixture.componentRef.setInput('messages', [
        {
          id: 'm-think',
          role: 'assistant',
          timestamp: 1,
          streamingState: rootNode,
        },
      ]);
      fixture.detectChanges();

      const text = fixture.nativeElement.textContent;
      expect(text).toContain('Thinking');
    });
  });

  describe('Tool grouping and tool row derivation', () => {
    it('groups consecutive tool nodes and tallies running and error counts', () => {
      const rootNode: ExecutionNode = {
        id: 'root-tools',
        type: 'message',
        status: 'complete',
        content: null,
        children: [
          {
            id: 'tool-err',
            type: 'tool',
            status: 'error',
            toolName: 'Bash',
            toolInput: { command: 'git status' },
            children: [],
          },
          {
            id: 'tool-stream',
            type: 'tool',
            status: 'streaming',
            toolName: 'Read',
            toolInput: { file_path: 'package.json' },
            children: [],
          },
          {
            id: 'tool-pend',
            type: 'tool',
            status: 'pending',
            toolName: 'Glob',
            toolInput: { pattern: '**/*.ts' },
            children: [],
          },
          {
            id: 'tool-comp',
            type: 'tool',
            status: 'complete',
            toolName: 'Grep',
            toolInput: { pattern: 'describe' },
            children: [],
          },
        ],
      };

      fixture.componentRef.setInput('messages', [
        {
          id: 'm-tools',
          role: 'assistant',
          timestamp: 1,
          streamingState: rootNode,
        },
      ]);
      fixture.detectChanges();

      const toolRows = fixture.debugElement.queryAll(
        By.css('ptah-compact-tool-row'),
      );
      expect(toolRows.length).toBe(4);
    });

    it('collapses tool rows when exceeding threshold and toggles expanded view', () => {
      const toolChildren: ExecutionNode[] = Array.from(
        { length: 8 },
        (_, i) => ({
          id: `tool-${i}`,
          type: 'tool',
          status: i === 0 ? 'error' : 'complete',
          toolName: 'Read',
          toolInput: { file_path: `src/file-${i}.ts` },
          children: [],
        }),
      );

      const rootNode: ExecutionNode = {
        id: 'root-collapse',
        type: 'message',
        status: 'complete',
        content: null,
        children: toolChildren,
      };

      fixture.componentRef.setInput('messages', [
        {
          id: 'm-col',
          role: 'assistant',
          timestamp: 1,
          streamingState: rootNode,
        },
      ]);
      fixture.detectChanges();

      // Initially shows preview count of 5 rows and a toggle button
      let rows = fixture.debugElement.queryAll(By.css('ptah-compact-tool-row'));
      expect(rows.length).toBe(5);

      const toggleButton = fixture.debugElement.query(
        By.css('button[type="button"]'),
      );
      expect(toggleButton.nativeElement.textContent).toContain('3 more tools');
      expect(toggleButton.nativeElement.textContent).toContain('1 failed');

      // Expand
      toggleButton.nativeElement.click();
      fixture.detectChanges();

      rows = fixture.debugElement.queryAll(By.css('ptah-compact-tool-row'));
      expect(rows.length).toBe(8);
      expect(toggleButton.nativeElement.textContent).toContain('Show fewer');

      // Collapse back
      toggleButton.nativeElement.click();
      fixture.detectChanges();

      rows = fixture.debugElement.queryAll(By.css('ptah-compact-tool-row'));
      expect(rows.length).toBe(5);
    });

    it('derives tool rows for Write tool with content line counts', () => {
      const rootNode: ExecutionNode = {
        id: 'root-write',
        type: 'message',
        status: 'complete',
        content: null,
        children: [
          {
            id: 'tool-w1',
            type: 'tool',
            status: 'complete',
            toolName: 'Write',
            toolInput: {
              file_path: 'path/to/script.ts',
              content: 'line1\nline2\nline3\nline4',
            },
            children: [],
          },
          {
            id: 'tool-w2',
            type: 'tool',
            status: 'complete',
            toolName: 'Write',
            toolInput: {
              file_path: 'path/to/empty.ts',
              content: '',
            },
            children: [],
          },
        ],
      };

      fixture.componentRef.setInput('messages', [
        {
          id: 'm-write',
          role: 'assistant',
          timestamp: 1,
          streamingState: rootNode,
        },
      ]);
      fixture.detectChanges();

      const text = fixture.nativeElement.textContent;
      expect(text).toContain('Wrote');
      expect(text).toContain('script.ts');
      expect(text).toContain('+4');
    });

    it('derives tool rows for Edit tool with LCS diff and handles oversized diff inputs', () => {
      const normalEdit: ExecutionNode = {
        id: 'edit-normal',
        type: 'tool',
        status: 'complete',
        toolName: 'Edit',
        toolInput: {
          file_path: 'src/app.component.ts',
          old_string: 'alpha\nbeta\ngamma',
          new_string: 'alpha\ndelta\ngamma',
        },
        children: [],
      };

      const oversizedOld = Array.from({ length: 600 }, () => 'line').join('\n');
      const oversizedNew = Array.from({ length: 600 }, () => 'line').join('\n');
      const oversizedEdit: ExecutionNode = {
        id: 'edit-oversized',
        type: 'tool',
        status: 'complete',
        toolName: 'Edit',
        toolInput: {
          file_path: 'src/large.ts',
          old_string: oversizedOld,
          new_string: oversizedNew,
        },
        children: [],
      };

      const rootNode: ExecutionNode = {
        id: 'root-edit',
        type: 'message',
        status: 'complete',
        content: null,
        children: [normalEdit, oversizedEdit],
      };

      fixture.componentRef.setInput('messages', [
        {
          id: 'm-edit',
          role: 'assistant',
          timestamp: 1,
          streamingState: rootNode,
        },
      ]);
      fixture.detectChanges();

      const text = fixture.nativeElement.textContent;
      expect(text).toContain('Updated');
      expect(text).toContain('app.component.ts');
      expect(text).toContain('+1');
      expect(text).toContain('-1');
      expect(text).toContain('large.ts');
    });

    it('derives verbs and details for all supported tool types', () => {
      const toolNodes: ExecutionNode[] = [
        {
          id: 't-multiedit',
          type: 'tool',
          status: 'complete',
          toolName: 'MultiEdit',
          toolInput: {
            file_path: 'libs/edit.ts',
            old_string: '1',
            new_string: '2',
          },
          children: [],
        },
        {
          id: 't-nbedit',
          type: 'tool',
          status: 'complete',
          toolName: 'NotebookEdit',
          toolInput: {
            notebook_path: 'demo.ipynb',
            new_source: 'import numpy',
          },
          children: [],
        },
        {
          id: 't-bash-desc',
          type: 'tool',
          status: 'complete',
          toolName: 'Bash',
          toolInput: {
            command: 'npm run test',
            description: 'Run unit test suite',
          },
          children: [],
        },
        {
          id: 't-bash-nodesc',
          type: 'tool',
          status: 'complete',
          toolName: 'Bash',
          toolInput: {
            command:
              'very_long_command_exceeding_sixty_characters_to_test_truncation_logic_properly_here',
          },
          children: [],
        },
        {
          id: 't-grep',
          type: 'tool',
          status: 'complete',
          toolName: 'Grep',
          toolInput: {
            pattern: 'long_pattern_string_exceeding_forty_characters_for_truncation',
          },
          children: [],
        },
        {
          id: 't-glob',
          type: 'tool',
          status: 'complete',
          toolName: 'Glob',
          toolInput: {
            pattern: 'glob_pattern_string_exceeding_forty_characters_for_truncation',
          },
          children: [],
        },
        {
          id: 't-fetch',
          type: 'tool',
          status: 'complete',
          toolName: 'WebFetch',
          toolInput: {
            url: 'https://example.com/very/long/url/path/exceeding/forty/eight/characters/threshold',
          },
          children: [],
        },
        {
          id: 't-search',
          type: 'tool',
          status: 'complete',
          toolName: 'WebSearch',
          toolInput: {
            query: 'search_query_exceeding_forty_characters_threshold_for_truncation',
          },
          children: [],
        },
        {
          id: 't-task',
          type: 'tool',
          status: 'complete',
          toolName: 'Task',
          toolInput: { prompt: 'Subtask' },
          children: [],
        },
        {
          id: 't-agent',
          type: 'tool',
          status: 'complete',
          toolName: 'Agent',
          toolInput: { prompt: 'Subagent' },
          children: [],
        },
        {
          id: 't-todo',
          type: 'tool',
          status: 'complete',
          toolName: 'TodoWrite',
          toolInput: { todos: [] },
          children: [],
        },
        {
          id: 't-mcp',
          type: 'tool',
          status: 'complete',
          toolName: 'mcp__ptah__read_diagnostics',
          toolInput: {},
          children: [],
        },
        {
          id: 't-custom',
          type: 'tool',
          status: 'complete',
          toolName: 'custom_executor',
          toolInput: {},
          children: [],
        },
      ];

      const rootNode: ExecutionNode = {
        id: 'root-verbs',
        type: 'message',
        status: 'complete',
        content: null,
        children: toolNodes,
      };

      fixture.componentRef.setInput('messages', [
        {
          id: 'm-verbs',
          role: 'assistant',
          timestamp: 1,
          streamingState: rootNode,
        },
      ]);
      fixture.detectChanges();

      // Expand the collapsed tool group to verify all tool labels
      const toggleButton = fixture.debugElement.query(
        By.css('button[type="button"]'),
      );
      toggleButton.nativeElement.click();
      fixture.detectChanges();

      const text = fixture.nativeElement.textContent;
      expect(text).toContain('Run unit test suite');
      expect(text).toContain('read diagnostics');
      expect(text).toContain('custom_executor');
    });

    it('normalizes Windows paths, POSIX paths, and directory basenames in tool inputs', () => {
      const winTool: ExecutionNode = {
        id: 't-win',
        type: 'tool',
        status: 'complete',
        toolName: 'Read',
        toolInput: { file_path: 'C:\\Users\\engineer\\project\\src\\index.ts' },
        children: [],
      };
      const trailingSlashTool: ExecutionNode = {
        id: 't-slash',
        type: 'tool',
        status: 'complete',
        toolName: 'custom_fs',
        toolInput: { file_path: '/var/log/ptah/output/' },
        children: [],
      };

      const rootNode: ExecutionNode = {
        id: 'root-paths',
        type: 'message',
        status: 'complete',
        content: null,
        children: [winTool, trailingSlashTool],
      };

      fixture.componentRef.setInput('messages', [
        {
          id: 'm-paths',
          role: 'assistant',
          timestamp: 1,
          streamingState: rootNode,
        },
      ]);
      fixture.detectChanges();

      const text = fixture.nativeElement.textContent;
      expect(text).toContain('index.ts');
      expect(text).toContain('output');
    });
  });

  describe('Live streaming from StreamingState', () => {
    it('builds feed from live streaming events including text, thinking, tools, and agents', () => {
      const state: StreamingState = createEmptyStreamingState();

      // Tool results
      const tool1Result: ToolResultEvent = {
        id: 'ev-res-1',
        eventType: 'tool_result',
        timestamp: 10,
        messageId: 'msg-live',
        toolCallId: 'call-1',
        isError: false,
        output: 'Done',
      };
      const tool2Result: ToolResultEvent = {
        id: 'ev-res-2',
        eventType: 'tool_result',
        timestamp: 20,
        messageId: 'msg-live',
        toolCallId: 'call-2',
        isError: true,
        output: 'Failed',
      };
      state.events.set(tool1Result.id, tool1Result);
      state.events.set(tool2Result.id, tool2Result);

      // Text delta
      const textDelta: TextDeltaEvent = {
        id: 'ev-text-1',
        eventType: 'text_delta',
        timestamp: 30,
        messageId: 'msg-live',
        blockIndex: 0,
        delta: 'Streaming prose chunk',
      };
      state.events.set(textDelta.id, textDelta);
      state.textAccumulators.set(
        AccumulatorKeys.textBlock('msg-live', 0),
        'Streaming prose chunk',
      );

      // Thinking start & delta
      const thinkingStart: ThinkingStartEvent = {
        id: 'ev-think-start',
        eventType: 'thinking_start',
        timestamp: 40,
        messageId: 'msg-live',
        blockIndex: 0,
      };
      const thinkingDelta: ThinkingDeltaEvent = {
        id: 'ev-think-delta',
        eventType: 'thinking_delta',
        timestamp: 41,
        messageId: 'msg-live',
        blockIndex: 0,
        delta: 'Live reasoning',
      };
      state.events.set(thinkingStart.id, thinkingStart);
      state.events.set(thinkingDelta.id, thinkingDelta);
      state.textAccumulators.set(
        AccumulatorKeys.thinkingBlock('msg-live', 0),
        'Live reasoning content',
      );

      // Task tool (should be skipped by tool_start)
      const taskTool: ToolStartEvent = {
        id: 'ev-task',
        eventType: 'tool_start',
        timestamp: 50,
        messageId: 'msg-live',
        toolCallId: 'call-task',
        toolName: 'Task',
        isTaskTool: true,
      };
      state.events.set(taskTool.id, taskTool);

      // Regular tool 1 (complete)
      const tool1: ToolStartEvent = {
        id: 'ev-tool-1',
        eventType: 'tool_start',
        timestamp: 60,
        messageId: 'msg-live',
        toolCallId: 'call-1',
        toolName: 'Read',
        isTaskTool: false,
        toolInput: { file_path: 'live.ts' },
      };
      state.events.set(tool1.id, tool1);

      // Regular tool 2 (error) with accumulated JSON
      const tool2: ToolStartEvent = {
        id: 'ev-tool-2',
        eventType: 'tool_start',
        timestamp: 70,
        messageId: 'msg-live',
        toolCallId: 'call-2',
        toolName: 'Write',
        isTaskTool: false,
      };
      state.events.set(tool2.id, tool2);
      state.toolInputAccumulators.set(
        AccumulatorKeys.toolInput('call-2'),
        JSON.stringify({ file_path: 'error.ts', content: 'bug' }),
      );

      // Tool 3 with invalid accumulated JSON (falls back safely)
      const tool3: ToolStartEvent = {
        id: 'ev-tool-3',
        eventType: 'tool_start',
        timestamp: 80,
        messageId: 'msg-live',
        toolCallId: 'call-3',
        toolName: 'Bash',
        isTaskTool: false,
        toolInput: { command: 'npm start' },
      };
      state.events.set(tool3.id, tool3);
      state.toolInputAccumulators.set(
        AccumulatorKeys.toolInput('call-3'),
        'INVALID_JSON{',
      );

      // Agent start with blocks map text
      const agentStart1: AgentStartEvent = {
        id: 'ev-agent-1',
        eventType: 'agent_start',
        timestamp: 90,
        messageId: 'msg-live',
        toolCallId: 'call-agent-1',
        agentType: 'architect',
        agentId: 'arch-id-1',
      };
      state.events.set(agentStart1.id, agentStart1);
      state.agentContentBlocksMap.set('arch-id-1', [
        { type: 'text', text: 'Architecture blueprint ready' },
      ]);

      // Agent start with summary accumulator text
      const agentStart2: AgentStartEvent = {
        id: 'ev-agent-2',
        eventType: 'agent_start',
        timestamp: 100,
        messageId: 'msg-live',
        toolCallId: 'call-agent-2',
        agentType: 'summarizer',
      };
      state.events.set(agentStart2.id, agentStart2);
      state.agentSummaryAccumulators.set(
        'call-agent-2',
        'Summary of operations',
      );

      fixture.componentRef.setInput('streamingState', state);
      fixture.detectChanges();

      const entries = fixture.componentInstance.feedEntries();
      expect(
        entries.some(
          (e) =>
            e.type === 'text' &&
            (e as { textContent?: string }).textContent ===
              'Streaming prose chunk',
        ),
      ).toBe(true);

      const text = fixture.nativeElement.textContent;
      expect(text).toContain('Thinking');
      expect(text).toContain('live.ts');
      expect(text).toContain('error.ts');
      expect(text).toContain('architect');
      expect(text).toContain('summarizer');
    });

    it('marks the latest block as streaming and pulses thinking header when isSessionStreaming is true', () => {
      const state: StreamingState = createEmptyStreamingState();

      const thinkingStart: ThinkingStartEvent = {
        id: 'ev-th-1',
        eventType: 'thinking_start',
        timestamp: 1,
        messageId: 'm-stream',
        blockIndex: 0,
      };
      state.events.set(thinkingStart.id, thinkingStart);
      state.textAccumulators.set(
        AccumulatorKeys.thinkingBlock('m-stream', 0),
        'Reasoning about tests',
      );

      fixture.componentRef.setInput('streamingState', state);
      fixture.componentRef.setInput('isSessionStreaming', true);
      fixture.detectChanges();

      expect(fixture.nativeElement.textContent).toContain('· reasoning…');

      // Click to expand thinking block
      const thinkingButton = fixture.debugElement.query(
        By.css('.thinking-terminal button'),
      );
      thinkingButton.nativeElement.click();
      fixture.detectChanges();

      const entries = fixture.componentInstance.feedEntries();
      expect((entries[0] as { textContent?: string }).textContent).toBe(
        'Reasoning about tests',
      );
      expect(
        fixture.debugElement.query(By.css('.thinking-terminal markdown')),
      ).not.toBeNull();
      expect(
        fixture.debugElement.query(By.css('ptah-typing-cursor')),
      ).not.toBeNull();

      // Click again to collapse
      thinkingButton.nativeElement.click();
      fixture.detectChanges();

      expect(
        fixture.debugElement.query(By.css('.thinking-terminal markdown')),
      ).toBeNull();
    });
  });

  describe('Interactive behaviors: Copy button, Permissions, and Questions', () => {
    it('copies text content to clipboard with feedback and resets after timeout', () => {
      jest.useFakeTimers();

      const rootNode: ExecutionNode = {
        id: 'root-copy',
        type: 'message',
        status: 'complete',
        content: null,
        children: [
          {
            id: 't-copy',
            type: 'text',
            status: 'complete',
            content: 'Copyable prose line',
            children: [],
          },
        ],
      };

      fixture.componentRef.setInput('messages', [
        {
          id: 'm-cp',
          role: 'assistant',
          timestamp: 1,
          streamingState: rootNode,
        },
      ]);
      fixture.detectChanges();

      const copyBtn = fixture.debugElement.query(
        By.css('button[title="Copy"]'),
      );
      expect(copyBtn).not.toBeNull();

      copyBtn.nativeElement.click();
      fixture.detectChanges();

      expect(copySpy).toHaveBeenCalledWith('Copyable prose line');
      expect(copyBtn.nativeElement.getAttribute('title')).toBe('Copied!');

      jest.advanceTimersByTime(2000);
      fixture.detectChanges();

      expect(copyBtn.nativeElement.getAttribute('title')).toBe('Copy');

      jest.useRealTimers();
    });

    it('does not set copied state when clipboard copy returns false', () => {
      copySpy.mockReturnValue(false);

      const rootNode: ExecutionNode = {
        id: 'root-fail',
        type: 'message',
        status: 'complete',
        content: null,
        children: [
          {
            id: 't-fail',
            type: 'text',
            status: 'complete',
            content: 'Uncopyable text',
            children: [],
          },
        ],
      };

      fixture.componentRef.setInput('messages', [
        {
          id: 'm-fail',
          role: 'assistant',
          timestamp: 1,
          streamingState: rootNode,
        },
      ]);
      fixture.detectChanges();

      const copyBtn = fixture.debugElement.query(
        By.css('button[title="Copy"]'),
      );
      copyBtn.nativeElement.click();
      fixture.detectChanges();

      expect(copyBtn.nativeElement.getAttribute('title')).toBe('Copy');
    });

    it('renders permission requests and forwards responded output', () => {
      const permissionReq: PermissionRequest = {
        id: 'perm-1',
        toolName: 'Bash',
        toolInput: { command: 'rm -rf /' },
        description: 'Dangerous shell execution',
        timestamp: Date.now(),
        timeoutAt: 0,
      };

      let emittedResponse: PermissionResponse | undefined;
      fixture.componentInstance.permissionResponded.subscribe((res) => {
        emittedResponse = res;
      });

      fixture.componentRef.setInput('permissionRequests', [permissionReq]);
      fixture.detectChanges();

      const card = fixture.debugElement.query(
        By.css('ptah-permission-request-card'),
      );
      expect(card).not.toBeNull();

      const expectedResponse: PermissionResponse = {
        id: 'perm-1',
        decision: 'allow',
      };
      card.componentInstance.responded.emit(expectedResponse);

      expect(emittedResponse).toEqual(expectedResponse);
    });

    it('renders user question requests and forwards answered output', () => {
      const questionReq: AskUserQuestionRequest = {
        id: 'q-1',
        toolName: 'AskUserQuestion',
        questions: [
          {
            header: 'Confirmation',
            question: 'Proceed with migration?',
            multiSelect: false,
            options: [
              { label: 'Yes', description: 'Run migration' },
              { label: 'No', description: 'Abort' },
            ],
          },
        ],
        timestamp: Date.now(),
        timeoutAt: 0,
      };

      let emittedAnswer: AskUserQuestionResponse | undefined;
      fixture.componentInstance.questionAnswered.subscribe((ans) => {
        emittedAnswer = ans;
      });

      fixture.componentRef.setInput('questionRequests', [questionReq]);
      fixture.detectChanges();

      const questionCard = fixture.debugElement.query(
        By.css('ptah-question-card'),
      );
      expect(questionCard).not.toBeNull();

      const expectedAnswer: AskUserQuestionResponse = {
        id: 'q-1',
        answers: { Confirmation: 'Yes' },
      };
      questionCard.componentInstance.answered.emit(expectedAnswer);

      expect(emittedAnswer).toEqual(expectedAnswer);
    });
  });
});
