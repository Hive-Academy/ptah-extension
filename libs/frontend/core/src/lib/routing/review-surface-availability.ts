import type { VSCodeService } from '../services/vscode.service';

/** P1 review is advertised only by the Electron host profile. */
export function isReviewSurfaceAvailable(
  host: Pick<VSCodeService, 'isElectron'>,
): boolean {
  return host.isElectron;
}
