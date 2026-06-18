import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt'; // 🌟 Added to decode tokens inline

@Injectable()
export class MaintenanceGuard implements CanActivate {
  constructor(
    private readonly configService: ConfigService,
    private readonly reflector: Reflector,
    private readonly jwtService: JwtService, // 🌟 Inject JwtService
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isMaintenanceMode = this.configService.get<string>('MAINTENANCE_MODE') === 'true';
    if (!isMaintenanceMode) {
      return true;
    }

    // 1. EXEMPTION 1: Let login and register endpoints through instantly
    const isPublic = this.reflector.getAllAndOverride<boolean>('isPublic', [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    
    // 2. EXEMPTION 2: Manually extract the token to find out if this is an Admin
    let user = request.user;

    if (!user) {
      try {
        const authHeader = request.headers.authorization;
        if (authHeader && authHeader.startsWith('Bearer ')) {
          const token = authHeader.split(' ')[1];
          // Decode the token to check the user profile payloads dynamically
          user = this.jwtService.decode(token);
        }
      } catch (err) {
        // Token format mismatch, fallback to guest treatment
      }
    }

    // 3. AUTHORIZATION CHECK: Superadmins and Admins bypass the block
    if (user && (
      user.roles?.includes('admin') || 
      user.appRole === 'admin' || 
      user.roles?.includes('superadmin') || 
      user.appRole === 'superadmin'
    )) {
      return true;
    }

    // 4. Block everyone else
    throw new ServiceUnavailableException({
      statusCode: 503,
      message: 'The system is currently undergoing scheduled maintenance. Please try again later.',
      error: 'MaintenanceMode',
    });
  }
}