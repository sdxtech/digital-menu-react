import {
  BadRequestException,
  type ExecutionContext,
  type INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Workbook } from 'exceljs';
import request from 'supertest';
import type { App } from 'supertest/types';
import type { AuthenticatedRequest } from '../src/auth/types/authenticated-request.type';
import { AppRole } from '../src/auth/roles.constants';
import { JwtAuthGuard } from '../src/auth/guards/jwt-auth.guard';
import { InventoryController } from '../src/inventory/inventory.controller';
import { InventoryService } from '../src/inventory/inventory.service';
import { readPurchaseOrders } from '../src/inventory/po-import';

describe('Inventory HTTP contract', () => {
  let app: INestApplication<App>;
  const id = '507f1f77bcf86cd799439011';
  const inventory = {
    resolveSite: jest.fn((site?: string) => {
      if (!site) throw new BadRequestException('Select a site first.');
      return Promise.resolve(site);
    }),
    status: jest.fn().mockResolvedValue({ active: false, activatedAt: null }),
    createReceipt: jest.fn().mockResolvedValue({ _id: id }),
    reverseReceipt: jest.fn().mockResolvedValue({ reversed: true }),
    previewOpening: jest
      .fn()
      .mockResolvedValue({ valid: true, previewId: id, rows: [] }),
    confirmOpening: jest.fn().mockResolvedValue({ active: true }),
    previewPurchaseOrders: jest.fn((_site: string, file: Buffer) =>
      readPurchaseOrders(file),
    ),
    confirmPurchaseOrders: jest.fn().mockResolvedValue({ count: 1 }),
  };
  const receipt = {
    requestId: '3692130c-8b38-4d65-b09f-031cab774a61',
    receivedDate: '2026-11-18',
    supplier: 'Supplier',
    lines: [{ productCode: 'IT001', unitOfMeasures: 'KG', quantity: 2 }],
  };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [InventoryController],
      providers: [{ provide: InventoryService, useValue: inventory }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate(context: ExecutionContext) {
          const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
          const role =
            req.headers['x-test-role'] === 'superadmin'
              ? AppRole.Superadmin
              : req.headers['x-test-role'] === 'chef'
                ? AppRole.Chef
                : AppRole.Storekeeper;
          req.user = {
            sub: 'test-user',
            name: 'Test User',
            email: 'test@example.test',
            roles: [role],
            site: 'S001',
          };
          return true;
        },
      })
      .compile();
    app = module.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('uses the storekeeper site and enforces the role guard', async () => {
    await request(app.getHttpServer())
      .get('/inventory/status?site=S002')
      .expect(200);
    expect(inventory.status).toHaveBeenCalledWith('S001');
    await request(app.getHttpServer())
      .get('/inventory/status?site=S002')
      .set('x-test-role', 'chef')
      .expect(403);
    await request(app.getHttpServer())
      .get('/inventory/status')
      .set('x-test-role', 'superadmin')
      .expect(400);
  });

  it.each(['storekeeper', 'superadmin'])(
    'rejects a purchase order without header R for %s',
    async (role) => {
      const workbook = new Workbook();
      workbook.addWorksheet('Sheet1').addRow(['Display Name']);
      const file = Buffer.from(await workbook.xlsx.writeBuffer());
      const response = await request(app.getHttpServer())
        .post('/inventory/receipts/po/preview?site=S002')
        .set('x-test-role', role)
        .attach('file', file, 'po.xlsx')
        .expect(400);
      expect(response.text).toContain('header R');
    },
  );

  it('forwards edited quantities and the workbook to the scoped PO confirmation', async () => {
    const file = Buffer.from('workbook');
    const quantities = '{"2":18}';
    await request(app.getHttpServer())
      .post('/inventory/receipts/po/confirm?site=S002')
      .field('receivedDates', '{"PO/1":"2026-11-19"}')
      .field('quantities', quantities)
      .attach('file', file, 'po.xlsx')
      .expect(201, { count: 1 });
    expect(inventory.confirmPurchaseOrders).toHaveBeenCalledWith(
      'S001',
      file,
      { receivedDates: '{"PO/1":"2026-11-19"}', quantities },
      { id: 'test-user', name: 'Test User' },
    );
  });

  it('accepts receipts without a supplier and rejects invalid supplied values', async () => {
    await request(app.getHttpServer())
      .post('/inventory/receipts')
      .send({ ...receipt, supplier: undefined })
      .expect(201);
    await request(app.getHttpServer())
      .post('/inventory/receipts')
      .send({ ...receipt, supplier: 123 })
      .expect(400);
    expect(inventory.createReceipt).toHaveBeenCalledTimes(1);
  });

  it('validates nested receipt quantities, dates, identifiers and unexpected fields', async () => {
    await request(app.getHttpServer())
      .post('/inventory/receipts')
      .send(receipt)
      .expect(201);
    for (const body of [
      { ...receipt, requestId: 'invalid' },
      { ...receipt, receivedDate: '2026-99-99' },
      { ...receipt, lines: [{ ...receipt.lines[0], quantity: -1 }] },
      { ...receipt, lines: [{ ...receipt.lines[0], quantity: '2' }] },
      { ...receipt, site: 'S002' },
    ])
      await request(app.getHttpServer())
        .post('/inventory/receipts')
        .send(body)
        .expect(400);
    expect(inventory.createReceipt).toHaveBeenCalledTimes(1);
  });

  it('accepts only preview identifiers for opening confirmation', async () => {
    await request(app.getHttpServer())
      .post('/inventory/opening/confirm')
      .send({ lines: receipt.lines })
      .expect(400);
    await request(app.getHttpServer())
      .post('/inventory/opening/confirm')
      .send({ previewId: id })
      .expect(201);
    expect(inventory.confirmOpening).toHaveBeenCalledWith(
      'S001',
      id,
      {
        id: 'test-user',
        name: 'Test User',
      },
      false,
    );
  });

  it('authorizes additional opening balances only from the superadmin role', async () => {
    await request(app.getHttpServer())
      .post('/inventory/opening/preview?site=S002')
      .set('x-test-role', 'superadmin')
      .attach('file', Buffer.from('fixture'), 'opening.xlsx')
      .expect(201);
    expect(inventory.previewOpening).toHaveBeenLastCalledWith(
      'S002',
      expect.any(Buffer),
      { id: 'test-user', name: 'Test User' },
      true,
    );
    await request(app.getHttpServer())
      .post('/inventory/opening/confirm?site=S002')
      .set('x-test-role', 'superadmin')
      .send({ previewId: id })
      .expect(201);
    expect(inventory.confirmOpening).toHaveBeenLastCalledWith(
      'S002',
      id,
      { id: 'test-user', name: 'Test User' },
      true,
    );
    await request(app.getHttpServer())
      .post('/inventory/opening/confirm')
      .send({ previewId: id, allowAdditional: true })
      .expect(400);
  });

  it('accepts multipart Excel previews and rejects missing/wrong/oversized files', async () => {
    await request(app.getHttpServer())
      .post('/inventory/opening/preview')
      .expect(400);
    await request(app.getHttpServer())
      .post('/inventory/opening/preview')
      .attach('file', Buffer.from('data'), 'opening.csv')
      .expect(400);
    await request(app.getHttpServer())
      .post('/inventory/opening/preview')
      .attach('file', Buffer.alloc(2 * 1024 * 1024 + 1), 'opening.xlsx')
      .expect(413);
    await request(app.getHttpServer())
      .post('/inventory/opening/preview')
      .attach('file', Buffer.from('transport fixture'), 'opening.xlsx')
      .expect(201);
    expect(inventory.previewOpening).toHaveBeenCalledTimes(1);
  });

  it('restricts reversals to superadmin and requires a reason', async () => {
    await request(app.getHttpServer())
      .post(`/inventory/receipts/${id}/reverse`)
      .send({ reason: 'Duplicate' })
      .expect(403);
    await request(app.getHttpServer())
      .post(`/inventory/receipts/${id}/reverse?site=S001`)
      .set('x-test-role', 'superadmin')
      .send({})
      .expect(400);
    await request(app.getHttpServer())
      .post(`/inventory/receipts/${id}/reverse?site=S001`)
      .set('x-test-role', 'superadmin')
      .send({ reason: 'Duplicate' })
      .expect(201);
    expect(inventory.reverseReceipt).toHaveBeenCalledTimes(1);
  });
});
