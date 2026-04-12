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
 * Petición Express mínima para resolver path de plantilla (`baseUrl` + `route.path`)
 * sin depender de `req.url` (puede incluir slugs/tokens).
 */
export type HttpLoggableRequest = {
  method?: string;
  url?: string;
  originalUrl?: string;
  baseUrl?: string;
  route?: { path: string };
};

/** Prefijos bajo los que todo lo que sigue se sustituye por `[redacted]` si no hay plantilla. */
const REDACT_AFTER_PREFIXES: readonly string[] = ['/api/v1/pay/'];

/**
 * Emite una línea de log JSON por petición HTTP (método, path, status, duración).
 * Omite `GET /health` para no inundar logs de probes.
 *
 * El `path` en el log es una **ruta normalizada** (plantilla Express cuando existe
 * `req.route.path`) o, si no, el path con segmentos sensibles redactados — no el
 * `req.url` crudo con slugs.
 *
 * Comportamiento por `HTTP_LOG_MODE` (por defecto: `all` fuera de producción;
 * en `production` solo `errors` para limitar ruido y coste bajo carga alta).
 * Rutas de alto QPS pueden excluirse con `HTTP_LOG_SKIP_PATH_PREFIXES`.
 * En `sandbox` y `production` se fusiona por defecto el prefijo `/api/v1/pay`
 * (además de los configurados).
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
    const parsed = parseSkipPrefixes(this.config.get<string>('HTTP_LOG_SKIP_PATH_PREFIXES') ?? '');
    const nodeEnv = this.config.get<string>('NODE_ENV') ?? 'development';
    this.skipPrefixes = mergeSkipPrefixes(parsed, nodeEnv);
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') {
      return next.handle();
    }

    if (this.mode === 'off') {
      return next.handle();
    }

    const http = context.switchToHttp();
    const req = http.getRequest<HttpLoggableRequest>();
    const rawPath = (req.originalUrl ?? req.url ?? '').split('?')[0] ?? '';

    if (req.method === 'GET' && rawPath === '/health') {
      return next.handle();
    }

    if (pathMatchesSkipList(rawPath, this.skipPrefixes)) {
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
        const path = resolveLoggablePath(req);
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

/**
 * Une `baseUrl` y `route.path` de Express en un solo path de plantilla.
 */
export function joinBaseAndRoute(baseUrl: string | undefined, routePath: string): string {
  const base = (baseUrl ?? '').replace(/\/+$/, '');
  const path = routePath.startsWith('/') ? routePath : `/${routePath}`;
  if (!base) {
    return path || '/';
  }
  return `${base}${path}`;
}

/**
 * Devuelve path seguro para logs: plantilla `baseUrl` + `req.route.path` si existe;
 * si no, aplica {@link redactSensitivePath} sobre el path sin query string.
 *
 * @param req Petición HTTP (Express).
 */
export function resolveLoggablePath(req: HttpLoggableRequest): string {
  const rawPath = (req.originalUrl ?? req.url ?? '').split('?')[0] ?? '';
  const routePath = req.route?.path;
  if (typeof routePath === 'string' && routePath.length > 0) {
    const template = joinBaseAndRoute(req.baseUrl, routePath);
    if (template.length > 0) {
      return template;
    }
  }
  return redactSensitivePath(rawPath);
}

/**
 * Sustituye por `[redacted]` el resto del path tras prefijos sensibles conocidos.
 */
export function redactSensitivePath(path: string): string {
  for (const prefix of REDACT_AFTER_PREFIXES) {
    if (path.startsWith(prefix)) {
      const base = prefix.endsWith('/') ? prefix.slice(0, -1) : prefix;
      return `${base}/[redacted]`;
    }
  }
  return path;
}

/**
 * En `sandbox` y `production`, añade prefijos omitidos por defecto (`/api/v1/pay`)
 * además de los definidos en env.
 */
export function mergeSkipPrefixes(parsed: string[], nodeEnv: string): string[] {
  const defaults =
    nodeEnv === 'sandbox' || nodeEnv === 'production' ? (['/api/v1/pay'] as const) : [];
  return dedupePrefixList([...defaults, ...parsed]);
}

function dedupePrefixList(prefixes: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of prefixes) {
    if (!seen.has(p)) {
      seen.add(p);
      out.push(p);
    }
  }
  return out;
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
