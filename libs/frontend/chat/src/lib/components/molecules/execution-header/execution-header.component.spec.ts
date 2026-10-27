import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ExecutionHeaderComponent } from './execution-header.component';

@Component({
  standalone: true,
  imports: [ExecutionHeaderComponent],
  template: `
    <ptah-execution-header
      kind="cli"
      label="Worked for 2s"
      [toolCount]="2"
      [showStats]="showStats"
      [live]="true"
      peek="Reading files"
      [extraMeta]="['12 tokens']"
      metaTone="warning"
      controlsId="lane-details"
    >
      <span executionHeaderStats data-testid="stats">Context 4%</span>
      <button
        executionHeaderActions
        type="button"
        aria-label="Resume codex session"
      >
        Resume
      </button>
      <p>Task: inspect files</p>
    </ptah-execution-header>
  `,
})
class HostComponent {
  showStats = true;
}

describe('ExecutionHeaderComponent', () => {
  it('shows stats, peek, meta, a Details toggle and actions in one column row', () => {
    TestBed.configureTestingModule({ imports: [HostComponent] });
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    const root: HTMLElement = fixture.nativeElement;
    const row = root.querySelector<HTMLElement>(
      '[data-test="execution-header-row"]',
    )!;
    const toggle = root.querySelector<HTMLButtonElement>(
      '[data-test="execution-header-details"]',
    )!;
    const action = root.querySelector<HTMLButtonElement>(
      '[executionHeaderActions]',
    )!;
    expect(
      root.querySelector('ptah-execution-header')?.getAttribute('data-kind'),
    ).toBe('cli');
    // The bubble owns the turn label and its disclosure row; the header has neither.
    expect(root.querySelector('ptah-turn-disclosure-row')).toBeNull();
    expect(row.textContent).not.toContain('Worked for 2s');
    // In the main chat column.
    expect(row.parentElement?.classList.contains('mx-auto')).toBe(true);
    expect(row.contains(root.querySelector('[data-testid="stats"]'))).toBe(
      true,
    );
    expect(row.contains(action)).toBe(true);
    expect(
      root.querySelector('[data-test="execution-header-peek"]')?.textContent,
    ).toBe('Reading files');
    const meta = root.querySelector('[data-test="execution-header-meta"]');
    expect(meta?.textContent).toBe('2 tools · 12 tokens');
    expect(meta?.className).toContain('!text-warning');
    expect(root.querySelector('[data-test="turn-disclosure-meta"]')).toBeNull();
    expect(toggle.getAttribute('aria-label')).toBe('Worked for 2s details');
    expect(toggle.getAttribute('aria-controls')).toBe('lane-details');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    // aria-controls always resolves to exactly one region (open or not).
    const regions = () =>
      root.querySelectorAll(
        `#${toggle.getAttribute('aria-controls')}[role="region"]`,
      );
    expect(regions()).toHaveLength(1);
    expect((regions()[0] as HTMLElement).hidden).toBe(true);
    toggle.click();
    fixture.detectChanges();
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(regions()).toHaveLength(1);
    expect((regions()[0] as HTMLElement).hidden).toBe(false);
    expect(root.querySelector('#lane-details')?.textContent).toContain(
      'Task: inspect files',
    );
    expect(
      root.querySelector('#lane-details')?.getAttribute('aria-label'),
    ).toBe('Worked for 2s details');
    toggle.click();
    fixture.detectChanges();
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(regions()).toHaveLength(1);
    expect((regions()[0] as HTMLElement).hidden).toBe(true);
  });
  it('removes the passive stats slot while retaining Resume and Details', () => {
    TestBed.configureTestingModule({ imports: [HostComponent] });
    const fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.showStats = false;
    fixture.detectChanges();
    const root: HTMLElement = fixture.nativeElement;
    expect(root.querySelector('[data-testid="stats"]')).toBeNull();
    expect(
      root.querySelector('[aria-label="Resume codex session"]'),
    ).not.toBeNull();
    root
      .querySelector<HTMLButtonElement>(
        '[data-test="execution-header-details"]',
      )!
      .click();
    fixture.detectChanges();
    expect(root.querySelector<HTMLElement>('#lane-details')?.hidden).toBe(
      false,
    );
  });
});
