import { TestBed } from '@angular/core/testing';
import { TypingCursorComponent } from './typing-cursor.component';

describe('TypingCursorComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TypingCursorComponent],
    }).compileComponents();
  });

  it('creates with default cursor color', () => {
    const fixture = TestBed.createComponent(TypingCursorComponent);
    fixture.detectChanges();
    expect(fixture.componentInstance).toBeTruthy();
    expect(fixture.componentInstance.colorClass()).toBe('text-current');
  });

  it('applies a custom color class to the rendered span', () => {
    const fixture = TestBed.createComponent(TypingCursorComponent);
    fixture.componentRef.setInput('colorClass', 'text-primary');
    fixture.detectChanges();
    const span = fixture.nativeElement.querySelector('span');
    expect(span.className).toContain('text-primary');
    expect(span.className).toContain('typing-cursor');
  });
});
