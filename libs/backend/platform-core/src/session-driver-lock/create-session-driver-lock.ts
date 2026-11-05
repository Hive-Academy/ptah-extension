import type { ISessionDriverLock } from '../interfaces/session-driver-lock.interface';
import { KernelSessionDriverLock } from './kernel-session-driver-lock';
import { NullSessionDriverLock } from './null-session-driver-lock';

let warnedDarwin = false;

/** Selects the supported kernel lock for the current host. */
export function createSessionDriverLock(): ISessionDriverLock {
  if (process.platform === 'darwin') {
    if (!warnedDarwin) {
      warnedDarwin = true;
      console.warn('[driver-lock] session driver lock disabled on darwin');
    }
    return new NullSessionDriverLock();
  }
  return new KernelSessionDriverLock();
}
