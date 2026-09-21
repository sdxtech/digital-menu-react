import {
  BadRequestException,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Readable } from 'stream';
import { AppRole } from '../auth/roles.constants';
import { FilesService } from '../files/files.service';
import { MailService } from '../mail/mail.service';
import { UsersService } from '../users/users.service';
import { AuditLogQueryDto } from './dto/audit-log-query.dto';
import { AuditPdfService } from './audit-pdf.service';
import {
  AuditArchive,
  AuditArchiveDocument,
} from './schemas/audit-archive.schema';
import { AuditLog, AuditLogDocument } from './schemas/audit-log.schema';

export type CreateAuditLogInput = {
  actorId?: string;
  actorName?: string;
  actorEmail?: string;
  role?: string;
  site?: string;
  module: string;
  action: string;
  method: string;
  path: string;
  targetId?: string;
  success: boolean;
  statusCode: number;
  ipAddress?: string;
  userAgent?: string;
  details?: Record<string, unknown>;
};

const ANNUAL_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const PDF_PART_SIZE = 5_000;

@Injectable()
export class AuditService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AuditService.name);
  private archiveTimer?: NodeJS.Timeout;

  constructor(
    @InjectModel(AuditLog.name)
    private readonly auditModel: Model<AuditLogDocument>,
    @InjectModel(AuditArchive.name)
    private readonly archiveModel: Model<AuditArchiveDocument>,
    private readonly pdf: AuditPdfService,
    private readonly files: FilesService,
    private readonly mail: MailService,
    private readonly users: UsersService,
  ) {}

  onModuleInit() {
    if (process.env.NODE_ENV === 'test' || process.env.VERCEL === '1') return;
    void this.runAnnualArchive();
    this.archiveTimer = setInterval(() => {
      void this.runAnnualArchive();
    }, ANNUAL_CHECK_INTERVAL_MS);
    this.archiveTimer.unref();
  }

  onModuleDestroy() {
    if (this.archiveTimer) clearInterval(this.archiveTimer);
  }

  async record(input: CreateAuditLogInput) {
    await this.auditModel.create(input);
  }

  async list(query: AuditLogQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 25;
    const filter = this.buildFilter(query);
    const [items, total, modules, roles, sites] = await Promise.all([
      this.auditModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      this.auditModel.countDocuments(filter),
      this.auditModel.distinct('module'),
      this.auditModel.distinct('role'),
      this.auditModel.distinct('site'),
    ]);
    return {
      items: items.map((item) => ({ ...item, id: String(item._id) })),
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
      filters: {
        modules: modules.filter(Boolean).sort(),
        roles: roles.filter(Boolean).sort(),
        sites: sites.filter(Boolean).sort(),
      },
    };
  }

  async exportManual(query: AuditLogQueryDto, actor: CreateAuditLogInput) {
    this.assertExportRange(query);
    const rows = await this.auditModel
      .find(this.buildFilter(query))
      .sort({ createdAt: 1 })
      .lean();
    const period = `${query.startDate} to ${query.endDate}`;
    const buffer = this.pdf.build('SPICES Audit Log', rows, period);
    await this.record({
      ...actor,
      module: 'audit',
      action: 'EXPORT_PDF',
      method: 'GET',
      path: '/superadmin/audit-logs/export',
      success: true,
      statusCode: 200,
      details: { ...query, exportedRecords: rows.length },
    });
    return { buffer, count: rows.length };
  }

  async getUploadDownloadUrl(key: string) {
    if (!key.startsWith('audit-uploads/')) {
      throw new BadRequestException('Invalid audit upload key');
    }
    return { url: await this.files.presignDownload(key) };
  }

  async runAnnualArchive() {
    const currentJakartaYear = Number(
      new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Jakarta',
        year: 'numeric',
      }).format(new Date()),
    );
    const year = currentJakartaYear - 1;
    try {
      const existing = await this.archiveModel.findOne({ year }).lean();
      if (existing?.status === 'completed') return;
      const staleBefore = Date.now() - 12 * 60 * 60 * 1000;
      if (
        existing?.status === 'processing' &&
        existing.updatedAt &&
        new Date(existing.updatedAt).getTime() > staleBefore
      )
        return;
      if (existing) {
        const claim = await this.archiveModel.updateOne(
          { year, status: existing.status },
          { $set: { status: 'processing' }, $unset: { error: 1 } },
        );
        if (!claim.matchedCount) return;
      } else {
        try {
          await this.archiveModel.create({ year, status: 'processing' });
        } catch (error) {
          if ((error as { code?: number }).code === 11000) return;
          throw error;
        }
      }

      const start = new Date(`${year}-01-01T00:00:00+07:00`);
      const end = new Date(`${year + 1}-01-01T00:00:00+07:00`);
      const rows = await this.auditModel
        .find({ createdAt: { $gte: start, $lt: end } })
        .sort({ createdAt: 1 })
        .lean();
      if (!rows.length) {
        await this.archiveModel.updateOne(
          { year },
          {
            $set: {
              status: 'completed',
              completedAt: new Date(),
              recordCount: existing?.recordCount ?? 0,
            },
          },
        );
        return;
      }

      const pdfKeys: string[] = [...(existing?.pdfKeys ?? [])];
      const partCount = Math.ceil(rows.length / PDF_PART_SIZE);
      if (!pdfKeys.length) {
        for (let index = 0; index < partCount; index += 1) {
          const part = rows.slice(
            index * PDF_PART_SIZE,
            (index + 1) * PDF_PART_SIZE,
          );
          const suffix = partCount > 1 ? `-part-${index + 1}` : '';
          const buffer = this.pdf.build(
            `SPICES Audit Log ${year}${suffix}`,
            part,
            `1 January ${year} to 31 December ${year}`,
          );
          const key = `audit-archives/${year}/audit-log-${year}${suffix}.pdf`;
          await this.files.uploadObject(
            key,
            Readable.from([buffer]),
            'application/pdf',
          );
          pdfKeys.push(key);
        }
        await this.archiveModel.updateOne(
          { year },
          { $set: { pdfKeys, recordCount: rows.length } },
        );
      }

      const recipients = await this.users.findActiveEmailRecipients({
        roles: [AppRole.Superadmin],
      });
      if (!recipients.length)
        throw new Error('No active Superadmin email recipients');
      const pdfUrls = await Promise.all(
        pdfKeys.map((key) => this.files.presignDownload(key)),
      );
      const links = pdfUrls
        .map(
          (url, index) =>
            `<li><a href="${url}">Audit ${year}${partCount > 1 ? ` part ${index + 1}` : ''}</a></li>`,
        )
        .join('');
      const alreadySent = new Set(existing?.recipientEmails ?? []);
      for (const recipient of recipients) {
        if (alreadySent.has(recipient.email)) continue;
        await this.mail.sendNow({
          to: recipient.email,
          subject: `SPICES annual audit archive ${year}`,
          text: `The ${year} audit archive is ready: ${pdfUrls.join(', ')}`,
          html: `<p>The SPICES audit archive for ${year} is ready.</p><ul>${links}</ul><p>${rows.length} records were archived.</p>`,
          category: 'annual-audit-archive',
        });
        await this.archiveModel.updateOne(
          { year },
          { $addToSet: { recipientEmails: recipient.email } },
        );
      }

      await this.auditModel.deleteMany({
        createdAt: { $gte: start, $lt: end },
      });
      await this.archiveModel.updateOne(
        { year },
        {
          $set: {
            status: 'completed',
            completedAt: new Date(),
            recordCount: rows.length,
            pdfKeys,
            recipientEmails: recipients.map((item) => item.email),
          },
          $unset: { error: 1 },
        },
      );
      await this.record({
        actorName: 'System',
        role: 'system',
        module: 'audit',
        action: 'ANNUAL_ARCHIVE',
        method: 'SYSTEM',
        path: 'annual-audit-archive',
        success: true,
        statusCode: 200,
        details: { year, recordCount: rows.length, pdfKeys },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Annual audit archive ${year} failed: ${message}`);
      await this.archiveModel.updateOne(
        { year },
        { $set: { status: 'failed', error: message } },
        { upsert: true },
      );
    }
  }

  private buildFilter(query: AuditLogQueryDto) {
    const filter: Record<string, unknown> = {};
    if (query.module?.trim()) filter.module = query.module.trim();
    if (query.role?.trim()) filter.role = query.role.trim();
    if (query.site?.trim()) filter.site = query.site.trim();
    if (query.status) filter.success = query.status === 'success';
    if (query.startDate || query.endDate) {
      const createdAt: Record<string, Date> = {};
      if (query.startDate)
        createdAt.$gte = new Date(`${query.startDate}T00:00:00+07:00`);
      if (query.endDate) {
        const end = new Date(`${query.endDate}T00:00:00+07:00`);
        end.setDate(end.getDate() + 1);
        createdAt.$lt = end;
      }
      filter.createdAt = createdAt;
    }
    if (query.search?.trim()) {
      const value = new RegExp(this.escapeRegExp(query.search.trim()), 'i');
      filter.$or = [
        { actorName: value },
        { actorEmail: value },
        { action: value },
        { path: value },
        { targetId: value },
      ];
    }
    return filter;
  }

  private assertExportRange(query: AuditLogQueryDto) {
    if (!query.startDate || !query.endDate) {
      throw new BadRequestException('startDate and endDate are required');
    }
    const start = new Date(`${query.startDate}T00:00:00Z`);
    const end = new Date(`${query.endDate}T00:00:00Z`);
    if (start > end)
      throw new BadRequestException('startDate must be before endDate');
    if (end.getTime() - start.getTime() > 366 * 24 * 60 * 60 * 1000) {
      throw new BadRequestException('Export range cannot exceed one year');
    }
  }

  private escapeRegExp(value: string) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}
