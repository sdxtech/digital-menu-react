import { WorkflowMailService } from './workflow-mail.service';

describe('WorkflowMailService', () => {
  const makeService = (enabled = true) => {
    const mail = { enqueue: jest.fn().mockResolvedValue({ jobId: 'mail-1' }) };
    const users = {
      findActiveEmailRecipients: jest
        .fn()
        .mockResolvedValue([
          { id: 'manager-1', name: 'Manager', email: 'manager@example.com' },
        ]),
    };
    const values: Record<string, string> = {
      EMAIL_NOTIFICATIONS_ENABLED: String(enabled),
      APP_BASE_URL: 'http://localhost:5173',
    };
    const config = {
      get: jest.fn((key: string) => values[key]),
      getOrThrow: jest.fn((key: string) => values[key]),
    };
    return {
      mail,
      service: new WorkflowMailService(
        mail as never,
        users as never,
        config as never,
      ),
      users,
    };
  };

  it('does not resolve recipients or enqueue when notifications are disabled', async () => {
    const { mail, service, users } = makeService(false);

    await service.notifyRecipeSubmitted({
      id: 'recipe-1',
      name: 'Soup',
      site: 'S001',
    });

    expect(users.findActiveEmailRecipients).not.toHaveBeenCalled();
    expect(mail.enqueue).not.toHaveBeenCalled();
  });

  it('emails active Unit Managers and Corporate Chefs for a recipe submission', async () => {
    const { mail, service, users } = makeService();

    await service.notifyRecipeSubmitted({
      id: 'recipe-1',
      name: 'Soup',
      recipeCode: 'RCP0001',
      version: 1,
      site: 'S001',
    });

    expect(users.findActiveEmailRecipients).toHaveBeenCalledWith({
      roles: ['unit-manager', 'corporate-chef'],
      site: 'S001',
    });
    expect(mail.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'manager@example.com',
        deduplicationKey: 'recipe-submitted-recipe-1-manager-1',
      }),
    );
  });

  it.each(['approved', 'rejected'] as const)(
    'emails only the Chef when a recipe is %s',
    async (status) => {
      const { mail, service, users } = makeService();
      users.findActiveEmailRecipients.mockResolvedValueOnce([
        { id: 'chef-1', name: 'Chef', email: 'chef@example.com' },
      ]);

      await service.notifyRecipeDecision(
        {
          id: 'recipe-1',
          name: 'Soup',
          recipeCode: 'RCP0001',
          version: 1,
          site: 'S001',
          createdBy: '507f1f77bcf86cd799439011',
        },
        status,
        status === 'rejected' ? 'Revise the ingredients' : undefined,
      );

      expect(users.findActiveEmailRecipients).toHaveBeenCalledTimes(1);
      expect(users.findActiveEmailRecipients).toHaveBeenCalledWith({
        roles: ['chef'],
        userIds: ['507f1f77bcf86cd799439011'],
      });
      expect(mail.enqueue).toHaveBeenCalledTimes(1);
      expect(mail.enqueue).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'chef@example.com',
          deduplicationKey: `recipe-${status}-chef-recipe-1-chef-1`,
        }),
      );
    },
  );

  it('waits until every menu in a production batch has been reviewed', async () => {
    const { mail, service, users } = makeService();

    await service.notifyMenuProductionBatchReviewed([
      {
        id: 'menu-1',
        productionCode: 'MPR0001',
        menuName: 'Soup',
        site: 'S001',
        approvalStatus: 'approved',
      },
      {
        id: 'menu-2',
        productionCode: 'MPR0001',
        menuName: 'Rice',
        site: 'S001',
        approvalStatus: 'pending',
      },
    ]);

    expect(users.findActiveEmailRecipients).not.toHaveBeenCalled();
    expect(mail.enqueue).not.toHaveBeenCalled();
  });

  it('sends separate Chef and Storekeeper links after a batch is reviewed', async () => {
    const { mail, service, users } = makeService();
    users.findActiveEmailRecipients
      .mockResolvedValueOnce([
        { id: 'chef-1', name: 'Chef', email: 'chef@example.com' },
      ])
      .mockResolvedValueOnce([
        { id: 'store-1', name: 'Store', email: 'store@example.com' },
      ]);

    await service.notifyMenuProductionBatchReviewed([
      {
        id: 'menu-1',
        productionCode: 'MPR0001',
        menuName: 'Soup',
        site: 'S001',
        createdBy: '507f1f77bcf86cd799439011',
        approvalStatus: 'approved',
      },
    ]);

    expect(mail.enqueue).toHaveBeenCalledTimes(2);
    expect(mail.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'chef@example.com',
        html: expect.stringContaining('/chef/store-request'),
      }),
    );
    expect(mail.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'store@example.com',
        html: expect.stringContaining('/storekeeper'),
      }),
    );
  });
});
