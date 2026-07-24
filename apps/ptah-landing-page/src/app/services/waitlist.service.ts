import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

/** Response shape from `POST /api/v1/waitlist` (license-server contract). */
export type WaitlistJoinStatus = 'joined' | 'already_joined';

export interface WaitlistJoinResponse {
  readonly status: WaitlistJoinStatus;
}

/**
 * Where on the site the visitor applied from — mirrors the license-server
 * `source` field. `'early-adopter'` tags applications to the Early Adopter
 * program (approved contributors get a free first year of Builders).
 */
export type WaitlistSource =
  | 'landing'
  | 'pricing'
  | 'profile'
  | 'vscode'
  | 'early-adopter';

export interface WaitlistJoinRequest {
  readonly email: string;
  readonly source?: WaitlistSource;
}

/**
 * WaitlistService — thin HttpClient wrapper for the Ptah Builders waitlist.
 *
 * Pattern: relative `/api/v1/...` URL, resolved by `apiInterceptor`
 * (prepends `environment.apiBaseUrl` + sets `withCredentials`). Public,
 * throttled endpoint — no auth required.
 */
@Injectable({ providedIn: 'root' })
export class WaitlistService {
  private readonly http = inject(HttpClient);

  public join(request: WaitlistJoinRequest): Observable<WaitlistJoinResponse> {
    return this.http.post<WaitlistJoinResponse>('/api/v1/waitlist', request);
  }
}
