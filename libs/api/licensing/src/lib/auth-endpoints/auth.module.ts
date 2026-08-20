import { Module } from '@nestjs/common';
import { EmailModule } from '@ptah-api/email';
import { IdentityModule } from '@ptah-api/identity';
import { AuthController } from './auth.controller';
import { LicenseModule } from '../license/license.module';

/**
 * Authentication Module — the HTTP surface for `/api/v1/auth/*`.
 *
 * ⚠️ WHY THIS LIVES IN api-licensing AND NOT api-identity.
 * The auth CAPABILITY (WorkOS provider, `AuthService`, token/PKCE/magic-link
 * services, the JWT and admin guards) lives in `@ptah-api/identity`. This
 * controller cannot join it for exactly ONE reason: signup provisions a free
 * licence, so it calls `LicenseService.createLicense()`. Identity must never
 * depend on licensing — that direction is the cycle this whole restructuring
 * existed to cut — so the controller lives on the licensing side, which already
 * depends on identity. Licensing is the dependency that decides the placement.
 *
 * The history worth keeping: this module used to declare `AuthController` AND
 * own every auth service, so it imported `LicenseModule` while `LicenseModule`
 * imported it back for `JwtAuthGuard`. `forwardRef()` on both sides made that
 * legal inside a single project, but Nx forbids a cycle BETWEEN projects.
 * Splitting the capability (identity) from the HTTP surface (here) removed the
 * cycle outright — neither side needs `forwardRef()` any more.
 *
 *   before:  AuthModule ⇄ LicenseModule                    (forwardRef both ways)
 *   after:   AuthModule → LicenseModule → IdentityModule
 *            AuthModule → IdentityModule
 *
 * A dedicated `api-auth-endpoints` lib was considered and rejected: one
 * controller and one module, with no second consumer and no independent
 * lifecycle, does not earn a project. If these endpoints ever grow — or shed
 * the licence dependency — promoting this folder to its own lib is a
 * mechanical move.
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
