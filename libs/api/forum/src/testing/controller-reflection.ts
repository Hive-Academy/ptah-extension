import { RequestMethod, type Type } from '@nestjs/common';
import {
  METHOD_METADATA,
  PATH_METADATA,
  ROUTE_ARGS_METADATA,
} from '@nestjs/common/constants';

/**
 * Decorator readers shared by this lib's five controller specs.
 *
 * ⚠️ WHY THIS EXISTS RATHER THAN FIVE COPIES. Each controller spec asserts the
 * same four structural properties — the route table, the guard chain, the
 * `dtoPipe` binding, and the absence of named-primitive query params — and each
 * needs the same three metadata readers to do it. Written five times, the
 * readers drift: the `RequestMethod.GET === 0` trap below is the one that
 * matters, because a falsy check silently drops EVERY `GET` route and leaves
 * a route-table assertion passing against a shorter list.
 *
 * ⚠️ IT IS NOT A SECOND `route-map.spec.ts`. The server's copy is the BUILD
 * GATE and covers every controller in the server, including the RI-1/RI-2/RI-3
 * cross-controller analysis these readers deliberately do not attempt. This is
 * the lib-local mirror, so a broken decorator fails in the project that owns
 * the file, with the handler named, before the server suite reports a count.
 *
 * Lives under `src/testing/` — excluded from `tsconfig.lib.json` and not
 * exported from the barrel, exactly like `mock-forum-prisma.ts`.
 */

/** Nest's `RouteParamtypes` values for the decorators these specs read. */
export const ROUTE_PARAMTYPES = { BODY: 3, QUERY: 4, PARAM: 5 } as const;

export interface RouteArg {
  /** One of {@link ROUTE_PARAMTYPES}. */
  readonly paramtype: number;
  /**
   * The key name for a NAMED param (`@Query('q')`, `@Param('id')`), and
   * `undefined` for a whole-object bind — the exact discriminator
   * `controller-validation.spec.ts` uses for its named-primitive carve-out.
   */
  readonly data: unknown;
  readonly pipes: unknown[];
}

/** Every `@Body()` / `@Query()` / `@Param()` binding on one handler. */
export function routeArgs(
  controller: Type<unknown>,
  handler: string,
): RouteArg[] {
  const meta =
    (Reflect.getMetadata(ROUTE_ARGS_METADATA, controller, handler) as Record<
      string,
      { data?: unknown; pipes?: unknown[] }
    >) ?? {};

  return Object.entries(meta).map(([key, value]) => ({
    paramtype: Number(key.split(':')[0]),
    data: value.data,
    pipes: value.pipes ?? [],
  }));
}

/**
 * Every method on the class that carries a route decorator, in DECLARATION
 * order (V8 preserves definition order for string-keyed own properties, which
 * is also what Nest's own `MetadataScanner` relies on — and is why RI-3's
 * intra-controller ordering is a real property rather than a style preference).
 *
 * ⚠️ `!== undefined`, NEVER A FALSY CHECK. `RequestMethod.GET === 0`.
 */
export function handlersOf(controller: Type<unknown>): string[] {
  const proto = controller.prototype as object;
  return Object.getOwnPropertyNames(proto).filter((name) => {
    if (name === 'constructor') return false;
    const fn = Object.getOwnPropertyDescriptor(proto, name)?.value as
      | object
      | undefined;
    if (!fn) return false;
    return Reflect.getMetadata(METHOD_METADATA, fn) !== undefined;
  });
}

/** `{ verb, path }` for one handler, with the controller prefix applied. */
export function routeOf(
  controller: Type<unknown>,
  handler: string,
): { verb: string; path: string } {
  const fn = Object.getOwnPropertyDescriptor(
    controller.prototype as object,
    handler,
  )?.value as object;

  const prefix = normalize(
    (Reflect.getMetadata(PATH_METADATA, controller) as string) ?? '',
  );
  const suffix = normalize(
    (Reflect.getMetadata(PATH_METADATA, fn) as string) ?? '',
  );

  return {
    verb: RequestMethod[
      Reflect.getMetadata(METHOD_METADATA, fn) as number
    ] as string,
    path: [prefix, suffix].filter(Boolean).join('/'),
  };
}

/** `'/'` → `''`; `'/a/b/'` → `'a/b'`. Matches `route-map.spec.ts`. */
function normalize(path: string): string {
  return path.split('/').filter(Boolean).join('/');
}
