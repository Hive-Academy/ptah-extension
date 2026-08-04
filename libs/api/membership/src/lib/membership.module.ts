import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CohortResolver } from './cohort-resolver.service';
import { MemberGuard } from './guards/member.guard';
import { MembershipService } from './membership.service';

/**
 * MembershipModule — the membership definition, its cohort lookup and the guard
 * that resolves both once per request.
 *
 * Declared `@Global()` (mirroring `MemberGroupsModule`)
 * so `MembershipService`, `CohortResolver` and `MemberGuard` are injectable
 * app-wide without threading an explicit import through every member module.
 *
 * ⚠️ REGISTER IT BEFORE EVERY CONSUMER in `app.module.ts` (R7.3). A `@Global()`
 * module's providers are visible only once it has been instantiated, and every
 * member controller in P2–P5 declares `@UseGuards(JwtAuthGuard, MemberGuard)`
 * at class level.
 *
 * `PrismaModule` is `@Global()` and `ConfigModule.forRoot({ isGlobal: true })`
 * is registered in `app.module.ts`, so neither strictly needs importing here;
 * `ConfigModule` is imported anyway to keep the module resolvable in isolation
 * (`Test.createTestingModule({ imports: [MembershipModule] })`), matching what
 * `MemberGroupsModule` does.
 *
 * `MemberGuard` is a PROVIDER as well as an export: `@UseGuards(MemberGuard)`
 * hands Nest a class to resolve, and a guard with constructor dependencies must
 * be resolvable from the consuming module's injector. Exporting it from a
 * global module makes that true everywhere without each consumer re-declaring
 * it (which is what forced `AdminGuard` to be re-listed in four modules).
 */
@Global()
@Module({
  imports: [ConfigModule],
  providers: [MembershipService, CohortResolver, MemberGuard],
  exports: [MembershipService, CohortResolver, MemberGuard],
})
export class MembershipModule {}
