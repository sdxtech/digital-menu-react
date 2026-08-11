import { HostingerMailClient } from './hostinger-mail.client';

describe('HostingerMailClient', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('sends email through the configured Hostinger mailbox over HTTPS', async () => {
    const requests: Array<Parameters<typeof fetch>> = [];
    const fetchMock = jest.fn<typeof fetch>((...args) => {
      requests.push(args);
      return Promise.resolve(new Response(null, { status: 204 }));
    });
    global.fetch = fetchMock;
    const values: Record<string, string> = {
      HOSTINGER_MAIL_API_TOKEN: 'hostinger-test-token',
      HOSTINGER_MAILBOX_ID: 'AC1mailbox',
    };
    const config = {
      get: jest.fn((key: string) => values[key]),
      getOrThrow: jest.fn((key: string) => values[key]),
    };
    const client = new HostingerMailClient(config as never);

    await client.send({
      from: 'Food Recipe System <no-reply@example.com>',
      to: 'manager@example.com',
      subject: 'Menu awaiting approval',
      text: 'Please review the menu.',
      html: '<p>Please review the menu.</p>',
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(requests[0][0]).toBe(
      'https://api.mail.hostinger.com/api/v1/mailboxes/AC1mailbox/send',
    );
    expect(requests[0][1]?.method).toBe('POST');
    expect(requests[0][1]?.headers).toEqual({
      Accept: 'application/json',
      Authorization: 'Bearer hostinger-test-token',
      'Content-Type': 'application/json',
      'User-Agent': 'food-recipe-system/1.0',
    });
    const body = requests[0][1]?.body;
    expect(typeof body).toBe('string');
    expect(JSON.parse(body as string)).toEqual({
      to: ['manager@example.com'],
      displayName: 'Food Recipe System',
      subject: 'Menu awaiting approval',
      text: 'Please review the menu.',
      html: '<p>Please review the menu.</p>',
    });
  });

  it('discovers and caches the mailbox matching EMAIL_FROM', async () => {
    const requests: Array<Parameters<typeof fetch>> = [];
    const fetchMock = jest.fn<typeof fetch>((...args) => {
      requests.push(args);
      if (requests.length === 1) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              data: {
                mailboxes: [
                  {
                    resourceId: 'AC1discovered',
                    address: 'no-reply@example.com',
                  },
                ],
              },
            }),
            { status: 200 },
          ),
        );
      }
      return Promise.resolve(new Response(null, { status: 204 }));
    });
    global.fetch = fetchMock;
    const config = {
      get: jest.fn().mockReturnValue(undefined),
      getOrThrow: jest.fn().mockReturnValue('hostinger-test-token'),
    };
    const client = new HostingerMailClient(config as never);
    const mail = {
      from: 'Food Recipe System <no-reply@example.com>',
      to: 'manager@example.com',
      subject: 'Test',
    };

    await client.send(mail);
    await client.send(mail);

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(requests[0][0]).toBe('https://api.mail.hostinger.com/api/v1/me');
    expect(requests[1][0]).toBe(
      'https://api.mail.hostinger.com/api/v1/mailboxes/AC1discovered/send',
    );
    expect(requests[2][0]).toBe(
      'https://api.mail.hostinger.com/api/v1/mailboxes/AC1discovered/send',
    );
  });

  it('reports Hostinger error details', async () => {
    global.fetch = jest.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          code: 'ERR_MAILBOX_NOT_FOUND',
          error: 'Mailbox not found.',
        }),
        { status: 404, statusText: 'Not Found' },
      ),
    ) as typeof fetch;
    const config = {
      get: jest.fn().mockReturnValue('AC1missing'),
      getOrThrow: jest.fn().mockReturnValue('hostinger-test-token'),
    };
    const client = new HostingerMailClient(config as never);

    await expect(
      client.send({
        from: 'no-reply@example.com',
        to: 'manager@example.com',
        subject: 'Test',
      }),
    ).rejects.toThrow(
      'Hostinger Mail API 404 (ERR_MAILBOX_NOT_FOUND): Mailbox not found.',
    );
  });

  it('explains how to configure an alias that cannot be discovered', async () => {
    global.fetch = jest.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: { mailboxes: [] } }), {
        status: 200,
      }),
    ) as typeof fetch;
    const config = {
      get: jest.fn().mockReturnValue(undefined),
      getOrThrow: jest.fn().mockReturnValue('hostinger-test-token'),
    };
    const client = new HostingerMailClient(config as never);

    await expect(
      client.send({
        from: 'Alias <alias@example.com>',
        to: 'manager@example.com',
        subject: 'Test',
      }),
    ).rejects.toThrow('set HOSTINGER_MAILBOX_ID explicitly');
  });
});
