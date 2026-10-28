import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { AppRole } from '../auth/roles.constants';
import { User, UserDocument } from '../users/schemas/user.schema';
import { Site, SiteDocument } from '../sites/schemas/site.schema';
import { Client, ClientDocument } from '../clients/schemas/client.schema';
import {
  DashboardAccess,
  DashboardAccessDocument,
} from './schemas/dashboard-access.schema';
import {
  emptyDashboardPolicy,
  resolveDashboardAccess,
} from './dashboard-access.policy';
import type { DashboardPolicy } from './dashboard-access.policy';
import { DashboardService } from './dashboard.service';
import { AnalyticsQueryDto } from './dto/analytics-query.dto';

@Injectable()
export class DashboardAccessService {
  constructor(
    @InjectModel(DashboardAccess.name)
    private readonly policies: Model<DashboardAccessDocument>,
    @InjectModel(User.name) private readonly users: Model<UserDocument>,
    @InjectModel(Site.name) private readonly sites: Model<SiteDocument>,
    @InjectModel(Client.name) private readonly clients: Model<ClientDocument>,
    private readonly dashboard: DashboardService,
  ) {}

  private async target(type: string, id: string) {
    if (type === 'role') {
      if (!Object.values(AppRole).includes(id as AppRole))
        throw new BadRequestException('Invalid role.');
      return {
        id,
        name: id,
        roles: [id as AppRole],
        assignedSites: [] as string[],
        locked: id === String(AppRole.Superadmin),
      };
    }
    if (type !== 'user' || !Types.ObjectId.isValid(id))
      throw new BadRequestException('Invalid dashboard access target.');
    const user = await this.users
      .findById(id)
      .select('name roles sites siteId isActive')
      .lean();
    if (!user) throw new NotFoundException('User not found.');
    const primarySite = user.siteId
      ? await this.sites.findById(user.siteId).select('code').lean()
      : null;
    return {
      id: new Types.ObjectId(id).toHexString(),
      name: user.name,
      roles: user.roles,
      assignedSites: [
        ...new Set([
          ...(user.sites ?? []),
          ...(primarySite ? [primarySite.code] : []),
        ]),
      ],
      locked: user.roles.includes(AppRole.Superadmin),
      active: user.isActive,
    };
  }

  async getSettings(type: string, id: string) {
    const target = await this.target(type, id);
    const policy = await this.policies
      .findOne({ targetType: type, targetId: target.id })
      .lean();
    const effective =
      type === 'user'
        ? await this.getAccess(id)
        : resolveDashboardAccess(
            target.roles,
            [],
            [policy ?? emptyDashboardPolicy()],
            emptyDashboardPolicy(),
          );
    return { target, policy: policy ?? emptyDashboardPolicy(), effective };
  }

  async saveSettings(
    type: string,
    id: string,
    policy: DashboardPolicy,
    actorId: string,
  ) {
    const target = await this.target(type, id);
    if (target.locked)
      throw new BadRequestException(
        'Superadmin dashboard access is always unrestricted.',
      );
    const codes = [
      ...new Set(policy.sites.map((code) => code.trim()).filter(Boolean)),
    ];
    if (policy.siteMode === 'selected') {
      if (!codes.length)
        throw new BadRequestException('Select at least one site.');
      const count = await this.sites.countDocuments({ code: { $in: codes } });
      if (count !== codes.length)
        throw new BadRequestException(
          'One or more selected sites no longer exist.',
        );
    }
    await this.policies.findOneAndUpdate(
      { targetType: type, targetId: target.id },
      {
        $set: {
          targetType: type,
          targetId: target.id,
          dashboard: policy.dashboard,
          components: policy.components,
          siteMode: policy.siteMode,
          sites: policy.siteMode === 'selected' ? codes : [],
          updatedBy: actorId,
        },
      },
      { upsert: true, runValidators: true },
    );
    return this.getSettings(type, id);
  }

  async getAccess(userId: string) {
    const target = await this.target('user', userId);
    const records = await this.policies
      .find({
        $or: [
          { targetType: 'user', targetId: target.id },
          { targetType: 'role', targetId: { $in: target.roles } },
        ],
      })
      .lean();
    return resolveDashboardAccess(
      target.active === false ? [] : target.roles,
      target.assignedSites,
      target.active === false
        ? []
        : records.filter((record) => record.targetType === 'role'),
      target.active === false
        ? emptyDashboardPolicy()
        : (records.find((record) => record.targetType === 'user') ??
            emptyDashboardPolicy()),
    );
  }

  private async requireAccess(userId: string, site?: string) {
    const access = await this.getAccess(userId);
    if (!access.dashboard || access.sites?.length === 0)
      throw new ForbiddenException(
        'Dashboard access has not been granted for any sites.',
      );
    if (site && access.sites !== null && !access.sites.includes(site))
      throw new ForbiddenException(
        'You do not have dashboard access to this site.',
      );
    return access;
  }

  async clientOptions(userId: string, site?: string) {
    const access = await this.requireAccess(userId, site);
    const codes = site ? [site] : access.sites;
    const allowedSites =
      codes === null
        ? null
        : await this.sites
            .find({ code: { $in: codes } })
            .select('_id')
            .lean();
    const items = await this.clients
      .find(
        allowedSites === null
          ? {}
          : {
              siteIds: { $in: allowedSites.map((item) => String(item._id)) },
            },
      )
      .select({ _id: 0, clientId: 1, name: 1 })
      .sort({ name: 1 })
      .lean();
    return { items };
  }

  async analytics(userId: string, query: AnalyticsQueryDto) {
    const access = await this.requireAccess(userId, query.site?.trim());
    const result = await this.dashboard.getSuperadminAnalytics(
      query,
      access.sites ?? undefined,
    );
    const c = access.components;
    return {
      access,
      sites: result.sites,
      summary: {
        foodCostPercentage: c.foodCostCard
          ? result.summary.foodCostPercentage
          : null,
        pax: c.paxCard ? result.summary.pax : null,
        estimatedCost: c.costCard ? result.summary.estimatedCost : null,
        estimatedRevenue: c.revenueCard
          ? result.summary.estimatedRevenue
          : null,
        incompleteBatches:
          c.foodCostCard || c.costCard || c.revenueCard
            ? result.summary.incompleteBatches
            : 0,
      },
      workflow: {
        ...(c.approvalStatus ? { approval: result.workflow.approval } : {}),
        ...(c.storeRequestStatus
          ? { storeRequest: result.workflow.storeRequest }
          : {}),
      },
      trend:
        c.foodCostChart || c.paxChart || c.financialChart
          ? result.trend.map((point) => ({
              period: point.period,
              batches: point.batches,
              foodCostPercentage: c.foodCostChart
                ? point.foodCostPercentage
                : null,
              pax: c.paxChart ? point.pax : null,
              paxByClient: c.paxChart ? point.paxByClient : [],
              estimatedCost: c.financialChart ? point.estimatedCost : null,
              estimatedRevenue: c.financialChart
                ? point.estimatedRevenue
                : null,
            }))
          : [],
    };
  }
}
