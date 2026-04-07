import { HttpInterceptorFn } from '@angular/common/http';
import { environment } from '../../environments/environment';

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
  // Only intercept API and auth requests
  const isApiRequest =
    req.url.startsWith('/api') || req.url.startsWith('/auth');

  if (!isApiRequest) {
    return next(req);
  }

  // Clone request with:
  // 1. Full URL (base + path) for production cross-origin support
  // 2. withCredentials for cookie authentication
  const apiReq = req.clone({
    url: `${environment.apiBaseUrl}${req.url}`,
    withCredentials: true,
  });

  return next(apiReq);
};
