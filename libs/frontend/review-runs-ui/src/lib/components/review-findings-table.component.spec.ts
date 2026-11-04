import { TestBed } from '@angular/core/testing';
import { ReviewFindingsTableComponent, type ReviewFindingRow } from './review-findings-table.component';

const rows: ReviewFindingRow[] = [
  { id: 'minor', severity: 'Minor', lens: 'security-privacy', path: 'a.ts', line: 4, status: 'suppressed', reason: 'Below confidence floor', confidence: 0.5 },
  { id: 'major', severity: 'Major', lens: 'contracts-callers', path: 'b.ts', line: 8, status: 'accepted', reason: null, confidence: 0.9 },
];

describe('ReviewFindingsTableComponent', () => {
  it('sorts by severity, filters status and shows suppression reason', () => {
    TestBed.configureTestingModule({ imports: [ReviewFindingsTableComponent] });
    const fixture = TestBed.createComponent(ReviewFindingsTableComponent);
    fixture.componentRef.setInput('rows', rows); fixture.detectChanges();
    expect((fixture.nativeElement.querySelector('tbody tr') as HTMLElement).textContent).toContain('Major');
    const filter = fixture.nativeElement.querySelector('#finding-status') as HTMLSelectElement;
    filter.value = 'suppressed'; filter.dispatchEvent(new Event('change')); fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('tbody tr')).toHaveLength(1);
    expect(fixture.nativeElement.textContent).toContain('Below confidence floor');
    fixture.nativeElement.querySelector('th button').click(); fixture.detectChanges();
    expect(fixture.componentInstance.ascending()).toBe(false);
  });
});
