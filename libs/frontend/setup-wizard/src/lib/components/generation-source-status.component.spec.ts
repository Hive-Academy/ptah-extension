import { TestBed } from '@angular/core/testing';
import { GenerationSourceStatusComponent } from './generation-source-status.component';

describe('GenerationSourceStatusComponent', () => {
  it('labels host verified analysis without showing its directory', () => {
    const fixture = TestBed.createComponent(GenerationSourceStatusComponent);
    fixture.componentRef.setInput('source', {
      kind: 'verified-analysis',
      analysisRunId: 'run-1',
      analysisDir: '/secret/analysis',
    });
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain(
      'Verified latest analysis',
    );
    expect(fixture.nativeElement.textContent).not.toContain('/secret/analysis');
  });

  it('calls fallback workspace discovery', () => {
    const fixture = TestBed.createComponent(GenerationSourceStatusComponent);
    fixture.componentRef.setInput('source', {
      kind: 'workspace-discovery',
      reason: 'stale',
    });
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Workspace discovery');
    expect(fixture.nativeElement.textContent).toContain('out of date');
  });
});
