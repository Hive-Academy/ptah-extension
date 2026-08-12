import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Logger,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { AuditLogService } from '@ptah-api/audit';
import { dtoPipe } from '@ptah-api/core';
import {
  AdminGuard,
  AdminThrottlerGuard,
  JwtAuthGuard,
} from '@ptah-api/identity';
import type { AdminCategory } from '@ptah-contracts/community';

import { adminActor, auditHook } from '../common/admin-audit';

import { CategoriesService } from './categories.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { ReorderCategoriesDto } from './dto/reorder-categories.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';

/** Admin write budget, matching `MemberGroupsController` / `AdminPacksController`. */
const ADMIN_WRITES = { default: { limit: 20, ttl: 60_000 } } as const;

/**
 * `AdminCommunityCategoriesController` — category CRUD and ordering for the
 * moderation surface (§3.3 admin table, R8.8).
 *
 * ── THE PREFIX IS `v1/admin/community/categories`, AND THE DEPTH IS RISK-J ──
 * Plan §2.5 proposed this controller at `v1/admin/community/categories` and a
 * second at bare `v1/admin/community`. The second is a strict PATH-PREFIX of
 * the first, which is exactly what `route-map.spec.ts`'s RI-1 rejects, and both
 * ledgers it could be excused through — `PREFIX_EXCEPTIONS` and
 * `KNOWN_PREFIX_DEBT` — are EMPTY ARRAYS at HEAD. That emptiness is the current
 * invariant, not an accident: it is what TASK_2026_170 R2/R3 were done to
 * achieve. So Batch 6 lands THREE controllers at three disjoint literal depth-4
 * prefixes (`…/categories`, `…/topics`, `…/posts`) and NOTHING at the bare
 * `v1/admin/community`. A failure in RI-1 here means a prefix is wrong; it does
 * not mean a ledger needs an entry.
 *
 * ── GUARDS ──────────────────────────────────────────────────────────────────
 * `@UseGuards(JwtAuthGuard, AdminGuard)` at CLASS level, in that order —
 * `JwtAuthGuard` populates `req.user`, `AdminGuard` then authorizes
 * `req.user.email` against the allowlist. Declared at class level so a handler
 * added later is guarded by default, which is what `admin-guards.spec.ts` G1
 * asserts. Writes add `AdminThrottlerGuard` for a per-admin-email budget.
 *
 * Both guards are provided LOCALLY by `ForumModule` rather than by importing
 * `AdminModule` — the acyclicity idiom `MemberGroupsModule` already uses. Both
 * are stateless and depend only on `ConfigService` and the global throttler
 * providers.
 *
 * ── PRE-6: THE AUDIT ROW IS IN THE MUTATION'S OWN TRANSACTION ───────────────
 * Every handler below passes `auditHook(...)` into the service, which calls it
 * with the `tx` it is already inside. Nothing here opens a transaction of its
 * own — doing so would wrap the mutation in an OUTER transaction and produce
 * precisely the non-atomic shape PRE-6 forbids.
 *
 * ── PRE-1 ───────────────────────────────────────────────────────────────────
 * Every `@Body()` binds `dtoPipe(TheDto)`. Under esbuild a bare `@Body()` is
 * silently unvalidated, which on THIS surface means an unvalidated `visibility`
 * string — a value outside `VISIBILITIES` saves cleanly, matches no visibility
 * branch, and makes the category invisible to everyone including the admin who
 * created it, with no error anywhere.
 */
@Controller('v1/admin/community/categories')
@UseGuards(JwtAuthGuard, AdminGuard)
export class AdminCommunityCategoriesController {
  private readonly logger = new Logger(AdminCommunityCategoriesController.name);

  constructor(
    @Inject(CategoriesService) private readonly categories: CategoriesService,
    @Inject(AuditLogService) private readonly audit: AuditLogService,
  ) {}

  /**
   * `GET` → every category, unfiltered by visibility, with resolved cohort
   * names and a live topic count. Read-only, so the global 100/min applies.
   */
  @Get()
  async list(): Promise<{ categories: AdminCategory[] }> {
    return { categories: await this.categories.listForAdmin() };
  }

  @Post()
  @UseGuards(AdminThrottlerGuard)
  @Throttle(ADMIN_WRITES)
  async create(
    @Req() req: Request,
    @Body(dtoPipe(CreateCategoryDto)) dto: CreateCategoryDto,
  ): Promise<AdminCategory> {
    const actor = adminActor(req);
    const created = await this.categories.create(
      dto,
      auditHook(this.audit, actor, 'community.category.create', 'Category', {
        slug: dto.slug,
        visibility: dto.visibility,
      }),
    );

    this.logger.log(
      `Admin created community category: actor=${actor.email ?? 'unknown'} id=${created.id} slug=${created.slug}`,
    );
    return this.reread(created.id);
  }

