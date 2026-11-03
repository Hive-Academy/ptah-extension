import {
  ChangeDetectionStrategy,
  Component,
  provideZonelessChangeDetection,
  signal,
} from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ComposerTypeToExpandDirective } from './composer-type-to-expand.directive';

@Component({
  imports: [ComposerTypeToExpandDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      [ptahComposerTypeToExpand]="enabled()"
      (typeToExpand)="typed.push($event.key)"
      (pasteToExpand)="pasted.push($event)"
    >
      <button id="bar" type="button">Expand composer</button>
      <input id="field" />
    </div>
  `,
})
class HostComponent {
  readonly enabled = signal(true);
  readonly typed: string[] = [];
  readonly pasted: Event[] = [];
}

async function setup() {
  TestBed.configureTestingModule({
    providers: [provideZonelessChangeDetection()],
  });
  const fixture = TestBed.createComponent(HostComponent);
  await fixture.whenStable();
  const el = (id: string) =>
    (fixture.nativeElement as HTMLElement).querySelector(`#${id}`) as Element;
  return { fixture, host: fixture.componentInstance, el };
}

/** Dispatch a cancelable keydown and report what the listener did to it. */
function press(target: Element, init: KeyboardEventInit) {
  const event = new KeyboardEvent('keydown', {
    bubbles: true,
    cancelable: true,
    ...init,
  });
  const stopPropagation = jest.spyOn(event, 'stopPropagation');
  const stopImmediate = jest.spyOn(event, 'stopImmediatePropagation');
  target.dispatchEvent(event);
  return {
    prevented: event.defaultPrevented,
    stopped: stopPropagation.mock.calls.length + stopImmediate.mock.calls.length,
  };
}

describe('ComposerTypeToExpandDirective', () => {
  afterEach(() => TestBed.resetTestingModule());

  it.each(['a', 'Z', '7', '/', '@', 'é'])(
    'expands on "%s" without cancelling or stopping the keydown',
    async (key) => {
      const { host, el } = await setup();
      const result = press(el('bar'), { key });
      expect(host.typed).toEqual([key]);
      // The browser's default action must still type the character into the
      // textarea the owner focuses; only a manual Electron check proves the
      // insertion itself.
      expect(result.prevented).toBe(false);
      expect(result.stopped).toBe(0);
    },
  );

  it.each([
    ['IME composition', { key: 'a', isComposing: true }],
    ['IME process key', { key: 'Process' }],
    ['Ctrl + key', { key: 'a', ctrlKey: true }],
    ['Meta + key', { key: 'v', metaKey: true }],
    ['Alt + key', { key: 'f', altKey: true }],
    ['Space', { key: ' ' }],
    ['a named key', { key: 'ArrowDown' }],
  ] as const)('ignores %s and leaves the event alone', async (_label, init) => {
    const { host, el } = await setup();
    const result = press(el('bar'), init);
    expect(host.typed).toEqual([]);
    expect(result.prevented).toBe(false);
    expect(result.stopped).toBe(0);
  });

  it('ignores keys typed into an editable field', async () => {
    const { host, el } = await setup();
    press(el('field'), { key: 'a' });
    expect(host.typed).toEqual([]);
  });

  it('forwards an in-scope paste and ignores one in an editable field', async () => {
    const { host, el } = await setup();
    el('bar').dispatchEvent(new Event('paste', { bubbles: true }));
    el('field').dispatchEvent(new Event('paste', { bubbles: true }));
    expect(host.pasted).toHaveLength(1);
  });

  it('removes its document listeners when disabled', async () => {
    const { fixture, host, el } = await setup();
    host.enabled.set(false);
    await fixture.whenStable();
    press(el('bar'), { key: 'a' });
    el('bar').dispatchEvent(new Event('paste', { bubbles: true }));
    expect(host.typed).toEqual([]);
    expect(host.pasted).toEqual([]);
  });

  it('removes its document listeners when destroyed', async () => {
    const { fixture } = await setup();
    const remove = jest.spyOn(document, 'removeEventListener');
    fixture.destroy();
    expect(remove).toHaveBeenCalledWith('keydown', expect.any(Function));
    expect(remove).toHaveBeenCalledWith('paste', expect.any(Function));
    remove.mockRestore();
  });
});
