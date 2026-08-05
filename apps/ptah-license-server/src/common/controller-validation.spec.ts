import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, sep } from 'node:path';
import { ValidationPipe, type Type } from '@nestjs/common';
import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants';

import {
  ALL_CONTROLLERS,
  CONTROLLER_ROOTS,
  WORKSPACE_ROOT,
  findControllerFiles,
} from '../testing/controller-registry';

/**
 * SERVER-WIDE INPUT-VALIDATION STRUCTURAL GUARD (TASK_2026_170, plan §7).
 *
 * ⚠️ WHY THIS TEST EXISTS.
 * esbuild does not implement `emitDecoratorMetadata`, so Nest cannot infer a
 * handler parameter's DTO class and the globally-registered `ValidationPipe`
 * short-circuits on `if (!metatype) return value;`. The practical effect is
 * that a bare `@Body() dto: X` is SILENTLY UNVALIDATED: every `@Matches` /
 * `@MaxLength` / `@IsUUID` cap and `forbidNonWhitelisted` becomes inert. This
 * was live and demonstrated —
 * `POST /admin/groups {"key":"INVALID KEY WITH SPACES!!"}` returned 201.
 *
 * `dtoPipe(X)` fixes it per-parameter via `ValidationPipe`'s `expectedType`
 * (see `src/common/dto-validation.pipe.ts`). Without this test that fix rots
 * exactly the way the bug did: the next contributor copies a bare `@Body()`
 * from somewhere else and ships an endpoint whose validation does nothing.
 *
 * HISTORY: this began life as "G7" inside `src/admin/admin-guards.spec.ts`
 * (TASK_2026_169). It was moved here by TASK_2026_170 for two reasons —
 *  (1) it now covers non-admin, mostly-PUBLIC controllers, which have no
 *      business being asserted under a file named `admin-guards`; and
 *  (2) its enumerator could not tell `@Query()` (whole object → DTO) from
 *      `@Query('code')` (named primitive → string), so adding `AuthController`
 *      to it produced five FALSE failures for params that can never bind a DTO.
 * `src/common/` is the right home: the guard now sits beside the mechanism it
 * guards (`dto-validation.pipe.ts`).
 *
 * Deliberately dependency-free — no Postgres, no Nest bootstrap, no docker.
 *
 * The controller list itself lives in `src/testing/controller-registry.ts`
 * (TASK_2026_170 R1), shared with `route-map.spec.ts` so the two structural
 * guards can never disagree about what "every controller" means. That module
 * documents why it is an explicit import list rather than module-graph
 * reflection, and it also owns `SRC` / `findControllerFiles`, the inputs to the
 * CENSUS assertion below which scans the source tree and fails if any
 * `*.controller.ts` is missing from the list.
 */

/** Nest's `RouteParamtypes` values for the two decorators carrying a payload. */
const PARAMTYPE = { BODY: 3, QUERY: 4 } as const;

/**
 * Controllers whose payload params are not yet bound. This list only ever
 * SHRINKS. TASK_2026_170 empties it, one controller per commit.
 *
 * ✅ EMPTY as of TASK_2026_170 B9. Every whole-object `@Body()` / `@Query()`
 * param in this server now binds a `ValidationPipe` carrying `expectedType`,
 * so the "no enforced controller has an unbound payload param" assertion below
 * covers the entire surface and the staleness assertion passes vacuously.
 *
 * Keyed on `ALL_CONTROLLERS[].label`, never on `controller.name` — see the note
 * on `ALL_CONTROLLERS` about the `AdminController` class-name collision that
 * TASK_2026_170 R2/R3 removed, and why path-qualified labels outlive it.
 *
 * ⚠️ THIS LIST IS NOT AN ESCAPE HATCH. It exists to let a large migration land
 * one revertible commit at a time; that migration is finished. Do not re-add a
 * name to unblock a merge — bind the param instead. If you genuinely believe a
 * new controller cannot be bound, it belongs in `EXCLUDED` below with a written
 * reason, not here.
 *
 * ⚠️ Only list a controller that ACTUALLY has an unbound whole-object payload
 * param. The staleness assertion below rejects entries for controllers with
 * nothing left to bind, which is what stops the ledger rotting in the other
 * direction.
 */
const UNVALIDATED_DEBT: readonly string[] = [];

