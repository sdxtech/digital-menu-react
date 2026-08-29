import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import { AppRole } from '../auth/roles.constants';
import { EmailRecipient, UsersService } from '../users/users.service';
import { MailService } from './mail.service';

type RecipeMailRecord = {
  id: string;
  name: string;
  recipeCode?: string;
  version?: number;
  site?: string;
  createdBy?: string;
  createdByEmail?: string;
};

type MenuProductionMailRecord = {
  id: string;
  productionCode: string;
  menuName: string;
  productionDate?: string;
  site?: string;
  createdBy?: string;
  unitManagerId?: string;
  approvalStatus?: 'pending' | 'approved' | 'rejected';
};

@Injectable()
export class WorkflowMailService {
  private readonly logger = new Logger(WorkflowMailService.name);

  constructor(
    private readonly mail: MailService,
    private readonly users: UsersService,
    private readonly config: ConfigService,
  ) {}

  async notifyRecipeSubmitted(recipe: RecipeMailRecord, resubmitted = false) {
    if (!this.isEnabled() || !this.hasSite(recipe.site, 'recipe submission')) {
      return;
    }
    const unitManagers = await this.users.findActiveEmailRecipients({
      roles: [AppRole.UnitManager],
      site: recipe.site,
    });
    const corporateChefs = await this.users.findActiveEmailRecipients({
      roles: [AppRole.CorporateChef],
      site: recipe.site,
    });
    const title = resubmitted
      ? 'Recipe Resubmitted For Approval'
      : 'New Recipe Awaiting Approval';
    const sharedMessage: {
      subject: string;
      title: string;
      message: string;
      details: Array<[string, string]>;
      actionLabel: string;
      category: string;
    } = {
      subject: `${title}: ${recipe.name}`,
      title,
      message: `${recipe.name} has been submitted by the Chef and requires review.`,
      details: [
        ['Recipe code', recipe.recipeCode ?? '-'],
        ['Version', recipe.version ? `V${recipe.version}` : '-'],
        ['Site', recipe.site ?? '-'],
      ],
      actionLabel: 'Review Recipe',
      category: 'recipe-submitted',
    };
    await this.enqueueForRecipients(unitManagers, {
      ...sharedMessage,
      path: '/unit-manager?section=recipes',
      deduplicationPrefix: `recipe-${resubmitted ? 'resubmitted' : 'submitted'}-unit-manager-${recipe.id}`,
    });
    const unitManagerEmails = new Set(
      unitManagers.map((recipient) => recipient.email.trim().toLowerCase()),
    );
    await this.enqueueForRecipients(
      corporateChefs.filter(
        (recipient) =>
          !unitManagerEmails.has(recipient.email.trim().toLowerCase()),
      ),
      {
        ...sharedMessage,
        path: '/corporate-chef?section=recipes',
        deduplicationPrefix: `recipe-${resubmitted ? 'resubmitted' : 'submitted'}-corporate-chef-${recipe.id}`,
      },
    );
  }

  async notifyRecipeDecision(
    recipe: RecipeMailRecord,
    status: 'approved' | 'rejected',
    rejectionReason?: string,
    reviewerLabel = 'Unit Manager',
  ) {
    if (!this.isEnabled() || !this.hasSite(recipe.site, 'recipe decision')) {
      return;
    }
    const creator = await this.findCreatorRecipients(
      recipe.createdBy,
      recipe.createdByEmail,
    );
    const title = `Recipe ${status}`;
    const sharedMessage: {
      subject: string;
      title: string;
      message: string;
      details: Array<[string, string]>;
      category: string;
    } = {
      subject: `${title}: ${recipe.name}`,
      title,
      message:
        status === 'approved'
          ? `${recipe.name} has been Approved by the ${reviewerLabel}.`
          : `${recipe.name} was Rejected by the ${reviewerLabel}.`,
      details: [
        ['Recipe code', recipe.recipeCode ?? '-'],
        ['Version', recipe.version ? `V${recipe.version}` : '-'],
        ['Site', recipe.site ?? '-'],
        ...(status === 'rejected' && rejectionReason
          ? ([['Reason', rejectionReason]] as Array<[string, string]>)
          : []),
      ],
      category: `recipe-${status}`,
    };
    await this.enqueueForRecipients(creator, {
      ...sharedMessage,
      path: '/chef/menu-bank',
      actionLabel: 'Open Recipe Data',
      deduplicationPrefix: `recipe-${status}-chef-${recipe.id}`,
    });
  }

