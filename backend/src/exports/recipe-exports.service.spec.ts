import { existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { Readable } from 'node:stream';
import ExcelJS from 'exceljs';
import { Types } from 'mongoose';
import { RecipeExportsService } from './recipe-exports.service';
import type { RecipeIngredient } from '../recipes/schemas/recipe.schema';

const recipe = (index: number, ingredientCount = 2) => ({
  _id: new Types.ObjectId(index.toString(16).padStart(24, '0')),
  name: `Recipe ${index}`,
  recipeCode: `RCP-${index}`,
  category: 'Main Course',
  portionSize: 10,
  createdBy: '000000000000000000000001',
  createdByName: 'Stored author',
  ingredients: Array.from({ length: ingredientCount }, (_, i) => ({
    ingredientType: 'IT' as const,
    productCode: `00${i + 1}`,
    name: `Ingredient ${i + 1}`,
    prodQty: i === 0 ? 0 : 0.123456,
    prodUomCode: 'KG',
    srQty: i === 0 ? 0 : 123.456,
    srUomCode: 'G',
  })),
});

type TestRecipe = Omit<ReturnType<typeof recipe>, 'ingredients'> & {
  ingredients: RecipeIngredient[];
};

const setup = (records: TestRecipe[]) => {
  let offset = 0;
  const query = {
    select: jest.fn().mockReturnThis(),
    sort: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    lean: jest.fn().mockImplementation(() => {
      const batch = records.slice(offset, offset + 100);
      offset += batch.length;
      return Promise.resolve(batch);
    }),
  };
  const model = {
    find: jest.fn().mockReturnValue(query),
    countDocuments: jest.fn().mockResolvedValue(records.length),
  };
  const users = {
    findNamesByIds: jest
      .fn()
      .mockResolvedValue(
        new Map([['000000000000000000000001', 'Current author']]),
      ),
  };
  let uploaded: Buffer = Buffer.alloc(0);
  let temporaryDirectory = '';
  const files = {
    uploadObject: jest
      .fn()
      .mockImplementation(
        async (_key: string, body: Readable & { path: string }) => {
          temporaryDirectory = dirname(body.path);
          const chunks: Buffer[] = [];
          for await (const chunk of body)
            chunks.push(Buffer.from(chunk as Uint8Array));
          uploaded = Buffer.concat(chunks);
        },
      ),
    presignDownload: jest
      .fn()
      .mockResolvedValue('https://storage.example/download'),
  };
  return {
    service: new RecipeExportsService(
      model as never,
      users as never,
      files as never,
    ),
    model,
    query,
    users,
    files,
    uploaded: () => uploaded,
    temporaryDirectory: () => temporaryDirectory,
  };
};

describe('RecipeExportsService', () => {
  it('writes recipe blocks in one sheet with exact metadata, numeric quantities and two blank spacer rows', async () => {
    const context = setup([recipe(1), recipe(2)]);
    const progress = jest.fn().mockResolvedValue(undefined);
    const result = await context.service.generate(
      { userId: 'owner', total: 3, requestedAt: '2026-10-10T17:30:00.000Z' },
      progress,
    );
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.read(Readable.from([context.uploaded()]));
    expect(workbook.worksheets).toHaveLength(1);
    const sheet = workbook.worksheets[0];
    expect(sheet.getCell('B2').value).toBe('Recipe 1');
    expect(sheet.getCell('B3').value).toBe('RCP-1');
    expect(sheet.getCell('B4').value).toBe('Main Course');
    expect(sheet.getCell('B5').value).toBe(10);
    expect(sheet.getCell('D2').value).toBe('Current author');
    expect(sheet.getCell('D3').value).toBe('Current author');
    expect(sheet.getRow(7).values).toEqual([
      undefined,
      'NO',
      'TYPE',
      'PRODUCT CODE',
      'INGREDIENT NAME',
      'PROD QTY',
      'PROD UOM',
      'SR QTY',
      'SR UOM',
    ]);
    expect(sheet.getCell('C8').value).toBe('001');
    expect(sheet.getCell('E8').value).toBe(0);
    expect(sheet.getCell('G8').value).toBe(0);
    expect(sheet.getCell('E9').value).toBe(0.123456);
    expect(sheet.getCell('G9').value).toBe(123.456);
    expect(sheet.getCell('A10').value).toBeNull();
    expect(sheet.getCell('A11').value).toBeNull();
    expect(sheet.getCell('B12').value).toBe('Recipe 2');
    expect(sheet.getCell('A18').value).toBe(1);
    expect(result.count).toBe(2);
    expect(result.filename).toBe('Recipes-2026-10-11-2.xlsx');
    expect(result.key).toMatch(/^exports\/recipes-[\da-f-]+\.xlsx$/);
    await context.service.downloadUrl(result);
    expect(context.files.presignDownload).toHaveBeenCalledWith(
      result.key,
      300,
      'Recipes-2026-10-11-2.xlsx',
    );
    expect(progress).toHaveBeenLastCalledWith(2);
    expect(context.files.uploadObject).toHaveBeenCalledWith(
      result.key,
      expect.any(Readable),
      expect.stringContaining('spreadsheetml'),
      context.uploaded().length,
    );
    expect(existsSync(context.temporaryDirectory())).toBe(false);
  });

  it('preserves legacy SR quantities without inventing production quantities or interpreting text as formulas', async () => {
    const record = recipe(1);
    const legacy = {
      productCode: '00005',
      name: '=1+1',
      qty: 0.75,
      unitOfMeasures: 'KG',
    };
    const context = setup([{ ...record, ingredients: [legacy] }]);
    await context.service.generate(
      { userId: 'owner', total: 1, requestedAt: new Date().toISOString() },
      () => Promise.resolve(),
    );
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.read(Readable.from([context.uploaded()]));
    const sheet = workbook.worksheets[0];
    expect(sheet.getCell('D8').value).toBe('=1+1');
    expect(sheet.getCell('E8').value).toBeNull();
    expect(sheet.getCell('F8').value).toBeNull();
    expect(sheet.getCell('G8').value).toBe(0.75);
    expect(sheet.getCell('H8').value).toBe('KG');
  });

  it('uses bounded batches and keyset pagination with one actor lookup per batch', async () => {
    const records = Array.from({ length: 205 }, (_, i) => recipe(i + 1));
    const context = setup(records);
    const requestedAt = '2026-10-11T00:00:00.000Z';
    const result = await context.service.generate(
      {
        userId: 'owner',
        total: 205,
        ids: records.map((item) => String(item._id)),
        requestedAt,
      },
      () => Promise.resolve(),
    );
    expect(result.filename).toBe('Recipes-2026-10-11-205.xlsx');
    expect(context.query.limit).toHaveBeenCalledWith(100);
    expect(context.model.find).toHaveBeenCalledTimes(4);
    expect(context.users.findNamesByIds).toHaveBeenCalledTimes(3);
    expect(context.model.find).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        deletedAt: { $exists: false },
        isDraft: { $ne: true },
        createdAt: { $lte: new Date(requestedAt) },
        $and: [{ _id: { $gt: records[99]._id } }],
        _id: { $in: records.map((item) => item._id) },
      }),
    );
  });

  it('excludes unchecked IDs consistently when counting and writing select-all exports', async () => {
    const context = setup([recipe(1), recipe(3)]);
    const excludedIds = [String(recipe(2)._id)];
    const requestedAt = new Date().toISOString();
    await context.service.count(undefined, requestedAt, excludedIds);
    expect(context.model.countDocuments).toHaveBeenCalledWith({
      deletedAt: { $exists: false },
      isDraft: { $ne: true },
      createdAt: { $lte: new Date(requestedAt) },
      _id: { $nin: [recipe(2)._id] },
    });
    const result = await context.service.generate(
      {
        userId: 'owner',
        total: 2,
        requestedAt,
        excludedIds,
      },
      () => Promise.resolve(),
    );
    expect(context.model.find).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        _id: { $nin: [recipe(2)._id] },
      }),
    );
    expect(context.model.find).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        _id: { $nin: [recipe(2)._id] },
        $and: [{ _id: { $gt: recipe(3)._id } }],
      }),
    );
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.read(Readable.from([context.uploaded()]));
    expect(workbook.worksheets[0].getCell('B2').value).toBe('Recipe 1');
    expect(workbook.worksheets[0].getCell('B12').value).toBe('Recipe 3');
    expect(result.count).toBe(2);
  });

  it.each([
    [
      { site: 'site-a', includeInactive: false, strictSite: false },
      {
        isActive: { $ne: false },
        $or: [{ approvalStatus: 'approved' }, { site: 'site-a' }],
      },
    ],
    [
      { site: ['site-a', 'site-b'], includeInactive: false, strictSite: false },
      {
        isActive: { $ne: false },
        $or: [
          { approvalStatus: 'approved' },
          { site: { $in: ['site-a', 'site-b'] } },
        ],
      },
    ],
    [
      { site: [], includeInactive: false, strictSite: false },
      {
        isActive: { $ne: false },
        $or: [{ approvalStatus: 'approved' }, { site: { $in: [] } }],
      },
    ],
    [
      { site: 'site-b', includeInactive: false, strictSite: true },
      { isActive: { $ne: false }, site: 'site-b' },
    ],
  ])(
    'applies visibility consistently to counts and every export batch for %j',
    async (scope, expected) => {
      const context = setup(
        Array.from({ length: 101 }, (_, i) => recipe(i + 1)),
      );
      const requestedAt = new Date().toISOString();
      await context.service.count(undefined, requestedAt, undefined, scope);
      await context.service.generate(
        { userId: 'owner', total: 101, requestedAt, scope },
        () => Promise.resolve(),
      );
      expect(context.model.countDocuments).toHaveBeenCalledWith(
        expect.objectContaining(expected),
      );
      expect(context.model.find).toHaveBeenCalledTimes(3);
      for (const [filter] of context.model.find.mock.calls) {
        expect(filter).toEqual(expect.objectContaining(expected));
      }
    },
  );

  it('fails explicitly for an empty export and does not upload a blank workbook', async () => {
    const context = setup([]);
    await expect(
      context.service.generate(
        { userId: 'owner', total: 1, requestedAt: new Date().toISOString() },
        () => Promise.resolve(),
      ),
    ).rejects.toThrow('No recipes');
    expect(context.files.uploadObject).not.toHaveBeenCalled();
  });

  it('cleans up its temporary file when storage upload fails', async () => {
    const context = setup([recipe(1)]);
    context.files.uploadObject.mockImplementationOnce(
      (_key: string, body: Readable & { path: string }) => {
        const directory = dirname(body.path);
        expect(existsSync(directory)).toBe(true);
        return Promise.reject(new Error(`Upload failed: ${directory}`));
      },
    );
    let directory = '';
    try {
      await context.service.generate(
        { userId: 'owner', total: 1, requestedAt: new Date().toISOString() },
        () => Promise.resolve(),
      );
    } catch (error) {
      directory = (error as Error).message.replace('Upload failed: ', '');
    }
    expect(directory).not.toBe('');
    expect(existsSync(directory)).toBe(false);
  });

  it('fails rather than downloading a partial selection when recipes disappear during processing', async () => {
    const context = setup([recipe(1)]);
    await expect(
      context.service.generate(
        {
          userId: 'owner',
          total: 2,
          ids: [String(recipe(1)._id), String(recipe(2)._id)],
          requestedAt: new Date().toISOString(),
        },
        () => Promise.resolve(),
      ),
    ).rejects.toThrow('Some selected recipes');
    expect(context.files.uploadObject).not.toHaveBeenCalled();
  });

  it('rejects an export that exceeds the single-sheet Excel row limit', async () => {
    const record: TestRecipe = {
      ...recipe(1),
      ingredients: Array<RecipeIngredient>(1048576),
    };
    const context = setup([record]);
    await expect(
      context.service.generate(
        {
          userId: 'owner',
          total: 1,
          requestedAt: new Date().toISOString(),
        },
        () => Promise.resolve(),
      ),
    ).rejects.toThrow('single-sheet row limit');
    expect(context.files.uploadObject).not.toHaveBeenCalled();
  });

  it('generates 10,000 recipes with 20 ingredients using 100 bounded batches', async () => {
    const context = setup(
      Array.from({ length: 10000 }, (_, i) => recipe(i + 1, 20)),
    );
    let bytes = 0;
    context.files.uploadObject.mockImplementationOnce(
      async (_key: string, body: Readable) => {
        for await (const chunk of body) bytes += (chunk as Buffer).length;
      },
    );
    const progress = jest.fn().mockResolvedValue(undefined);
    const startedAt = performance.now();
    const result = await context.service.generate(
      { userId: 'owner', total: 10000, requestedAt: new Date().toISOString() },
      progress,
    );
    expect(result.count).toBe(10000);
    expect(context.users.findNamesByIds).toHaveBeenCalledTimes(100);
    expect(context.model.find).toHaveBeenCalledTimes(101);
    expect(progress).toHaveBeenLastCalledWith(10000);
    expect(bytes).toBeGreaterThan(0);
    console.info(
      `Synthetic recipe export: 10000 recipes, 200000 ingredients, ${bytes} bytes, ${Math.round(performance.now() - startedAt)} ms`,
    );
  }, 120000);
});
