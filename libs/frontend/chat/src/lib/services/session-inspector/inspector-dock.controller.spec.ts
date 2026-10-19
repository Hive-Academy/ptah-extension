import { type WritableSignal, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { InspectorDockController } from './inspector-dock.controller';
import { InspectorDockWidthStore } from './inspector-dock-width.store';

describe('InspectorDockController', () => {
  let availableWidth: WritableSignal<number>;
  let shown: WritableSignal<boolean>;
  let preference: WritableSignal<number | null>;
  let commit: jest.Mock;
  let reset: jest.Mock;
  let dock: InspectorDockController;

  function create(bind = true): void {
    TestBed.configureTestingModule({
      providers: [
        InspectorDockController,
        {
          provide: InspectorDockWidthStore,
          useValue: { preference, commit, reset },
        },
      ],
    });
    dock = TestBed.inject(InspectorDockController);
    if (bind)
      dock.bind(
        () => shown(),
        () => availableWidth(),
      );
  }

  beforeEach(() => {
    availableWidth = signal(1124);
    shown = signal(true);
    preference = signal<number | null>(null);
    commit = jest.fn((value: number) => preference.set(Math.round(value)));
    reset = jest.fn(() => preference.set(null));
  });

  afterEach(() => TestBed.resetTestingModule());

  it('renders the default tier and writes nothing while unbound', () => {
    create(false);
    expect(dock.slotShown()).toBe(false);
    expect(dock.width()).toBe(336);
    expect(dock.maxWidth()).toBe(560);
    dock.commit();
    expect(commit).not.toHaveBeenCalled();
  });

  it('follows the bound `shown` source', () => {
    create();
    expect(dock.slotShown()).toBe(true);
    shown.set(false);
    expect(dock.slotShown()).toBe(false);
  });

  it.each([
    [880, 336],
    [1124, 400],
    [1500, 448],
  ])('defaults to the tier for %p px available', (width, expected) => {
    create();
    availableWidth.set(width);
    expect(dock.width()).toBe(expected);
  });

  it('clamps to the max as the available width shrinks and keeps the preference', () => {
    create();
    preference.set(560);
    expect(dock.width()).toBe(560);
    availableWidth.set(672);
    expect(dock.maxWidth()).toBe(312);
    expect(dock.width()).toBe(312);
    expect(preference()).toBe(560);
    availableWidth.set(1124);
    expect(dock.width()).toBe(560);
  });

  it('renders a draft without persisting it, and cancel restores', () => {
    create();
    dock.preview(452.4);
    expect(dock.width()).toBe(452);
    expect(commit).not.toHaveBeenCalled();
    dock.cancel();
    expect(dock.width()).toBe(400);
    expect(commit).not.toHaveBeenCalled();
  });

  it('commits a moved draft once and clears it', () => {
    create();
    dock.preview(480);
    dock.commit();
    expect(commit).toHaveBeenCalledWith(480);
    expect(dock.width()).toBe(480);
    dock.commit();
    expect(commit).toHaveBeenCalledTimes(1);
  });

  it('skips a commit equal to the clamped width (no overwrite of a wider preference)', () => {
    create();
    preference.set(560);
    availableWidth.set(672);
    expect(dock.width()).toBe(312);
    dock.preview(312);
    dock.commit();
    expect(commit).not.toHaveBeenCalled();
    expect(preference()).toBe(560);
  });

  it('commits the host-clamped draft when the host shrinks mid-drag', () => {
    create();
    dock.preview(500);
    expect(dock.width()).toBe(500);
    availableWidth.set(760);
    expect(dock.maxWidth()).toBe(400);
    expect(dock.width()).toBe(400);
    dock.commit();
    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledWith(400);
    expect(preference()).toBe(400);
  });

  it('floors a fractional max so width never exceeds it (AC 3.2)', () => {
    create();
    preference.set(560);
    availableWidth.set(880.5);
    expect(dock.maxWidth()).toBe(520);
    expect(dock.width()).toBe(520);
  });

  it('reset drops the draft and the preference', () => {
    create();
    preference.set(480);
    dock.preview(500);
    dock.reset();
    expect(reset).toHaveBeenCalledTimes(1);
    expect(dock.width()).toBe(400);
  });

  it('drops the draft when `shown` goes false then true', () => {
    create();
    dock.preview(470);
    expect(dock.width()).toBe(470);
    shown.set(false);
    expect(dock.slotShown()).toBe(false);
    shown.set(true);
    expect(dock.width()).toBe(400);
  });
});
