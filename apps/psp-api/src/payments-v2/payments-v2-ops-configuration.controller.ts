import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { InternalSecretGuard } from '../common/guards/internal-secret.guard';
import {
  CreateOpsConfigurationProviderDto,
  PatchOpsConfigurationProviderDto,
} from './dto/ops-configuration-provider.dto';
import { ListOpsConfigurationRoutesQueryDto } from './dto/ops-configuration-list-routes-query.dto';
import { UpsertOpsConfigurationMerchantRateDto } from './dto/ops-configuration-merchant-rate.dto';
import {
  CreateOpsConfigurationRouteDto,
  PatchOpsConfigurationRouteDto,
  PatchOpsConfigurationRouteWeightDto,
} from './dto/ops-configuration-route.dto';
import { PaymentsV2OpsConfigurationService } from './payments-v2-ops-configuration.service';

@ApiTags('payments-v2')
@Controller({ path: 'payments', version: '2' })
@ApiSecurity('InternalSecret')
@UseGuards(InternalSecretGuard)
export class PaymentsV2OpsConfigurationController {
  constructor(private readonly configOps: PaymentsV2OpsConfigurationService) {}

  @Get('ops/configuration/providers')
  @ApiOperation({ summary: 'Listado interno de configuración de proveedores de pago (backoffice ops)' })
  listProviders() {
    return this.configOps.listProviders();
  }

  @Post('ops/configuration/providers')
  @ApiOperation({ summary: 'Alta de proveedor de pago (configuración ops)' })
  createProvider(@Body() body: CreateOpsConfigurationProviderDto) {
    return this.configOps.createProvider(body);
  }

  @Patch('ops/configuration/providers/:providerId')
  @ApiOperation({ summary: 'Actualización parcial de proveedor (configuración ops)' })
  patchProvider(@Param('providerId') providerId: string, @Body() body: PatchOpsConfigurationProviderDto) {
    const id = providerId?.trim();
    if (!id) {
      throw new BadRequestException('Invalid providerId');
    }
    return this.configOps.patchProvider(id, body);
  }

  @Get('ops/configuration/routes')
  @ApiOperation({ summary: 'Listado de rutas método/país (configuración ops)' })
  listRoutes(@Query() query: ListOpsConfigurationRoutesQueryDto) {
    return this.configOps.listRoutes(query);
  }

  @Post('ops/configuration/routes')
  @ApiOperation({ summary: 'Alta de ruta con divisas (configuración ops)' })
  createRoute(@Body() body: CreateOpsConfigurationRouteDto) {
    return this.configOps.createRoute(body);
  }

  @Patch('ops/configuration/routes/:routeId/weight')
  @ApiOperation({ summary: 'Actualizar solo el peso de enrutado de una ruta' })
  patchRouteWeight(
    @Param('routeId') routeId: string,
    @Body() body: PatchOpsConfigurationRouteWeightDto,
  ) {
    const id = routeId?.trim();
    if (!id) {
      throw new BadRequestException('Invalid routeId');
    }
    return this.configOps.patchRouteWeight(id, body.weight);
  }

  @Patch('ops/configuration/routes/:routeId')
  @ApiOperation({ summary: 'Actualización parcial de ruta (configuración ops)' })
  patchRoute(@Param('routeId') routeId: string, @Body() body: PatchOpsConfigurationRouteDto) {
    const id = routeId?.trim();
    if (!id) {
      throw new BadRequestException('Invalid routeId');
    }
    return this.configOps.patchRoute(id, body);
  }

  @Get('ops/configuration/merchants/:merchantId/provider-rates')
  @ApiOperation({ summary: 'Tasas proveedor por merchant y país (configuración ops)' })
  listMerchantProviderRates(@Param('merchantId') merchantId: string) {
    const id = merchantId?.trim();
    if (!id) {
      throw new BadRequestException('Invalid merchantId');
    }
    return this.configOps.listMerchantProviderRates(id);
  }

  @Post('ops/configuration/merchants/:merchantId/provider-rates')
  @ApiOperation({ summary: 'Upsert de tasa proveedor para un merchant' })
  upsertMerchantProviderRate(
    @Param('merchantId') merchantId: string,
    @Body() body: UpsertOpsConfigurationMerchantRateDto,
  ) {
    const id = merchantId?.trim();
    if (!id) {
      throw new BadRequestException('Invalid merchantId');
    }
    return this.configOps.upsertMerchantProviderRate(id, body);
  }
}
