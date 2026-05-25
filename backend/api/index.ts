import type { Express, Request, Response } from 'express';
import express from 'express';
import { NestFactory } from '@nestjs/core';
import { ExpressAdapter } from '@nestjs/platform-express';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';

let cachedServer: Express | undefined;

async function getServer() {
  if (cachedServer) return cachedServer;

  const server = express();
  const app = await NestFactory.create(AppModule, new ExpressAdapter(server));
  await configureApp(app);
  await app.init();

  cachedServer = server;
  return server;
}

export default async function handler(req: Request, res: Response) {
  const server = await getServer();
  return server(req, res);
}
