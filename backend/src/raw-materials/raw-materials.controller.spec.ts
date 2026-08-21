import { ForbiddenException } from '@nestjs/common';
import { AppRole } from '../auth/roles.constants';
import { RawMaterialsController } from './raw-materials.controller';

describe('RawMaterialsController site scope', () => {
  const makeController = () => {
    const rawMaterials = {
      findAll: jest.fn().mockResolvedValue({ items: [], total: 0 }),
      findVendorPrices: jest.fn().mockResolvedValue([]),
    };
    const controller = new RawMaterialsController(
      rawMaterials as never,
      {} as never,
    );

    return { controller, rawMaterials };
  };

  const chefRequest = {
    user: {
      sub: 'chef-1',
      name: 'Site Chef',
      email: 'chef@example.com',
      roles: [AppRole.Chef],
      site: 'SITE-001',
    },
  };

  const superadminRequest = {
    user: {
      sub: 'superadmin-1',
      name: 'Superadmin',
      email: 'superadmin@example.com',
      roles: [AppRole.Superadmin],
    },
  };

  const corporateChefRequest = {
    user: {
      sub: 'corporate-chef-1',
      name: 'Corporate Chef',
      email: 'corporate-chef@example.com',
      roles: [AppRole.CorporateChef],
      site: 'SITE-001',
      sites: ['SITE-001', 'SITE-002'],
    },
  };

  it('forces raw material lists to the authenticated user site', async () => {
    const { controller, rawMaterials } = makeController();

    await controller.list(
      { page: 2, limit: 30, search: 'rice', site: 'OTHER-SITE' },
      chefRequest as never,
    );

    expect(rawMaterials.findAll).toHaveBeenCalledWith({
      page: 2,
      limit: 30,
      search: 'rice',
      site: 'SITE-001',
    });
  });

  it('forces vendor prices to the authenticated user site', async () => {
    const { controller, rawMaterials } = makeController();

    await controller.listVendorPrices(
      chefRequest as never,
      'IT00001',
      'OTHER-SITE',
      'Vendor A',
    );

    expect(rawMaterials.findVendorPrices).toHaveBeenCalledWith({
      productCode: 'IT00001',
      site: 'SITE-001',
      vendor: 'Vendor A',
    });
  });

  it('allows superadmin to request a selected site', async () => {
    const { controller, rawMaterials } = makeController();

    await controller.list(
      { page: 1, limit: 20, site: 'SITE-002' },
      superadminRequest as never,
    );

    expect(rawMaterials.findAll).toHaveBeenCalledWith({
      page: 1,
      limit: 20,
      search: undefined,
      site: 'SITE-002',
    });
  });

  it('gives corporate chefs a global raw material list', async () => {
    const { controller, rawMaterials } = makeController();

    await controller.list(
      { page: 1, limit: 20, search: 'chicken', site: 'SITE-001' },
      corporateChefRequest as never,
    );

    expect(rawMaterials.findAll).toHaveBeenCalledWith({
      page: 1,
      limit: 20,
      search: 'chicken',
      site: undefined,
    });
  });

  it('gives corporate chefs global raw material vendor prices', async () => {
    const { controller, rawMaterials } = makeController();

    await controller.listVendorPrices(
      corporateChefRequest as never,
      'IT00001',
      'SITE-001',
      'Vendor A',
    );

    expect(rawMaterials.findVendorPrices).toHaveBeenCalledWith({
      productCode: 'IT00001',
      site: undefined,
      vendor: 'Vendor A',
    });
  });

  it('rejects non-superadmin users without a site', () => {
    const { controller } = makeController();
    const requestWithoutSite = {
      ...chefRequest,
      user: { ...chefRequest.user, site: undefined },
    };

    expect(() =>
      controller.list({ page: 1, limit: 20 }, requestWithoutSite as never),
    ).toThrow(ForbiddenException);
  });
});
