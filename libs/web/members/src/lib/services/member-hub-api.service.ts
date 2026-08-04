import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';

import {
  memberHubResponseSchema,
  type MemberHubResponse,
} from '@ptah-contracts/community';
import { validate } from '@ptah-web/core';

/**
 * MemberHubApiService — the member hub's ONE data call.
 *
 * ⚠️ R6.2: the hub's initial render costs EXACTLY ONE REQUEST. That is the
 * whole reason `GET /api/v1/members/hub` exists as an aggregate rather than as
 * five per-section endpoints the client stitches together. A hub composed
 * client-side would put five round trips on the critical path of the first
 * screen a paying member sees, and would make a single slow section delay all
 * of them. `member-hub-api.service.spec.ts` asserts the call count, and
 * `ptah-landing-page-e2e` re-asserts it over the network, unchanged, in every
 * later phase.
 *
 * ⚠️ NO CACHING LAYER HERE, AND NO `shareReplay`. `HubPage` subscribes once per
 * activation; a replayed cache would hand a member a stale "next session" after
 * the one they were waiting for started. Freshness is the point of the screen.
 *
 * URLs stay relative — `apiInterceptor` prepends `environment.apiBaseUrl` and
 * sets `withCredentials: true` so the `ptah_auth` cookie is attached.
 */
@Injectable({ providedIn: 'root' })
export class MemberHubApiService {
  private readonly http = inject(HttpClient);

  /**
   * `GET /api/v1/members/hub`.
   *
   * The response is parsed against `memberHubResponseSchema` from
   * `@ptah-contracts/community` — the SAME schema the server's contract tests
   * assert against. This lib declares no response shapes of its own; a
   * re-declared envelope is exactly the drift that contracts lib exists to
   * prevent.
   *
   * Errors propagate. The section-level `'unavailable'` status already covers a
   * degraded dependency with a `200`, so an actual error here means the hub
   * itself failed, and the page must say so rather than render five empty cards
   * that read as "you have nothing".
   */
  public getHub(): Observable<MemberHubResponse> {
    return this.http
      .get<unknown>('/api/v1/members/hub')
      .pipe(map(validate(memberHubResponseSchema, 'GET /members/hub')));
  }
}
