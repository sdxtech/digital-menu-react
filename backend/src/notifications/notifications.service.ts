import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Notification, NotificationDocument } from './schemas/notification.schema';
import { NotificationsGateway } from './notifications.gateway';

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
    this.gateway.emitToUser(userId, 'notification', {
      id: createdObject._id?.toString() ?? created.id,
      title: createdObject.title,
      message: createdObject.message,
      meta: createdObject.meta,
      read: createdObject.read,
      createdAt: createdObject.createdAt,
    });

    return created;
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
}
