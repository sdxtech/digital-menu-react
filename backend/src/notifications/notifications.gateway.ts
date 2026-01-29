import { OnGatewayConnection, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { JwtService } from '@nestjs/jwt';
import { Server, Socket } from 'socket.io';
import type { JwtPayload } from '../auth/types/jwt-payload.type';

@WebSocketGateway({ namespace: '/ws', cors: { origin: '*' } })
export class NotificationsGateway implements OnGatewayConnection {
  @WebSocketServer()
  private readonly server: Server;

  constructor(private readonly jwt: JwtService) {}

  emitToUser(userId: string, event: string, payload: unknown) {
    this.server.to(`user:${userId}`).emit(event, payload);
  }

  handleConnection(client: Socket) {
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

    const queryToken = client.handshake.query?.token;
    if (typeof queryToken === 'string' && queryToken.trim()) {
      return this.normalizeToken(queryToken);
    }
    if (Array.isArray(queryToken) && queryToken.length && typeof queryToken[0] === 'string') {
      return this.normalizeToken(queryToken[0]);
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
