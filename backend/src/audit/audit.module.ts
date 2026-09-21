import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from '../auth/auth.module';
import { FilesModule } from '../files/files.module';
import { MailModule } from '../mail/mail.module';
import { UsersModule } from '../users/users.module';
import { AuditController } from './audit.controller';
import { AuditInterceptor } from './audit.interceptor';
import { AuditPdfService } from './audit-pdf.service';
import { AuditService } from './audit.service';
import {
  AuditArchive,
  AuditArchiveSchema,
} from './schemas/audit-archive.schema';
import { AuditLog, AuditLogSchema } from './schemas/audit-log.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: AuditLog.name, schema: AuditLogSchema },
      { name: AuditArchive.name, schema: AuditArchiveSchema },
    ]),
    AuthModule,
    FilesModule,
    MailModule,
    UsersModule,
  ],
  controllers: [AuditController],
  providers: [
    AuditService,
    AuditPdfService,
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
  ],
  exports: [AuditService],
})
export class AuditModule {}
