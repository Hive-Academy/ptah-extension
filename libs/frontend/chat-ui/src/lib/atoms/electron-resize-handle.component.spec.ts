import { TestBed } from '@angular/core/testing';
import { ElectronResizeHandleComponent } from './electron-resize-handle.component';

describe('ElectronResizeHandleComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ElectronResizeHandleComponent],
    }).compileComponents();
  });

  it('creates with default direction "left"', () => {
    const fixture = TestBed.createComponent(ElectronResizeHandleComponent);
    fixture.detectChanges();
    expect(fixture.componentInstance.direction()).toBe('left');
    expect(
      fixture.nativeElement.querySelector('.resize-handle'),
    ).not.toBeNull();
  });

  it('emits dragStarted/dragMoved/dragEnded across a mouse interaction (left)', () => {
    const fixture = TestBed.createComponent(ElectronResizeHandleComponent);
    fixture.componentRef.setInput('direction', 'left');
    fixture.detectChanges();

    const events: { started: number; moved: number[]; ended: number } = {
      started: 0,
      moved: [],
      ended: 0,
    };
    fixture.componentInstance.dragStarted.subscribe(() => events.started++);
    fixture.componentInstance.dragMoved.subscribe((w) => events.moved.push(w));
    fixture.componentInstance.dragEnded.subscribe(() => events.ended++);

    const handle = fixture.nativeElement.querySelector(
      '.resize-handle',
    ) as HTMLElement;
    handle.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(events.started).toBe(1);

    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 250 }));
    expect(events.moved).toContain(250);

    document.dispatchEvent(new MouseEvent('mouseup'));
    expect(events.ended).toBe(1);
  });

  it('inverts width calculation when direction is "right"', () => {
    const fixture = TestBed.createComponent(ElectronResizeHandleComponent);
    fixture.componentRef.setInput('direction', 'right');
    fixture.detectChanges();

    let lastWidth = -1;
    fixture.componentInstance.dragMoved.subscribe((w) => (lastWidth = w));

    fixture.nativeElement
      .querySelector('.resize-handle')
      .dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 100 }));
    document.dispatchEvent(new MouseEvent('mouseup'));

    expect(lastWidth).toBe(window.innerWidth - 100);
  });

  it('cleans up listeners on destroy', () => {
    const fixture = TestBed.createComponent(ElectronResizeHandleComponent);
    fixture.detectChanges();
    expect(() => fixture.destroy()).not.toThrow();
  });
});
