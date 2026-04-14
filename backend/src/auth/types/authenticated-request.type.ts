import type { Request } from 'express';
import type { JwtPayload } from './jwt-payload.type';

export type AuthenticatedRequest = Request & { user: JwtPayload };
