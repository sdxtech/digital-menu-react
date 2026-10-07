import { AppRole } from '../roles.constants';

export type JwtPayload = {
  sub: string;
  name: string;
  email: string;
  roles: AppRole[];
  appRole?: string;
  site?: string;
  siteId?: string;
  siteName?: string;
  sites?: string[];
  corporateSite?: boolean;
  approvalSites?: string[];
  sessionVersion?: number;
  iat?: number;
  exp?: number;
};
