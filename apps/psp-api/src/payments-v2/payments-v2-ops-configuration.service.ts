import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateOpsConfigurationProviderDto,
  PatchOpsConfigurationProviderDto,
} from './dto/ops-configuration-provider.dto';
import { ListOpsConfigurationRoutesQueryDto } from './dto/ops-configuration-list-routes-query.dto';
import { UpsertOpsConfigurationMerchantRateDto } from './dto/ops-configuration-merchant-rate.dto';
import {
  CreateOpsConfigurationRouteDto,
  PatchOpsConfigurationRouteDto,
} from './dto/ops-configuration-route.dto';

type ProviderRow = {
  id: string;
  name: string;
  description: string | null;
  integrationBaseUrl: string;
  initPaymentResource: string;
  isConfigured: boolean;
  isActive: boolean;
  isPublished: boolean;
  createdAt: string;
  updatedAt: string;
};

type RouteRow = {
  id: string;
  providerId: string;
  methodCode: string;
  methodName: string;
  countryCode: string;
  countryName?: string | null;
  countryImageName?: string | null;
  channel: string;
  integrationMode: string;
  requestTemplate: string;
  integrationCode?: string | null;
  checkoutUrlTemplate?: string | null;
  expirationTimeOffset: number;
  weight: number;
  isActive: boolean;
  isPublished: boolean;
  routeConfigJson?: unknown | null;
  createdAt: string;
  updatedAt: string;
  provider?: ProviderRow;
  currencies: Array<{ currency: string; minAmount: string; maxAmount: string; isDefault: boolean }>;
};

type MerchantRateRow = {
  id: string;
  merchantId: string;
  providerId: string;
  countryCode: string;
  percentage: string;
  fixed: string;
  minRateDiscount: string;
  applyToCustomer: boolean;
  fxSpread: string;
  fxMarkup: string;
  disableIndustryValidation: boolean;
  cashEnabled: boolean;
  creditCardEnabled: boolean;
  cryptoEnabled: boolean;
  onlineEnabled: boolean;
  cashMinAmount: string;
  creditCardMinAmount: string;
  cryptoMinAmount: string;
  onlineMinAmount: string;
  isActive: boolean;
  provider?: { id: string; name: string };
};

