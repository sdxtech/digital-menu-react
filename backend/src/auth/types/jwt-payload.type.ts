import { AppRole } from '../roles.constants';

export type JwtPayload = {
  sub: string;
  name: string;
  email: string;
  roles: AppRole[];
  appRole?: string;
  site?: string;
  iat?: number;
  exp?: number;
};
