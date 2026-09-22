import { Injectable, signal } from '@angular/core';

/** Invalidates effective-setting snapshots around runtime effort writes. Contains no values. */
@Injectable({ providedIn: 'root' })
export class EffortSettingsChangeService {
  private readonly revisionState = signal(0);
  private readonly pendingState = signal(0);
  readonly revision = this.revisionState.asReadonly();
  readonly pending = this.pendingState.asReadonly();

  beginWrite(): () => void {
    this.pendingState.update((count) => count + 1);
    this.revisionState.update((revision) => revision + 1);
    return () => {
      this.pendingState.update((count) => count - 1);
      this.revisionState.update((revision) => revision + 1);
    };
  }
}