const providerSelect = {
  id: true,
  name: true,
  description: true,
  integrationBaseUrl: true,
  initPaymentResource: true,
  isConfigured: true,
  isActive: true,
  isPublished: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.PaymentProviderConfigSelect;

const routeInclude = {
  currencies: true,
  provider: { select: providerSelect },
} satisfies Prisma.PaymentMethodRouteInclude;

type RouteWithRelations = Prisma.PaymentMethodRouteGetPayload<{ include: typeof routeInclude }>;

@Injectable()
export class PaymentsV2OpsConfigurationService {
  constructor(private readonly prisma: PrismaService) {}

  async listProviders(): Promise<ProviderRow[]> {
    const rows = await this.prisma.paymentProviderConfig.findMany({
      select: providerSelect,
      orderBy: { name: 'asc' },
    });
    return rows.map((p) => this.toProviderRow(p));
  }

  async createProvider(dto: CreateOpsConfigurationProviderDto): Promise<ProviderRow> {
    const created = await this.prisma.paymentProviderConfig.create({
      data: {
        name: dto.name.trim(),
        description: dto.description?.trim(),
        integrationBaseUrl: dto.integrationBaseUrl.trim(),
        initPaymentResource: dto.initPaymentResource.trim(),
        isConfigured: dto.isConfigured ?? false,
        isActive: dto.isActive ?? true,
        isPublished: dto.isPublished ?? false,
      },
      select: providerSelect,
    });
    return this.toProviderRow(created);
  }

  async patchProvider(providerId: string, dto: PatchOpsConfigurationProviderDto): Promise<ProviderRow> {
    const id = providerId.trim();
    const exists = await this.prisma.paymentProviderConfig.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!exists) {
      throw new NotFoundException('Provider not found');
    }
    const data: Prisma.PaymentProviderConfigUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name.trim();
    if (dto.description !== undefined) {
      data.description = dto.description === null ? null : dto.description.trim();
    }
    if (dto.integrationBaseUrl !== undefined) data.integrationBaseUrl = dto.integrationBaseUrl.trim();
    if (dto.initPaymentResource !== undefined) data.initPaymentResource = dto.initPaymentResource.trim();
    if (dto.isConfigured !== undefined) data.isConfigured = dto.isConfigured;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;
    if (dto.isPublished !== undefined) data.isPublished = dto.isPublished;
    if (Object.keys(data).length === 0) {
      throw new BadRequestException('Body must include at least one field');
    }
    const updated = await this.prisma.paymentProviderConfig.update({
      where: { id },
      data,
      select: providerSelect,
    });
    return this.toProviderRow(updated);
  }

  async listRoutes(query: ListOpsConfigurationRoutesQueryDto): Promise<RouteRow[]> {
    const where: Prisma.PaymentMethodRouteWhereInput = {};
    if (query.countryCode) where.countryCode = query.countryCode;
    if (query.providerId) where.providerId = query.providerId.trim();
    if (query.channel) where.channel = query.channel;
    if (query.isActive !== undefined) where.isActive = query.isActive;
    const rows = await this.prisma.paymentMethodRoute.findMany({
      where,
      include: routeInclude,
      orderBy: [{ countryCode: 'asc' }, { methodCode: 'asc' }, { id: 'asc' }],
    });
    return rows.map((r) => this.toRouteRow(r));
  }

  async createRoute(dto: CreateOpsConfigurationRouteDto): Promise<RouteRow> {
    const provider = await this.prisma.paymentProviderConfig.findUnique({
      where: { id: dto.providerId.trim() },
      select: { id: true },
    });
    if (!provider) {
      throw new NotFoundException('Provider not found');
    }
    const created = await this.prisma.paymentMethodRoute.create({
      data: {
        providerId: dto.providerId.trim(),
        methodCode: dto.methodCode.trim(),
        methodName: dto.methodName.trim(),
        countryCode: dto.countryCode.toUpperCase(),
        countryName: dto.countryName?.trim(),
        countryImageName: dto.countryImageName?.trim(),
        channel: dto.channel,
        integrationMode: dto.integrationMode,
        requestTemplate: dto.requestTemplate,
        integrationCode: dto.integrationCode?.trim(),
        checkoutUrlTemplate: dto.checkoutUrlTemplate?.trim(),
        expirationTimeOffset: dto.expirationTimeOffset ?? 0,
        weight: dto.weight ?? 0,
        isActive: dto.isActive ?? true,
        isPublished: dto.isPublished ?? false,
        ...(dto.routeConfigJson !== undefined
          ? { routeConfigJson: dto.routeConfigJson as Prisma.InputJsonValue }
          : {}),
        currencies: {
          create: dto.currencies.map((c) => ({
            currency: c.currency.trim().toUpperCase(),
            minAmount: String(c.minAmount),
            maxAmount: String(c.maxAmount),
            isDefault: c.isDefault ?? false,
          })),
        },
      },
      include: routeInclude,
    });
    return this.toRouteRow(created as RouteWithRelations);
  }

  async patchRoute(routeId: string, dto: PatchOpsConfigurationRouteDto): Promise<RouteRow> {
    const id = routeId.trim();
    const exists = await this.prisma.paymentMethodRoute.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!exists) {
      throw new NotFoundException('Route not found');
    }
    const scalar: Prisma.PaymentMethodRouteUpdateInput = {};
    if (dto.methodCode !== undefined) scalar.methodCode = dto.methodCode.trim();
    if (dto.methodName !== undefined) scalar.methodName = dto.methodName.trim();
    if (dto.countryCode !== undefined) scalar.countryCode = dto.countryCode.toUpperCase();
    if (dto.countryName !== undefined) {
      scalar.countryName = dto.countryName === null ? null : dto.countryName.trim();
    }
    if (dto.countryImageName !== undefined) {
      scalar.countryImageName =
        dto.countryImageName === null ? null : dto.countryImageName.trim();
    }
    if (dto.channel !== undefined) scalar.channel = dto.channel;
    if (dto.integrationMode !== undefined) scalar.integrationMode = dto.integrationMode;
    if (dto.requestTemplate !== undefined) scalar.requestTemplate = dto.requestTemplate;
    if (dto.integrationCode !== undefined) {
      scalar.integrationCode = dto.integrationCode === null ? null : dto.integrationCode.trim();
    }
    if (dto.checkoutUrlTemplate !== undefined) {
      scalar.checkoutUrlTemplate =
        dto.checkoutUrlTemplate === null ? null : dto.checkoutUrlTemplate.trim();
    }
    if (dto.expirationTimeOffset !== undefined) scalar.expirationTimeOffset = dto.expirationTimeOffset;
    if (dto.weight !== undefined) scalar.weight = dto.weight;
    if (dto.isActive !== undefined) scalar.isActive = dto.isActive;
    if (dto.isPublished !== undefined) scalar.isPublished = dto.isPublished;
    if (dto.routeConfigJson !== undefined) {
      scalar.routeConfigJson =
        dto.routeConfigJson === null ? Prisma.DbNull : (dto.routeConfigJson as Prisma.InputJsonValue);
    }

    const hasScalar = Object.keys(scalar).length > 0;
    const hasCurrencies = dto.currencies !== undefined;

    if (!hasScalar && !hasCurrencies) {
      throw new BadRequestException('Body must include at least one field');
    }

    await this.prisma.$transaction(async (tx) => {
      if (hasCurrencies) {
        await tx.paymentMethodRouteCurrency.deleteMany({ where: { routeId: id } });
        if (dto.currencies!.length > 0) {
          await tx.paymentMethodRouteCurrency.createMany({
            data: dto.currencies!.map((c) => ({
              routeId: id,
              currency: c.currency.trim().toUpperCase(),
              minAmount: String(c.minAmount),
              maxAmount: String(c.maxAmount),
              isDefault: c.isDefault ?? false,
            })),
          });
        }
      }
      if (hasScalar) {
        await tx.paymentMethodRoute.update({ where: { id }, data: scalar });
      }
    });

    const row = await this.prisma.paymentMethodRoute.findUniqueOrThrow({
      where: { id },
      include: routeInclude,
    });
    return this.toRouteRow(row);
  }

  async patchRouteWeight(routeId: string, weight: number): Promise<RouteRow> {
    const id = routeId.trim();
    const exists = await this.prisma.paymentMethodRoute.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!exists) {
      throw new NotFoundException('Route not found');
    }
    const row = await this.prisma.paymentMethodRoute.update({
      where: { id },
      data: { weight },
      include: routeInclude,
    });
    return this.toRouteRow(row);
  }

  async listMerchantProviderRates(merchantId: string): Promise<MerchantRateRow[]> {
    const mid = merchantId.trim();
    const merchant = await this.prisma.merchant.findUnique({
      where: { id: mid },
      select: { id: true },
    });
    if (!merchant) {
      throw new NotFoundException('Merchant not found');
    }
    const rows = await this.prisma.merchantProviderRate.findMany({
      where: { merchantId: mid },
      include: { provider: { select: { id: true, name: true } } },
      orderBy: [{ countryCode: 'asc' }, { providerId: 'asc' }],
    });
    return rows.map((r) => this.toMerchantRateRow(r));
  }

  async upsertMerchantProviderRate(
    merchantId: string,
    dto: UpsertOpsConfigurationMerchantRateDto,
  ): Promise<MerchantRateRow> {
    const mid = merchantId.trim();
    const providerId = dto.providerId.trim();
    const countryCode = dto.countryCode.toUpperCase();

    const [merchant, provider] = await Promise.all([
      this.prisma.merchant.findUnique({ where: { id: mid }, select: { id: true } }),
      this.prisma.paymentProviderConfig.findUnique({ where: { id: providerId }, select: { id: true } }),
    ]);
    if (!merchant) {
      throw new NotFoundException('Merchant not found');
    }
    if (!provider) {
      throw new NotFoundException('Provider not found');
    }

    const createData: Prisma.MerchantProviderRateCreateInput = {
      merchant: { connect: { id: mid } },
      provider: { connect: { id: providerId } },
      countryCode,
      percentage: String(dto.percentage),
      fixed: String(dto.fixed),
      minRateDiscount: String(dto.minRateDiscount ?? 0),
      applyToCustomer: dto.applyToCustomer ?? false,
      fxSpread: String(dto.fxSpread ?? 0),
      fxMarkup: String(dto.fxMarkup ?? 0),
      disableIndustryValidation: dto.disableIndustryValidation ?? false,
      cashEnabled: dto.cashEnabled ?? true,
      creditCardEnabled: dto.creditCardEnabled ?? true,
      cryptoEnabled: dto.cryptoEnabled ?? true,
      onlineEnabled: dto.onlineEnabled ?? true,
      cashMinAmount: String(dto.cashMinAmount ?? 0),
      creditCardMinAmount: String(dto.creditCardMinAmount ?? 0),
      cryptoMinAmount: String(dto.cryptoMinAmount ?? 0),
      onlineMinAmount: String(dto.onlineMinAmount ?? 0),
      isActive: dto.isActive ?? true,
    };

    const updateData: Prisma.MerchantProviderRateUpdateInput = {
      percentage: String(dto.percentage),
      fixed: String(dto.fixed),
    };
    if (dto.minRateDiscount !== undefined) {
      updateData.minRateDiscount = String(dto.minRateDiscount);
    }
    if (dto.applyToCustomer !== undefined) {
      updateData.applyToCustomer = dto.applyToCustomer;
    }
    if (dto.fxSpread !== undefined) {
      updateData.fxSpread = String(dto.fxSpread);
    }
    if (dto.fxMarkup !== undefined) {
      updateData.fxMarkup = String(dto.fxMarkup);
    }
    if (dto.disableIndustryValidation !== undefined) {
      updateData.disableIndustryValidation = dto.disableIndustryValidation;
    }
    if (dto.cashEnabled !== undefined) {
      updateData.cashEnabled = dto.cashEnabled;
    }
    if (dto.creditCardEnabled !== undefined) {
      updateData.creditCardEnabled = dto.creditCardEnabled;
    }
    if (dto.cryptoEnabled !== undefined) {
      updateData.cryptoEnabled = dto.cryptoEnabled;
    }
    if (dto.onlineEnabled !== undefined) {
      updateData.onlineEnabled = dto.onlineEnabled;
    }
    if (dto.cashMinAmount !== undefined) {
      updateData.cashMinAmount = String(dto.cashMinAmount);
    }
    if (dto.creditCardMinAmount !== undefined) {
      updateData.creditCardMinAmount = String(dto.creditCardMinAmount);
    }
    if (dto.cryptoMinAmount !== undefined) {
      updateData.cryptoMinAmount = String(dto.cryptoMinAmount);
    }
    if (dto.onlineMinAmount !== undefined) {
      updateData.onlineMinAmount = String(dto.onlineMinAmount);
    }
    if (dto.isActive !== undefined) {
      updateData.isActive = dto.isActive;
    }

    const row = await this.prisma.merchantProviderRate.upsert({
      where: {
        merchantId_providerId_countryCode: {
          merchantId: mid,
          providerId,
          countryCode,
        },
      },
      create: createData,
      update: updateData,
      include: { provider: { select: { id: true, name: true } } },
    });
    return this.toMerchantRateRow(row);
  }

  private toProviderRow(p: {
    id: string;
    name: string;
    description: string | null;
    integrationBaseUrl: string;
    initPaymentResource: string;
    isConfigured: boolean;
    isActive: boolean;
    isPublished: boolean;
    createdAt: Date;
    updatedAt: Date;
  }): ProviderRow {
    return {
      id: p.id,
      name: p.name,
      description: p.description,
      integrationBaseUrl: p.integrationBaseUrl,
      initPaymentResource: p.initPaymentResource,
      isConfigured: p.isConfigured,
      isActive: p.isActive,
      isPublished: p.isPublished,
      createdAt: p.createdAt.toISOString(),
      updatedAt: p.updatedAt.toISOString(),
    };
  }

  private toRouteRow(r: RouteWithRelations): RouteRow {
    return {
      id: r.id,
      providerId: r.providerId,
      methodCode: r.methodCode,
      methodName: r.methodName,
      countryCode: r.countryCode,
      countryName: r.countryName,
      countryImageName: r.countryImageName,
      channel: r.channel,
      integrationMode: r.integrationMode,
      requestTemplate: r.requestTemplate,
      integrationCode: r.integrationCode,
      checkoutUrlTemplate: r.checkoutUrlTemplate,
      expirationTimeOffset: r.expirationTimeOffset,
      weight: r.weight,
      isActive: r.isActive,
      isPublished: r.isPublished,
      routeConfigJson: r.routeConfigJson ?? null,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
      provider: r.provider ? this.toProviderRow(r.provider) : undefined,
      currencies: r.currencies.map((c) => ({
        currency: c.currency,
        minAmount: String(c.minAmount),
        maxAmount: String(c.maxAmount),
        isDefault: c.isDefault,
      })),
    };
  }

  private toMerchantRateRow(r: {
    id: string;
    merchantId: string;
    providerId: string;
    countryCode: string;
    percentage: { toString: () => string };
    fixed: { toString: () => string };
    minRateDiscount: { toString: () => string };
    applyToCustomer: boolean;
    fxSpread: { toString: () => string };
    fxMarkup: { toString: () => string };
    disableIndustryValidation: boolean;
    cashEnabled: boolean;
    creditCardEnabled: boolean;
    cryptoEnabled: boolean;
    onlineEnabled: boolean;
    cashMinAmount: { toString: () => string };
    creditCardMinAmount: { toString: () => string };
    cryptoMinAmount: { toString: () => string };
    onlineMinAmount: { toString: () => string };
    isActive: boolean;
    provider: { id: string; name: string } | null;
  }): MerchantRateRow {
    return {
      id: r.id,
      merchantId: r.merchantId,
      providerId: r.providerId,
      countryCode: r.countryCode,
      percentage: r.percentage.toString(),
      fixed: r.fixed.toString(),
      minRateDiscount: r.minRateDiscount.toString(),
      applyToCustomer: r.applyToCustomer,
      fxSpread: r.fxSpread.toString(),
      fxMarkup: r.fxMarkup.toString(),
      disableIndustryValidation: r.disableIndustryValidation,
      cashEnabled: r.cashEnabled,
      creditCardEnabled: r.creditCardEnabled,
      cryptoEnabled: r.cryptoEnabled,
      onlineEnabled: r.onlineEnabled,
      cashMinAmount: r.cashMinAmount.toString(),
      creditCardMinAmount: r.creditCardMinAmount.toString(),
      cryptoMinAmount: r.cryptoMinAmount.toString(),
      onlineMinAmount: r.onlineMinAmount.toString(),
      isActive: r.isActive,
      provider: r.provider ? { id: r.provider.id, name: r.provider.name } : undefined,
    };
  }
}