  /**
   * `PATCH reorder` — R8.8, one transaction, sparse renumber.
   *
   * ⚠️ DECLARED BEFORE `PATCH :id`, AND THAT IS LOAD-BEARING (RI-3). Within one
   * controller Nest matches in DECLARATION order, so with `:id` first the
   * literal `reorder` is swallowed and this endpoint becomes
   * "update the category whose id is the string `reorder`" — a `404`, or worse a
   * `400` from a DTO mismatch, with nothing anywhere saying why.
   * `route-map.spec.ts`'s RI-3 asserts the ordering; this comment is why it is
   * not merely a style rule.
   */
  @Patch('reorder')
  @HttpCode(200)
  @UseGuards(AdminThrottlerGuard)
  @Throttle(ADMIN_WRITES)
  async reorder(
    @Req() req: Request,
    @Body(dtoPipe(ReorderCategoriesDto)) dto: ReorderCategoriesDto,
  ): Promise<{ reordered: number }> {
    const actor = adminActor(req);
    const result = await this.categories.reorder(
      dto,
      // `targetId` is null — a reorder has no single target row, and
      // `AuditLogService.write` strips the undefined key so Postgres stores the
      // column default rather than a literal null.
      auditHook(this.audit, actor, 'community.category.reorder', 'Category', {
        count: dto.ids.length,
      }),
    );

    this.logger.log(
      `Admin reordered community categories: actor=${actor.email ?? 'unknown'} count=${result.reordered}`,
    );
    return result;
  }

  @Patch(':id')
  @UseGuards(AdminThrottlerGuard)
  @Throttle(ADMIN_WRITES)
  async update(
    @Req() req: Request,
    @Param('id') id: string,
    @Body(dtoPipe(UpdateCategoryDto)) dto: UpdateCategoryDto,
  ): Promise<AdminCategory> {
    const actor = adminActor(req);
    await this.categories.update(
      id,
      dto,
      auditHook(this.audit, actor, 'community.category.update', 'Category', {
        // The KEYS, not the values: a 2000-character description does not belong
        // in an audit row, and "what did they touch" is the question asked.
        changed: Object.keys(dto),
      }),
    );

    this.logger.log(
      `Admin updated community category: actor=${actor.email ?? 'unknown'} id=${id} keys=[${Object.keys(dto).join(',')}]`,
    );
    return this.reread(id);
  }

  /**
   * `DELETE :id` — refused with a `409` while the category still holds topics.
   *
   * The DATABASE refuses it: `Topic.category` is `onDelete: Restrict`, and
   * `CategoriesService` turns the `P2003` into a fixed sentence. A pre-flight
   * count here would be a TOCTOU window in which a member creates a topic
   * between the check and the delete.
   */
  @Delete(':id')
  @HttpCode(200)
  @UseGuards(AdminThrottlerGuard)
  @Throttle(ADMIN_WRITES)
  async remove(
    @Req() req: Request,
    @Param('id') id: string,
  ): Promise<{ deleted: boolean }> {
    const actor = adminActor(req);
    const result = await this.categories.remove(
      id,
      auditHook(this.audit, actor, 'community.category.delete', 'Category'),
    );

    this.logger.log(
      `Admin deleted community category: actor=${actor.email ?? 'unknown'} id=${id}`,
    );
    return result;
  }

  /**
   * Re-read the admin view after a write.
   *
   * ⚠️ THE WRITE SERVICE RETURNS A `Category` ROW; THE WIRE SHAPE IS
   * `AdminCategory`, which additionally carries `cohortNames` and `topicCount`.
   * Assembling it here from the row would mean a created category renders
   * differently from the same category on the next `GET` — the exact drift the
   * member surface avoids by composing creates through its read model.
   *
   * `listForAdmin()` is three small queries over a table §1.3 sizes at ~10 rows,
   * on an admin write path. If the category count ever makes that wrong, the
   * replacement is a single-row admin read, not a hand-assembled response.
   */
  private async reread(id: string): Promise<AdminCategory> {
    const categories = await this.categories.listForAdmin();
    const found = categories.find((category) => category.id === id);
    if (!found) {
      // Unreachable: the write just committed. Checked rather than asserted so
      // a future change that starts filtering `listForAdmin` fails loudly here
      // instead of returning `undefined` as a `200`.
      throw new Error(`Category ${id} vanished between write and read`);
    }
    return found;
  }
}