  async notifyMenuProductionsSubmitted(
    records: MenuProductionMailRecord[],
    deduplicationContext?: string,
  ) {
    if (!this.isEnabled()) return;
    const groups = this.groupMenuRecords(records);
    for (const group of groups.values()) {
      const first = group[0];
      if (!first || !this.hasSite(first.site, 'menu production submission')) {
        continue;
      }
      const recipients = await this.users.findActiveEmailRecipients({
        roles: [AppRole.AdminSite],
        site: first.site,
      });
      await this.enqueueForRecipients(recipients, {
        subject: `Menu Production Sales Input Required: ${first.productionCode}`,
        title: 'Menu Production Sales Input Required',
        message: `${group.length} menu item(s) have been submitted and require selling price and pax calculation input.`,
        details: [
          ['Production code', first.productionCode],
          ['Production date', first.productionDate ?? '-'],
          ['Site', first.site ?? '-'],
        ],
        path: '/admin-site/menu-productions',
        actionLabel: 'Complete Sales Input',
        category: 'menu-production-sales-input',
        deduplicationPrefix: `menu-production-sales-input-${first.productionCode}${
          deduplicationContext ? `-${deduplicationContext}` : ''
        }`,
      });
    }
  }

  async notifyMenuProductionsReadyForApproval(
    records: MenuProductionMailRecord[],
    deduplicationContext?: string,
  ) {
    if (!this.isEnabled()) return;
    const groups = this.groupMenuRecords(records);
    for (const group of groups.values()) {
      const first = group[0];
      if (!first || !this.hasSite(first.site, 'menu production approval')) {
        continue;
      }
      const assignedManagerIds = Array.from(
        new Set(group.map((item) => item.unitManagerId).filter(Boolean)),
      ) as string[];
      let recipients = await this.users.findActiveEmailRecipients({
        roles: [AppRole.UnitManager],
        site: first.site,
        ...(assignedManagerIds.length ? { userIds: assignedManagerIds } : {}),
      });
      if (!recipients.length && assignedManagerIds.length) {
        this.logger.warn(
          `Assigned Unit Manager has no active email for ${first.productionCode}; falling back to active managers at the site.`,
        );
        recipients = await this.users.findActiveEmailRecipients({
          roles: [AppRole.UnitManager],
          site: first.site,
        });
      }
      await this.enqueueForRecipients(recipients, {
        subject: `Menu Production Awaiting Approval: ${first.productionCode}`,
        title: 'Menu Production Awaiting Approval',
        message: `${group.length} menu item(s) have completed sales input and require review.`,
        details: [
          ['Production code', first.productionCode],
          ['Production date', first.productionDate ?? '-'],
          ['Site', first.site ?? '-'],
        ],
        path: '/unit-manager?section=menu-productions',
        actionLabel: 'Review Menu Production',
        category: 'menu-production-awaiting-approval',
        deduplicationPrefix: `menu-production-awaiting-approval-${first.productionCode}${
          deduplicationContext ? `-${deduplicationContext}` : ''
        }`,
      });
    }
  }

  async notifyMenuProductionBatchReviewed(records: MenuProductionMailRecord[]) {
    if (!this.isEnabled() || !records.length) return;
    const first = records[0];
    if (!this.hasSite(first.site, 'menu production decision')) return;

    const pendingCount = records.filter(
      (item) => item.approvalStatus === 'pending',
    ).length;
    if (pendingCount) return;
    const approvedCount = records.filter(
      (item) => item.approvalStatus === 'approved',
    ).length;
    const rejectedCount = records.filter(
      (item) => item.approvalStatus === 'rejected',
    ).length;
    const allApproved = approvedCount === records.length && rejectedCount === 0;
    const creatorIds = Array.from(
      new Set(records.map((item) => item.createdBy).filter(Boolean)),
    ) as string[];
    const chefs = await this.users.findActiveEmailRecipients({
      roles: [AppRole.Chef],
      site: first.site,
      userIds: creatorIds,
    });
    const storekeepers = allApproved
      ? await this.users.findActiveEmailRecipients({
          roles: [AppRole.Storekeeper],
          site: first.site,
        })
      : [];
    const fingerprint = createHash('sha256')
      .update(
        records
          .map((item) => `${item.id}:${item.approvalStatus}`)
          .sort()
          .join('|'),
      )
      .digest('hex')
      .slice(0, 16);
    const sharedMessage: {
      subject: string;
      title: string;
      message: string;
      details: Array<[string, string]>;
      category: string;
    } = {
      subject: allApproved
        ? `Menu Production Approved: ${first.productionCode}`
        : `Menu Production Returned: ${first.productionCode}`,
      title: allApproved
        ? 'Menu Production Approved'
        : 'Menu Production Returned To Chef',
      message: allApproved
        ? `All menus in production batch ${first.productionCode} were approved and forwarded to Storekeeper.`
        : `Production batch ${first.productionCode} was returned to Chef because ${rejectedCount} menu(s) were rejected. It was not forwarded to Storekeeper.`,
      details: [
        ['Production code', first.productionCode],
        ['Production date', first.productionDate ?? '-'],
        ['Approved menus', String(approvedCount)],
        ['Rejected menus', String(rejectedCount)],
        ['Site', first.site ?? '-'],
      ],
      category: allApproved
        ? 'menu-production-approved'
        : 'menu-production-returned',
    };
    await this.enqueueForRecipients(chefs, {
      ...sharedMessage,
      path: '/chef/store-request',
      actionLabel: 'Open Production Records',
      deduplicationPrefix: `menu-production-reviewed-chef-${first.productionCode}-${fingerprint}`,
    });
    if (storekeepers.length) {
      await this.enqueueForRecipients(storekeepers, {
        ...sharedMessage,
        path: '/storekeeper',
        actionLabel: 'Open Store Requests',
        deduplicationPrefix: `menu-production-reviewed-storekeeper-${first.productionCode}-${fingerprint}`,
      });
    }
  }

