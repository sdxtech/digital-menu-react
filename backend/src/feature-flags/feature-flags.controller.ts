import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { AppRole } from '../auth/roles.constants';
import { UpdateInventoryFeatureDto } from './dto/update-inventory-feature.dto';
import { FeatureFlagsService } from './feature-flags.service';

@Controller('feature-flags')
@UseGuards(JwtAuthGuard, RolesGuard)
export class FeatureFlagsController {
  constructor(private readonly featureFlags: FeatureFlagsService) {}

  @Get('inventory')
  @Roles(AppRole.Storekeeper, AppRole.Superadmin)
  getInventory() {
    return this.featureFlags.getInventory();
  }

  @Patch('inventory')
  @Roles(AppRole.Superadmin)
  setInventory(@Body() dto: UpdateInventoryFeatureDto) {
    return this.featureFlags.setInventory(dto.enabled);
  }
}
