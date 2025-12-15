import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from '../prisma/prisma.module';
import { LicenseModule } from '../license/license.module';

@Module({
  imports: [PrismaModule, LicenseModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
