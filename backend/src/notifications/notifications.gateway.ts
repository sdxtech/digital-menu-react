import { Logger } from '@nestjs/common';
import {
  OnGatewayConnection,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Server, Socket } from 'socket.io';
import type { JwtPayload } from '../auth/types/jwt-payload.type';
import { parseCorsOrigins } from '../common/cors.utils';

@WebSocketGateway({
  namespace: '/ws',
  cors: {
    // Validate origin in handleConnection using ConfigService-backed list.
    origin: true,
    credentials: true,
  },
})
export class NotificationsGateway implements OnGatewayConnection {
  private readonly logger = new Logger(NotificationsGateway.name);
  private readonly allowedOrigins: string[];

  @WebSocketServer()
  private readonly server: Server;

  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {
    this.allowedOrigins = parseCorsOrigins(
      this.config.getOrThrow<string>('CORS_ORIGIN'),
    );
  }

  emitToUser(userId: string, event: string, payload: unknown) {
    this.server.to(`user:${userId}`).emit(event, payload);
  }

  async handleConnection(client: Socket) {
    const origin = client.handshake.headers?.origin;
    if (typeof origin !== 'string' || !this.allowedOrigins.includes(origin)) {
      this.logger.warn(
        `WebSocket connection blocked due to disallowed origin: ${origin ?? 'unknown'}`,
      );
      client.disconnect(true);
      return;
    }

    const token = this.extractToken(client);
    if (!token) {
      client.disconnect(true);
      return;
    }

    try {
      const payload = this.jwt.verify<JwtPayload>(token);
      const data = client.data as { userId?: string };
      data.userId = payload.sub;
      await client.join(`user:${payload.sub}`);
    } catch {
      client.disconnect(true);
    }
  }

  private extractToken(client: Socket) {
    const header = client.handshake.headers?.authorization;
    if (typeof header === 'string' && header.trim()) {
      return this.normalizeToken(header);
    }

    const authToken = this.extractAuthToken(client.handshake.auth);
    if (typeof authToken === 'string' && authToken.trim()) {
      return this.normalizeToken(authToken);
    }

    return undefined;
  }

  private extractAuthToken(auth: unknown) {
    if (!auth || typeof auth !== 'object') return undefined;
    const token = (auth as Record<string, unknown>).token;
    return typeof token === 'string' ? token : undefined;
  }

  private normalizeToken(value: string) {
    const trimmed = value.trim();
    if (trimmed.startsWith('Bearer ')) {
      return trimmed.slice(7).trim();
    }
    return trimmed;
  }
}
