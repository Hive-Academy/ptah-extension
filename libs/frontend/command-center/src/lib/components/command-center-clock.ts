import { DestroyRef, NgZone, inject, signal } from '@angular/core';

export function commandCenterClock() {
  const now = signal(Date.now());
  // Outside the zone so a pending interval never keeps the app unstable; the signal write still schedules change detection.
  const timer = inject(NgZone).runOutsideAngular(() =>
    setInterval(() => now.set(Date.now()), 30_000),
  );
  inject(DestroyRef).onDestroy(() => clearInterval(timer));
  return now.asReadonly();
}
