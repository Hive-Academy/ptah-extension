/**
 * ExecutionNodeComponent and MessageBubbleComponent — `ptah-ui` wiring behind
 * the Electron gate (TASK_2026_610, batch B6, component 10).
 *
 * Real `ngx-markdown` with the app's `'full'` preset, the real lazy
 * `@ptah-extension/chat-ui/ptah-ui` host and a real tab-scoped
 * `PtahUiLiveWindow`; only the agent bubble and the generic tool card are
 * stand-ins, so their recursions can be exercised without agent-monitor
 * stores.
 */
import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
  type TemplateRef,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import {
  DeferBlockBehavior,
  DeferBlockState,
  TestBed,
  type ComponentFixture,
} from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { provideSurfaceActiveTesting } from '@ptah-extension/core/testing';
import { VSCodeService } from '@ptah-extension/core';
import { provideMarkdownRendering } from '@ptah-extension/markdown';
import { PtahUiLiveWindow } from '@ptah-extension/chat-ui';
import {
  PtahUiBlockComponent,
  PtahUiMessageTextComponent,
} from '@ptah-extension/chat-ui/ptah-ui';
import { createExecutionChatMessage } from '@ptah-extension/shared';
import type {
  ExecutionChatMessage,
  ExecutionNode,
  PermissionRequest,
  PermissionResponse,
} from '@ptah-extension/shared';
import { ChatStore } from '../../../services/chat.store';
import { MessageBubbleComponent } from '../message-bubble.component';
import { ToolCallItemComponent } from '../../molecules/tool-execution/tool-call-item.component';
import {
  ExecutionNodeComponent,
  type PtahUiNodeContext,
} from './execution-node.component';
import { InlineAgentBubbleComponent } from './inline-agent-bubble.component';
import * as fenceLine from './ptah-ui-fence-line';

const BODY = 'title Release checklist\nstats\n  Reviewers | 2\n  Risk | low\n';
const VALID = 'Intro paragraph.\n\n```ptah-ui\n' + BODY + '```\n\nAfter.\n';
const INVALID = 'Intro.\n\n```ptah-ui\nnot a directive at all\n```\n';
const CONTEXT: PtahUiNodeContext = { messageId: 'msg-1', orderKey: 3 };

