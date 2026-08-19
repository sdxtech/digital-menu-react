import { Types } from 'mongoose';
import { AppRole } from '../auth/roles.constants';
import { UsersService } from './users.service';

describe('UsersService email recipients', () => {
  it('filters active users by role, site, and assigned user ids', async () => {
    const userId = new Types.ObjectId().toString();
    const siteId = new Types.ObjectId().toString();
    const lean = jest
      .fn()
      .mockResolvedValue([
        { _id: userId, name: 'Manager', email: 'MANAGER@example.com' },
      ]);
    const select = jest.fn().mockReturnValue({ lean });
    const model = { find: jest.fn().mockReturnValue({ select }) };
    const sites = {
      findSummariesByCodes: jest
        .fn()
        .mockResolvedValue(
          new Map([
            [
              'S001',
              { id: siteId, code: 'S001', name: 'Site 1', isActive: true },
            ],
          ]),
        ),
    };
    const service = new UsersService(model as never, sites as never);

    const result = await service.findActiveEmailRecipients({
      roles: [AppRole.UnitManager],
      site: 's001',
      userIds: [userId],
    });

    expect(model.find).toHaveBeenCalledWith({
      $and: [
        { roles: { $in: [AppRole.UnitManager] } },
        { isActive: { $ne: false } },
        { email: { $type: 'string', $ne: '' } },
        { _id: { $in: [expect.any(Types.ObjectId)] } },
        {
          $or: [{ sites: 'S001' }, { siteId: expect.any(Types.ObjectId) }],
        },
      ],
    });
    expect(result).toEqual([
      { id: userId, name: 'Manager', email: 'manager@example.com' },
    ]);
  });

  it('does not query Mongo when assigned ids are invalid', async () => {
    const model = { find: jest.fn() };
    const sites = { findSummariesByCodes: jest.fn() };
    const service = new UsersService(model as never, sites as never);

    const result = await service.findActiveEmailRecipients({
      roles: [AppRole.Chef],
      userIds: ['invalid-id'],
    });

    expect(result).toEqual([]);
    expect(model.find).not.toHaveBeenCalled();
  });
});
