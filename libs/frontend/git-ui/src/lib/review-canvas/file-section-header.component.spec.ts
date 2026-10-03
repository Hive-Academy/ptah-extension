import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import {
  FileSectionHeaderComponent,
  type FileSectionHeaderFile,
} from './file-section-header.component';

const LONG_PATH =
  'libs/frontend/git-ui/src/lib/review-canvas/a/very/deep/folder/structure/file-section-header.component.ts';

describe('FileSectionHeaderComponent (layout, V-6)', () => {
  let fixture: ComponentFixture<FileSectionHeaderComponent>;

  function render(file: Partial<FileSectionHeaderFile> = {}): HTMLElement {
    fixture = TestBed.createComponent(FileSectionHeaderComponent);
    fixture.componentRef.setInput('file', {
      path: LONG_PATH,
      status: 'M',
      comparison: 'worktree',
      ...file,
    } satisfies FileSectionHeaderFile);
    fixture.componentRef.setInput('bodyId', 'body-1');
    fixture.componentRef.setInput('totals', { additions: 4, deletions: 0 });
    fixture.componentRef.setInput('canComment', true);
    fixture.componentRef.setInput('canEdit', true);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  function byTestId(host: HTMLElement, id: string): HTMLElement | null {
    return host.querySelector<HTMLElement>(`[data-testid="${id}"]`);
  }

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [FileSectionHeaderComponent] });
  });

  afterEach(() => fixture.destroy());

  it('stays one row: the path truncates from the left, its title keeps the full path', () => {
    const host = render();
    expect(host.classList).toContain('flex-nowrap');
    expect(host.classList).not.toContain('flex-wrap');

    const path = byTestId(host, 'file-section-path');
    expect(path?.getAttribute('title')).toBe(LONG_PATH);
    expect(path?.getAttribute('dir')).toBe('rtl');
    expect(path?.querySelector('bdi')?.getAttribute('dir')).toBe('ltr');
    expect(path?.classList).toContain('truncate');
    expect(path?.classList).toContain('min-w-0');
    expect(path?.textContent?.trim()).toBe(LONG_PATH);
  });

  it('never lets the badges or the actions shrink or wrap', () => {
    const host = render({ originalPath: 'old/name.ts' });
    expect(byTestId(host, 'file-section-side')?.classList).toContain(
      'shrink-0',
    );
    const actions = byTestId(host, 'file-section-totals')?.parentElement;
    expect(actions?.classList).toContain('shrink-0');
    expect(byTestId(host, 'file-section-renamed')?.getAttribute('title')).toBe(
      'renamed from old/name.ts',
    );
  });

  it('folds a populated chip list into one bounded summary chip at narrow widths (round 2)', () => {
    fixture = TestBed.createComponent(FileSectionHeaderComponent);
    fixture.componentRef.setInput('file', {
      path: LONG_PATH,
      status: 'A',
      comparison: 'worktree',
    } satisfies FileSectionHeaderFile);
    fixture.componentRef.setInput('bodyId', 'body-1');
    fixture.componentRef.setInput('collapsed', true);
    fixture.componentRef.setInput('chips', [
      '3 hunks',
      'new',
      'comment in progress',
    ]);
    fixture.componentRef.setInput('canComment', true);
    fixture.componentRef.setInput('canEdit', true);
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;

    const chips = host.querySelectorAll('[data-testid="file-chip"]');
    expect(chips).toHaveLength(3);
    chips.forEach((chip) => expect(chip.classList).toContain('fsh-chip'));
    const summary = byTestId(host, 'file-chip-summary');
    expect(summary?.textContent?.trim()).toBe('+3');
    expect(summary?.classList).toContain('fsh-chip-summary');
    expect(summary?.getAttribute('aria-label')).toBe(
      'File details: 3 hunks, new, comment in progress',
    );
    expect(summary?.getAttribute('title')).toBe(
      'File details: 3 hunks, new, comment in progress',
    );
    expect(byTestId(host, 'file-section-side')?.getAttribute('title')).toBe(
      'Working tree',
    );

    const source = readFileSync(
      join(__dirname, 'file-section-header.component.ts'),
      'utf8',
    );
    const css = source.slice(source.indexOf('styles: ['));
    // Wide: the summary is hidden. Narrow: chips hide, the summary shows.
    expect(css).toMatch(/^\s*\.fsh-chip-summary\s*\{\s*display:\s*none/m);
    const narrow = css.slice(css.indexOf('@container (max-width: 480px)'));
    expect(narrow).toMatch(/\.fsh-chip\s*\{\s*display:\s*none/);
    expect(narrow).toMatch(/\.fsh-chip-summary\s*\{\s*display:\s*inline-flex/);
    const narrowest = css.slice(css.indexOf('@container (max-width: 360px)'));
    expect(narrowest).toMatch(/\.fsh-side\s*\{[^}]*max-width:\s*4\.5rem/);
  });

  it('renders no summary chip without chips', () => {
    const host = render();
    expect(byTestId(host, 'file-chip-summary')).toBeNull();
  });

  it('keeps Comment and Edit named while their labels collapse at narrow widths', () => {
    const host = render();
    expect(
      byTestId(host, 'file-section-comment')?.getAttribute('aria-label'),
    ).toBe(`Comment on lines of ${LONG_PATH}`);
    expect(
      byTestId(host, 'file-section-edit')?.getAttribute('aria-label'),
    ).toBe(`Edit ${LONG_PATH}`);
    expect(
      byTestId(host, 'file-section-comment')?.querySelector('.fsh-label'),
    ).not.toBeNull();

    // CSS only (no observer per section): the host is its own size container.
    const source = readFileSync(
      join(__dirname, 'file-section-header.component.ts'),
      'utf8',
    );
    const css = source.slice(source.indexOf('styles: ['));
    expect(css).toMatch(/container-type:\s*inline-size/);
    expect(css).toMatch(
      /@container \(max-width: 480px\)\s*\{\s*\.fsh-label,\s*\.fsh-chip\s*\{\s*display:\s*none/,
    );
    expect(source).not.toMatch(/new ResizeObserver/);
  });
});
