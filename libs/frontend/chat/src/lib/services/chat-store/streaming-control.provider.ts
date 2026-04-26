/**
 * provideStreamingControl — Composition-root helper for binding the
 * STREAMING_CONTROL token to its concrete implementation.
 *
 * TASK_2026_103 Wave B1. Usage in app.config.ts:
 *
 *   providers: [
 *     ...
 *     ...provideStreamingControl(),
 *   ]
 *
 * Returns an array (spreadable) so callers can mix it with other providers.
 */

import { Provider } from '@angular/core';
import { STREAMING_CONTROL } from '@ptah-extension/chat-state';

import { StreamingControlImpl } from './streaming-control-impl.service';

export function provideStreamingControl(): Provider[] {
  return [{ provide: STREAMING_CONTROL, useExisting: StreamingControlImpl }];
}
