import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FILE_LINK_OPENER } from '@ptah-extension/core';
import { provideSurfaceActiveTesting } from '@ptah-extension/core/testing';
import { provideMarkdown } from 'ngx-markdown';
import { AgentCardOutputComponent } from './agent-card-output.component';

describe('AgentCardOutputComponent', () => {
  let fixture: ComponentFixture<AgentCardOutputComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AgentCardOutputComponent],
      providers: [
        provideSurfaceActiveTesting(),
        provideMarkdown(),
        { provide: FILE_LINK_OPENER, useValue: { open: jest.fn() } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(AgentCardOutputComponent);
    fixture.componentRef.setInput('embedded', true);
    fixture.componentRef.setInput('stderrSegments', []);
  });

  it('renders tool-result markup as literal text', async () => {
    const content = '```html\n<div class="fixed">x</div>\n```';
    fixture.componentRef.setInput('segments', [
      { type: 'tool-result', content },
    ]);
    fixture.detectChanges();
    await fixture.whenStable();

    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('pre')?.textContent).toBe(content);
    expect(host.querySelector('div.fixed')).toBeNull();
    expect(host.querySelector('markdown')).toBeNull();
  });

  it('continues rendering model text as markdown', async () => {
    fixture.componentRef.setInput('segments', [
      { type: 'text', content: '**Model prose**' },
    ]);
    fixture.detectChanges();
    await fixture.whenStable();

    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('strong')?.textContent).toBe('Model prose');
  });

  it('moves trailing WROTE lines out of the markdown into a result card', async () => {
    const path = 'D:\\repo\\.claude-worktrees\\x\\plan.md';
    fixture.componentRef.setInput('segments', [
      { type: 'text', content: `**Done.**\n\nWROTE: ${path} — APPROVED` },
    ]);
    fixture.detectChanges();
    await fixture.whenStable();

    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('strong')?.textContent).toBe('Done.');
    expect(host.querySelector('markdown')?.textContent).not.toContain('WROTE');
    expect(
      host
        .querySelector('[data-testid="lane-result-file"]')
        ?.getAttribute('title'),
    ).toBe(path);
  });

  it('keeps every earlier segment node when a segment is appended', async () => {
    fixture.componentRef.setInput('segments', [
      { type: 'info', content: 'first' },
      { type: 'info', content: 'identical segment' },
      { type: 'info', content: 'identical segment' },
      { type: 'text', content: 'partial tail' },
    ]);
    fixture.detectChanges();
    await fixture.whenStable();
    const output = fixture.nativeElement.querySelector('.p-2') as HTMLElement;
    const existingNodes = Array.from(output.children);

    fixture.componentRef.setInput('segments', [
      { type: 'info', content: 'first' },
      { type: 'info', content: 'identical segment' },
      { type: 'info', content: 'identical segment' },
      { type: 'text', content: 'partial tail, now complete' },
      { type: 'info', content: 'appended' },
    ]);
    fixture.detectChanges();
    await fixture.whenStable();

    const rerenderedNodes = Array.from(output.children);
    expect(rerenderedNodes).toHaveLength(5);
    for (let i = 0; i < existingNodes.length; i++) {
      expect(rerenderedNodes[i]).toBe(existingNodes[i]);
    }
    // The former tail shows its final content at once.
    expect(rerenderedNodes[3].textContent).toContain(
      'partial tail, now complete',
    );
  });

  it('renders the right content after a front trim', async () => {
    fixture.componentRef.setInput('segments', [
      { type: 'info', content: 'trimmed from the stream' },
      { type: 'info', content: 'retained after trimming' },
      { type: 'text', content: 'tail' },
    ]);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(() => {
      fixture.componentRef.setInput('segments', [
        { type: 'info', content: 'retained after trimming' },
        { type: 'text', content: 'tail' },
      ]);
      fixture.detectChanges();
    }).not.toThrow();
    await fixture.whenStable();

    const output = fixture.nativeElement.querySelector('.p-2') as HTMLElement;
    expect(output.children).toHaveLength(2);
    expect(output.children[0].textContent).toContain('retained after trimming');
    expect(output.children[1].textContent).toContain('tail');
  });

  describe('streaming tail markdown', () => {
    type Source = {
      markdownSource(segment: { content: string }, index: number): string;
    };
    const sourceOf = (index: number, content: string): string =>
      (fixture.componentInstance as unknown as Source).markdownSource(
        { content },
        index,
      );

    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    function show(segments: { type: string; content: string }[]): void {
      fixture.componentRef.setInput('segments', segments);
      fixture.detectChanges();
    }

    it('renders the tail at most once per 150 ms, latest content on the trailing edge', () => {
      show([{ type: 'text', content: 'a' }]);
      expect(sourceOf(0, 'a')).toBe('a');

      show([{ type: 'text', content: 'ab' }]);
      show([{ type: 'text', content: 'abc' }]);
      // Inside the window: still the first render.
      expect(sourceOf(0, 'abc')).toBe('a');

      jest.advanceTimersByTime(149);
      expect(sourceOf(0, 'abc')).toBe('a');

      jest.advanceTimersByTime(1);
      fixture.detectChanges();
      expect(sourceOf(0, 'abc')).toBe('abc');
    });

    it('a former tail renders its final content as soon as a segment follows it', () => {
      show([{ type: 'text', content: 'a' }]);
      show([{ type: 'text', content: 'ab' }]);
      expect(sourceOf(0, 'ab')).toBe('a');

      show([
        { type: 'text', content: 'abc' },
        { type: 'info', content: 'next' },
      ]);
      expect(sourceOf(0, 'abc')).toBe('abc');
    });

    it('clears a pending tail render on destroy', () => {
      show([{ type: 'text', content: 'a' }]);
      const setSpy = jest.spyOn(globalThis, 'setTimeout');
      show([{ type: 'text', content: 'ab' }]);
      const tailCall = setSpy.mock.calls.findIndex(
        ([, delay]) => typeof delay === 'number' && delay > 0 && delay <= 150,
      );
      expect(tailCall).toBeGreaterThan(-1);
      const tailTimer = setSpy.mock.results[tailCall].value;
      setSpy.mockRestore();
      const clearSpy = jest.spyOn(globalThis, 'clearTimeout');

      fixture.destroy();

      expect(clearSpy).toHaveBeenCalledWith(tailTimer);
      clearSpy.mockRestore();
    });
  });
});
