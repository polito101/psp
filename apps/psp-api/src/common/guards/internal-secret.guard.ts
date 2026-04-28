import {
  BadRequestException,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'crypto';
import type { Request } from 'express';

const UNAUTHORIZED_MESSAGE = 'Unauthorized';

@Injectable()
export class InternalSecretGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();

    const raw = req.headers['x-internal-secret'];
    // Express puede entregar un header repetido como string[]; tomamos el primero
    // en lugar de dejar que Buffer.from reciba un array y lance una excepción interna.
    const provided = Array.isArray(raw) ? raw[0] : raw;

    if (typeof provided !== 'string' || provided.length === 0) {
      throw new UnauthorizedException(UNAUTHORIZED_MESSAGE);
    }

    const expected = this.config.get<string>('INTERNAL_API_SECRET');
    if (!expected) {
      throw new UnauthorizedException(UNAUTHORIZED_MESSAGE);
    }

    const expectedBuf = Buffer.from(expected);
    const providedBuf = Buffer.from(provided);
    const sameLength = expectedBuf.length === providedBuf.length;

    // `cmpBuf` tiene siempre la misma longitud que `expectedBuf`: cuando las longitudes
    // difieren se usa un buffer de ceros para poder llamar a `timingSafeEqual` igualmente.
    // IMPORTANTE: `timingSafeEqual` debe evaluarse primero, sin cortocircuito, para que
    // el tiempo de respuesta sea constante independientemente de si las longitudes coinciden.
    // `sameLength && isEqual` (y no `sameLength && timingSafeEqual(...)`) garantiza esto.
    const cmpBuf = sameLength ? providedBuf : Buffer.alloc(expectedBuf.length);
    const isEqual = timingSafeEqual(expectedBuf, cmpBuf);
    const isMatch = sameLength && isEqual;

    if (!isMatch) {
      throw new UnauthorizedException(UNAUTHORIZED_MESSAGE);
    }

    this.assertBackofficeScopeForRequest(req);
    return true;
  }

  /** Solo `GET .../api/v2/payments/ops/*` (BFF backoffice); otros callers internos no envían rol. */
  private isPaymentsV2OpsPath(path: string): boolean {
    return path.includes('/payments/ops/');
  }

  private assertBackofficeScopeForRequest(req: Request): void {
    const path = req.path ?? '';
    if (this.isPaymentsV2OpsPath(path) || this.isSettlementsOpsPath(path) || this.isMerchantsOpsPath(path)) {
      this.assertPaymentsOpsFailClosed(req);
    } else {
      this.assertLegacyOptionalMerchantScope(req);
    }
  }

  private isSettlementsOpsPath(path: string): boolean {
    return path.includes('/settlements/');
  }

  private isMerchantsOpsPath(path: string): boolean {
    return path.includes('/merchants/ops/');
  }

  /**
   * Fail-closed: toda petición a payments v2 ops con secreto válido debe declarar rol admin|merchant.
   */
  private assertPaymentsOpsFailClosed(req: Request): void {
    const roleRaw = this.getHeader(req, 'x-backoffice-role');
    const role = roleRaw?.toLowerCase().trim();
    if (!role || (role !== 'admin' && role !== 'merchant')) {
      throw new ForbiddenException(
        'Missing or invalid X-Backoffice-Role for payments ops endpoints',
      );
    }
    if (role === 'admin') {
      return;
    }
    this.assertMerchantScopeOnOpsRequest(req);
  }

  /**
   * Si el BFF envía `X-Backoffice-Role: merchant` en ops, restringe path/query a ese merchant.
   */
  private assertMerchantScopeOnOpsRequest(req: Request): void {
    const scoped = this.getHeader(req, 'x-backoffice-merchant-id')?.trim();
    if (!scoped) {
      throw new ForbiddenException('Missing X-Backoffice-Merchant-Id for merchant scope');
    }

    const path = req.path ?? '';
    if (path.includes('/ops/metrics')) {
      throw new ForbiddenException('Merchant scope cannot access global metrics');
    }

    const pathMerchantMatch = path.match(/\/ops\/merchants\/([^/]+)\/finance\//);
    if (pathMerchantMatch) {
      let pathMerchant: string;
      try {
        pathMerchant = decodeURIComponent(pathMerchantMatch[1]!);
      } catch {
        throw new BadRequestException('Invalid merchant segment in path');
      }
      if (pathMerchant !== scoped) {
        throw new ForbiddenException('Cross-merchant access denied');
      }
    }

    const settlementMerchantMatch = path.match(/\/settlements\/merchants\/([^/]+)\//);
    if (settlementMerchantMatch) {
      let pathMerchant: string;
      try {
        pathMerchant = decodeURIComponent(settlementMerchantMatch[1]!);
      } catch {
        throw new BadRequestException('Invalid merchant segment in path');
      }
      if (pathMerchant !== scoped) {
        throw new ForbiddenException('Cross-merchant access denied');
      }
    }

    if (path.includes('/settlements/requests/inbox')) {
      throw new ForbiddenException('Merchant scope cannot access settlement request inbox');
    }
    if (/\/settlements\/requests\/[^/]+\/(approve|reject)/.test(path)) {
      throw new ForbiddenException('Merchant scope cannot approve or reject settlement requests');
    }

    const merchantsOps = path.match(/\/merchants\/ops\/([^/?#]+)/);
    if (merchantsOps) {
      const segment = merchantsOps[1];
      if (!segment) {
        return;
      }
      if (segment === 'directory') {
        throw new ForbiddenException('Merchant scope cannot access merchants directory');
      }
      let pathMerchant: string;
      try {
        pathMerchant = decodeURIComponent(segment);
      } catch {
        throw new BadRequestException('Invalid merchant segment in path');
      }
      if (pathMerchant !== scoped) {
        throw new ForbiddenException('Cross-merchant access denied');
      }
    }

    if (this.isOpsTransactionsAggregatePath(path) || this.isOpsDashboardMerchantScopedPath(path)) {
      const qm = this.getSingleQueryParam(req.query, 'merchantId');
      if (!qm || qm !== scoped) {
        throw new ForbiddenException('merchantId query must match merchant scope');
      }
    }
  }

  /**
   * Rutas internas no-ops (merchants bootstrap, webhooks): sin cabeceras RBAC.
   * Si alguien envía `merchant` sin ser ops, se rechaza (evita confusión).
   */
  private assertLegacyOptionalMerchantScope(req: Request): void {
    const roleRaw = this.getHeader(req, 'x-backoffice-role');
    const role = roleRaw?.toLowerCase().trim();
    if (!role) {
      return;
    }
    if (role === 'admin') {
      return;
    }
    if (role === 'merchant') {
      throw new ForbiddenException('X-Backoffice-Role merchant is only valid for payments ops endpoints');
    }
    throw new ForbiddenException('Invalid X-Backoffice-Role');
  }

  private isOpsTransactionsAggregatePath(path: string): boolean {
    return (
      path.includes('/ops/transactions/counts') ||
      path.includes('/ops/transactions/volume-hourly') ||
      path.includes('/ops/transactions/summary-daily') ||
      path.includes('/ops/transactions/summary-hourly') ||
      path.includes('/ops/transactions/summary') ||
      /\/ops\/transactions$/.test(path)
    );
  }

  private isOpsDashboardMerchantScopedPath(path: string): boolean {
    return path.includes('/ops/dashboard/volume-usd');
  }

  private getHeader(req: Request, name: string): string | undefined {
    const raw = req.headers[name] as string | string[] | undefined;
    if (Array.isArray(raw)) {
      return raw[0];
    }
    return typeof raw === 'string' ? raw : undefined;
  }

  private getSingleQueryParam(
    q: Request['query'] | undefined,
    key: string,
  ): string | undefined {
    if (!q) {
      return undefined;
    }
    const v = q[key];
    if (typeof v === 'string') {
      return v;
    }
    if (Array.isArray(v) && typeof v[0] === 'string') {
      return v[0];
    }
    return undefined;
  }
}

/** Para controladores que deben restringir datos tras cargar recurso (p. ej. detalle de pago). */
export function readBackofficeMerchantScopeId(req: Pick<Request, 'headers'>): string | undefined {
  const role = String(req.headers['x-backoffice-role'] ?? '').toLowerCase();
  if (role !== 'merchant') {
    return undefined;
  }
  const mid = req.headers['x-backoffice-merchant-id'];
  const s = Array.isArray(mid) ? mid[0] : mid;
  return typeof s === 'string' && s.trim() ? s.trim() : undefined;
}
