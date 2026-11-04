import { inject } from '@angular/core';
import type { CanMatchFn } from '@angular/router';
import { isReviewSurfaceAvailable, VSCodeService } from '@ptah-extension/core';

/** Reject the route before the review page chunk is requested. */
export const reviewOnlySurface: CanMatchFn = () =>
  isReviewSurfaceAvailable(inject(VSCodeService));
