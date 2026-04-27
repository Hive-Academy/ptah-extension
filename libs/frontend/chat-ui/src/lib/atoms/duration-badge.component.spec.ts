import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DurationBadgeComponent } from './duration-badge.component';

describe('DurationBadgeComponent', () => {
  let fixture: ComponentFixture<DurationBadgeComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DurationBadgeComponent],
    }).compileComponents();
    fixture = TestBed.createComponent(DurationBadgeComponent);
  });

  function setDuration(ms: number): void {
    fixture.componentRef.setInput('durationMs', ms);
    fixture.detectChanges();
  }

  it('creates the component', () => {
    setDuration(500);
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('formats sub-second durations as ms', () => {
    setDuration(500);
    expect(fixture.nativeElement.textContent).toContain('500ms');
  });

  it('treats values < 100 as seconds and converts to ms', () => {
    setDuration(2); // 2 seconds → 2000ms → "2.0s"
    expect(fixture.nativeElement.textContent).toContain('2.0s');
  });

  it('formats sub-minute durations as seconds with one decimal', () => {
    setDuration(12_500);
    expect(fixture.nativeElement.textContent).toContain('12.5s');
  });

  it('formats >= 1 minute durations as minutes + seconds', () => {
    setDuration(135_000); // 2m 15s
    expect(fixture.nativeElement.textContent).toContain('2m 15s');
  });

  it('omits seconds when minutes are exact', () => {
    setDuration(120_000);
    expect(fixture.nativeElement.textContent.trim()).toMatch(/2m\s*$/);
  });
});
