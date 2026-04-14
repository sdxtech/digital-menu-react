import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { extname, join } from 'path';
import { promises as fs } from 'fs';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { AppRole, ALL_APP_ROLES } from '../auth/roles.constants';
import { getUserSiteScope } from '../auth/site-scope';
import type { AuthenticatedRequest } from '../auth/types/authenticated-request.type';
import { CreateRecipeDto } from './dto/create-recipe.dto';
import { ListRecipesQueryDto } from './dto/list-recipes.query.dto';
import { UpdateRecipePhotoDto } from './dto/update-recipe-photo.dto';
import { UpdateRecipeDto } from './dto/update-recipe.dto';
import { RecipesService } from './recipes.service';

const RECIPE_IMPORT_EXTENSIONS = new Set(['.xlsx', '.xls']);
const RECIPE_IMPORT_MIME_TYPES = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'application/octet-stream',
]);

type UploadFilterCallback = (error: Error | null, acceptFile: boolean) => void;

@Controller('recipes')
@UseGuards(JwtAuthGuard, RolesGuard)
export class RecipesController {
  constructor(private readonly recipes: RecipesService) {}

  @Post()
  @Roles(AppRole.Chef, AppRole.Superadmin)
  create(@Req() req: AuthenticatedRequest, @Body() dto: CreateRecipeDto) {
    return this.recipes.create(dto, this.buildActor(req));
  }

  // BACKEND LOGIC: provide category options for recipe filters.
  @Get('categories')
  @Roles(...ALL_APP_ROLES)
  listCategories() {
    return this.recipes.listCategories();
  }

  @Get()
  @Roles(...ALL_APP_ROLES)
  list(@Query() query: ListRecipesQueryDto) {
    return this.recipes.findAll(query);
  }

  @Patch(':id')
  @Roles(AppRole.Chef, AppRole.Superadmin)
  update(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() dto: UpdateRecipeDto,
  ) {
    return this.recipes.updateById(id, dto, this.buildActor(req));
  }

  @Patch(':id/approve')
  @Roles(AppRole.UnitManager, AppRole.Superadmin)
  approve(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.recipes.setApprovalStatus(id, 'approved', this.buildActor(req));
  }

  @Patch(':id/reject')
  @Roles(AppRole.UnitManager, AppRole.Superadmin)
  reject(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.recipes.setApprovalStatus(id, 'rejected', this.buildActor(req));
  }

  @Patch(':id/photo')
  @Roles(AppRole.Chef, AppRole.Superadmin)
  updatePhoto(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() dto: UpdateRecipePhotoDto,
  ) {
    return this.recipes.setImageUrl(id, dto.imageUrl, this.buildActor(req));
  }

  @Delete(':id/photo')
  @Roles(AppRole.Chef, AppRole.Superadmin)
  removePhoto(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.recipes.clearImageUrl(id, this.buildActor(req));
  }

  @Post('import')
  @Roles(AppRole.Chef, AppRole.Superadmin)
  @UseInterceptors(
    FileInterceptor('file', {
      dest: join(process.cwd(), 'uploads'),
      fileFilter: (
        _req: Request,
        file: { originalname: string; mimetype: string },
        cb: UploadFilterCallback,
      ) => {
        const ext = extname(file.originalname || '').toLowerCase();
        const isValidExt = RECIPE_IMPORT_EXTENSIONS.has(ext);
        const mime = (file.mimetype || '').toLowerCase();
        const isValidMime = RECIPE_IMPORT_MIME_TYPES.has(mime);
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
  async importRecipes(
    @Req() req: AuthenticatedRequest,
    @UploadedFile() file?: { path: string },
  ) {
    if (!file) {
      throw new BadRequestException('file is required');
    }

    try {
      return await this.recipes.importFromExcel(
        file.path,
        this.buildActor(req),
      );
    } finally {
      await fs.unlink(file.path).catch(() => null);
    }
  }

  private buildActor(req: AuthenticatedRequest) {
    return {
      id: req.user.sub,
      name: req.user.name,
      email: req.user.email,
      site: getUserSiteScope(req.user),
    };
  }
}
