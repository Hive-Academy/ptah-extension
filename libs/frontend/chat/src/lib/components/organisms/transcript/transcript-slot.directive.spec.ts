/**
 * TranscriptSlotDirective — element registration (TASK_2026_381 component 2).
 *
 * The directive holds no policy, so the window is a jest double and the
 * assertions are entirely about registration lifetime: once on mount, again on
 * an id change, and released on destroy.
 */

import {
  ChangeDetectionStrategy,
  Component,
  signal,
  WritableSignal,
} from '@angular/core';
import { TestBed, ComponentFixture } from '@angular/core/testing';
import { TranscriptSlotDirective } from './transcript-slot.directive';
import { TranscriptRenderWindow } from './transcript-render-window';

@Component({
  selector: 'ptah-slot-host',
  standalone: true,
  imports: [TranscriptSlotDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div data-test="slot" [ptahTranscriptSlot]="id()"></div>`,
})
class SlotHostComponent {
  readonly id: WritableSignal<string> = signal('m0');
}

interface WindowDouble {
  register: jest.Mock;
  unregister: jest.Mock;
}

function makeHost(withWindow = true): {
  fixture: ComponentFixture<SlotHostComponent>;
  windowDouble: WindowDouble;
  slot: HTMLElement;
} {
  const windowDouble: WindowDouble = {
    register: jest.fn(),
    unregister: jest.fn(),
  };

  TestBed.configureTestingModule({
    imports: [SlotHostComponent],
    providers: withWindow
      ? [
          {
            provide: TranscriptRenderWindow,
            useValue: windowDouble as unknown as TranscriptRenderWindow,
          },
        ]
      : [],
  });

  const fixture = TestBed.createComponent(SlotHostComponent);
  fixture.detectChanges();
  const slot: HTMLElement =
    fixture.nativeElement.querySelector('[data-test="slot"]');
  return { fixture, windowDouble, slot };
}

describe('TranscriptSlotDirective', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
    jest.clearAllMocks();
  });

  it('registers the host element with its message id exactly once on mount', () => {
    const { windowDouble, slot } = makeHost();

    expect(windowDouble.register).toHaveBeenCalledTimes(1);
    expect(windowDouble.register).toHaveBeenCalledWith('m0', slot);
  });

  it('does not re-register on a change detection pass that leaves the id alone', () => {
    const { fixture, windowDouble } = makeHost();
    fixture.detectChanges();
    fixture.detectChanges();

    expect(windowDouble.register).toHaveBeenCalledTimes(1);
  });

  it('re-registers the same element when the message id changes', () => {
    const { fixture, windowDouble, slot } = makeHost();
    fixture.componentInstance.id.set('m1');
    fixture.detectChanges();

    expect(windowDouble.register).toHaveBeenCalledTimes(2);
    expect(windowDouble.register).toHaveBeenLastCalledWith('m1', slot);
  });

  it('unregisters the host element on destroy', () => {
    const { fixture, windowDouble, slot } = makeHost();
    expect(windowDouble.unregister).not.toHaveBeenCalled();

    fixture.destroy();

    expect(windowDouble.unregister).toHaveBeenCalledTimes(1);
    expect(windowDouble.unregister).toHaveBeenCalledWith(slot);
  });

  it('throws when no render window is provided rather than silently no-opping', () => {
    expect(() => makeHost(false)).toThrow();
  });
});
