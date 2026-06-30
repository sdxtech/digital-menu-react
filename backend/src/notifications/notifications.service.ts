import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  Notification,
  NotificationDocument,
} from './schemas/notification.schema';
import { NotificationsGateway } from './notifications.gateway';
import { GetRoleNotificationsDto } from './dto/get-role-notifications.dto';

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
    targetUserRole: 'superadmin' | 'unit.manager' | 'storekeeper' | 'chef',
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

    const result = created as any;
    this.gateway.emitToUser(userId, 'notification:new', {
      id: result._id?.toString() ?? result.id,
      title: result.title,
      message: result.message,
      siteCode: result.siteCode,
      targetUserRole: result.targetUserRole,
      componentKey: result.componentKey,
      read: result.read,
      meta: result.meta,
      createdAt: result.createdAt,
    });

    return created;
  }

  // 🌟 ADDED: Get unread records inside a worker's site tenant boundary
  async getUnreadRoleNotifications(filter: GetRoleNotificationsDto): Promise<any[]> {
    const incomingRole = (filter.targetUserRole || '').toLowerCase().trim();
    const cleanRole = incomingRole === 'unit-manager' ? 'unit.manager' : incomingRole;

    const docs = await this.notificationModel
      .find({
        siteCode: filter.siteCode?.trim(),
        targetUserRole: { 
          $in: [
            cleanRole, 
            cleanRole.replace('-', '.'), 
            cleanRole.replace('.', '-')
          ] 
        },
        read: false,
      })
      .sort({ createdAt: -1 })
      .lean();

    return docs.map((doc: any) => ({
      id: doc._id?.toString() ?? doc.id,
      title: doc.title,
      message: doc.message,
      siteCode: doc.siteCode,
      targetUserRole: doc.targetUserRole,
      componentKey: doc.componentKey,
      read: doc.read,
      meta: doc.meta,
      createdAt: doc.createdAt,
    }));
  }

  // 🌟 ADDED: Clear role counters on page view
  async markRoleNotificationsAsRead(filter: GetRoleNotificationsDto) {
    const incomingRole = (filter.targetUserRole || '').toLowerCase().trim();
    const cleanRole = incomingRole === 'unit-manager' ? 'unit.manager' : incomingRole;

    return this.notificationModel.updateMany(
      {
        siteCode: filter.siteCode,
        targetUserRole: { 
          $in: [cleanRole, cleanRole.replace('-', '.'), cleanRole.replace('.', '-')] 
        },
        read: false,
      },
      { $set: { read: true } },
    ).exec();
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
}