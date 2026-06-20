import {
  ChangeDetectionStrategy,
  Component,
  Input,
  signal,
} from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { MarkdownBlockComponent } from '@ptah-extension/markdown';
import { TribunalSurfaceService } from '../services/tribunal-surface.service';
import { ExecutionTreeBuilderService } from '@ptah-extension/chat-streaming';
import { VerdictTileComponent } from './verdict-tile.component';

@Component({
  selector: 'ptah-markdown-block',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div data-testid="markdown-stub">{{ content }}</div>`,
})
class MarkdownBlockStubComponent {
  @Input() content!: string;
}

@Component({
  standalone: true,
  imports: [VerdictTileComponent],
  template: '<ptah-verdict-tile />',
})
class TestHostComponent {}

describe('VerdictTileComponent — parse-from-stream edge cases', () => {
  let streamingStateSig: ReturnType<
    typeof signal<{ events: Map<string, unknown> }>
  >;
  let mockTreeBuilder: jest.Mocked<
    Pick<ExecutionTreeBuilderService, 'buildTree'>
  >;

  function createTextNode(text: string) {
    return { type: 'text', content: text, children: [] };
  }

  function configure() {
    TestBed.configureTestingModule({
      imports: [TestHostComponent],
      providers: [
        {
          provide: TribunalSurfaceService,
          useValue: { streamingState: () => streamingStateSig() },
        },
        { provide: ExecutionTreeBuilderService, useValue: mockTreeBuilder },
      ],
    });

    TestBed.overrideComponent(VerdictTileComponent, {
      remove: { imports: [MarkdownBlockComponent] },
      add: { imports: [MarkdownBlockStubComponent] },
    });
  }

  beforeEach(() => {
    streamingStateSig = signal({ events: new Map() });
    mockTreeBuilder = {
      buildTree: jest.fn().mockReturnValue([]),
    };
  });

  it('renders loading state when streaming state has no events (no crash)', () => {
    configure();

    const fixture = TestBed.createComponent(TestHostComponent);
    expect(() => fixture.detectChanges()).not.toThrow();

    const host = fixture.debugElement.query(
      By.css('[data-testid="tribunal-verdict"]'),
    );
    expect(host).toBeTruthy();
    expect(host.query(By.css('.loading'))).toBeTruthy();
  });

  it('renders loading state when events exist but tree returns no text nodes (partial stream — no crash)', () => {
    configure();
    streamingStateSig.set({ events: new Map([['e1', {}]]) });
    mockTreeBuilder.buildTree.mockReturnValue([]);

    const fixture = TestBed.createComponent(TestHostComponent);
    expect(() => fixture.detectChanges()).not.toThrow();

    const host = fixture.debugElement.query(
      By.css('[data-testid="tribunal-verdict"]'),
    );
    expect(host.query(By.css('.loading'))).toBeTruthy();
  });

  it('does not throw when tree contains only non-text nodes (absent final assistant text)', () => {
    configure();
    streamingStateSig.set({ events: new Map([['e1', {}]]) });
    mockTreeBuilder.buildTree.mockReturnValue([
      { type: 'tool_use', content: '', children: [] } as unknown as ReturnType<
        ExecutionTreeBuilderService['buildTree']
      >[number],
    ]);

    const fixture = TestBed.createComponent(TestHostComponent);
    expect(() => fixture.detectChanges()).not.toThrow();

    expect(fixture.debugElement.query(By.css('.loading'))).toBeTruthy();
  });

  it('does not throw when tree contains deeply nested empty children', () => {
    configure();
    streamingStateSig.set({ events: new Map([['e1', {}]]) });
    mockTreeBuilder.buildTree.mockReturnValue([
      {
        type: 'tool_use',
        content: '',
        children: [{ type: 'tool_result', content: '', children: [] }],
      } as unknown as ReturnType<
        ExecutionTreeBuilderService['buildTree']
      >[number],
    ]);

    const fixture = TestBed.createComponent(TestHostComponent);
    expect(() => fixture.detectChanges()).not.toThrow();

    expect(fixture.debugElement.query(By.css('.loading'))).toBeTruthy();
  });

  it('hides loading and renders markdown stub when assistant text is present', () => {
    configure();
    streamingStateSig.set({ events: new Map([['e1', {}]]) });
    mockTreeBuilder.buildTree.mockReturnValue([
      createTextNode('The verdict is: Codex wins.') as unknown as ReturnType<
        ExecutionTreeBuilderService['buildTree']
      >[number],
    ]);

    const fixture = TestBed.createComponent(TestHostComponent);
    expect(() => fixture.detectChanges()).not.toThrow();

    expect(fixture.debugElement.query(By.css('.loading'))).toBeNull();
    expect(
      fixture.debugElement.query(By.css('[data-testid="markdown-stub"]')),
    ).toBeTruthy();
  });

  it('collects text from nested children and renders content without crashing', () => {
    configure();
    streamingStateSig.set({ events: new Map([['e1', {}]]) });
    mockTreeBuilder.buildTree.mockReturnValue([
      {
        type: 'tool_use',
        content: '',
        children: [createTextNode('Nested verdict text.')],
      } as unknown as ReturnType<
        ExecutionTreeBuilderService['buildTree']
      >[number],
    ]);

    const fixture = TestBed.createComponent(TestHostComponent);
    expect(() => fixture.detectChanges()).not.toThrow();

    expect(fixture.debugElement.query(By.css('.loading'))).toBeNull();
  });
});
