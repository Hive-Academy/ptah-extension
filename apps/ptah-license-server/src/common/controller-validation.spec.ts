import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { ValidationPipe, type Type } from '@nestjs/common';
import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants';

import { AdminController as AdminAdminController } from '../admin/admin.controller';
import { AuthController } from '../app/auth/auth.controller';
import { ContactController } from '../contact/contact.controller';
import { AdminCommunityController } from '../discourse/admin-community.controller';
import { CommunityController } from '../discourse/community.controller';
import { DiscourseController } from '../discourse/discourse.controller';
import { EventsController } from '../events/events.controller';
import { AdminSessionsController } from '../google-sessions/admin-sessions.controller';
import { MembersController } from '../google-sessions/members.controller';
import { HealthController } from '../health/health.controller';
import { AdminController as LicenseAdminController } from '../license/controllers/admin.controller';
import { LicenseController } from '../license/controllers/license.controller';
import { AdminMarketingController } from '../marketing/controllers/admin-marketing.controller';
import { PublicMarketingController } from '../marketing/controllers/public-marketing.controller';
import { ResendWebhookController } from '../marketing/controllers/resend-webhook.controller';
import { MemberGroupsController } from '../member-groups/member-groups.controller';
import { AdminPacksController } from '../packs/admin-packs.controller';
import { PaddleController } from '../paddle/paddle.controller';
import { SessionController } from '../session/session.controller';
import { SubscriptionController } from '../subscription/subscription.controller';
import { WaitlistController } from '../waitlist/waitlist.controller';

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
 * Deliberately dependency-free — no Postgres, no Nest bootstrap, no docker. In
 * particular the controller list below is an explicit import list and NOT
 * module-graph reflection: reflecting over `AppModule` would drag Prisma's
 * `onModuleInit` into a spec that must stay infra-free (the same reasoning
 * TASK_2026_169 used for G3 — see its report §6(d)). The hand-maintained list
 * is instead kept honest by the CENSUS assertion below, which scans the source
 * tree and fails if any `*.controller.ts` is missing from it.
 */

const SRC = join(__dirname, '..');

/** Nest's `RouteParamtypes` values for the two decorators carrying a payload. */
const PARAMTYPE = { BODY: 3, QUERY: 4 } as const;

/**
 * Every controller in the server, with a UNIQUE human label and its
 * source-relative file path.
 *
 * ⚠️ The label is NOT `controller.name`. Two distinct classes in this server are
 * both called `AdminController` (`admin/admin.controller.ts` and
 * `license/controllers/admin.controller.ts`). Keying the debt ledger on the
 * class name would let one hide behind the other: whichever got bound first
 * would remove "AdminController" from the ledger and silently exempt the other.
 * Labels are path-qualified so the two can never collide, and the classes are
 * imported under aliases.
 */
const ALL_CONTROLLERS: ReadonlyArray<{
  readonly label: string;
  readonly file: string;
  readonly controller: Type<unknown>;
}> = [
  {
    label: 'admin/AdminController',
    file: 'admin/admin.controller.ts',
    controller: AdminAdminController,
  },
  {
    label: 'app/auth/AuthController',
    file: 'app/auth/auth.controller.ts',
    controller: AuthController,
  },
  {
    label: 'contact/ContactController',
    file: 'contact/contact.controller.ts',
    controller: ContactController,
  },
  {
    label: 'discourse/AdminCommunityController',
    file: 'discourse/admin-community.controller.ts',
    controller: AdminCommunityController,
  },
  {
    label: 'discourse/CommunityController',
    file: 'discourse/community.controller.ts',
    controller: CommunityController,
  },
  {
    label: 'discourse/DiscourseController',
    file: 'discourse/discourse.controller.ts',
    controller: DiscourseController,
  },
  {
    label: 'events/EventsController',
    file: 'events/events.controller.ts',
    controller: EventsController,
  },
  {
    label: 'google-sessions/AdminSessionsController',
    file: 'google-sessions/admin-sessions.controller.ts',
    controller: AdminSessionsController,
  },
  {
    label: 'google-sessions/MembersController',
    file: 'google-sessions/members.controller.ts',
    controller: MembersController,
  },
  {
    label: 'health/HealthController',
    file: 'health/health.controller.ts',
    controller: HealthController,
  },
  {
    label: 'license/AdminController',
    file: 'license/controllers/admin.controller.ts',
    controller: LicenseAdminController,
  },
  {
    label: 'license/LicenseController',
    file: 'license/controllers/license.controller.ts',
    controller: LicenseController,
  },
  {
    label: 'marketing/AdminMarketingController',
    file: 'marketing/controllers/admin-marketing.controller.ts',
    controller: AdminMarketingController,
  },
  {
    label: 'marketing/PublicMarketingController',
    file: 'marketing/controllers/public-marketing.controller.ts',
    controller: PublicMarketingController,
  },
  {
    label: 'marketing/ResendWebhookController',
    file: 'marketing/controllers/resend-webhook.controller.ts',
    controller: ResendWebhookController,
  },
  {
    label: 'member-groups/MemberGroupsController',
    file: 'member-groups/member-groups.controller.ts',
    controller: MemberGroupsController,
  },
  {
    label: 'packs/AdminPacksController',
    file: 'packs/admin-packs.controller.ts',
    controller: AdminPacksController,
  },
  {
    label: 'paddle/PaddleController',
    file: 'paddle/paddle.controller.ts',
    controller: PaddleController,
  },
  {
    label: 'session/SessionController',
    file: 'session/session.controller.ts',
    controller: SessionController,
  },
  {
    label: 'subscription/SubscriptionController',
    file: 'subscription/subscription.controller.ts',
    controller: SubscriptionController,
  },
  {
    label: 'waitlist/WaitlistController',
    file: 'waitlist/waitlist.controller.ts',
    controller: WaitlistController,
  },
];

