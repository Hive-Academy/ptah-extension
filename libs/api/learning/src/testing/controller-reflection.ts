import { RequestMethod, type Type } from '@nestjs/common';
import {
  METHOD_METADATA,
  PATH_METADATA,
  ROUTE_ARGS_METADATA,
} from '@nestjs/common/constants';

/**
 * Decorator readers shared by this lib's five controller specs.
 *
 * ⚠️ SIBLING FILE: `libs/api/forum/src/testing/controller-reflection.ts`. A
 * re-declaration for the same reason as the rest of this lib's shared code
 * (AD-5's copy-rather-than-share decision): forum's `src/testing/` is excluded
 * from its `tsconfig.lib.json` and is not barrel-exported, so it cannot be
 * imported from here without widening a public surface for test helpers. The two
 * must change together.
 *
 * ⚠️ WHY IT EXISTS RATHER THAN FIVE COPIES INSIDE THIS LIB. Each controller spec
 * asserts the same four structural properties — the route table, the guard
 * chain, the `dtoPipe` binding, and the absence of named-primitive query params
 * — and each needs the same three metadata readers. Written five times, the
 * readers drift, and the `RequestMethod.GET === 0` trap below is the drift that
 * matters: a falsy check silently drops EVERY `GET` route and leaves a
 * route-table assertion passing against a shorter list. Three of this lib's five
 * controllers have `GET` handlers.
 *
 * ⚠️ IT IS NOT A SECOND `route-map.spec.ts`. The server's copy is the BUILD GATE
 * and covers every controller in the server, including the RI-1/RI-2/RI-3
 * cross-controller analysis these readers deliberately do not attempt. This is
 * the lib-local mirror, so a broken decorator fails in the project that owns the
 * file, with the handler named, before the server suite reports a count.
 *
 * Lives under `src/testing/` — excluded from `tsconfig.lib.json` and not
 * exported from the barrel, exactly like `mock-learning-prisma.ts`.
 */

/** Nest's `RouteParamtypes` values for the decorators these specs read. */
export const ROUTE_PARAMTYPES = { BODY: 3, QUERY: 4, PARAM: 5 } as const;

export interface RouteArg {
  /** One of {@link ROUTE_PARAMTYPES}. */
  readonly paramtype: number;
  /**
   * The key name for a NAMED param (`@Query('q')`, `@Param('id')`), and
   * `undefined` for a whole-object bind — the exact discriminator
   * `controller-validation.spec.ts` uses for its named-primitive carve-out, and
   * therefore the exact thing `NAMED_PRIMITIVE_PARAM_COUNT = 6` counts.
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
 * order (V8 preserves definition order for string-keyed own properties, which is
 * also what Nest's own `MetadataScanner` relies on — and is why RI-3's
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

/**
 * Do two normalised paths UNIFY — i.e. could one concrete request match both?
 *
 * ⚠️ THIS IS THE ANTI-VACUITY HALF OF EVERY RI-3 ASSERTION IN THIS LIB. "The
 * literal is declared before the parameter" is decoration unless the two paths
 * genuinely contest; this batch adds THREE such pairs (`…/reorder` before
 * `…/:id` on all three admin controllers), and the assertion is only worth
 * having if each pair is checked to unify first.
 *
 * Same segment count, and every position either matches literally or has a
 * parameter on at least one side. It mirrors `route-map.spec.ts`'s `unifiable()`
 * without importing across the project boundary.
 */
export function unifies(a: string, b: string): boolean {
  const left = a.split('/');
  const right = b.split('/');
  if (left.length !== right.length) return false;

  return left.every((segment, i) => {
    const other = right[i] as string;
    return (
      segment === other || segment.startsWith(':') || other.startsWith(':')
    );
  });
}

/** How many `:param` segments a normalised path carries. */
export function paramCount(path: string): number {
  return path.split('/').filter((segment) => segment.startsWith(':')).length;
}
