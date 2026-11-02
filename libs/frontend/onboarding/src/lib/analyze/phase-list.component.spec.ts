import { TestBed } from '@angular/core/testing';
import { PhaseListComponent } from './phase-list.component';

describe('PhaseListComponent', () => {
  it('renders every returned phase status as text', () => {
    TestBed.configureTestingModule({ imports: [PhaseListComponent] });
    const fixture = TestBed.createComponent(PhaseListComponent);
    fixture.componentRef.setInput('phases', ['pending', 'running', 'completed', 'failed', 'skipped'].map((status, index) => ({ id: `phase-${index}`, label: `Phase ${index}`, status })));
    fixture.detectChanges();
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    for (const status of ['Waiting', 'Running', 'Completed', 'Failed', 'Skipped']) expect(text).toContain(status);
    expect((fixture.nativeElement as HTMLElement).querySelectorAll('li')).toHaveLength(5);
  });
});
