import type { ApplicationRef } from '@angular/core';
import { APP_STABLE_ATTRIBUTE, markAppStable } from './app-stable-marker';

function fakeAppRef(whenStable: () => Promise<void>): ApplicationRef {
  return { whenStable } as unknown as ApplicationRef;
}

describe('markAppStable', () => {
  let doc: Document;

  beforeEach(() => {
    doc = document.implementation.createHTMLDocument('stable');
  });

  it('sets data-app-stable="true" once the app reports stable', async () => {
    await markAppStable(
      fakeAppRef(() => Promise.resolve()),
      doc,
    );

    expect(doc.documentElement.getAttribute(APP_STABLE_ATTRIBUTE)).toBe('true');
  });

  it('does not set the attribute before the app is stable', async () => {
    let becomeStable: () => void = () => undefined;
    const stable = new Promise<void>((resolve) => (becomeStable = resolve));

    const marking = markAppStable(
      fakeAppRef(() => stable),
      doc,
    );
    // Let every already-queued microtask run: still not stable.
    await Promise.resolve();
    await Promise.resolve();
    expect(doc.documentElement.hasAttribute(APP_STABLE_ATTRIBUTE)).toBe(false);

    becomeStable();
    await marking;
    expect(doc.documentElement.getAttribute(APP_STABLE_ATTRIBUTE)).toBe('true');
  });

  it('never sets the attribute for an app that never becomes stable', async () => {
    jest.useFakeTimers();
    try {
      void markAppStable(
        fakeAppRef(() => new Promise<void>(() => undefined)),
        doc,
      );
      // No timeout fallback: however long the wait, no attribute.
      await jest.advanceTimersByTimeAsync(60_000);
      expect(doc.documentElement.hasAttribute(APP_STABLE_ATTRIBUTE)).toBe(
        false,
      );
    } finally {
      jest.useRealTimers();
    }
  });
});
