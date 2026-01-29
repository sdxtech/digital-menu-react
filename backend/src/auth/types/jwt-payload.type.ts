import { AppRole } from '../roles.constants';

export type JwtPayload = {
  sub: string;
  name: string;
  email: string;
  roles: AppRole[];
  iat?: number;
  exp?: number;
};
