import { ApplicationRef, ChangeDetectionStrategy, Component, NgModule, input, signal } from '@angular/core';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

jest.mock('ngx-markdown', () => {
  // eslint-disable-next-line @angular-eslint/component-selector
  @Component({ selector: 'markdown', standalone: true, template: '' })
  class MarkdownStubComponent { readonly data = input<string | null>(''); }
  @NgModule({ imports: [MarkdownStubComponent], exports: [MarkdownStubComponent] })
  class MarkdownModule {}
  return {
    MarkdownModule, MarkdownComponent: MarkdownStubComponent, provideMarkdown: () => [],
    MARKED_OPTIONS: 'MARKED_OPTIONS', CLIPBOARD_OPTIONS: 'CLIPBOARD_OPTIONS',
    MARKED_EXTENSIONS: 'MARKED_EXTENSIONS', MERMAID_OPTIONS: 'MERMAID_OPTIONS', SANITIZE: 'SANITIZE',
  };
});

import { TestBed } from '@angular/core/testing';
import type { ExecutionChatMessage } from '@ptah-extension/shared';
import { ChatTranscriptComponent } from './chat-transcript.component';
import { configureTranscriptTestBed } from './testing/transcript-spec-harness';

interface Tab {
  id: string;
  claudeSessionId: string;
  status: 'loaded' | 'streaming';
  messages: readonly ExecutionChatMessage[];
  streamingState: null;
}

@Component({
  standalone: true,
  imports: [ChatTranscriptComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @for (id of ids; track id) {
      <ptah-chat-transcript [tabId]="id" [active]="selected() === id"
        [entering]="entering() === id" />
    }
  `,
})
class HostComponent {
  readonly ids = ['A', 'B'];
  readonly selected = signal('A');
  readonly entering = signal<string | null>(null);
}

const messages = (prefix: string, count: number): ExecutionChatMessage[] =>
  Array.from({ length: count }, (_, index) => ({
    id: `${prefix}-${index}`, role: 'assistant', rawContent: `reply ${index}`,
    timestamp: index + 1, streamingState: null,
  } as ExecutionChatMessage));

describe('ChatTranscriptComponent session pane entrance', () => {
  const tabs = signal<Tab[]>([]);

  beforeEach(() => {
    tabs.set([
      { id: 'A', claudeSessionId: 'session-A', status: 'loaded', messages: messages('A', 2), streamingState: null },
      { id: 'B', claudeSessionId: 'session-B', status: 'streaming', messages: messages('B', 2), streamingState: null },
    ]);
    configureTranscriptTestBed({ tabs, buildTree: jest.fn(() => []) });
    TestBed.configureTestingModule({ imports: [HostComponent] });
  });

  afterEach(() => TestBed.resetTestingModule());

  function setup() {
    const fixture = TestBed.createComponent(HostComponent);
    const tick = () => { fixture.detectChanges(); TestBed.inject(ApplicationRef).tick(); };
    const scroller = (id: string) => fixture.nativeElement.querySelector(
      `[data-ptah-tab-id="${id}"] .chat-scroll-container`,
    ) as HTMLElement;
    tick();
    return { fixture, tick, scroller };
  }

  it('marks only the active transcript pane on a session switch', () => {
    const h = setup();
    const pane = h.scroller('B');
    expect(h.scroller('A').classList.contains('ptah-pane-switch-enter')).toBe(false);
    expect(pane.classList.contains('ptah-pane-switch-enter')).toBe(false);
    h.fixture.componentInstance.selected.set('B');
    h.fixture.componentInstance.entering.set('B');
    h.tick();
    expect(h.scroller('B')).toBe(pane);
    expect(pane.classList.contains('ptah-pane-switch-enter')).toBe(true);
    expect(h.scroller('A').classList.contains('ptah-pane-switch-enter')).toBe(false);
    expect(h.fixture.nativeElement.querySelector('.ptah-turn-enter, [data-enter-i]')).toBeNull();
  });

  it('keeps the same pane entrance while streaming messages arrive', () => {
    const h = setup();
    h.fixture.componentInstance.selected.set('B');
    h.fixture.componentInstance.entering.set('B');
    h.tick();
    const pane = h.scroller('B');
    tabs.set(tabs().map(tab => tab.id === 'B' ? { ...tab, messages: messages('B', 3) } : tab));
    h.tick();
    expect(h.scroller('B')).toBe(pane);
    expect(pane.classList.contains('ptah-pane-switch-enter')).toBe(true);
    expect(h.fixture.nativeElement.querySelector('.ptah-turn-enter, [data-enter-i]')).toBeNull();
  });

  it('removes the pane class at the end of the entering window and rearms on return', () => {
    const h = setup();
    h.fixture.componentInstance.selected.set('B');
    h.fixture.componentInstance.entering.set('B');
    h.tick();
    h.fixture.componentInstance.entering.set(null);
    h.tick();
    expect(h.scroller('B').classList.contains('ptah-pane-switch-enter')).toBe(false);
    h.fixture.componentInstance.selected.set('A');
    h.fixture.componentInstance.entering.set('A');
    h.tick();
    expect(h.scroller('A').classList.contains('ptah-pane-switch-enter')).toBe(true);
  });

  it('disables the pane animation under reduced motion', () => {
    const css = readFileSync(join(__dirname, 'chat-transcript.component.css'), 'utf8');
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.ptah-pane-switch-enter,[\s\S]*?animation-duration: 0\.01ms;\s*animation-delay: 0s;/);
    expect(css).toMatch(/:host\(\.ptah-pane-switch-leave\)\s*\{\s*display: none;/);
  });
});