  private async findCreatorRecipients(userId?: string, fallbackEmail?: string) {
    if (userId) {
      return this.users.findActiveEmailRecipients({
        roles: [AppRole.Chef],
        userIds: [userId],
      });
    }
    const email = fallbackEmail?.trim().toLowerCase();
    return email ? [{ id: email, name: email, email }] : [];
  }

  private async enqueueForRecipients(
    recipients: EmailRecipient[],
    message: {
      subject: string;
      title: string;
      message: string;
      details: Array<[string, string]>;
      path: string;
      actionLabel: string;
      category: string;
      deduplicationPrefix: string;
    },
  ) {
    if (!recipients.length) {
      this.logger.warn(
        `No active email recipients found for ${message.category}.`,
      );
      return;
    }
    const url = this.buildAppUrl(message.path);
    const textDetails = message.details
      .map(([label, value]) => `${label}: ${value}`)
      .join('\n');
    const htmlDetails = message.details
      .map(
        ([label, value]) =>
          `<tr><td style="padding:4px 12px 4px 0;color:#64748b">${this.escapeHtml(label)}</td><td style="padding:4px 0;font-weight:600">${this.escapeHtml(value)}</td></tr>`,
      )
      .join('');
    const results = await Promise.allSettled(
      this.uniqueRecipients(recipients).map((recipient) =>
        this.mail.enqueue({
          to: recipient.email,
          subject: message.subject,
          text: `${message.message}\n\n${textDetails}\n\n${message.actionLabel}: ${url}`,
          html: `<div style="font-family:Arial,sans-serif;max-width:640px;color:#0f172a"><h2>${this.escapeHtml(message.title)}</h2><p>${this.escapeHtml(message.message)}</p><table>${htmlDetails}</table><p style="margin-top:24px"><a href="${this.escapeHtml(url)}" style="background:#2563eb;color:#fff;padding:10px 16px;text-decoration:none;border-radius:6px">${this.escapeHtml(message.actionLabel)}</a></p><p style="margin-top:24px;color:#64748b;font-size:12px">This is an automated notification from Food Recipe System.</p></div>`,
          category: message.category,
          deduplicationKey: `${message.deduplicationPrefix}-${recipient.id}`,
        }),
      ),
    );
    results.forEach((result) => {
      if (result.status === 'rejected') {
        this.logger.error(
          `Failed to enqueue workflow email: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`,
        );
      }
    });
  }

  private groupMenuRecords(records: MenuProductionMailRecord[]) {
    const groups = new Map<string, MenuProductionMailRecord[]>();
    records.forEach((record) => {
      const key = record.productionCode || record.id;
      groups.set(key, [...(groups.get(key) ?? []), record]);
    });
    return groups;
  }

  private uniqueRecipients(recipients: EmailRecipient[]) {
    const unique = new Map<string, EmailRecipient>();
    recipients.forEach((recipient) => {
      const email = recipient.email.trim().toLowerCase();
      if (email && !unique.has(email))
        unique.set(email, { ...recipient, email });
    });
    return Array.from(unique.values());
  }

  private buildAppUrl(path: string) {
    const baseUrl = this.config
      .getOrThrow<string>('APP_BASE_URL')
      .replace(/\/$/, '');
    return `${baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
  }

  private hasSite(site: string | undefined, event: string) {
    if (site?.trim()) return true;
    this.logger.warn(`Skipped ${event} email because site is missing.`);
    return false;
  }

  private isEnabled() {
    return (
      this.config.get<string>('EMAIL_NOTIFICATIONS_ENABLED')?.toLowerCase() ===
      'true'
    );
  }

  private escapeHtml(value: string) {
    return value
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }
}
