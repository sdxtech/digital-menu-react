import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  Notification,
  NotificationDocument,
} from './schemas/notification.schema';
import { NotificationsGateway } from './notifications.gateway';
import { GetRoleNotificationsDto } from './dto/get-role-notifications.dto';

type RoleNotificationItem = Notification & {
  _id?: unknown;
  id?: string;
  createdAt?: Date;
};

@Injectable()
export class NotificationsService {
  constructor(
    @InjectModel(Notification.name)
    private readonly notificationModel: Model<NotificationDocument>,
    private readonly gateway: NotificationsGateway,
  ) {}

  async create(
    userId: string,
    title: string,
    message: string,
    meta?: Record<string, unknown>,
  ) {
    const created = await this.notificationModel.create({
      userId,
      title,
      message,
      meta,
    });

    const createdObject = created.toObject() as Notification & {
      _id?: unknown;
      createdAt?: Date;
    };
    this.gateway.emitToUser(userId, 'notification:new', {
      id: createdObject._id?.toString() ?? created.id,
      title: createdObject.title,
      message: createdObject.message,
      meta: createdObject.meta,
      read: createdObject.read,
      createdAt: createdObject.createdAt,
    });

    return created;
  }

  // 🌟 ADDED: Create notifications scoped by site and role boundary
  async createHierarchicalNotification(
    userId: string,
    title: string,
    message: string,
    siteCode: string,
    targetUserRole:
      | 'superadmin'
      | 'unit.manager'
      | 'admin-site'
      | 'storekeeper'
      | 'chef',
    componentKey: string,
    meta?: Record<string, unknown>,
  ) {
    const created = await this.notificationModel.create({
      userId: '', // Kept empty so it's broad to the role boundary
      title,
      message,
      siteCode,
      targetUserRole,
      componentKey,
      meta,
    });

    const result = created.toObject() as RoleNotificationItem;
    this.gateway.emitToUser(userId, 'notification:new', {
      id: result._id?.toString() ?? result.id,
      title: result.title,
      message: result.message,
      siteCode: result.siteCode,
      targetUserRole: result.targetUserRole,
      componentKey: result.componentKey,
      read: result.read,
      meta: result.meta,
      payload: result.meta,
      createdAt: result.createdAt,
    });

    return created;
  }

  async getRoleNotifications(filter: GetRoleNotificationsDto) {
    const query = this.buildRoleNotificationQuery(filter);
    const docs = await this.notificationModel
      .find(query)
      .sort({ createdAt: -1 })
      .limit(30)
      .lean<RoleNotificationItem[]>();

    return docs.map((doc) => this.toRoleNotificationResponse(doc));
  }

  // 🌟 ADDED: Get unread records inside a worker's site tenant boundary
  async getUnreadRoleNotifications(filter: GetRoleNotificationsDto) {
    const query = this.buildRoleNotificationQuery(filter, { unreadOnly: true });
    const docs = await this.notificationModel
      .find(query)
      .sort({ createdAt: -1 })
      .lean<RoleNotificationItem[]>();

    return docs.map((doc) => this.toRoleNotificationResponse(doc));
  }

  // 🌟 ADDED: Clear role counters on page view
  async markRoleNotificationsAsRead(filter: GetRoleNotificationsDto) {
    const cleanRole = this.normalizeRole(filter.targetUserRole);
    const componentKey = filter.componentKey?.trim();
    const query: Record<string, unknown> = {
      siteCode: filter.siteCode?.trim(),
      targetUserRole: {
        $in: this.roleVariants(cleanRole),
      },
      read: false,
    };

    if (componentKey) {
      query.componentKey = { $in: this.componentKeyVariants(componentKey) };
    }

    if (filter.productionCode?.trim()) {
      query['meta.productionCode'] = filter.productionCode.trim();
    }

    return this.notificationModel
      .updateMany(query, { $set: { read: true } })
      .exec();
  }

  async listByUser(userId: string, page = 1, limit = 20) {
    const safeLimit = Math.min(Math.max(limit, 1), 100);
    const safePage = Math.max(page, 1);
    const skip = (safePage - 1) * safeLimit;

    const items = await this.notificationModel
      .find({ userId })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(safeLimit)
      .lean();

    return items;
  }

  async markRead(userId: string, id: string) {
    const updated = await this.notificationModel.findOneAndUpdate(
      { _id: id, userId },
      { read: true },
      { new: true },
    );

    if (!updated) throw new NotFoundException('Notification not found');
    return updated;
  }

  emitJobProgress(userId: string, payload: Record<string, unknown>) {
    this.gateway.emitToUser(userId, 'job:progress', payload);
  }

  emitJobDone(userId: string, payload: Record<string, unknown>) {
    this.gateway.emitToUser(userId, 'job:done', payload);
  }

  emitJobFailed(userId: string, payload: Record<string, unknown>) {
    this.gateway.emitToUser(userId, 'job:failed', payload);
  }

  private normalizeRole(role?: string) {
    const normalized = role?.trim().toLowerCase() ?? '';
    return normalized === 'unit-manager' ? 'unit.manager' : normalized;
  }

  private roleVariants(role: string) {
    return Array.from(
      new Set([role, role.replace('-', '.'), role.replace('.', '-')]),
    );
  }

  private componentKeyVariants(componentKey: string) {
    const normalized = componentKey.trim();
    if (normalized === 'RECIPE_APPROVAL_REQUESTS') {
      return ['RECIPE_APPROVAL_REQUESTS', 'RECIPE_APPROVALS'];
    }
    return [normalized];
  }

  private buildRoleNotificationQuery(
    filter: GetRoleNotificationsDto,
    options?: { unreadOnly?: boolean },
  ) {
    const cleanRole = this.normalizeRole(filter.targetUserRole);
    const componentKey = filter.componentKey?.trim();
    const query: Record<string, unknown> = {
      siteCode: filter.siteCode?.trim(),
      targetUserRole: {
        $in: this.roleVariants(cleanRole),
      },
    };

    if (options?.unreadOnly) {
      query.read = false;
    }

    if (componentKey) {
      query.componentKey = { $in: this.componentKeyVariants(componentKey) };
    }

    return query;
  }

  private toRoleNotificationResponse(doc: RoleNotificationItem) {
    return {
      id: doc._id?.toString() ?? doc.id,
      title: doc.title,
      message: doc.message,
      siteCode: doc.siteCode,
      targetUserRole: doc.targetUserRole,
      componentKey: doc.componentKey,
      read: doc.read,
      meta: doc.meta,
      payload: doc.meta,
      createdAt: doc.createdAt,
    };
  }
}
