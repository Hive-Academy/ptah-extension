import { wrapTabWithin } from './focus-wrap.utils';

function tab(options: KeyboardEventInit = {}): KeyboardEvent {
  return new KeyboardEvent('keydown', {
    key: 'Tab',
    bubbles: true,
    cancelable: true,
    ...options,
  });
}

describe('wrapTabWithin', () => {
  let outside: HTMLButtonElement;
  let container: HTMLElement;

  const byId = (id: string): HTMLElement => {
    const found = container.querySelector<HTMLElement>(`#${id}`);
    if (!found) throw new Error(`Missing #${id}`);
    return found;
  };

  beforeEach(() => {
    outside = document.createElement('button');
    outside.textContent = 'outside';
    container = document.createElement('div');
    container.innerHTML = `
      <button id="disabled-first" disabled>Disabled</button>
      <div inert><button id="inert-first">Inert</button></div>
      <button id="first">First</button>
      <span id="plain">Not tabbable</span>
      <input id="middle" />
      <button id="negative" tabindex="-1">Skipped</button>
      <a id="last" href="#x">Last</a>
      <div hidden><button id="hidden-last">Hidden</button></div>
      <button id="display-none-last" style="display: none">None</button>
      <div style="visibility: hidden"><button id="invisible-last">Invisible</button></div>
      <select id="disabled-last" disabled><option>a</option></select>
    `;
    document.body.append(outside, container);
  });

  afterEach(() => {
    outside.remove();
    container.remove();
  });

  it('wraps Tab from the last tabbable to the first, skipping inert, disabled and hidden elements', () => {
    byId('last').focus();
    const event = tab();
    wrapTabWithin(container, event);
    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(byId('first'));
  });

  it('wraps Shift+Tab from the first tabbable to the last', () => {
    byId('first').focus();
    const event = tab({ shiftKey: true });
    wrapTabWithin(container, event);
    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(byId('last'));
  });

  it('leaves Tab between inner tabbables to the browser', () => {
    byId('middle').focus();
    const forward = tab();
    wrapTabWithin(container, forward);
    expect(forward.defaultPrevented).toBe(false);

    byId('last').focus();
    const backward = tab({ shiftKey: true });
    wrapTabWithin(container, backward);
    expect(backward.defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(byId('last'));
  });

  it('brings focus from outside the container to the first or last tabbable', () => {
    outside.focus();
    const forward = tab();
    wrapTabWithin(container, forward);
    expect(forward.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(byId('first'));

    outside.focus();
    const backward = tab({ shiftKey: true });
    wrapTabWithin(container, backward);
    expect(backward.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(byId('last'));
  });

  it('ignores other keys and Tab with Alt, Ctrl or Meta', () => {
    byId('last').focus();
    for (const event of [
      new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }),
      tab({ altKey: true }),
      tab({ ctrlKey: true }),
      tab({ metaKey: true }),
    ]) {
      wrapTabWithin(container, event);
      expect(event.defaultPrevented).toBe(false);
    }
    expect(document.activeElement).toBe(byId('last'));
  });

  it('swallows Tab when the container has nothing tabbable', () => {
    container.innerHTML = '<p>Nothing</p><button disabled>Off</button>';
    outside.focus();
    const event = tab();
    wrapTabWithin(container, event);
    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(outside);
  });
});
