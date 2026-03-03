import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { extname, join } from 'path';
import { promises as fs } from 'fs';
import type { Request } from 'express';
import ExcelJS from 'exceljs';
import * as bcrypt from 'bcrypt';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { AppRole } from '../auth/roles.constants';
import { UsersService } from '../users/users.service';
import { CreateUserDto } from '../users/dto/create-user.dto';
import { ListUsersQueryDto } from '../users/dto/list-users.query.dto';
import { UpdateUserDto } from '../users/dto/update-user.dto';
import { UpdateUserPasswordDto } from '../users/dto/update-user-password.dto';

const USER_HEADER_ALIASES = {
  name: ['name', 'nama', 'full name', 'fullname'],
  email: ['email', 'e-mail', 'mail'],
  password: ['password', 'pass', 'pwd', 'kata sandi', 'katasandi'],
  roles: ['roles', 'role', 'jabatan', 'posisi'],
};

const USER_IMPORT_EXTENSIONS = new Set(['.xlsx', '.xls']);
const USER_IMPORT_MIME_TYPES = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'application/octet-stream',
]);

type UploadFilterCallback = (error: Error | null, acceptFile: boolean) => void;

@Controller('superadmin/users')
@UseGuards(JwtAuthGuard, RolesGuard)
export class SuperadminUsersController {
  constructor(private readonly users: UsersService) {}

  @Get('sites')
  @Roles(AppRole.Superadmin)
  async listSites() {
    return {
      items: await this.users.listSites(),
    };
  }

  @Get()
  @Roles(AppRole.Superadmin)
  list(@Query() query: ListUsersQueryDto) {
    return this.users.list({
      page: query.page ?? 1,
      limit: query.limit ?? 20,
      search: query.search,
      sites: query.sites ?? query.site,
    });
  }

  @Patch(':id')
  @Roles(AppRole.Superadmin)
  update(@Param('id') id: string, @Body() dto: UpdateUserDto) {
    return this.users.updateById(id, {
      name: dto.name,
      email: dto.email,
      sites: dto.sites,
    });
  }

  @Patch(':id/password')
  @Roles(AppRole.Superadmin)
  updatePassword(@Param('id') id: string, @Body() dto: UpdateUserPasswordDto) {
    return this.users.updatePassword(id, dto.password);
  }

  @Delete(':id')
  @Roles(AppRole.Superadmin)
  remove(@Param('id') id: string) {
    return this.users.deleteById(id);
  }

  @Post('import')
  @Roles(AppRole.Superadmin)
  @UseInterceptors(
    FileInterceptor('file', {
      dest: join(process.cwd(), 'uploads'),
      fileFilter: (
        _req: Request,
        file: { originalname: string; mimetype: string },
        cb: UploadFilterCallback,
      ) => {
        const ext = extname(file.originalname || '').toLowerCase();
        const isValidExt = USER_IMPORT_EXTENSIONS.has(ext);
        const mime = (file.mimetype || '').toLowerCase();
        const isValidMime = USER_IMPORT_MIME_TYPES.has(mime);
        if (!isValidExt || !isValidMime) {
          cb(
            new BadRequestException('Only .xlsx or .xls files are allowed'),
            false,
          );
          return;
        }
        cb(null, true);
      },
      limits: { fileSize: 20 * 1024 * 1024 },
    }),
  )
  async importUsers(
    @UploadedFile() file?: { path: string; originalname: string },
  ) {
    if (!file) {
      throw new BadRequestException('file is required');
    }

    try {
      return await this.importFromExcel(file.path);
    } finally {
      await fs.unlink(file.path).catch(() => null);
    }
  }

