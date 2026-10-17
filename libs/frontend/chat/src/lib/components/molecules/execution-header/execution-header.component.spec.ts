import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ExecutionHeaderComponent } from './execution-header.component';

@Component({
  standalone: true,
  imports: [ExecutionHeaderComponent],
  template: `
    <ptah-execution-header kind="cli" label="Worked for 2s" [toolCount]="2"
      [extraMeta]="['12 tokens']" metaTone="warning" controlsId="lane-details">
      <button executionHeaderActions type="button" aria-label="Resume codex session">Resume</button>
      <p>Task: inspect files</p>
    </ptah-execution-header>
  `,
})
class HostComponent {}

describe('ExecutionHeaderComponent', () => {
  it('shows stable metadata and a sibling action, then opens its controlled region', () => {
    TestBed.configureTestingModule({ imports: [HostComponent] });
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    const root: HTMLElement = fixture.nativeElement;
    const row = root.querySelector<HTMLButtonElement>('[data-test="turn-disclosure-row"]')!;
    const action = root.querySelector<HTMLButtonElement>('[executionHeaderActions]')!;
    expect(root.querySelector('ptah-execution-header')?.getAttribute('data-kind')).toBe('cli');
    expect(row.getAttribute('aria-label')).toBe('Worked for 2s, 2 tools, 12 tokens');
    expect(row.getAttribute('aria-controls')).toBe('lane-details');
    expect(row.getAttribute('aria-expanded')).toBe('false');
    expect(row.closest('ptah-turn-disclosure-row')?.nextElementSibling).toBe(action);
    expect(row.contains(action)).toBe(false);
    expect(root.querySelector('#lane-details')).toBeNull();
    expect(root.querySelector('[data-test="turn-disclosure-meta"]')?.className).toContain('!text-warning');
    row.click();
    fixture.detectChanges();
    expect(row.getAttribute('aria-expanded')).toBe('true');
    expect(root.querySelector('#lane-details')?.textContent).toContain('Task: inspect files');
    expect(root.querySelector('#lane-details')?.getAttribute('aria-label')).toBe('Worked for 2s details');
  });
});
