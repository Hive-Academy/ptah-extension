import { Global, Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditLogService } from './audit-log.service';

/**
 * AuditModule — cross-cutting `@Global()` module exposing `AuditLogService`
 * to every feature module without requiring per-module imports
 * (TASK_2025_292 §3).
 *
 * Imports `PrismaModule` (itself `@Global()`, but declared here explicitly
 * so the dependency is explicit and the module is trivially testable in
 * isolation via `Test.createTestingModule`).
 */
@Global()
@Module({
  imports: [PrismaModule],
  providers: [AuditLogService],
  exports: [AuditLogService],
})
export class AuditModule {}
