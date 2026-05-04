import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import * as bcrypt from 'bcrypt';
import { ALL_APP_ROLES, AppRole } from '../auth/roles.constants';
import { SiteSummary, SitesService } from '../sites/sites.service';
import { User, UserDocument } from './schemas/user.schema';

type CreateUserInput = {
  name: string;
  email: string;
  passwordHash: string;
  roles?: AppRole[];
  sites?: string[];
  siteId?: string | null;
  createMissingSites?: boolean;
};

type UpdateUserInput = {
  name?: string;
  email?: string;
  sites?: string[];
  siteId?: string | null;
};

type ListUsersQuery = {
  page: number;
  limit: number;
  search?: string;
  sites?: string;
};

type UserRecord = {
  _id?: unknown;
  id?: unknown;
  name?: string;
  email?: string;
  roles?: AppRole[];
  sites?: string[];
  siteId?: Types.ObjectId | string | null;
  isActive?: boolean;
  createdAt?: Date;
  updatedAt?: Date;
  [key: string]: unknown;
};

type SiteLookup = {
  byId: Map<string, SiteSummary>;
  byCode: Map<string, SiteSummary>;
};

@Injectable()
export class UsersService {
  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    private readonly sites: SitesService,
  ) {}

  async findByEmail(email: string, withPassword = false) {
    const q = this.userModel.findOne({ email: email.toLowerCase().trim() });
    return withPassword ? q.select('+passwordHash') : q;
  }

  async findById(id: string) {
    return this.userModel.findById(id);
  }

  async findByIdWithRefreshToken(id: string) {
    return this.userModel
      .findById(id)
      .select('+refreshTokenHash +lastActivityAt');
  }

  async findByIdWithSessionState(id: string) {
    return this.userModel
      .findById(id)
      .select('+refreshTokenHash +lastActivityAt');
  }

  async findNamesByIds(ids: string[]) {
    const validIds = ids.filter((id) => Types.ObjectId.isValid(id));
    if (validIds.length === 0) return new Map<string, string>();

    const users = await this.userModel
      .find({ _id: { $in: validIds } })
      .select({ name: 1 })
      .lean();

    const map = new Map<string, string>();
    users.forEach((user) => {
      map.set(String(user._id), user.name);
    });
    return map;
  }

  async create(input: CreateUserInput) {
    const exists = await this.userModel.exists({
      email: input.email.toLowerCase().trim(),
    });
    if (exists) throw new ConflictException('Email already registered');

    const siteAssignment = await this.resolveSiteAssignment(
      input.siteId,
      input.sites,
      input.createMissingSites,
    );
    const created = await this.userModel.create({
      ...input,
      email: input.email.toLowerCase().trim(),
      roles: this.normalizeRoles(input.roles),
      sites: siteAssignment.sites,
      siteId: siteAssignment.siteId,
    });

    return created;
  }

  async list(query: ListUsersQuery) {
    const filter: Record<string, unknown> = {};
    const andFilters: Record<string, unknown>[] = [];
    if (query.search?.trim()) {
      const text = query.search.trim();
      andFilters.push({
        $or: [
          { name: new RegExp(this.escapeRegExp(text), 'i') },
          { email: new RegExp(this.escapeRegExp(text), 'i') },
        ],
      });
    }
    const selectedSites = Array.from(
      new Set(
        (query.sites ?? '')
          .split(',')
          .map((site) => site.trim())
          .filter(Boolean),
      ),
    );
    if (selectedSites.length) {
      const selectedSiteMap =
        await this.sites.findSummariesByCodes(selectedSites);
      const selectedSiteIds = Array.from(selectedSiteMap.values()).map(
        (site) => site.id,
      );
      const siteFilters: Record<string, unknown>[] = [
        { sites: { $in: selectedSites } },
      ];
      if (selectedSiteIds.length) {
        siteFilters.push({ siteId: { $in: selectedSiteIds } });
      }
      andFilters.push({ $or: siteFilters });
    }
    if (andFilters.length) {
      filter.$and = andFilters;
    }

    const skip = (query.page - 1) * query.limit;
    const [items, total] = await Promise.all([
      this.userModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(query.limit)
        .lean(),
      this.userModel.countDocuments(filter),
    ]);

    const itemRecords = items as unknown as UserRecord[];
    const siteLookup = await this.buildSiteLookup(itemRecords);

    return {
      items: itemRecords.map((item) => this.withSiteSummary(item, siteLookup)),
      total,
      page: query.page,
      limit: query.limit,
      totalPages: Math.max(1, Math.ceil(total / query.limit)),
    };
  }

  async listSites() {
    const [rawSites, activeSites] = await Promise.all([
      this.userModel.distinct('sites'),
      this.sites.findAll({ page: 1, limit: 100, isActive: true }),
    ]);
    const values = [
      ...activeSites.items.map((site) => site.code),
      ...rawSites.map((site) => String(site).trim()),
    ];
    return Array.from(new Set(values.filter(Boolean))).sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: 'base' }),
    );
  }

  async updateById(id: string, input: UpdateUserInput) {
    const user = await this.userModel.findById(id);
    if (!user) throw new NotFoundException('User not found');

    const nextName = input.name?.trim();
    const nextEmail = input.email?.trim().toLowerCase();
    const siteAssignment =
      input.siteId !== undefined || input.sites !== undefined
        ? await this.resolveSiteAssignment(input.siteId, input.sites)
        : undefined;
    const hasSitesUpdate = input.sites !== undefined;
    const hasSiteIdUpdate = input.siteId !== undefined;

    if (!nextName && !nextEmail && !hasSitesUpdate && !hasSiteIdUpdate) {
      throw new BadRequestException('No changes provided');
    }

    if (nextEmail && nextEmail !== user.email) {
      const exists = await this.userModel.exists({
        email: nextEmail,
        _id: { $ne: id },
      });
      if (exists) throw new ConflictException('Email already registered');
      user.email = nextEmail;
    }

    if (nextName) {
      user.name = nextName;
    }
    if (siteAssignment) {
      user.sites = siteAssignment.sites;
      user.siteId = siteAssignment.siteId;
    }

    await user.save();
    const site = await this.sites.findSummaryById(user.siteId);
    return this.withSiteSummary(
      user.toObject() as unknown as UserRecord,
      this.siteLookupFrom(site),
    );
  }

  async updatePassword(id: string, password: string) {
    const user = await this.userModel.findById(id).select('+passwordHash');
    if (!user) throw new NotFoundException('User not found');

    const trimmed = password.trim();
    if (!trimmed) {
      throw new BadRequestException('Password is required');
    }

    user.passwordHash = await bcrypt.hash(trimmed, 12);
    await user.save();

    return { id: user.id, email: user.email, name: user.name };
  }

  async setRefreshToken(id: string, refreshToken: string | null) {
    const user = await this.userModel
      .findById(id)
      .select('+refreshTokenHash +lastActivityAt');
    if (!user) throw new NotFoundException('User not found');

    if (!refreshToken) {
      user.refreshTokenHash = undefined;
      user.lastActivityAt = undefined;
      await user.save();
      return;
    }

    user.refreshTokenHash = await bcrypt.hash(refreshToken, 12);
    user.lastActivityAt = new Date();
    await user.save();
  }

  async touchLastActivity(id: string, minIntervalMs = 60_000) {
    const now = new Date();
    const cutoff = new Date(now.getTime() - minIntervalMs);

    await this.userModel.updateOne(
      {
        _id: id,
        $or: [
          { lastActivityAt: { $exists: false } },
          { lastActivityAt: { $lt: cutoff } },
        ],
      },
      { $set: { lastActivityAt: now } },
    );
  }

  async deleteById(id: string) {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException('Invalid user id.');
    }

    const user = await this.userModel.findByIdAndDelete(id);
    if (!user) throw new NotFoundException('User not found');

    return { id: user.id, email: user.email };
  }

  private async resolveSiteAssignment(
    siteId?: string | null,
    sites?: string[],
    createMissingSites = false,
  ) {
    const normalizedSiteId = siteId?.trim();
    if (normalizedSiteId) {
      const site = await this.sites.findById(normalizedSiteId);
      const summary = this.sites.toSummary(site);
      return {
        siteId: new Types.ObjectId(summary.id),
        sites: [summary.code],
      };
    }

    return this.resolveSiteCodes(sites, createMissingSites);
  }

  private async resolveSiteCodes(sites?: string[], createMissingSites = false) {
    const normalizedSites = this.normalizeSites(sites);
    if (normalizedSites.length === 0) {
      return { siteId: undefined, sites: [] as string[] };
    }

    const requestedSite = normalizedSites[0];
    const siteCodes = normalizedSites.map((site) => this.normalizeSiteCode(site));
    const siteByCode = await this.sites.findSummariesByCodes(siteCodes);
    const primarySiteCode = siteCodes[0];
    let site = siteByCode.get(primarySiteCode);
    if (!site) {
      const siteByName = await this.sites.findAll({
        page: 1,
        limit: 1,
        search: requestedSite,
        isActive: true,
      });
      site = siteByName.items.find(
        (item) =>
          item.name.trim().toLowerCase() === requestedSite.trim().toLowerCase(),
      );
    }
    if (!site && createMissingSites) {
      const created = await this.sites.createWithNextSequentialCode(
        requestedSite,
      );
      site = this.sites.toSummary(created);
    }
    if (!site) {
      throw new BadRequestException(`Site not found: ${primarySiteCode}`);
    }

    return {
      siteId: new Types.ObjectId(site.id),
      sites: [site.code],
    };
  }

  private async buildSiteLookup(items: UserRecord[]): Promise<SiteLookup> {
    const ids = items.map((item) => item.siteId);
    const codes = items.flatMap((item) => this.normalizeSites(item.sites));
    const [byId, byCode] = await Promise.all([
      this.sites.findSummariesByIds(ids),
      this.sites.findSummariesByCodes(codes),
    ]);
    return { byId, byCode };
  }

  private withSiteSummary(item: UserRecord, siteLookup: SiteLookup) {
    const siteId = this.normalizeSiteId(item.siteId);
    const legacySites = this.normalizeSites(item.sites);
    const legacySiteCode = legacySites[0];
    const site =
      (siteId ? siteLookup.byId.get(siteId) : undefined) ??
      (legacySiteCode ? siteLookup.byCode.get(legacySiteCode) : undefined);
    const primarySiteCode = site?.code ?? legacySiteCode;

    return {
      ...item,
      id: this.stringifyObjectId(item._id) || this.stringifyObjectId(item.id),
      siteId: site?.id ?? siteId,
      siteName: site?.name ?? primarySiteCode,
      siteCode: primarySiteCode,
      sites: primarySiteCode ? [primarySiteCode] : [],
      site,
    };
  }

  private siteLookupFrom(site: SiteSummary | null): SiteLookup {
    const byId = new Map<string, SiteSummary>();
    const byCode = new Map<string, SiteSummary>();
    if (site) {
      byId.set(site.id, site);
      byCode.set(site.code, site);
    }
    return { byId, byCode };
  }

  private normalizeSiteId(siteId?: Types.ObjectId | string | null) {
    if (!siteId) return undefined;
    const value = String(siteId);
    return Types.ObjectId.isValid(value) ? value : undefined;
  }

  private stringifyObjectId(value: unknown) {
    if (value instanceof Types.ObjectId) return value.toHexString();
    if (typeof value === 'string') return value;
    return '';
  }

  private escapeRegExp(value: string) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  private normalizeSites(sites?: string[]) {
    if (!Array.isArray(sites)) return [];
    return sites
      .map((site) => site.trim())
      .filter(Boolean)
      .slice(0, 1);
  }

  private normalizeSiteCode(site: string) {
    return site.trim().replace(/\s+/g, '-').toUpperCase();
  }

  private normalizeRoles(roles?: AppRole[]) {
    const allowedRoles = new Set<AppRole>(ALL_APP_ROLES);
    const normalized = Array.from(
      new Set((roles ?? []).filter((role) => allowedRoles.has(role))),
    );
    if (normalized.length === 0) {
      throw new BadRequestException('User role is required');
    }
    return normalized;
  }
}
