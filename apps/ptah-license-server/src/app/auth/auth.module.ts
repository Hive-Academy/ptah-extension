import { Module } from '@nestjs/common';
import { EmailModule } from '@ptah-api/email';
import { IdentityModule } from '@ptah-api/identity';
import { AuthController } from './auth.controller';
import { LicenseModule } from '../../license/license.module';

/**
 * Authentication Module — the app-side composition seam for `AuthController`.
 *
 * ⚠️ THIS MODULE IS DELIBERATELY THIN, AND IT IS WHAT BREAKS THE CYCLE.
 * The auth CAPABILITY (WorkOS provider, AuthService, token/PKCE/magic-link
 * services, the JWT/admin guards) now lives in `@ptah-api/identity`. What stays
 * here is only the controller and the wiring it needs.
 *
 * The cycle it replaced: this module used to declare `AuthController` AND own
 * every auth service. `AuthController` needs `LicenseService`, so this module
 * imported `LicenseModule`; `LicenseModule` needed `JwtAuthGuard`, so it
 * imported this module. `forwardRef()` on both sides made that legal inside a
 * single project — but Nx forbids a cycle BETWEEN projects, so the capability
 * could not become a lib until the knot was cut.
 *
 * The cut, in one sentence: identity owns everything that does not touch
 * licensing, and the controller — the ONLY part that touches both — stays in
 * the app, which is allowed to depend on both libs.
 *
 *   before:  AuthModule ⇄ LicenseModule            (forwardRef both ways)
 *   after:   AuthModule → LicenseModule → IdentityModule
 *            AuthModule → IdentityModule
 *
 * That is acyclic, so NEITHER side needs `forwardRef()` any more — both were
 * removed rather than left as harmless-looking scaffolding.
 *
 * When `api-licensing` lands, `AuthController` becomes movable to a thin
 * endpoints lib depending on identity + licensing, and this module disappears.
 *
 * Everything previously re-exported from here (`AuthService`, `JwtAuthGuard`,
 * `TicketService`, `MagicLinkService`, `JwtModule`, `WORKOS_CLIENT`) is
 * exported by `IdentityModule` — feature modules import that directly now.
 *
 * `EmailModule` is imported directly rather than leaned on through
 * `IdentityModule`: `AuthController` injects `EmailService` (verification and
 * magic-link sends), and a module must import what its OWN controllers inject.
 * `IdentityModule` imports `EmailModule` for its services but deliberately does
 * not re-export it — re-exporting a dependency to satisfy someone else's
 * injection is how modules quietly become each other's service locator.
 */
@Module({
  imports: [IdentityModule, EmailModule, LicenseModule],
  controllers: [AuthController],
})
export class AuthModule {}
