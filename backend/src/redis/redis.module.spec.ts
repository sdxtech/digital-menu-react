import { Test, TestingModule } from '@nestjs/testing';
import { once } from 'node:events';
import { createServer, Server, Socket } from 'node:net';
import type Redis from 'ioredis';
import { RedisModule } from './redis.module';
import { REDIS_CLIENT, REDIS_OPTIONS } from './redis.constants';

describe('Redis connection recovery', () => {
  let server: Server;
  let module: TestingModule | undefined;
  let client: Redis;
  const sockets = new Set<Socket>();

  const waitUntilReady = () =>
    new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        client.off('ready', ready);
        client.off('end', ended);
        clearTimeout(timeout);
      };
      const ready = () => {
        cleanup();
        resolve();
      };
      const ended = () => {
        cleanup();
        reject(new Error('Redis connection ended instead of reconnecting'));
      };
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error('Redis did not reconnect within 3 seconds'));
      }, 3000);
      client.once('ready', ready);
      client.once('end', ended);
    });

  beforeEach(async () => {
    // A local PING-only endpoint lets the real ioredis client exercise socket
    // loss/recovery without requiring or changing a running Redis database.
    server = createServer((socket) => {
      sockets.add(socket);
      socket.on('close', () => sockets.delete(socket));
      socket.on('data', () => socket.write('+PONG\r\n'));
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Expected a TCP server address');
    }
    module = await Test.createTestingModule({ imports: [RedisModule] })
      .overrideProvider(REDIS_OPTIONS)
      .useValue({
        host: '127.0.0.1',
        port: address.port,
        enableReadyCheck: false,
        disableClientInfo: true,
      })
      .compile();
    client = module.get<Redis>(REDIS_CLIENT);
    if (client.status !== 'ready') await waitUntilReady();
  });

  afterEach(async () => {
    await module?.close();
    module = undefined;
    for (const socket of sockets) socket.destroy();
    sockets.clear();
    if (server.listening) {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  it('answers PING again after its socket is disconnected', async () => {
    await expect(client.ping()).resolves.toBe('PONG');
    const reconnected = waitUntilReady();
    for (const socket of sockets) socket.destroy();
    await reconnected;
    await expect(client.ping()).resolves.toBe('PONG');
  });

  it('still rejects pending commands after the request retry limit during an outage', async () => {
    const reconnecting = once(client, 'reconnecting');
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await reconnecting;
    await expect(client.ping()).rejects.toThrow(
      'max retries per request limit',
    );
  });

  it('ends the connection when the application shuts down', async () => {
    const ended = once(client, 'end');
    await module?.close();
    module = undefined;
    await ended;
    expect(client.status).toBe('end');
  });
});
