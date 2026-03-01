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

const DEFAULT_WS_ORIGIN = 'http://localhost:5173';

@WebSocketGateway({
  namespace: '/ws',
  cors: {
    origin: parseCorsOrigins(process.env.CORS_ORIGIN ?? DEFAULT_WS_ORIGIN),
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

  handleConnection(client: Socket) {
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
      client.data.userId = payload.sub;
      client.join(`user:${payload.sub}`);
    } catch {
      client.disconnect(true);
    }
  }

  private extractToken(client: Socket) {
    const header = client.handshake.headers?.authorization;
    if (typeof header === 'string' && header.trim()) {
      return this.normalizeToken(header);
    }

    const authToken = client.handshake.auth?.token;
    if (typeof authToken === 'string' && authToken.trim()) {
      return this.normalizeToken(authToken);
    }

    return undefined;
  }

  private normalizeToken(value: string) {
    const trimmed = value.trim();
    if (trimmed.startsWith('Bearer ')) {
      return trimmed.slice(7).trim();
    }
    return trimmed;
  }
}