/**
 * Permanently excluded from the binding rule — expressed as DATA so the reason
 * travels with the exclusion and the exclusion itself is asserted.
 *
 * `PaddleController` is deliberately NOT listed: it has no payload param at all
 * (it reads `req.rawBody` via `@Req()`), so listing it would be a lie that the
 * "still has an unbound param" assertion below would catch.
 */
const EXCLUDED: ReadonlyArray<{
  readonly label: string;
  readonly reason: string;
}> = [
  {
    label: 'marketing/ResendWebhookController',
    reason:
      'TASK_2026_170 locked decision: third-party payload shapes change without notice; ' +
      'forbidNonWhitelisted would 400 valid webhooks the first time Resend adds a field. ' +
      'ResendWebhookPayload is also an interface, not a class, so it cannot be an expectedType.',
  },
];

/**
 * Server-wide anti-vacuity floor.
 *
 * This is a FLOOR, NOT A TARGET. If Nest's route-args metadata key format ever
 * changes underneath us, the enumerator silently discovers zero params and
 * every "all params are bound" assertion passes vacuously. Asserting a minimum
 * total makes that failure loud and immediate.
 *
 * Counted from source on 2026-08-01: 39 `@Body()`/`@Query()` params across every
 * controller in `ALL_CONTROLLERS` (31 whole-object + 8 named-primitive).
 * Re-counted 2026-08-04 at **37** (31 whole-object + 6 named-primitive) after
 * TASK_2026_177 P1b deleted three controllers with the forum integration.
 * Re-derived 2026-08-04 at **51** (45 whole-object + 6 named-primitive) after
 * TASK_2026_177 P2 added the five `libs/api/forum` controllers.
 * Re-derived 2026-08-05 at **67** (61 whole-object + 6 named-primitive) after
 * TASK_2026_177 P3 added the five `libs/api/learning` controllers. Raise it only
 * when you have counted again.
 *
 * ⚠️ THE -2, AND THEN THE +14, ARE BOTH ACCOUNTED FOR — WHICH IS THE ONLY
 * REASON MOVING THIS NUMBER IS SAFE. A floor that is edited whenever it fails is
 * not a floor.
 *
 * The 39 → 37 drop was entirely the SSO controller's two named primitives
 * (`sso`, `sig`) — which is why `NAMED_PRIMITIVE_PARAM_COUNT` went 8 → 6 in the
 * same change while the whole-object count stayed at 31.
 *
 * The 37 → 51 rise is entirely whole-object params on the five new forum
 * controllers, and it decomposes exactly:
 *
 *   forum/MemberCommunityController              8   (2 @Query + 6 @Body)
 *   forum/MemberSearchController                 1   (1 @Query)
 *   forum/AdminCommunityCategoriesController     3   (3 @Body)
 *   forum/AdminCommunityTopicsController         2   (1 @Query + 1 @Body)
 *   forum/AdminCommunityPostsController          0   (delete + restore only)
 *                                              ---
 *                                               14   31 + 14 = 45 whole-object
 *
 * `NAMED_PRIMITIVE_PARAM_COUNT` is UNCHANGED at 6, and that is the load-bearing
 * half: it is an exact-equality assertion (RISK-I), so every `@Query()` in
 * `libs/api/forum` had to bind a whole-object DTO. It does — `ListTopicsQueryDto`,
 * `ThreadQueryDto`, `SearchQueryDto` and `ListAdminTopicsQueryDto`, each with
 * `@Type(() => Number)` on its numeric fields so `dtoPipe`'s `transform: true`
 * has a target. Had one `@Query('q') q: string` slipped in, the total would read
 * 51 against a named count of 7 and the arithmetic here would not close.
 *
 * The 51 → 67 rise is entirely whole-object params on the five new learning
 * controllers, and it decomposes exactly:
 *
 *   learning/MemberCoursesController             2   (2 @Body)
 *   learning/MemberLessonCommentsController      3   (3 @Body)
 *   learning/AdminCoursesController              4   (4 @Body)
 *   learning/AdminCourseModulesController        3   (3 @Body)
 *   learning/AdminLessonsController              4   (4 @Body)
 *                                              ---
 *                                               16   45 + 16 = 61 whole-object
 *                                                    61 +  6 = 67 total
 *
 * ⚠️ EVERY ONE OF THE SIXTEEN IS A `@Body()`; THIS BATCH ADDED NO `@Query()` AT
 * ALL. That is not an accident of the surface — the member course list is
 * unpaged (a curriculum is tens of courses, not thousands), the admin course
 * list takes no filters, and plan §3.4's admin table has no `?includeDeleted`
 * for courses. So `NAMED_PRIMITIVE_PARAM_COUNT` is UNCHANGED at 6, which is the
 * load-bearing half: it is an exact-equality assertion (RISK-I), and a single
 * `@Query('slug') slug: string` anywhere in `libs/api/learning` would make the
 * total read 68 against a named count of 7 and the arithmetic here would not
 * close.
 *
 * ⚠️ THE FOUR `@Param()`s PER LESSON ROUTE ARE NOT COUNTED BY EITHER NUMBER, and
 * that is correct rather than a gap: `paramBindings` filters on
 * `PARAMTYPE.BODY | QUERY`, because `@Param('slug')` binds a path segment that
 * Express has already produced and `dtoPipe` has nothing to validate it against.
 * `GET v1/members/courses/:slug/lessons/:lessonSlug` therefore contributes zero
 * to both, despite carrying two route params.
 *
 * ⚠️ It is ALSO the arithmetic check on TASK_2026_170's controller splits. R2
 * turned one 6-param `admin/AdminController` into five controllers holding
 * 2 + 2 + 1 + 1 + 0 = 6 params. A split MOVES params; it can never add or
 * remove one, so this total must read EXACTLY the same across a split. That
 * property is intact — a DELETION is the one thing that legitimately lowers it,
 * and it must be justified in this docblock, as above, every time.
 *
 * ⚠️ LEAVING IT AT 37 WOULD HAVE BEEN THE REAL FAILURE. The assertion is
 * `>= MIN`, so a stale floor does not fail — it silently stops covering the
 * surface it was written for. At 37 against an actual 51, fourteen params could
 * have vanished before this test noticed; at 51 against an actual 67, sixteen
 * could. That is the whole argument for re-deriving the floor in every batch
 * that adds a controller, and it is why "it still passes" is not a reason to
 * leave it alone.
 *
 * HOW EACH RE-DERIVATION ABOVE WAS DONE, so the next one is mechanical rather
 * than a recount by eye: set this constant to `9999`, run
 * `npx nx test ptah-license-server --skip-nx-cache --testPathPatterns=controller-validation`,
 * and read the ACTUAL total out of the failure message
 * (`Expected: >= 9999 / Received: 67`), then restore it to that number and write
 * the per-controller breakdown here so the arithmetic closes.
 */
