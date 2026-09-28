import {
  ChangeDetectionStrategy,
  Component,
  computed,
  signal,
} from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { AppsSessionService } from '../services/apps-session.service';
import { AppsFocusMemoryDirective } from './apps-focus-memory.directive';

@Component({
  selector: 'ptah-focus-memory-probe',
  standalone: true,
  imports: [AppsFocusMemoryDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<section ptahAppsFocusMemory>
    <button data-apps-focus-key="first"><span>First</span></button>
    <input data-apps-focus-key="second" />
    <button data-apps-focus-key="disabled" disabled>Disabled</button>
    <div data-apps-focus-key="plain">Plain</div>
  </section>`,
})
class FocusMemoryProbeComponent {}

describe('AppsFocusMemoryDirective', () => {
  let fixture: ComponentFixture<FocusMemoryProbeComponent>;
  let host: HTMLElement;
  let workspace: ReturnType<typeof signal<string>>;
  let keys: ReturnType<typeof signal<ReadonlyMap<string, string | null>>>;
  let recordFocusKey: jest.Mock;

  function mount(beforeRender?: (element: HTMLElement) => void): void {
    fixture = TestBed.createComponent(FocusMemoryProbeComponent);
    const root = fixture.nativeElement as HTMLElement;
    document.body.appendChild(root);
    host = root.querySelector('section') as HTMLElement;
    beforeRender?.(host);
    fixture.detectChanges();
    TestBed.tick();
  }

  function unmount(): void {
    const root = fixture.nativeElement as HTMLElement;
    fixture.destroy();
    root.remove();
  }

  beforeEach(() => {
    workspace = signal('a');
    keys = signal<ReadonlyMap<string, string | null>>(new Map());
    recordFocusKey = jest.fn((key: string | null) => {
      keys.update((current) => new Map(current).set(workspace(), key));
    });
    TestBed.configureTestingModule({
      providers: [
        {
          provide: AppsSessionService,
          useValue: {
            lastFocusKey: computed(() => keys().get(workspace()) ?? null),
            recordFocusKey,
          },
        },
      ],
    });
  });

  afterEach(() => unmount());

  it('records the nearest key on focusin and removes the listener on destroy', () => {
    mount();
    const span = host.querySelector('span') as HTMLElement;
    span.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    expect(recordFocusKey).toHaveBeenLastCalledWith('first');
    fixture.destroy();
    recordFocusKey.mockClear();
    span.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    expect(recordFocusKey).not.toHaveBeenCalled();
  });

  it('restores the recorded key after host destroy and re-create', () => {
    mount();
    (host.querySelector('input') as HTMLInputElement).focus();
    unmount();
    mount();
    expect(document.activeElement).toBe(host.querySelector('input'));
  });

  it.each(['missing', 'disabled', 'detached', 'plain', 'hidden', 'inert'])(
    'falls back to the host with tabindex -1 for a %s control',
    (key) => {
      keys.set(new Map([['a', key]]));
      mount((element) => {
        const control = element.querySelector('input') as HTMLInputElement;
        if (key === 'detached') {
          control.setAttribute('data-apps-focus-key', key);
          control.remove();
        }
        if (key === 'hidden' || key === 'inert') {
          control.setAttribute('data-apps-focus-key', key);
          control.setAttribute(key, '');
        }
      });
      expect(host.getAttribute('tabindex')).toBe('-1');
      expect(document.activeElement).toBe(host);
    },
  );

  it('handles a key containing quotes and brackets safely', () => {
    const key = 'filter["value"]\'suffix';
    keys.set(new Map([['a', key]]));
    mount((element) =>
      element.querySelector('input')?.setAttribute('data-apps-focus-key', key),
    );
    expect(document.activeElement).toBe(host.querySelector('input'));
    expect(recordFocusKey).toHaveBeenLastCalledWith(key);
  });

  it('restores each workspace slice key when its host is re-created', () => {
    mount();
    (host.querySelector('button') as HTMLButtonElement).focus();
    unmount();
    workspace.set('b');
    mount();
    (host.querySelector('input') as HTMLInputElement).focus();
    unmount();
    workspace.set('a');
    mount();
    expect(document.activeElement).toBe(host.querySelector('button'));
    unmount();
    workspace.set('b');
    mount();
    expect(document.activeElement).toBe(host.querySelector('input'));
  });

  it('falls back without throwing when a control refuses focus', () => {
    keys.set(new Map([['a', 'second']]));
    mount((element) => {
      const control = element.querySelector('input') as HTMLInputElement;
      jest.spyOn(control, 'focus').mockImplementation(() => {
        throw new Error('Detached during focus');
      });
    });
    expect(document.activeElement).toBe(host);
  });
});
