import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { API_BASE_URL } from '../config/api-base-url.token';

/**
 * API Interceptor - Configures HTTP requests for backend API
 *
 * Responsibilities:
 * 1. Prepends API base URL for relative paths starting with /api or /auth
 * 2. Sets withCredentials: true for cookie-based authentication
 *
 * Why needed:
 * - Production deployment uses separate domains (e.g., ptah.live vs api.ptah.live)
 * - Auth cookies (ptah_auth) must be sent with cross-origin requests
 * - Without withCredentials, cookies are not sent on cross-origin requests
 *
 * Evidence: Code review finding P0-1 (HTTP credentials configuration)
 */
export const apiInterceptor: HttpInterceptorFn = (req, next) => {
  const isApiRequest =
    req.url.startsWith('/api') || req.url.startsWith('/auth');

  if (!isApiRequest) {
    return next(req);
  }

  // Interceptor functions run inside an injection context, so `inject()` is
  // legal here — but only on the path that actually needs the base URL.
  const apiBaseUrl = inject(API_BASE_URL);

  const apiReq = req.clone({
    url: `${apiBaseUrl}${req.url}`,
    withCredentials: true,
  });

  return next(apiReq);
};
