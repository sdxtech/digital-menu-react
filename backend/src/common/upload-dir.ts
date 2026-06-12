import { join } from 'path';

export const getUploadDir = () => {
  if (process.env.VERCEL === '1') {
    return join('/tmp', 'uploads');
  }

  return join(process.cwd(), 'uploads');
};