const MIN_TOTAL_PAYLOAD_PARAMS = 67;

/**
 * Named-primitive params — `@Query('code') code: string` — bind a STRING, not a
 * DTO, so `dtoPipe` is meaningless for them and demanding an `expectedType`
 * would produce false failures.
 *
 * The discriminator is Nest's own route-args metadata value `{ index, data,
 * pipes }`: `data` holds the key name for a named param and is `undefined` for
 * a whole-object bind. Verified at
 * `node_modules/@nestjs/common/decorators/http/route-params.decorator.js` —
 * `createPipesRouteParamDecorator` sets `paramData = isNil(data) || isString(data)
 * ? data : undefined`, so passing a pipe as the first argument
 * (`@Query(dtoPipe(X))`) leaves `data` undefined while `@Query('code')` leaves
 * it `'code'`.
 *
 * Counted from source on 2026-08-01, re-counted 2026-08-04 after TASK_2026_177
 * P1b deleted the forum SSO controller (which held `sso` and `sig`, two of the
 * original eight): 6 —
 *   app/auth/auth.controller.ts:246,247,478,858,859   (code, state, token, returnUrl, plan)
 *   events/events.controller.ts:78                    (ticket)
 * Asserted EXACTLY, not as a floor: a seventh named primitive must fail this test
 * so a contributor has to consciously accept it. The carve-out cannot silently
 * grow. Hardening these with `ParseUUIDPipe`/`@IsString` wrappers is recorded
 * in `.ptah/specs/TASK_2026_170/future-enhancements.md`.
 */
const NAMED_PRIMITIVE_PARAM_COUNT = 6;

interface ParamBinding {
  /** `<label>.<handler>` — so a failure names the exact offending handler. */
  handler: string;
  kind: 'Body' | 'Query';
  /** True for `@Query('code')`-style named primitives (route-args `data` set). */
  named: boolean;
  /** True when a `ValidationPipe` carrying `expectedType` is bound. */
  validated: boolean;
}

/**
 * Enumerate every `@Body()` / `@Query()` parameter on a controller and report
 * its kind, whether it is a named primitive, and whether it binds a
 * `dtoPipe(...)` / `passthroughDtoPipe(...)` — i.e. a `ValidationPipe` carrying
 * an explicit `expectedType`.
 */