/** Agent bubble stand-in that renders its children through `nodeTemplate`, like the real one. */
@Component({
  selector: 'ptah-inline-agent-bubble',
  standalone: true,
  imports: [NgTemplateOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @for (child of node().children; track child.id) {
      <ng-container
        [ngTemplateOutlet]="nodeTemplate() ?? null"
        [ngTemplateOutletContext]="{ $implicit: child }"
      />
    }
  `,
})
class InlineAgentBubbleStubComponent {
  readonly node = input.required<ExecutionNode>();
  readonly getPermissionForTool = input<
    ((toolCallId: string) => PermissionRequest | null) | undefined
  >();
  readonly nodeTemplate = input<TemplateRef<unknown>>();
  readonly isFinalizing = input<boolean>(false);
  readonly permissionResponded = output<PermissionResponse>();
}

/** Generic tool card stand-in: always projects the nested children. */
@Component({
  selector: 'ptah-tool-call-item',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<ng-content />`,
})
class ToolCallItemStubComponent {
  readonly node = input.required<ExecutionNode>();
  readonly permission = input<PermissionRequest | undefined>();
  readonly permissionResponded = output<PermissionResponse>();
}

/**
 * The "feature absent" baseline: the execution-node template read from its
 * source with the two B6 additions cut out (the `ptahUiHost()` branch and the
 * `[ptahUi]` forward in the message recursion). Everything else is the
 * shipped template, so the comparison covers every anchor and binding. The
 * cut fails loudly if either addition is not found exactly once.
 */
function templateWithoutPtahUi(): string {
  const source = readFileSync(
    join(__dirname, 'execution-node.component.ts'),
    'utf8',
  );
  const open = 'template: `';
  const start = source.indexOf(open) + open.length;
  const end = source.search(/`,\r?\n {2}styles:/);
  const template = source.slice(start, end);
  const branch = '} @else if (ptahUiHost(); as host) {';
  const binding = '[ptahUi]="ptahUi()"';
  if (
    template.split(branch).length !== 2 ||
    template.split(binding).length !== 2
  ) {
    throw new Error(
      'execution-node template changed shape; update the B6 baseline cut',
    );
  }
  const branchStart = template.indexOf(branch);
  const branchEnd = template.indexOf('} @else {', branchStart);
  return (template.slice(0, branchStart) + template.slice(branchEnd)).replace(
    binding,
    '',
  );
}

function node(
  partial: Partial<ExecutionNode> & Pick<ExecutionNode, 'id' | 'type'>,
): ExecutionNode {
  return {
    status: 'complete',
    content: null,
    children: [],
    ...partial,
  } as ExecutionNode;
}

const text = (id: string, content: string): ExecutionNode =>
  node({ id, type: 'text', content });

const messageOf = (...children: ExecutionNode[]): ExecutionNode =>
  node({ id: 'root', type: 'message', children });

function assistant(content: string): ExecutionChatMessage {
  return createExecutionChatMessage({
    id: 'msg-1',
    role: 'assistant',
    rawContent: content,
    streamingState: messageOf(text('text-1', content)),
  });
}

/** Normalises only the per-component encapsulation ids, which depend on the template hash. */
const normalise = (html: string): string =>
  html.replace(/_ng(content|host)-[A-Za-z0-9-]+/g, '_ng$1-X');

interface Setup {
  readonly isElectron: boolean;
  readonly behavior?: DeferBlockBehavior;
  readonly preB6?: boolean;
}

function configure({ isElectron, behavior, preB6 }: Setup): void {
  const vscodeStub: Partial<VSCodeService> = {
    getPtahIconUri: () => 'data:image/svg+xml;base64,PHN2Zy8+',
    getPtahUserIconUri: () => 'data:image/svg+xml;base64,PHN2Zy8+',
  };
  Object.defineProperty(vscodeStub, 'isElectron', { get: () => isElectron });
  const chatStoreStub: Partial<ChatStore> = {
    getPermissionForTool: () => null,
    handlePermissionResponse: jest.fn(),
  };
  TestBed.configureTestingModule({
    imports: [MessageBubbleComponent, ExecutionNodeComponent],
    providers: [
      provideMarkdownRendering({ extensions: 'full' }),
      provideSurfaceActiveTesting(),
      PtahUiLiveWindow,
      { provide: VSCodeService, useValue: vscodeStub },
      { provide: ChatStore, useValue: chatStoreStub },
    ],
    deferBlockBehavior: behavior ?? DeferBlockBehavior.Playthrough,
  });
  TestBed.overrideComponent(ExecutionNodeComponent, {
    remove: { imports: [InlineAgentBubbleComponent, ToolCallItemComponent] },
    add: {
      imports: [InlineAgentBubbleStubComponent, ToolCallItemStubComponent],
    },
  });
  if (preB6) {
    TestBed.overrideComponent(ExecutionNodeComponent, {
      set: { template: templateWithoutPtahUi() },
    });
  }
}

/**
 * Two rounds: the deferred host mounts after the first, and its `<markdown>`
 * parts render asynchronously after the second.
 */
async function settle<T>(fixture: ComponentFixture<T>): Promise<void> {
  for (let round = 0; round < 2; round += 1) {
    fixture.detectChanges();
    await fixture.whenStable();
  }
  fixture.detectChanges();
}

async function renderBubble(
  message: ExecutionChatMessage,
): Promise<ComponentFixture<MessageBubbleComponent>> {
  const fixture = TestBed.createComponent(MessageBubbleComponent);
  fixture.componentRef.setInput('message', message);
  await settle(fixture);
  return fixture;
}

async function renderNode(
  root: ExecutionNode,
  ptahUi: PtahUiNodeContext | null = CONTEXT,
): Promise<ComponentFixture<ExecutionNodeComponent>> {
  const fixture = TestBed.createComponent(ExecutionNodeComponent);
  fixture.componentRef.setInput('node', root);
  fixture.componentRef.setInput('ptahUi', ptahUi);
  await settle(fixture);
  return fixture;
}

const el = (fixture: ComponentFixture<unknown>): HTMLElement =>
  fixture.nativeElement as HTMLElement;
const blockCount = (fixture: ComponentFixture<unknown>): number =>
  fixture.debugElement.queryAll(By.directive(PtahUiBlockComponent)).length;
const hostCount = (fixture: ComponentFixture<unknown>): number =>
  fixture.debugElement.queryAll(By.directive(PtahUiMessageTextComponent))
    .length;

/** Asserts the subtree rendered the fence as an ordinary code block and loaded nothing. */
async function expectOrdinaryCode(
  fixture: ComponentFixture<unknown>,
  fenceText: string,
): Promise<void> {
  expect(await fixture.getDeferBlocks()).toHaveLength(0);
  expect(hostCount(fixture)).toBe(0);
  expect(blockCount(fixture)).toBe(0);
  expect(el(fixture).querySelector('ptah-surface-renderer')).toBeNull();
  expect(el(fixture).querySelector('[data-ptah-ui-reason]')).toBeNull();
  const code = [...el(fixture).querySelectorAll('code')].map(
    (c) => c.textContent ?? '',
  );
  expect(code.some((c) => c.includes(fenceText))).toBe(true);
}

/** Counts fence scans; wraps the real function, so behaviour is unchanged. */
let fenceScan: jest.SpyInstance<boolean, [string]>;

beforeEach(() => {
  fenceScan = jest.spyOn(fenceLine, 'hasPtahUiFenceLine');
});

afterEach(() => {
  TestBed.resetTestingModule();
  fenceScan.mockRestore();
});

describe('hasPtahUiFenceLine', () => {
  it.each([
    ['```ptah-ui\n', true],
    ['intro\n```ptah-ui   \r\nbody', true],
    ['intro\n```ptah-ui', true],
    ['  ```ptah-ui\n', false],
    ['```ptah-ui-x\n', false],
    ['```ptah-ui x\n', false],
    ['text ```ptah-ui\n', false],
    ['<ptah-ui-block raw="```ptah-ui"></ptah-ui-block>', false],
    ['', false],
  ])('%j -> %s', (input, expected) => {
    expect(fenceLine.hasPtahUiFenceLine(input)).toBe(expected);
  });
});