/**
 * Controllers whose payload params are not yet bound. This list only ever
 * SHRINKS. TASK_2026_170 empties it, one controller per commit.
 *
 * Keyed on `ALL_CONTROLLERS[].label`, never on `controller.name` — see the note
 * on `ALL_CONTROLLERS` about the duplicated `AdminController` class name.
 *
 * ⚠️ Only list a controller that ACTUALLY has an unbound whole-object payload
 * param. The staleness assertion below rejects entries for controllers with
 * nothing left to bind, which is what stops the ledger rotting in the other
 * direction.
 */
const UNVALIDATED_DEBT: readonly string[] = [
  'waitlist/WaitlistController', // B1
  'license/LicenseController', // B2
  'app/auth/AuthController', // B3
  'contact/ContactController', // B4
  'session/SessionController', // B5
  'subscription/SubscriptionController', // B6
  'admin/AdminController', // B7
  'marketing/AdminMarketingController', // B8
  'license/AdminController', // B9
];

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
 * Counted from source on 2026-08-01: 39 `@Body()`/`@Query()` params across the
 * 21 controllers above (31 whole-object + 8 named-primitive). Raise it only
 * when you have counted again.
 */
const MIN_TOTAL_PAYLOAD_PARAMS = 39;

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
 * Counted from source on 2026-08-01: 8 —
 *   app/auth/auth.controller.ts:246,247,478,858,859   (code, state, token, returnUrl, plan)
 *   discourse/discourse.controller.ts:48,49           (sso, sig)
 *   events/events.controller.ts:78                    (ticket)
 * Asserted EXACTLY, not as a floor: a ninth named primitive must fail this test
 * so a contributor has to consciously accept it. The carve-out cannot silently
 * grow. Hardening these with `ParseUUIDPipe`/`@IsString` wrappers is recorded
 * in `.ptah/specs/TASK_2026_170/future-enhancements.md`.
 */
const NAMED_PRIMITIVE_PARAM_COUNT = 8;

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

/** Recursively collect `*.controller.ts` paths under `src/`, `/`-normalized. */
function findControllerFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (
        entry.name === 'generated-prisma-client' ||
        entry.name === 'node_modules'
      ) {
        continue;
      }
      found.push(...findControllerFiles(full));
    } else if (
      entry.name.endsWith('.controller.ts') &&
      !entry.name.endsWith('.spec.ts')
    ) {
      found.push(relative(SRC, full).split(sep).join('/'));
    }
  }
  return found;
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
    // source tree and fails when the two drift. Cheap, infra-free, and it
    // closes the one hole an import list otherwise leaves open.
    it('every *.controller.ts in src/ appears in ALL_CONTROLLERS', () => {
      const onDisk = findControllerFiles(SRC).sort();
      const listed = ALL_CONTROLLERS.map((c) => c.file).sort();

      expect(listed).toEqual(onDisk);
    });

    it('each ALL_CONTROLLERS entry names the class its file exports', () => {
      for (const { file, controller } of ALL_CONTROLLERS) {
        const source = readFileSync(join(SRC, ...file.split('/')), 'utf8');
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
    it.each(UNVALIDATED_DEBT)(
      '%s still has at least one unbound param (delete this line once it does not)',
      (label) => {
        const unbound = bindingsFor(label).filter((b) => !b.validated);

        expect({
          label,
          unbound: unbound.length > 0,
        }).toEqual({ label, unbound: true });
      },
    );
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
