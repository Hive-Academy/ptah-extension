import {
  ChangeDetectionStrategy,
  Component,
  Input,
  NgModule,
  signal,
} from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ChatTranscriptComponent } from './chat-transcript.component';
import {
  configureTranscriptTestBed,
  FakeIntersectionObserver,
  installFakeIntersectionObserver,
  installFakeResizeObserver,
  removeFakeIntersectionObserver,
  removeFakeResizeObserver,
} from './testing/transcript-spec-harness';

jest.mock('ngx-markdown', () => {
  @Component({
    // eslint-disable-next-line @angular-eslint/component-selector
    selector: 'markdown',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: '',
  })
  class MarkdownStubComponent {
    @Input() data: string | null | undefined = '';
  }
  @NgModule({
    imports: [MarkdownStubComponent],
    exports: [MarkdownStubComponent],
  })
  class MarkdownModule {}
  return {
    MarkdownModule,
    MarkdownComponent: MarkdownStubComponent,
    provideMarkdown: () => [],
    MARKED_OPTIONS: 'MARKED_OPTIONS',
    CLIPBOARD_OPTIONS: 'CLIPBOARD_OPTIONS',
    MARKED_EXTENSIONS: 'MARKED_EXTENSIONS',
    MERMAID_OPTIONS: 'MERMAID_OPTIONS',
    SANITIZE: 'SANITIZE',
  };
});

function makeHarness(withObserver = true) {
  if (withObserver) {
    installFakeIntersectionObserver();
  } else {
    removeFakeIntersectionObserver();
  }
  installFakeResizeObserver();

  const tabs = signal([
    {
      id: 'tab-1',
      status: 'loaded',
      messages: [],
      streamingState: null,
    },
  ]);
  configureTranscriptTestBed({
    tabs,
    buildTree: () => [],
    iconUri: 'data:image/svg+xml;base64,PHN2Zy8+',
  });

  const fixture = TestBed.createComponent(ChatTranscriptComponent);
  fixture.componentRef.setInput('tabId', 'tab-1');
  fixture.componentRef.setInput('active', true);
  fixture.componentRef.setInput('hasOlderHistory', true);
  fixture.detectChanges();

  const root = fixture.nativeElement.querySelector(
    '.chat-scroll-container',
  ) as HTMLElement;
  Object.defineProperty(root, 'clientHeight', {
    configurable: true,
    value: 200,
  });
  Object.defineProperty(root, 'scrollHeight', {
    configurable: true,
    value: 1000,
  });
  return { fixture, root };
}