describe('MessageBubbleComponent + ExecutionNodeComponent — ptah-ui on Electron', () => {
  beforeEach(() => configure({ isElectron: true }));

  it('renders a valid fence as a block in place, between its markdown parts', async () => {
    const fixture = await renderBubble(assistant(VALID));

    expect(fenceScan).toHaveBeenCalled();
    expect(hostCount(fixture)).toBe(1);
    expect(blockCount(fixture)).toBe(1);
    expect(el(fixture).querySelector('ptah-surface-renderer')).not.toBeNull();
    expect(el(fixture).querySelector('[data-ptah-ui-reason]')).toBeNull();
    const host = fixture.debugElement.query(
      By.directive(PtahUiMessageTextComponent),
    ).componentInstance as PtahUiMessageTextComponent;
    expect(host.messageId()).toBe('msg-1');
    expect(host.nodeId()).toBe('text-1');
    expect(el(fixture).textContent).toContain('Intro paragraph.');
    expect(el(fixture).textContent).toContain('After.');
  });

  it('renders an invalid fence as the code fallback with its reason line outside the code', async () => {
    const fixture = await renderBubble(assistant(INVALID));

    expect(blockCount(fixture)).toBe(1);
    expect(el(fixture).querySelector('ptah-surface-renderer')).toBeNull();
    const reason = el(fixture).querySelector('[data-ptah-ui-reason]');
    expect(reason?.textContent?.trim()).toMatch(/^Not rendered: \S/);
    expect(reason?.closest('code, markdown')).toBeNull();
    expect(el(fixture).querySelector('markdown code')?.textContent).toContain(
      'not a directive at all',
    );
  });

  it('builds no context for a user message: its fence stays code', async () => {
    const fixture = await renderBubble(
      createExecutionChatMessage({ id: 'u1', role: 'user', rawContent: VALID }),
    );

    await expectOrdinaryCode(fixture, 'Reviewers | 2');
    expect(fenceScan).not.toHaveBeenCalled();
  });

  it('keeps subagent text as code: the agent recursion does not forward the context', async () => {
    const fixture = await renderNode(
      messageOf(
        node({
          id: 'agent-1',
          type: 'agent',
          children: [messageOf(text('sub-text', VALID))],
        }),
      ),
    );

    await expectOrdinaryCode(fixture, 'Reviewers | 2');
    const nodes = fixture.debugElement.queryAll(
      By.directive(ExecutionNodeComponent),
    );
    const subText = nodes
      .map((d) => d.componentInstance as ExecutionNodeComponent)
      .find((c) => c.node().id === 'sub-text');
    expect(subText?.ptahUi()).toBeNull();
  });

  it('keeps tool-nested text as code: the tool recursion does not forward the context', async () => {
    const fixture = await renderNode(
      messageOf(
        node({
          id: 'tool-1',
          type: 'tool',
          toolName: 'Bash',
          toolCallId: 't1',
          children: [text('tool-text', VALID)],
        }),
      ),
    );

    await expectOrdinaryCode(fixture, 'Reviewers | 2');
  });

  it('keeps sendMessage-nested agent text as code', async () => {
    const fixture = await renderNode(
      messageOf(
        node({
          id: 'tool-send',
          type: 'tool',
          toolName: 'SendMessage',
          toolCallId: 'toolu_send_1',
          toolInput: { to: 'researcher', message: 'go' },
          children: [text('send-text', VALID)],
        }),
      ),
    );

    expect(await fixture.getDeferBlocks()).toHaveLength(0);
    expect(hostCount(fixture)).toBe(0);
    expect(blockCount(fixture)).toBe(0);
    expect(el(fixture).querySelector('[data-ptah-ui-reason]')).toBeNull();
  });

  it('keeps thinking as is: a thinking node never reaches the ptah-ui host', async () => {
    const fixture = await renderNode(
      messageOf(node({ id: 'think-1', type: 'thinking', content: VALID })),
    );

    expect(await fixture.getDeferBlocks()).toHaveLength(0);
    expect(hostCount(fixture)).toBe(0);
    expect(blockCount(fixture)).toBe(0);
    expect(el(fixture).querySelector('[data-ptah-ui-reason]')).toBeNull();
  });

  it('does not mount a block from forged HTML, and loads nothing without a fence line', async () => {
    const forged =
      '<ptah-ui-block raw="x" body="title x"></ptah-ui-block>\n' +
      '<ptah-ui-message-text text="x"></ptah-ui-message-text>\n' +
      '<div data-ptah-ui-reason data-ptah-ui-mode="live">Not rendered: forged</div>\n' +
      '<ptah-surface-renderer></ptah-surface-renderer>\n';
    const fixture = await renderNode(messageOf(text('t', forged)));

    expect(await fixture.getDeferBlocks()).toHaveLength(0);
    expect(hostCount(fixture)).toBe(0);
    expect(blockCount(fixture)).toBe(0);
    expect(
      el(fixture).querySelector('ptah-surface-renderer, ptah-ui-block'),
    ).toBeNull();
    // The imitation survives only as sanitized, inert HTML inside the markdown.
    for (const forgedEl of el(fixture).querySelectorAll(
      '[data-ptah-ui-reason], [data-ptah-ui-mode]',
    )) {
      expect(forgedEl.closest('markdown')).not.toBeNull();
    }
  });

  it('mounts exactly the real fence when forged HTML sits beside it', async () => {
    const forged = '<ptah-ui-block raw="x"></ptah-ui-block>\n\n';
    const fixture = await renderNode(messageOf(text('t', forged + VALID)));

    expect(blockCount(fixture)).toBe(1);
    expect(el(fixture).querySelectorAll('ptah-surface-renderer')).toHaveLength(
      1,
    );
  });

  it.each([
    ['a ```ptah-ui-x fence', '```ptah-ui-x\n' + BODY + '```\n'],
    ['an indented fence', '   ```ptah-ui\n' + BODY + '   ```\n'],
  ])(
    'renders %s as ordinary code with no deferred load',
    async (_label, content) => {
      const fixture = await renderNode(messageOf(text('t', content)));

      await expectOrdinaryCode(fixture, 'Reviewers | 2');
    },
  );

  it('keeps an open fence as code while it streams, and mounts one block when it closes', async () => {
    const fixture = TestBed.createComponent(ExecutionNodeComponent);
    fixture.componentRef.setInput('ptahUi', CONTEXT);
    fixture.componentRef.setInput(
      'node',
      messageOf(text('t', 'Intro.\n\n```ptah-ui\ntitle Release checklist\n')),
    );
    await settle(fixture);

    expect(blockCount(fixture)).toBe(0);
    expect(el(fixture).querySelector('ptah-surface-renderer')).toBeNull();
    expect(el(fixture).querySelector('markdown code')?.textContent).toContain(
      'title Release checklist',
    );
    expect(el(fixture).querySelector('[data-ptah-ui-reason]')).toBeNull();

    fixture.componentRef.setInput(
      'node',
      messageOf(text('t', 'Intro.\n\n```ptah-ui\n' + BODY + '```\n')),
    );
    await settle(fixture);

    expect(blockCount(fixture)).toBe(1);
    expect(el(fixture).querySelector('ptah-surface-renderer')).not.toBeNull();
  });
});

