import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { LiveRunLayoutComponent } from './live-run-layout.component';

@Component({
  standalone: true,
  imports: [LiveRunLayoutComponent],
  template: `<ptah-live-run-layout [hasLog]="hasLog" [composer]="composer">
    <div runLog data-testid="log">Log</div><div data-testid="results">Results</div>
  </ptah-live-run-layout>`,
})
class HostComponent {
  hasLog = true;
  composer = false;
}

describe('LiveRunLayoutComponent', () => {
  it('places the log before results and exposes the composer layout state', () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.composer = true;
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    const log = root.querySelector('[data-testid="log"]') as HTMLElement;
    const results = root.querySelector('[data-testid="results"]') as HTMLElement;
    expect(log.compareDocumentPosition(results) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(root.querySelector('.run-container')?.classList.contains('has-composer')).toBe(true);
  });

  it('omits the log cell when no log is available', () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.hasLog = false;
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('.run-log')).toBeNull();
    expect(root.querySelector('[data-testid="results"]')).not.toBeNull();
  });
});