describe('ChatTranscriptComponent older-history affordance', () => {
  afterEach(() => {
    removeFakeIntersectionObserver();
    removeFakeResizeObserver();
    TestBed.resetTestingModule();
  });

  it('shows the button only when older history exists and replay is idle', () => {
    const h = makeHarness(false);
    expect(
      h.fixture.nativeElement.querySelector('button')?.textContent,
    ).toContain('Load earlier messages');

    h.fixture.componentRef.setInput('historyReplaying', true);
    h.fixture.detectChanges();
    expect(h.fixture.nativeElement.querySelector('button')).toBeNull();

    h.fixture.componentRef.setInput('historyReplaying', false);
    h.fixture.componentRef.setInput('hasOlderHistory', false);
    h.fixture.detectChanges();
    expect(h.fixture.nativeElement.querySelector('button')).toBeNull();
  });

  it('catches up older-history availability when an inactive transcript reactivates', () => {
    const h = makeHarness(false);
    h.fixture.componentRef.setInput('hasOlderHistory', false);
    h.fixture.detectChanges();
    h.fixture.componentRef.setInput('active', false);
    h.fixture.detectChanges();

    h.fixture.componentRef.setInput('hasOlderHistory', true);
    h.fixture.detectChanges();
    expect(h.fixture.nativeElement.querySelector('button')).toBeNull();

    h.fixture.componentRef.setInput('active', true);
    h.fixture.detectChanges();
    expect(
      h.fixture.nativeElement.querySelector('button')?.textContent,
    ).toContain('Load earlier messages');
  });

  it('keeps the button operable without IntersectionObserver and disables it while loading', () => {
    const h = makeHarness(false);
    const requested = jest.fn();
    h.fixture.componentInstance.olderHistoryRequested.subscribe(requested);

    (
      h.fixture.nativeElement.querySelector('button') as HTMLButtonElement
    ).click();
    expect(requested).toHaveBeenCalledTimes(1);

    h.fixture.componentRef.setInput('olderHistoryLoading', true);
    h.fixture.detectChanges();
    const button = h.fixture.nativeElement.querySelector(
      'button',
    ) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.getAttribute('aria-busy')).toBe('true');
  });

  it('auto-loads only after an upward scroll and only once per arm', () => {
    const h = makeHarness();
    const requested = jest.fn();
    h.fixture.componentInstance.olderHistoryRequested.subscribe(requested);
    const sentinel = (
      h.fixture.nativeElement.querySelector('button') as HTMLButtonElement
    ).parentElement as HTMLElement;
    const observer = FakeIntersectionObserver.instances.find((candidate) =>
      candidate.observed.has(sentinel),
    ) as FakeIntersectionObserver;

    observer.emit(sentinel, true);
    expect(requested).not.toHaveBeenCalled();

    h.root.scrollTop = 500;
    h.root.dispatchEvent(new Event('scroll'));
    expect(requested).not.toHaveBeenCalled();

    h.root.scrollTop = 400;
    h.root.dispatchEvent(new Event('scroll'));
    expect(requested).toHaveBeenCalledTimes(1);

    observer.emit(sentinel, true);
    h.root.scrollTop = 450;
    h.root.dispatchEvent(new Event('scroll'));
    expect(requested).toHaveBeenCalledTimes(1);

    h.root.scrollTop = 350;
    h.root.dispatchEvent(new Event('scroll'));
    expect(requested).toHaveBeenCalledTimes(2);
  });

  it('does not auto-load while disabled or when the transcript is not scrollable', () => {
    const h = makeHarness();
    const requested = jest.fn();
    h.fixture.componentInstance.olderHistoryRequested.subscribe(requested);
    const sentinel = (
      h.fixture.nativeElement.querySelector('button') as HTMLButtonElement
    ).parentElement as HTMLElement;
    const observer = FakeIntersectionObserver.instances.find((candidate) =>
      candidate.observed.has(sentinel),
    ) as FakeIntersectionObserver;
    observer.emit(sentinel, true);

    h.fixture.componentRef.setInput('olderHistoryLoading', true);
    h.fixture.detectChanges();
    h.root.scrollTop = 500;
    h.root.dispatchEvent(new Event('scroll'));
    h.root.scrollTop = 400;
    h.root.dispatchEvent(new Event('scroll'));
    expect(requested).not.toHaveBeenCalled();

    h.fixture.componentRef.setInput('olderHistoryLoading', false);
    h.fixture.detectChanges();
    Object.defineProperty(h.root, 'scrollHeight', {
      configurable: true,
      value: 200,
    });
    h.root.scrollTop = 300;
    h.root.dispatchEvent(new Event('scroll'));
    expect(requested).not.toHaveBeenCalled();
  });

  it('disconnects its observer on destroy', () => {
    const h = makeHarness();
    const sentinel = (
      h.fixture.nativeElement.querySelector('button') as HTMLButtonElement
    ).parentElement as HTMLElement;
    const observer = FakeIntersectionObserver.instances.find((candidate) =>
      candidate.observed.has(sentinel),
    ) as FakeIntersectionObserver;
    expect(observer.observed.size).toBe(1);
    h.fixture.destroy();
    expect(observer.observed.size).toBe(0);
  });
});
