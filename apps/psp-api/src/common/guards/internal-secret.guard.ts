import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'crypto';

const UNAUTHORIZED_MESSAGE = 'Unauthorized';

@Injectable()
export class InternalSecretGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<{
      headers: Record<string, string | string[] | undefined>;
    }>();

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

    return true;
  }
}
