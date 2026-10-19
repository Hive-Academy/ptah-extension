import { type WritableSignal, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { InspectorDockController } from './inspector-dock.controller';
import { InspectorDockWidthStore } from './inspector-dock-width.store';
import {
  type InspectorTabContext,
  InspectorShellController,
} from './inspector-shell.controller';

describe('InspectorDockController', () => {
  let shellWidth: WritableSignal<number>;
  let isOpen: WritableSignal<boolean>;
  let isModal: WritableSignal<boolean>;
  let tab: WritableSignal<InspectorTabContext | null>;
  let preference: WritableSignal<number | null>;
  let hosted: WritableSignal<boolean>;
  let toggle: jest.Mock;
  let commit: jest.Mock;
  let reset: jest.Mock;
  let dock: InspectorDockController;

  beforeEach(() => {
    shellWidth = signal(1124);
    isOpen = signal(true);
    isModal = signal(false);
    tab = signal<InspectorTabContext | null>({
      tabId: 'tab-1',
      mode: 'full',
      initialOpen: null,
    });
    preference = signal<number | null>(null);
    hosted = signal(true);
    toggle = jest.fn();
    commit = jest.fn((value: number) => preference.set(Math.round(value)));
    reset = jest.fn(() => preference.set(null));

    TestBed.configureTestingModule({
      providers: [
        InspectorDockController,
        {
          provide: InspectorShellController,
          useValue: { shellWidth, isOpen, isModal, tab, toggle },
        },
        {
          provide: InspectorDockWidthStore,
          useValue: { preference, commit, reset },
        },
      ],
    });
    dock = TestBed.inject(InspectorDockController);
    dock.bindHosted(() => hosted());
  });

  afterEach(() => TestBed.resetTestingModule());

  it('shows the slot only for a hosted, open, docked inspector', () => {
    expect(dock.slotShown()).toBe(true);
    hosted.set(false);
    expect(dock.slotShown()).toBe(false);
    hosted.set(true);
    isModal.set(true);
    expect(dock.slotShown()).toBe(false);
    isModal.set(false);
    tab.set(null);
    expect(dock.slotShown()).toBe(false);
    tab.set({ tabId: 'tab-1', mode: 'full', initialOpen: null });
    isOpen.set(false);
    expect(dock.slotShown()).toBe(false);
  });

  it('renders the default, then a draft, without persisting the draft', () => {
    expect(dock.width()).toBe(400);
    expect(dock.maxWidth()).toBe(500);
    dock.preview(452.4);
    expect(dock.width()).toBe(452);
    expect(commit).not.toHaveBeenCalled();
    dock.cancel();
    expect(dock.width()).toBe(400);
    expect(commit).not.toHaveBeenCalled();
  });

  it('commits a moved draft once and clears it', () => {
    dock.preview(480);
    dock.commit();
    expect(commit).toHaveBeenCalledWith(480);
    expect(dock.width()).toBe(480);
    dock.commit();
    expect(commit).toHaveBeenCalledTimes(1);
  });

  it('skips a commit equal to the shell-clamped width (no overwrite of a wider preference)', () => {
    preference.set(560);
    shellWidth.set(960);
    expect(dock.width()).toBe(336);
    dock.preview(336);
    dock.commit();
    expect(commit).not.toHaveBeenCalled();
    expect(preference()).toBe(560);
  });

  it('floors a fractional max so width never exceeds it (AC 3.2)', () => {
    preference.set(560);
    shellWidth.set(960.5);
    expect(dock.maxWidth()).toBe(336);
    expect(dock.width()).toBe(336);
    expect(dock.width()).toBeLessThanOrEqual(dock.maxWidth());
  });

  it('reset drops the draft and the preference', () => {
    preference.set(480);
    dock.preview(500);
    dock.reset();
    expect(reset).toHaveBeenCalledTimes(1);
    expect(dock.width()).toBe(400);
  });

  it('drops the draft and the resizing flag when the slot goes away', () => {
    dock.preview(470);
    dock.setResizing(true);
    expect(dock.width()).toBe(470);
    expect(dock.resizing()).toBe(true);

    isModal.set(true);
    expect(dock.slotShown()).toBe(false);
    isModal.set(false);
    expect(dock.width()).toBe(400);
    expect(dock.resizing()).toBe(false);
  });

  it('toggles with the tab button as the opener', () => {
    const host = document.createElement('div');
    const button = document.createElement('button');
    host.append(button);
    dock.toggleFromTab(host);
    expect(toggle).toHaveBeenCalledWith(button);
    dock.toggleFromTab(null);
    expect(toggle).toHaveBeenLastCalledWith(null);
  });
});
