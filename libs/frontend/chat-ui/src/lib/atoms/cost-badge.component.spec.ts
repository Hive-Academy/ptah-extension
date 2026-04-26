import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CostBadgeComponent } from './cost-badge.component';

describe('CostBadgeComponent', () => {
  let fixture: ComponentFixture<CostBadgeComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CostBadgeComponent],
    }).compileComponents();
    fixture = TestBed.createComponent(CostBadgeComponent);
  });

  it('creates with required cost input', () => {
    fixture.componentRef.setInput('cost', 0.0042);
    fixture.detectChanges();
    expect(fixture.componentInstance).toBeTruthy();
    expect(fixture.nativeElement.textContent).toContain('$0.0042');
  });

  it('formats costs >= $0.01 with 2 decimals', () => {
    fixture.componentRef.setInput('cost', 1.234);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('$1.23');
  });

  it('formats costs == $0.01 with 2 decimals', () => {
    fixture.componentRef.setInput('cost', 0.01);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('$0.01');
  });

  it('exposes raw USD value via title tooltip', () => {
    fixture.componentRef.setInput('cost', 0.5);
    fixture.detectChanges();
    const span = fixture.nativeElement.querySelector('span');
    expect(span.getAttribute('title')).toBe('$0.5000 USD');
  });
});
