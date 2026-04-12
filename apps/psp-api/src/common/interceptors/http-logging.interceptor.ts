import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Observable } from 'rxjs';
import { finalize } from 'rxjs/operators';

type HttpLogMode = 'off' | 'all' | 'errors' | 'sample';

/**
 * Emite una línea de log JSON por petición HTTP (método, path, status, duración).
 * Omite `GET /health` para no inundar logs de probes.
 *
 * Comportamiento por `HTTP_LOG_MODE` (por defecto: `all` fuera de producción;
 * en `production` solo `errors` para limitar ruido y coste bajo carga alta).
 * Rutas de alto QPS pueden excluirse con `HTTP_LOG_SKIP_PATH_PREFIXES`.
 */
@Injectable()
export class HttpLoggingInterceptor implements NestInterceptor {
  private readonly log = new Logger('HTTP');
  private readonly mode: HttpLogMode;
  private readonly sampleRate: number;
  private readonly skipPrefixes: string[];

  constructor(private readonly config: ConfigService) {
    this.mode = this.config.get<HttpLogMode>('HTTP_LOG_MODE') ?? 'all';
    this.sampleRate = Number(this.config.get<string>('HTTP_LOG_SAMPLE_RATE') ?? '0.1');
    this.skipPrefixes = parseSkipPrefixes(this.config.get<string>('HTTP_LOG_SKIP_PATH_PREFIXES') ?? '');
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') {
      return next.handle();
    }

    if (this.mode === 'off') {
      return next.handle();
    }

    const http = context.switchToHttp();
    const req = http.getRequest<{ method?: string; url?: string }>();
    const rawPath = req.url ?? '';
    const path = rawPath.split('?')[0] ?? '';

    if (req.method === 'GET' && path === '/health') {
      return next.handle();
    }

    if (pathMatchesSkipList(path, this.skipPrefixes)) {
      return next.handle();
    }

    if (this.mode === 'sample' && Math.random() >= this.sampleRate) {
      return next.handle();
    }

    const start = Date.now();
    return next.handle().pipe(
      finalize(() => {
        const res = http.getResponse<{ statusCode?: number }>();
        const statusCode = res.statusCode ?? 0;
        if (this.mode === 'errors' && statusCode < 400) {
          return;
        }

        const ms = Date.now() - start;
        const line = JSON.stringify({
          event: 'http.request',
          method: req.method ?? 'UNKNOWN',
          path,
          statusCode,
          ms,
        });
        this.log.log(line);
      }),
    );
  }
}

/** Exportado para pruebas unitarias de reglas de exclusión por prefijo. */
export function parseSkipPrefixes(raw: string): string[] {
  if (!raw.trim()) {
    return [];
  }
  return raw
    .split(',')
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
    .map((p) => (p.startsWith('/') ? p : `/${p}`));
}

/** Exportado para pruebas unitarias de reglas de exclusión por prefijo. */
export function pathMatchesSkipList(path: string, prefixes: string[]): boolean {
  for (const prefix of prefixes) {
    if (path === prefix || path.startsWith(`${prefix}/`)) {
      return true;
    }
  }
  return false;
}
