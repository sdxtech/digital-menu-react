import { ConflictException } from '@nestjs/common';
import { MenuGroupsService } from './menu-groups.service';

describe('MenuGroupsService', () => {
  const createService = (menuGroupModel: Record<string, jest.Mock>) =>
    new MenuGroupsService(menuGroupModel as never);

  it('trims and creates a unique Group By option', async () => {
    const collation = jest.fn().mockResolvedValue(null);
    const findOne = jest.fn().mockReturnValue({ collation });
    const create = jest.fn().mockResolvedValue({ name: 'Breakfast' });
    const service = createService({ findOne, create });

    await service.create({ name: '  Breakfast  ' });

    expect(findOne).toHaveBeenCalledWith({ name: 'Breakfast' });
    expect(collation).toHaveBeenCalledWith({ locale: 'en', strength: 2 });
    expect(create).toHaveBeenCalledWith({
      name: 'Breakfast',
      isActive: true,
    });
  });

  it('rejects duplicate Group By names', async () => {
    const findOne = jest.fn().mockReturnValue({
      collation: jest.fn().mockResolvedValue({ _id: 'existing-id' }),
    });
    const service = createService({ findOne });

    await expect(service.create({ name: 'Breakfast' })).rejects.toThrow(
      ConflictException,
    );
  });

  it('lists active options alphabetically', async () => {
    const lean = jest.fn().mockResolvedValue([{ name: 'Breakfast' }]);
    const limit = jest.fn().mockReturnValue({ lean });
    const skip = jest.fn().mockReturnValue({ limit });
    const sort = jest.fn().mockReturnValue({ skip });
    const find = jest.fn().mockReturnValue({ sort });
    const countDocuments = jest.fn().mockResolvedValue(1);
    const service = createService({ find, countDocuments });

    const result = await service.findAll({
      page: 1,
      limit: 10,
      isActive: true,
    });

    expect(find).toHaveBeenCalledWith({ isActive: true });
    expect(sort).toHaveBeenCalledWith({ name: 1 });
    expect(result).toEqual({
      items: [{ name: 'Breakfast' }],
      total: 1,
      page: 1,
      limit: 10,
    });
  });
});
