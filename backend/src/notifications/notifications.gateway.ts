import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';

type JoinPayload = { userId: string } | string;

@WebSocketGateway({ namespace: '/ws', cors: { origin: '*' } })
export class NotificationsGateway {
  @WebSocketServer()
  private readonly server: Server;

  emitToUser(userId: string, event: string, payload: unknown) {
    this.server.to(`user:${userId}`).emit(event, payload);
  }

  @SubscribeMessage('join')
  handleJoin(@MessageBody() payload: JoinPayload, @ConnectedSocket() client: Socket) {
    // TODO: replace with socket auth token validation.
    const userId = typeof payload === 'string' ? payload : payload?.userId;
    if (userId) {
      client.join(`user:${userId}`);
    }
  }
}
