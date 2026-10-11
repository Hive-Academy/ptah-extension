import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FILE_LINK_OPENER, VSCodeService } from '@ptah-extension/core';
import { DiffDisplayComponent } from './diff-display.component';

/** Classes that would let a block scroll sideways (decision #119, R9.5). */
const HORIZONTAL_SCROLL =
  '.overflow-x-auto, .overflow-x-scroll, .whitespace-nowrap';

describe.each([true, false])(
  'DiffDisplayComponent — counts, gutters and wrapping (isElectron=%s)',
  (isElectron) => {
    let fixture: ComponentFixture<DiffDisplayComponent>;
    let open: jest.Mock;

    function render(
      toolInput: { file_path: string; old_string: string; new_string: string },
      replacements?: number,
    ): HTMLElement {
      fixture.componentRef.setInput('toolInput', toolInput);
      if (replacements !== undefined) {
        fixture.componentRef.setInput('replacements', replacements);
      }
      fixture.detectChanges();
      return fixture.nativeElement as HTMLElement;
    }

    const edit = {
      file_path: '/repo/src/source.ts',
      old_string: 'const a = 1;\nconst b = 2;',
      new_string: 'const a = 3;',
    };

    beforeEach(async () => {
      open = jest.fn().mockResolvedValue(undefined);
      await TestBed.configureTestingModule({
        imports: [DiffDisplayComponent],
        providers: [
          { provide: FILE_LINK_OPENER, useValue: { open } },
          { provide: VSCodeService, useValue: { isElectron } },
        ],
      }).compileComponents();
      fixture = TestBed.createComponent(DiffDisplayComponent);
    });

    it('shows removed and added counts with a spoken summary', () => {
      const counts = render(edit).querySelector(
        '[data-testid="diff-counts"]',
      ) as HTMLElement;

      expect(counts.textContent).toContain('-2');
      expect(counts.textContent).toContain('+1');
      expect(counts.querySelector('.sr-only')?.textContent).toBe(
        '2 lines removed, 1 line added',
      );
    });

    it('renders old lines then new lines with line numbers, named signs and a tint', () => {
      const rows = Array.from(
        render(edit).querySelectorAll<HTMLElement>('.diff-row'),
      );

      expect(rows.map((row) => row.dataset['kind'])).toEqual([
        'removed',
        'removed',
        'added',
      ]);
      expect(
        rows.map((row) => row.querySelector('.diff-line-number')?.textContent),
      ).toEqual(['1', '2', '1']);
      expect(
        rows.map((row) => row.querySelector('.diff-code')?.textContent),
      ).toEqual(['const a = 1;', 'const b = 2;', 'const a = 3;']);

      const removedSign = rows[0].querySelector('.diff-sign') as HTMLElement;
      const addedSign = rows[2].querySelector('.diff-sign') as HTMLElement;
      expect(removedSign.textContent).toBe('-');
      expect(removedSign.getAttribute('role')).toBe('img');
      expect(removedSign.getAttribute('aria-label')).toBe('removed');
      expect(addedSign.textContent).toBe('+');
      expect(addedSign.getAttribute('aria-label')).toBe('added');
      expect(rows[0].classList).toContain('bg-error/10');
      expect(rows[2].classList).toContain('bg-success/10');
    });

    it('renders backtick runs and markup in either string as plain text', () => {
      const host = render({
        ...edit,
        old_string: '```',
        new_string: '``````````\n<div class="fixed">x</div>',
      });

      expect(
        Array.from(host.querySelectorAll('.diff-code')).map(
          (code) => code.textContent,
        ),
      ).toEqual(['```', '``````````', '<div class="fixed">x</div>']);
      expect(host.querySelector('div.fixed')).toBeNull();
    });

    it('counts an empty old string as no removed lines', () => {
      const host = render({ ...edit, old_string: '' });

      expect(host.querySelectorAll('[data-kind="removed"]')).toHaveLength(0);
      expect(
        host.querySelector('[data-testid="diff-counts"] .sr-only')?.textContent,
      ).toBe('0 lines removed, 1 line added');
    });

    it('keeps the replacements badge', () => {
      expect(render(edit, 2).textContent).toContain('2 replacements');
      expect(render(edit, 1).textContent).toContain('1 replacement');
      expect(render(edit, 0).textContent).not.toContain('replacement');
    });

    it('labels the language of the edited file', () => {
      expect(
        render(edit)
          .querySelector('[data-testid="diff-language"]')
          ?.textContent?.trim(),
      ).toBe('TypeScript');
    });

    it('keeps the path link, which opens through FILE_LINK_OPENER', () => {
      const host = render(edit);
      const link = host.querySelector(
        'ptah-file-path-link [title]',
      ) as HTMLElement;

      expect(link.getAttribute('title')).toBe('/repo/src/source.ts');
      link.click();
      expect(open).toHaveBeenCalledWith(
        expect.objectContaining({ path: '/repo/src/source.ts' }),
      );
    });

    it('is a focusable, labelled, max-h-64 block that wraps and never scrolls sideways', () => {
      const longLine = 'x'.repeat(400);
      const host = render({ ...edit, new_string: longLine });
      const block = host.querySelector('[role="region"]') as HTMLElement;

      expect(block.getAttribute('tabindex')).toBe('0');
      expect(block.getAttribute('aria-label')).toBe(
        'Diff of source.ts, line numbers count within the replaced snippet',
      );
      expect(block.classList).toContain('max-h-64');
      expect(block.classList).toContain('overflow-y-auto');
      expect(host.querySelectorAll(HORIZONTAL_SCROLL)).toHaveLength(0);
      expect(
        host.querySelector('[data-kind="added"] .diff-code')?.textContent,
      ).toBe(longLine);
    });

    // Batch 28F.3 / decision #132: the gutter counts within the snippet.
    it('captions the gutter as snippet lines and names it in the region label', () => {
      const host = render(edit);
      const caption = host.querySelector(
        '[data-testid="diff-gutter-caption"]',
      ) as HTMLElement;
      const block = host.querySelector('[role="region"]') as HTMLElement;

      expect(caption.textContent?.trim()).toBe('Snippet lines');
      expect(caption.classList).toContain('text-[10px]');
      expect(caption.classList).toContain('text-base-content-muted');
      expect(block.getAttribute('aria-label')).toContain(
        'line numbers count within the replaced snippet',
      );
    });

    it('shows no file-relative line range', () => {
      const text = render(edit).textContent ?? '';

      expect(text).not.toMatch(/line \d+ of/i);
      expect(text).not.toMatch(/L\d+-\d+/);
    });

    it('splits CRLF strings with no \\r left and the same counts as LF', () => {
      const lf = {
        ...edit,
        old_string: 'const a = 1;\nconst b = 2;\nconst c = 3;',
        new_string: 'const a = 4;\nconst b = 5;',
      };
      const crlf = {
        ...lf,
        old_string: lf.old_string.replace(/\n/g, '\r\n'),
        new_string: lf.new_string.replace(/\n/g, '\r\n'),
      };
      const snapshot = (host: HTMLElement) => ({
        codes: Array.from(host.querySelectorAll('.diff-code')).map(
          (code) => code.textContent,
        ),
        counts: host.querySelector('[data-testid="diff-counts"] .sr-only')
          ?.textContent,
      });

      const fromLf = snapshot(render(lf));
      const fromCrlf = snapshot(render(crlf));

      expect(fromCrlf.codes.some((code) => code?.includes('\r'))).toBe(false);
      expect(fromCrlf).toEqual(fromLf);
      expect(fromCrlf.counts).toBe('3 lines removed, 2 lines added');
    });
  },
);