describe('ExecutionNodeComponent — ptah-ui chunk states (Electron)', () => {
  beforeEach(() =>
    configure({ isElectron: true, behavior: DeferBlockBehavior.Manual }),
  );

  /** Today's markdown for `content`, rendered with no context. */
  async function plainMarkdownHtml(content: string): Promise<string> {
    const plain = await renderNode(messageOf(text('t', content)), null);
    return normalise(el(plain).querySelector('markdown')?.innerHTML ?? '');
  }

  it.each([
    ['a chunk-load failure (@error)', DeferBlockState.Error],
    ['the placeholder before the chunk loads', DeferBlockState.Placeholder],
  ])('renders today markdown for %s', async (_label, state) => {
    const expected = await plainMarkdownHtml(VALID);
    const fixture = await renderNode(messageOf(text('t', VALID)));
    const [block] = await fixture.getDeferBlocks();
    await block.render(state);
    await settle(fixture);

    expect(hostCount(fixture)).toBe(0);
    expect(blockCount(fixture)).toBe(0);
    expect(el(fixture).querySelector('[data-ptah-ui-reason]')).toBeNull();
    const markdown = el(fixture).querySelectorAll('markdown');
    expect(markdown).toHaveLength(1);
    expect(normalise(markdown[0].innerHTML)).toBe(expected);
    expect(markdown[0].querySelector('code')?.textContent).toContain(
      'Reviewers | 2',
    );
  });
});

