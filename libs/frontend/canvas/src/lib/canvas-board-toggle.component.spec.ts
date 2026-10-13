import { TestBed } from '@angular/core/testing';
import { CanvasBoardToggleComponent } from './canvas-board-toggle.component';

describe('CanvasBoardToggleComponent', () => {
  it('labels the control, reflects the active mode and emits a selection', () => {
    const fixture = TestBed.createComponent(CanvasBoardToggleComponent);
    fixture.componentRef.setInput('mode', 'rail');
    fixture.detectChanges();
    const group = fixture.nativeElement.querySelector('[role="group"]') as HTMLElement;
    const [rail, grid] = [...group.querySelectorAll('button')];
    expect(group.getAttribute('aria-label')).toBe('Board');
    expect(rail.getAttribute('aria-pressed')).toBe('true');
    expect(grid.getAttribute('aria-pressed')).toBe('false');
    const selected = jest.fn();
    fixture.componentInstance.modeChanged.subscribe(selected);
    grid.click();
    expect(selected).toHaveBeenCalledWith('grid');
    fixture.componentRef.setInput('mode', 'grid');
    fixture.detectChanges();
    expect(rail.getAttribute('aria-pressed')).toBe('false');
    expect(grid.getAttribute('aria-pressed')).toBe('true');
  });
});
