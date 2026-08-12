import { Module, Global } from '@nestjs/common';
import { PrismaService } from './prisma.service';

/**
 * PrismaModule - Global module that provides PrismaService
 *
 * Marked as @Global() so PrismaService can be injected anywhere
 * without needing to import PrismaModule in every module.
 */
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