describe('MessageBubbleComponent + ExecutionNodeComponent — VS Code regression', () => {
  interface Rendered {
    /** Whole bubble, encapsulation ids normalised. */
    readonly bubble: string;
    /** Every text-branch wrapper (`.exec-text-branch`) outerHTML, encapsulation ids normalised. */
    readonly textBranches: readonly string[];
  }

  async function renderHtml(
    setup: Setup,
    message: ExecutionChatMessage,
  ): Promise<Rendered> {
    configure(setup);
    const fixture = await renderBubble(message);
    const rendered: Rendered = {
      bubble: normalise(el(fixture).innerHTML),
      textBranches: [...el(fixture).querySelectorAll('.exec-text-branch')].map(
        (branch) => normalise(branch.outerHTML),
      ),
    };
    TestBed.resetTestingModule();
    return rendered;
  }

  /**
   * Angular's empty `<!--container-->` anchors: one per control-flow branch
   * template, never rendered, not in the accessibility tree, the text or a
   * copy. The `ptahUiHost()` branch adds one such anchor to a text node; the
   * repo's own snapshot serializers drop comments for the same reason.
   */
  const withoutAnchors = (html: string): string =>
    html.replace(/<!--container-->/g, '');

  it.each([
    ['a valid fence', VALID],
    ['an invalid fence', INVALID],
    ['an open fence', 'Intro.\n\n```ptah-ui\ntitle x\n'],
  ])(
    'renders %s identical to the template without the feature',
    async (_label, content) => {
      // One message object, so the header timestamp is the same in both renders.
      const message = assistant(content);
      const withFeature = await renderHtml({ isElectron: false }, message);
      const withoutFeature = await renderHtml(
        { isElectron: false, preB6: true },
        message,
      );

      // The text render itself: byte-identical, comments included.
      expect(withFeature.textBranches).toHaveLength(1);
      expect(withFeature.textBranches).toEqual(withoutFeature.textBranches);
      // The whole bubble: byte-identical apart from Angular's empty anchors.
      expect(withoutAnchors(withFeature.bubble)).toBe(
        withoutAnchors(withoutFeature.bubble),
      );
      expect(withFeature.bubble).toContain('language-ptah-ui');
      expect(withFeature.bubble).not.toContain('data-ptah-ui-');
      expect(withFeature.bubble).not.toMatch(
        /<ptah-ui-|<ptah-surface-renderer/,
      );
    },
  );

  it('builds no context, never scans the text and requests no deferred dependency', async () => {
    configure({ isElectron: false });
    const fixture = await renderBubble(assistant(VALID));

    await expectOrdinaryCode(fixture, 'Reviewers | 2');
    expect(fenceScan).not.toHaveBeenCalled();
    const nodes = fixture.debugElement
      .queryAll(By.directive(ExecutionNodeComponent))
      .map((d) => d.componentInstance as ExecutionNodeComponent);
    expect(nodes.length).toBeGreaterThan(0);
    expect(nodes.every((n) => n.ptahUi() === null)).toBe(true);
  });
});