function paramBindings(
  label: string,
  controller: Type<unknown>,
): ParamBinding[] {
  const proto = controller.prototype as object;
  const handlers = Object.getOwnPropertyNames(proto).filter(
    (name) => name !== 'constructor',
  );

  const bindings: ParamBinding[] = [];
  for (const handler of handlers) {
    const meta =
      (Reflect.getMetadata(ROUTE_ARGS_METADATA, controller, handler) as Record<
        string,
        { data?: unknown; pipes?: unknown[] }
      >) ?? {};

    for (const [key, value] of Object.entries(meta)) {
      const paramtype = Number(key.split(':')[0]);
      if (paramtype !== PARAMTYPE.BODY && paramtype !== PARAMTYPE.QUERY) {
        continue;
      }
      const validated = (value.pipes ?? []).some(
        (pipe) =>
          pipe instanceof ValidationPipe &&
          (pipe as ValidationPipe & { expectedType?: unknown }).expectedType !==
            undefined,
      );
      bindings.push({
        handler: `${label}.${handler}`,
        kind: paramtype === PARAMTYPE.BODY ? 'Body' : 'Query',
        named: value.data !== undefined,
        validated,
      });
    }
  }
  return bindings;
}

/** Whole-object payload params only — the ones `dtoPipe` actually applies to. */
function payloadBindings(
  label: string,
  controller: Type<unknown>,
): ParamBinding[] {
  return paramBindings(label, controller).filter((b) => !b.named);
}

function bindingsFor(label: string): ParamBinding[] {
  const entry = ALL_CONTROLLERS.find((c) => c.label === label);
  if (!entry) {
    throw new Error(`Unknown controller label: ${label}`);
  }
  return payloadBindings(entry.label, entry.controller);
}

