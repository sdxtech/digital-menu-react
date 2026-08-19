import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { MailJob } from './mail.types';

type HostingerErrorResponse = {
  code?: unknown;
  error?: unknown;
};

type HostingerAccountResponse = HostingerErrorResponse & {
  data?: {
    mailboxes?: Array<{
      address?: unknown;
      resourceId?: unknown;
    }>;
  };
};

@Injectable()
export class HostingerMailClient {
  private readonly apiBaseUrl = 'https://api.mail.hostinger.com';
  private mailboxResourceId?: Promise<string>;

  constructor(private readonly config: ConfigService) {}

  async send(mail: MailJob): Promise<void> {
    const sender = this.parseSender(mail.from);
    const mailboxResourceId = await this.resolveMailboxResourceId(
      sender.address,
    );
    const response = await this.request(
      `/api/v1/mailboxes/${encodeURIComponent(mailboxResourceId)}/send`,
      {
        method: 'POST',
        body: JSON.stringify({
          to: [mail.to],
          ...(sender.displayName ? { displayName: sender.displayName } : {}),
          subject: mail.subject,
          ...(mail.text !== undefined ? { text: mail.text } : {}),
          ...(mail.html !== undefined ? { html: mail.html } : {}),
        }),
      },
    );

    if (!response.ok) {
      throw await this.apiError(response);
    }
  }

  private resolveMailboxResourceId(senderAddress: string) {
    const configuredId = this.config
      .get<string>('HOSTINGER_MAILBOX_ID')
      ?.trim();
    if (configuredId) return Promise.resolve(configuredId);

    this.mailboxResourceId ??= this.discoverMailboxResourceId(
      senderAddress,
    ).catch((error: unknown) => {
      this.mailboxResourceId = undefined;
      throw error;
    });
    return this.mailboxResourceId;
  }

  private async discoverMailboxResourceId(senderAddress: string) {
    const response = await this.request('/api/v1/me', { method: 'GET' });
    if (!response.ok) {
      throw await this.apiError(response);
    }

    const result = (await this.readResponse(
      response,
    )) as HostingerAccountResponse;
    const mailbox = result.data?.mailboxes?.find(
      (candidate) =>
        typeof candidate.address === 'string' &&
        candidate.address.trim().toLowerCase() === senderAddress.toLowerCase(),
    );
    if (typeof mailbox?.resourceId !== 'string' || !mailbox.resourceId.trim()) {
      throw new Error(
        `Hostinger Mail API cannot find a mailbox matching EMAIL_FROM address ${senderAddress}; set HOSTINGER_MAILBOX_ID explicitly if the sender is an alias`,
      );
    }

    return mailbox.resourceId.trim();
  }

  private async request(path: string, init: RequestInit) {
    const apiToken = this.config
      .getOrThrow<string>('HOSTINGER_MAIL_API_TOKEN')
      .trim();
    try {
      return await fetch(`${this.apiBaseUrl}${path}`, {
        ...init,
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${apiToken}`,
          ...(init.body ? { 'Content-Type': 'application/json' } : {}),
          'User-Agent': 'food-recipe-system/1.0',
        },
        signal: AbortSignal.timeout(15_000),
      });
    } catch (error) {
      throw new Error(
        `Hostinger Mail API connection failed: ${this.errorMessage(error)}`,
      );
    }
  }

  private async apiError(response: Response) {
    const result = (await this.readResponse(
      response,
    )) as HostingerErrorResponse;
    const detail =
      typeof result.error === 'string'
        ? result.error
        : response.statusText || 'Unknown error';
    const code = typeof result.code === 'string' ? ` (${result.code})` : '';
    return new Error(`Hostinger Mail API ${response.status}${code}: ${detail}`);
  }

  private async readResponse(response: Response): Promise<unknown> {
    const body = await response.text();
    if (!body) return {};
    try {
      return JSON.parse(body) as unknown;
    } catch {
      return {};
    }
  }

  private parseSender(from: string) {
    const trimmed = from.trim();
    const angleStart = trimmed.lastIndexOf('<');
    if (angleStart >= 0 && trimmed.endsWith('>')) {
      const address = trimmed.slice(angleStart + 1, -1).trim();
      this.assertEmailAddress(address);
      const rawDisplayName = trimmed.slice(0, angleStart).trim();
      const displayName = rawDisplayName.replace(/^"|"$/g, '').trim();
      return { address, displayName };
    }

    this.assertEmailAddress(trimmed);
    return { address: trimmed, displayName: '' };
  }

  private assertEmailAddress(value: string) {
    if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(value)) {
      throw new Error(
        'EMAIL_FROM must contain a valid mailbox address for Hostinger Mail API',
      );
    }
  }

  private errorMessage(error: unknown) {
    return error instanceof Error ? error.message : String(error);
  }
}
