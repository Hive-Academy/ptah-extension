import {
  Component,
  Input,
  NgModule,
  ChangeDetectionStrategy,
} from '@angular/core';

jest.mock('ngx-markdown', () => {
  @Component({
    // eslint-disable-next-line @angular-eslint/component-selector
    selector: 'markdown',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `<div data-test="markdown-stub">{{ data }}</div>`,
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

import { TestBed } from '@angular/core/testing';
import { CompactionMarkerComponent } from './compaction-marker.component';

describe('CompactionMarkerComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CompactionMarkerComponent],
    }).compileComponents();
  });

  function setup(inputs: {
    summary?: string | null;
    preTokens?: number | null;
    postTokens?: number | null;
    durationMs?: number | null;
  }) {
    const fixture = TestBed.createComponent(CompactionMarkerComponent);
    fixture.componentRef.setInput('summary', inputs.summary ?? null);
    fixture.componentRef.setInput('preTokens', inputs.preTokens ?? null);
    fixture.componentRef.setInput('postTokens', inputs.postTokens ?? null);
    fixture.componentRef.setInput('durationMs', inputs.durationMs ?? null);
    fixture.detectChanges();
    return fixture;
  }

  it('always renders the "Context compacted" title', () => {
    const fixture = setup({});
    expect(fixture.nativeElement.textContent).toContain('Context compacted');
  });

  it('renders the token-reduction line only when both counts are present', () => {
    const fixture = setup({ preTokens: 5000, postTokens: 1200 });
    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('shrank');
    expect(text).toContain('5,000');
    expect(text).toContain('1,200');
  });

  it('omits the token line when only one count is present', () => {
    const fixture = setup({ preTokens: 5000, postTokens: null });
    expect(fixture.nativeElement.textContent).not.toContain('shrank');
  });

  it('appends duration only when durationMs is present', () => {
    const withDuration = setup({
      preTokens: 5000,
      postTokens: 1200,
      durationMs: 1500,
    });
    expect(withDuration.nativeElement.textContent).toContain('1.5s');

    const withoutDuration = setup({ preTokens: 5000, postTokens: 1200 });
    expect(withoutDuration.nativeElement.textContent).not.toContain(' in ');
  });

  it('renders the summary via MarkdownBlockComponent after expanding', () => {
    const fixture = setup({ summary: '## recap markdown' });
    expect(
      fixture.nativeElement.querySelector('[data-test="markdown-stub"]'),
    ).toBeNull();

    const toggle = fixture.nativeElement.querySelector('button');
    toggle.click();
    fixture.detectChanges();

    const stub = fixture.nativeElement.querySelector(
      '[data-test="markdown-stub"]',
    );
    expect(stub).not.toBeNull();
    expect(stub.textContent).toContain('## recap markdown');
  });

  it('renders tokens-only with no markdown block when summary is null', () => {
    const fixture = setup({
      summary: null,
      preTokens: 5000,
      postTokens: 1200,
    });
    expect(
      fixture.nativeElement.querySelector('ptah-expandable-content'),
    ).toBeNull();
    expect(
      fixture.nativeElement.querySelector('[data-test="markdown-stub"]'),
    ).toBeNull();
    expect(fixture.nativeElement.textContent).toContain('shrank');
  });
});
