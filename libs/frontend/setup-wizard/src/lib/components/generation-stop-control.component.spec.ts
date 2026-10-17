import { TestBed } from '@angular/core/testing';
import { GenerationStopControlComponent } from './generation-stop-control.component';

describe('GenerationStopControlComponent', () => {
  it('emits Stop only while active', () => {
    TestBed.configureTestingModule({
      imports: [GenerationStopControlComponent],
    });
    const fixture = TestBed.createComponent(GenerationStopControlComponent);
    const stop = jest.fn();
    fixture.componentInstance.stopRequested.subscribe(stop);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('button')).toBeNull();
    fixture.componentRef.setInput('active', true);
    fixture.detectChanges();
    fixture.nativeElement.querySelector('button').click();
    expect(stop).toHaveBeenCalledTimes(1);
    expect(fixture.nativeElement.textContent).toContain(
      'Stopping may take a moment',
    );
    fixture.componentRef.setInput('active', false);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('button')).toBeNull();
  });
});