describe('Server-wide input validation — structural guard', () => {
  const ENFORCED = ALL_CONTROLLERS.filter(
    (c) =>
      !UNVALIDATED_DEBT.includes(c.label) &&
      !EXCLUDED.some((e) => e.label === c.label),
  );

  describe('the controller census is complete (the ledger can only work if it is)', () => {
    // The ledger's guarantee — "add a new controller with a bare @Body() and
    // the suite fails" — is only true if the new controller is IN
    // ALL_CONTROLLERS. Since that list is hand-maintained, this scans the
    // source trees and fails when the two drift. Cheap, infra-free, and it
    // closes the one hole an import list otherwise leaves open.
    //
    // Scans EVERY controller root — this app plus each extracted libs/api/*
    // domain — so a controller stays covered after its domain moves out.
    it('every *.controller.ts under the controller roots appears in ALL_CONTROLLERS', () => {
      const onDisk = findControllerFiles().sort();
      const listed = ALL_CONTROLLERS.map((c) => c.file).sort();

      expect(listed).toEqual(onDisk);
    });

    // Guards the census against silently scanning nothing: if root discovery
    // ever returned an empty or app-only list while controllers lived in libs,
    // the assertion above would pass vacuously for the missing tree.
    it('the controller roots include this app and every api lib', () => {
      const libRoots = CONTROLLER_ROOTS.filter((root) =>
        root.split(sep).join('/').includes('/libs/api/'),
      );
      const apiLibsDir = join(WORKSPACE_ROOT, 'libs', 'api');
      const expectedLibCount = existsSync(apiLibsDir)
        ? readdirSync(apiLibsDir, { withFileTypes: true }).filter(
            (entry) =>
              entry.isDirectory() &&
              existsSync(join(apiLibsDir, entry.name, 'src')),
          ).length
        : 0;

      expect(CONTROLLER_ROOTS.length).toBe(1 + expectedLibCount);
      expect(libRoots.length).toBe(expectedLibCount);
    });

    it('each ALL_CONTROLLERS entry names the class its file exports', () => {
      for (const { file, controller } of ALL_CONTROLLERS) {
        const source = readFileSync(
          join(WORKSPACE_ROOT, ...file.split('/')),
          'utf8',
        );
        const exported = [
          ...source.matchAll(/^export class (\w+Controller)\b/gm),
        ].map((m) => m[1]);

        expect({ file, exported }).toEqual({
          file,
          exported: [controller.name],
        });
      }
    });

    it('labels are unique and each maps to a distinct class', () => {
      const labels = ALL_CONTROLLERS.map((c) => c.label);
      expect(new Set(labels).size).toBe(labels.length);

      const classes = ALL_CONTROLLERS.map((c) => c.controller);
      expect(new Set(classes).size).toBe(classes.length);
    });
  });

  describe('every whole-object payload param binds a ValidationPipe with expectedType', () => {
    it.each(ENFORCED.map((c) => [c.label, c] as const))(
      '%s',
      (_label, entry) => {
        for (const binding of payloadBindings(entry.label, entry.controller)) {
          // Assert on the whole object so a failure NAMES the exact handler.
          expect(binding).toEqual({
            handler: binding.handler,
            kind: binding.kind,
            named: false,
            validated: true,
          });
        }
      },
    );

    it('no enforced controller has an unbound payload param (aggregate view)', () => {
      const offenders = ENFORCED.flatMap((c) =>
        payloadBindings(c.label, c.controller),
      )
        .filter((b) => !b.validated)
        .map((b) => `${b.handler} (@${b.kind}())`);

      expect(offenders).toEqual([]);
    });
  });

  describe('UNVALIDATED_DEBT — the shrinking ledger', () => {
    it('only names controllers that exist in ALL_CONTROLLERS', () => {
      const known = ALL_CONTROLLERS.map((c) => c.label);
      for (const label of UNVALIDATED_DEBT) {
        expect(known).toContain(label);
      }
    });

    // STALENESS. Without this, doing the binding work but forgetting to delete
    // the ledger line leaves the controller permanently exempt — the ledger
    // would rot silently in the direction nobody checks. With it, the ledger is
    // un-rottable in BOTH directions:
    //   remove a name without binding   -> the main assertion above fails
    //   bind without removing the name  -> this assertion fails
    //   add a controller with bare @Body() -> not in the ledger -> main fails
    //
    // ⚠️ This is ONE aggregate test that loops, not `it.each(UNVALIDATED_DEBT)`.
    // Jest throws "`.each` called with an empty Array of table data" on an empty
    // table, and an EMPTY ledger is precisely the end state TASK_2026_170 drives
    // to — a parameterised form would have turned success into a suite failure
    // on the final commit. Looping keeps the assertion vacuous at zero entries
    // while still NAMING every stale label when there are some.
    it('every entry still has an unbound param (delete the line once it does not)', () => {
      const stale = UNVALIDATED_DEBT.filter((label) =>
        bindingsFor(label).every((b) => b.validated),
      );

      expect(stale).toEqual([]);
    });
  });

  describe('EXCLUDED — permanent, documented carve-outs', () => {
    it('is disjoint from UNVALIDATED_DEBT (a controller cannot hide in both)', () => {
      const overlap = EXCLUDED.map((e) => e.label).filter((label) =>
        UNVALIDATED_DEBT.includes(label),
      );

      expect(overlap).toEqual([]);
    });

    it.each(EXCLUDED.map((e) => [e.label, e.reason] as const))(
      '%s still exists, still has an unbound param, and carries a reason',
      (label, reason) => {
        expect(ALL_CONTROLLERS.map((c) => c.label)).toContain(label);
        expect(reason.length).toBeGreaterThan(40);

        // The exclusion must not outlive its subject: if someone later binds
        // this param, the exclusion is dead weight and must be deleted.
        const unbound = bindingsFor(label).filter((b) => !b.validated);
        expect({ label, unbound: unbound.length > 0 }).toEqual({
          label,
          unbound: true,
        });
      },
    );
  });

  describe('anti-vacuity', () => {
    it(`discovers at least ${MIN_TOTAL_PAYLOAD_PARAMS} payload params server-wide`, () => {
      const total = ALL_CONTROLLERS.flatMap((c) =>
        paramBindings(c.label, c.controller),
      ).length;

      expect(total).toBeGreaterThanOrEqual(MIN_TOTAL_PAYLOAD_PARAMS);
    });

    it(`carves out exactly ${NAMED_PRIMITIVE_PARAM_COUNT} named-primitive params`, () => {
      const named = ALL_CONTROLLERS.flatMap((c) =>
        paramBindings(c.label, c.controller),
      )
        .filter((b) => b.named)
        .map((b) => b.handler)
        .sort();

      // Listed, not just counted, so a failure says WHICH param appeared.
      expect({ count: named.length, named }).toEqual({
        count: NAMED_PRIMITIVE_PARAM_COUNT,
        named,
      });
    });
  });
});
