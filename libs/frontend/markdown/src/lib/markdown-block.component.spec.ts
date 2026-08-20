import {
  Component,
  Input,
  NgModule,
  ChangeDetectionStrategy,
} from '@angular/core';

// Mock ngx-markdown BEFORE importing the component under test so the
// component picks up our stub `MarkdownModule`. We avoid pulling the real
// ESM bundle (and `marked`) into the Jest module graph.
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

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MarkdownBlockComponent } from './markdown-block.component';

describe('MarkdownBlockComponent', () => {
  let fixture: ComponentFixture<MarkdownBlockComponent>;
  let component: MarkdownBlockComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MarkdownBlockComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(MarkdownBlockComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('content', '# Hello world');
    fixture.detectChanges();
  });

  it('creates the component', () => {
    expect(component).toBeTruthy();
  });

  it('exposes the content input as a signal', () => {
    expect(component.content()).toBe('# Hello world');
  });

  it('renders the inner <markdown> element with prose classes', () => {
    const markdownEl = fixture.nativeElement.querySelector('markdown');
    expect(markdownEl).not.toBeNull();
    expect(markdownEl.classList.contains('prose')).toBe(true);
    expect(markdownEl.classList.contains('prose-sm')).toBe(true);
    expect(markdownEl.classList.contains('prose-invert')).toBe(true);
    expect(markdownEl.classList.contains('max-w-none')).toBe(true);
  });

  it('passes content through to the markdown stub via [data]', () => {
    const stub = fixture.nativeElement.querySelector(
      '[data-test="markdown-stub"]',
    );
    expect(stub?.textContent?.trim()).toBe('# Hello world');
  });

  it("defaults variant to 'invert' so no existing consumer moves", () => {
    expect(component.variant()).toBe('invert');
  });

  it("emits dark:prose-invert (not prose-invert) for variant 'auto'", () => {
    fixture.componentRef.setInput('variant', 'auto');
    fixture.detectChanges();

    const markdownEl = fixture.nativeElement.querySelector('markdown');
    // The hardcoded `prose-invert` is what breaks `operator-member-light`:
    // near-white body text on a near-white card (NFR-U5). `auto` must drop it.
    expect(markdownEl.classList.contains('prose-invert')).toBe(false);
    expect(markdownEl.classList.contains('dark:prose-invert')).toBe(true);
    expect(markdownEl.classList.contains('prose')).toBe(true);
  });

  it('updates when the content input changes', () => {
    fixture.componentRef.setInput('content', '## Updated');
    fixture.detectChanges();
    expect(component.content()).toBe('## Updated');
    const stub = fixture.nativeElement.querySelector(
      '[data-test="markdown-stub"]',
    );
    expect(stub?.textContent?.trim()).toBe('## Updated');
  });
});
