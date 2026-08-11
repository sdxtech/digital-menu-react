export type MailJob = {
  to: string;
  originalTo?: string;
  subject: string;
  text?: string;
  html?: string;
  from: string;
  category?: string;
};

export type EnqueueMailInput = {
  to: string;
  subject: string;
  text?: string;
  html?: string;
  category?: string;
  deduplicationKey?: string;
};