  @Post()
  @Roles(AppRole.Superadmin)
  async create(@Body() dto: CreateUserDto) {
    const roles = this.parseRoles(dto.roles);
    if (dto.roles?.length && roles.length === 0) {
      throw new BadRequestException('Roles are invalid.');
    }

    const password = dto.password.trim();
    if (!password) {
      throw new BadRequestException('Password is required');
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const created = await this.users.create({
      name: dto.name.trim(),
      email: dto.email.trim(),
      passwordHash,
      roles: roles.length ? roles : undefined,
      sites: dto.sites,
    });

    return {
      id: created.id,
      name: created.name,
      email: created.email,
      roles: created.roles,
      sites: created.sites ?? [],
      isActive: created.isActive,
    };
  }

  private async importFromExcel(filePath: string) {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(filePath);
    const worksheet = workbook.worksheets[0];
    if (!worksheet) throw new BadRequestException('Sheet tidak ditemukan.');

    const headerValues = worksheet.getRow(1).values as unknown[];
    const headerMap = this.buildHeaderMap(headerValues);
    if (
      !headerMap.name ||
      !headerMap.email ||
      !headerMap.password ||
      !headerMap.roles
    ) {
      throw new BadRequestException(
        'Header harus berisi name, email, password, dan roles untuk import akun.',
      );
    }

    const rows: Array<{
      name: string;
      email: string;
      password: string;
      roles: AppRole[];
    }> = [];
    const seenEmails = new Set<string>();
    let skippedCount = 0;

    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      const values = row.values as unknown[];
      const name = this.getCellValue(values, headerMap.name);
      const emailRaw = this.getCellValue(values, headerMap.email);
      const password = this.getCellValue(values, headerMap.password);
      if (!name || !emailRaw || !password) {
        skippedCount += 1;
        return;
      }

      const email = emailRaw.toLowerCase();
      if (seenEmails.has(email)) {
        skippedCount += 1;
        return;
      }
      seenEmails.add(email);

      const rolesRaw = this.getCellValue(values, headerMap.roles);
      const roles = this.parseRoles(rolesRaw);
      if (!roles.length) {
        skippedCount += 1;
        return;
      }

      rows.push({
        name,
        email,
        password,
        roles,
      });
    });

    let insertedCount = 0;
    for (const row of rows) {
      try {
        const passwordHash = await bcrypt.hash(row.password, 12);
        await this.users.create({
          name: row.name,
          email: row.email,
          passwordHash,
          roles: row.roles.length ? row.roles : undefined,
        });
        insertedCount += 1;
      } catch (error) {
        if (error instanceof ConflictException) {
          skippedCount += 1;
          continue;
        }
        throw error;
      }
    }

    return { insertedCount, skippedCount };
  }

  private buildHeaderMap(values: unknown[]) {
    const map: Record<string, number> = {};
    for (let idx = 1; idx < values.length; idx += 1) {
      const header = this.normalizeHeader(values[idx]);
      if (!header) continue;
      for (const [key, aliases] of Object.entries(USER_HEADER_ALIASES)) {
        if (aliases.includes(header)) {
          map[key] = idx;
        }
      }
    }
    return map;
  }

  private getCellValue(values: unknown[], index?: number) {
    if (!index) return '';
    const cell = values[index];
    return this.toCellText(cell);
  }

  private normalizeHeader(value: unknown) {
    return this.toCellText(value).trim().toLowerCase();
  }

  private toCellText(value: unknown) {
    if (value === undefined || value === null) return '';
    if (typeof value === 'string') return value.trim();
    if (typeof value === 'number' || typeof value === 'boolean') {
      return String(value).trim();
    }
    if (value instanceof Date) return value.toISOString();
    if (typeof value === 'object' && 'text' in value) {
      const text = (value as { text?: unknown }).text;
      return typeof text === 'string' ? text.trim() : '';
    }
    return '';
  }

  private parseRoles(value?: string | string[]) {
    if (!value) return [];
    const rawItems = Array.isArray(value) ? value : [value];
    const rawRoles = rawItems
      .flatMap((item) => item.split(/[,|;/]/))
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean);

    const roles = new Set<AppRole>();
    const roleMap: Record<string, AppRole> = {
      superadmin: AppRole.Superadmin,
      admin: AppRole.Superadmin,
      chef: AppRole.Chef,
      'unit-manager': AppRole.UnitManager,
      unitmanager: AppRole.UnitManager,
      'unit manager': AppRole.UnitManager,
      storekeeper: AppRole.Storekeeper,
      'store-keeper': AppRole.Storekeeper,
      'store keeper': AppRole.Storekeeper,
    };

    rawRoles.forEach((role) => {
      const normalized = role.replace(/[_\s]+/g, '-');
      const mapped = roleMap[normalized] ?? roleMap[role];
      if (mapped) roles.add(mapped);
    });

    return Array.from(roles.values());
  }
}
