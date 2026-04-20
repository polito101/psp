import {
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

    this.assertMerchantBackofficeScope(req);
    return true;
  }

  /**
   * Si el BFF envía `X-Backoffice-Role: merchant`, restringe path/query a ese merchant.
   * Sin cabeceras de rol (legacy) se mantiene el comportamiento anterior (solo secreto interno).
   */
  private assertMerchantBackofficeScope(req: Request): void {
    const roleRaw = this.getHeader(req, 'x-backoffice-role');
    const role = roleRaw?.toLowerCase().trim();
    if (!role || role === 'admin') {
      return;
    }
    if (role !== 'merchant') {
      throw new ForbiddenException('Invalid X-Backoffice-Role');
    }

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
      const pathMerchant = decodeURIComponent(pathMerchantMatch[1]!);
      if (pathMerchant !== scoped) {
        throw new ForbiddenException('Cross-merchant access denied');
      }
    }

    if (this.isOpsTransactionsAggregatePath(path)) {
      const qm = this.getSingleQueryParam(req.query, 'merchantId');
      if (!qm || qm !== scoped) {
        throw new ForbiddenException('merchantId query must match merchant scope');
      }
    }
  }

  private isOpsTransactionsAggregatePath(path: string): boolean {
    return (
      path.includes('/ops/transactions/counts') ||
      path.includes('/ops/transactions/volume-hourly') ||
      /\/ops\/transactions$/.test(path)
    );
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
