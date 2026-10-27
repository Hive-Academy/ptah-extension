import { Injector } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  focusNeighbourCard,
  restoreBoardFocus,
  survivingSessionControl,
} from './canvas-board-focus';

function board(html: string): HTMLElement {
  const root = document.createElement('div');
  root.innerHTML = html;
  document.body.appendChild(root);
  return root;
}

const CARD = (id: string) => `
  <li data-rail-card data-tab-id="${id}">
    <button type="button" class="rc-select">${id}</button>
    <div data-rail-actions><button type="button" class="rail-actions-trigger" aria-label="Session actions">⋮</button></div>
  </li>`;
const SIDEBAR = `
  <aside data-inspector-rail><button type="button" data-inspector-expand>‹</button></aside>`;

describe('canvas board focus', () => {
  afterEach(() => (document.body.innerHTML = ''));

  it('prefers the surviving pane menu while the split is still shown', () => {
    const root = board(`
      <section data-pane-side="left"><button type="button" data-header-menu>⋯</button></section>
      ${CARD('a')}${SIDEBAR}`);
    expect(survivingSessionControl(root, 'left', 'a')).toBe(
      root.querySelector('[data-header-menu]'),
    );
  });

  it("then the surviving session's card Session actions button, never another card's", () => {
    const root = board(`${CARD('a')}${CARD('b')}${SIDEBAR}`);
    expect(survivingSessionControl(root, 'left', 'b')).toBe(
      root.querySelector('[data-tab-id="b"] .rail-actions-trigger'),
    );
  });

  it('falls back to the card select button, then the sidebar expand control', () => {
    const root = board(`
      <li data-rail-card data-tab-id="a"><button type="button" class="rc-select">a</button></li>
      ${SIDEBAR}`);
    expect(survivingSessionControl(root, 'left', 'a')).toBe(root.querySelector('.rc-select'));
    expect(survivingSessionControl(root, 'left', 'gone')).toBe(
      root.querySelector('[data-inspector-expand]'),
    );
  });

  it('restores lost focus after the next render and leaves live focus alone', () => {
    const root = board(`${CARD('a')}${SIDEBAR}`);
    const injector = TestBed.inject(Injector);
    restoreBoardFocus(root, () => 'left', () => 'a', injector);
    TestBed.tick();
    expect(document.activeElement).toBe(root.querySelector('.rail-actions-trigger'));
    const expand = root.querySelector<HTMLElement>('[data-inspector-expand]')!;
    expand.focus();
    restoreBoardFocus(root, () => 'left', () => 'a', injector);
    TestBed.tick();
    expect(document.activeElement).toBe(expand);
  });

  it("moves focus lost with a closed card to the neighbour card's select button", () => {
    const root = board(`${CARD('a')}${CARD('c')}`);
    const closed = root.querySelector<HTMLElement>('[data-tab-id="a"] .rail-actions-trigger')!;
    closed.focus();
    root.querySelector('[data-tab-id="a"]')!.remove();
    focusNeighbourCard(root, 'c', TestBed.inject(Injector));
    TestBed.tick();
    expect(document.activeElement).toBe(root.querySelector('[data-tab-id="c"] .rc-select'));
  });

  it('moves focus lost with the last card to the empty board New session, then the footer one', () => {
    const footer = '<footer><button type="button" data-testid="canvas-footer-new-session">New session</button></footer>';
    // The empty board follows the rail in the DOM (it is only ordered first visually).
    const root = board(`${footer}<main><button type="button" data-testid="canvas-hero-new-session">New session</button></main>`);
    focusNeighbourCard(root, null, TestBed.inject(Injector));
    TestBed.tick();
    expect(document.activeElement).toBe(root.querySelector('[data-testid="canvas-hero-new-session"]'));
    document.body.innerHTML = '';
    const railOnly = board(footer);
    focusNeighbourCard(railOnly, null, TestBed.inject(Injector));
    TestBed.tick();
    expect(document.activeElement).toBe(railOnly.querySelector('[data-testid="canvas-footer-new-session"]'));
  });

  it('leaves live focus alone after a close (a pointer close kept it in the composer)', () => {
    const root = board(`${CARD('c')}<textarea></textarea>`);
    const composer = root.querySelector('textarea')!;
    composer.focus();
    focusNeighbourCard(root, 'c', TestBed.inject(Injector));
    TestBed.tick();
    expect(document.activeElement).toBe(composer);
  });
});
