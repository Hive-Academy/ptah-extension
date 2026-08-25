import { readFileSync } from 'fs';
import { join } from 'path';

import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { RequestMethod, type Type } from '@nestjs/common';
import { parse } from 'dotenv';

import {
  ALL_CONTROLLERS,
  WORKSPACE_ROOT,
} from '../testing/controller-registry';

/**
 * THE WORKOS CALLBACK URL AS AN EXECUTABLE ARTEFACT.
 *
 * ⚠️ WHY THIS TEST EXISTS.
 * `.env.prod.example` shipped `WORKOS_REDIRECT_URI=https://api.ptah.live/api/auth/callback`
 * while the route is, and always was, `/api/v1/auth/callback` — global prefix
 * `api` (main.ts) + `@Controller('v1/auth')` + `@Get('callback')`. `.env.example`
 * carried the same missing `v1` for local dev.
 *
 * Nothing catches that. The value is read straight into `AuthService.redirectUri`
 * (`libs/api/identity/src/lib/services/auth.service.ts`) and handed to WorkOS as
 * the authorization request's `redirectUri`, so WorkOS faithfully bounces the
 * browser to whatever it was told. The server never sees the request, the logs
 * are silent, and the user lands on:
 *
 *     {"message":"Cannot GET /api/auth/callback?code=…&state=…",
 *      "error":"Not Found","statusCode":404}
 *
 * — holding a valid authorization code, one path segment from home. The failure
 * surfaces only in a browser, only after a full round trip through WorkOS, and
 * only in whichever environment copied the bad example. All four deployment docs
 * had the URL right the whole time; the two files people actually `cp` had it
 * wrong. Nobody diffs an example against prose.
 *
 * A comment cannot fail a build. This can.
 *
 * Deliberately dependency-free — no Postgres, no Nest bootstrap, no WorkOS. Both
 * sides are DERIVED, never restated: the expected path is rebuilt from the
 * global prefix in `main.ts` plus `PATH_METADATA`/`METHOD_METADATA` off the real
 * controller class, and the actual value is read with dotenv's `parse()`, which
 * returns an object and touches `process.env` for nobody. Hardcoding
 * `/api/v1/auth/callback` here would just move the stale copy rather than
 * removing it — rename the controller and this spec must fail, not agree.
 */

const ENV_FILES = ['.env.example', '.env.prod.example'] as const;
const MAIN_TS = join(WORKSPACE_ROOT, 'apps/ptah-license-server/src/main.ts');

/** The `const globalPrefix = '…'` that main.ts passes to setGlobalPrefix. */
function readGlobalPrefix(): string {
  const source = readFileSync(MAIN_TS, 'utf8');
  const match = /const\s+globalPrefix\s*=\s*['"]([^'"]+)['"]/.exec(source);
  if (!match) {
    throw new Error(
      `Could not read globalPrefix from ${MAIN_TS}. If setGlobalPrefix stopped ` +
        `taking a literal, update this reader rather than hardcoding the prefix.`,
    );
  }
  return match[1];
}

/** `GET`-able paths on a controller, as `<controller-prefix>/<handler-path>`. */
function getRoutesOf(controller: Type<unknown>): string[] {
  const strip = (s: string) => s.replace(/^\/+|\/+$/g, '');
  const prefix = strip(
    (Reflect.getMetadata(PATH_METADATA, controller) as string) ?? '',
  );
  const proto = controller.prototype as object;

  const routes: string[] = [];
  for (const handler of Object.getOwnPropertyNames(proto)) {
    if (handler === 'constructor') continue;
    const fn = Object.getOwnPropertyDescriptor(proto, handler)?.value as
      | object
      | undefined;
    if (!fn) continue;

    // RequestMethod.GET === 0, so this MUST be an undefined check. A falsy
    // check would drop every GET route and pass vacuously.
    const method = Reflect.getMetadata(METHOD_METADATA, fn) as
      | RequestMethod
      | undefined;
    if (method === undefined || method !== RequestMethod.GET) continue;

    const path = strip(
      (Reflect.getMetadata(PATH_METADATA, fn) as string) ?? '',
    );
    routes.push([prefix, path].filter(Boolean).join('/'));
  }
  return routes;
}

const globalPrefix = readGlobalPrefix();

const allGetPaths = new Set(
  ALL_CONTROLLERS.flatMap((entry) =>
    getRoutesOf(entry.controller as Type<unknown>).map(
      (route) => `/${globalPrefix}/${route}`,
    ),
  ),
);

const envValues = new Map<string, string | undefined>(
  ENV_FILES.map((file) => [
    file,
    parse(readFileSync(join(WORKSPACE_ROOT, file), 'utf8'))[
      'WORKOS_REDIRECT_URI'
    ],
  ]),
);

describe('WORKOS_REDIRECT_URI matches a real callback route', () => {
  // Anti-vacuity. Every assertion below is a membership test against
  // `allGetPaths`; if the enumerator silently produced nothing, or the env
  // files stopped parsing, the interesting assertions would still "pass" for
  // the wrong reason.
  it('anti-vacuity: the route enumerator and the env reader both work', () => {
    expect(globalPrefix).toBe('api');
    expect(allGetPaths.size).toBeGreaterThan(10);
    for (const [file, value] of envValues) {
      expect(`${file}: ${value ?? '<missing>'}`).toMatch(/^\S+: https?:\/\//);
    }
  });

  // The route this is all about — derived, so renaming the controller or the
  // handler fails here instead of in a browser after a WorkOS round trip.
  it('the auth callback route exists under the global prefix', () => {
    expect([...allGetPaths]).toContain(`/${globalPrefix}/v1/auth/callback`);
  });

  it.each(ENV_FILES)(
    '%s points WORKOS_REDIRECT_URI at a route the server actually serves',
    (file) => {
      const value = envValues.get(file);
      expect(value).toBeDefined();

      const { pathname } = new URL(value as string);
      // The whole bug in one assertion: `/api/auth/callback` is not a route.
      expect([...allGetPaths]).toContain(pathname);
    },
  );
});
