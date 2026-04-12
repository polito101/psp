import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { VERSION_NEUTRAL } from '@nestjs/common';
import { PATH_METADATA, VERSION_METADATA } from '@nestjs/common/constants';
import { ConfigService } from '@nestjs/config';
import { Observable } from 'rxjs';
import { finalize } from 'rxjs/operators';

type HttpLogMode = 'off' | 'all' | 'errors' | 'sample';

/** Alineado con `setGlobalPrefix('api')` en main.ts */
const GLOBAL_API_PREFIX = 'api';

/** Alineado con `enableVersioning({ defaultVersion: '1' })` */
const DEFAULT_URI_VERSION = '1';

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

/**
 * Prefijos (con `/` final) bajo los que el resto del path se sustituye por `[redacted]`
 * si no hay plantilla Express/Nest. Orden: más específicos primero.
 */
const REDACT_AFTER_PREFIXES: readonly string[] = [
  '/api/v1/payment-links/',
  '/api/v1/payments/',
  '/api/v1/pay/',
  '/api/v1/merchants/',
  '/api/v1/webhooks/',
];

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
 * Rutas de alto QPS pueden reducir ruido con `HTTP_LOG_SKIP_PATH_PREFIXES`: no se emite
 * línea para respuestas exitosas (status menor que 400) en esos prefijos; 4xx/5xx se loguean siempre.
 * En `sandbox` y `production` se fusiona por defecto el prefijo `/api/v1/pay`
 * (además de los configurados).
 */
@Injectable()
export class HttpLoggingInterceptor implements NestInterceptor {
  private readonly log = new Logger('HTTP');
  private readonly mode: HttpLogMode;
  private readonly sampleRate: number;
  private readonly skipPrefixes: string[];
  /** Cache por handler: `buildNestRouteTemplate` usa `Reflect.getMetadata` varias veces. */
  private readonly nestRouteTemplateByHandler = new WeakMap<object, string | undefined>();

  constructor(private readonly config: ConfigService) {
    this.mode = this.config.get<HttpLogMode>('HTTP_LOG_MODE') ?? 'all';
    this.sampleRate = Number(this.config.get<string>('HTTP_LOG_SAMPLE_RATE') ?? '0.1');
    const rawSkipPrefixes = this.config.get<string>('HTTP_LOG_SKIP_PATH_PREFIXES') ?? '';
    const parsed = parseSkipPrefixes(rawSkipPrefixes);
    const nodeEnv = this.config.get<string>('NODE_ENV') ?? 'development';
    this.skipPrefixes = mergeSkipPrefixes(parsed, nodeEnv);
    if (rawContainsRootSkipPrefix(rawSkipPrefixes)) {
      this.log.warn(
        `Ignoring '/' in HTTP_LOG_SKIP_PATH_PREFIXES to avoid disabling all 2xx logs. Received: "${rawSkipPrefixes}"`,
      );
    }
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
    const isSkipped = pathMatchesSkipList(rawPath, this.skipPrefixes);

    if (req.method === 'GET' && rawPath === '/health') {
      return next.handle();
    }

    // Rutas en skip list siguen pasando por `finalize` para poder loguear 4xx/5xx;
    // el muestreo aleatorio no debe descartar por completo esas peticiones.
    if (this.mode === 'sample' && !isSkipped && Math.random() >= this.sampleRate) {
      return next.handle();
    }

    const start = Date.now();
    return next.handle().pipe(
      finalize(() => {
        const res = http.getResponse<{ statusCode?: number }>();
        const statusCode = res.statusCode ?? 0;
        if (isSkipped && statusCode < 400) {
          return;
        }
        if (this.mode === 'errors' && statusCode < 400) {
          return;
        }

        const nestRouteTemplate = this.getNestRouteTemplate(context);
        const ms = Date.now() - start;
        const path = resolveLoggablePath(req, nestRouteTemplate);
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

  private getNestRouteTemplate(context: ExecutionContext): string | undefined {
    const handler = context.getHandler();
    if (!this.nestRouteTemplateByHandler.has(handler)) {
      this.nestRouteTemplateByHandler.set(handler, buildNestRouteTemplate(context));
    }
    return this.nestRouteTemplateByHandler.get(handler);
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
 * Devuelve path seguro para logs:
 * 1. Plantilla Express (`baseUrl` + `req.route.path`) si existe tras el enrutado.
 * 2. Plantilla Nest (metadata de ruta) si se pasó desde el interceptor.
 * 3. {@link redactSensitivePath} sobre el path sin query string.
 *
 * @param req Petición HTTP (Express).
 * @param nestRouteTemplate Plantilla desde metadata Nest (p. ej. `/api/v1/payments/:id`).
 */
export function resolveLoggablePath(req: HttpLoggableRequest, nestRouteTemplate?: string): string {
  const expressTemplate = tryExpressRouteTemplate(req);
  if (expressTemplate) {
    return expressTemplate;
  }
  if (nestRouteTemplate) {
    return nestRouteTemplate;
  }
  return redactSensitivePath(getRawPathWithoutQuery(req));
}

function getRawPathWithoutQuery(req: HttpLoggableRequest): string {
  return (req.originalUrl ?? req.url ?? '').split('?')[0] ?? '';
}

/**
 * Plantilla de ruta según Express una vez resuelto el handler (si está disponible).
 */
export function tryExpressRouteTemplate(req: HttpLoggableRequest): string | undefined {
  const routePath = req.route?.path;
  if (typeof routePath !== 'string' || routePath.length === 0) {
    return undefined;
  }
  const template = joinBaseAndRoute(req.baseUrl, routePath);
  return template.length > 0 ? template : undefined;
}

/**
 * Construye la ruta tipo plantilla desde metadata Nest (`@Controller` / método).
 * Cubre casos donde `req.route` aún no refleja la ruta con parámetros de forma fiable.
 *
 * @returns `undefined` si no hay metadata de ruta (p. ej. middleware sin handler Nest).
 */
export function buildNestRouteTemplate(context: ExecutionContext): string | undefined {
  try {
    const controllerClass = context.getClass();
    const handler = context.getHandler();
    const controllerPath = Reflect.getMetadata(PATH_METADATA, controllerClass) as string | undefined;
    const methodPathRaw = Reflect.getMetadata(PATH_METADATA, handler) as string | undefined;
    const versionMeta = Reflect.getMetadata(VERSION_METADATA, controllerClass);

    if (controllerPath === undefined && methodPathRaw === undefined) {
      return undefined;
    }

    const controllerSegment = typeof controllerPath === 'string' ? controllerPath : '';
    const methodTail = normalizeMethodRouteSegment(
      typeof methodPathRaw === 'string' ? methodPathRaw : '/',
    );

    const req = context.switchToHttp().getRequest<{ method?: string }>();
    const httpMethod = req.method?.toUpperCase();

    const isHealthExcludedFromApiPrefix =
      controllerSegment === 'health' &&
      versionMeta === VERSION_NEUTRAL &&
      httpMethod === 'GET';

    if (isHealthExcludedFromApiPrefix) {
      const base = `/${controllerSegment}`;
      return methodTail ? joinPathSegments(base, methodTail) : base;
    }

    const versionSegment = resolveVersionUriSegment(versionMeta);
    const parts: string[] = [GLOBAL_API_PREFIX];
    if (versionSegment) {
      parts.push(versionSegment);
    }
    if (controllerSegment) {
      parts.push(controllerSegment);
    }
    const basePath = `/${parts.join('/')}`;
    return methodTail ? joinPathSegments(basePath, methodTail) : basePath;
  } catch {
    return undefined;
  }
}

function resolveVersionUriSegment(versionMeta: unknown): string | null {
  if (versionMeta === VERSION_NEUTRAL) {
    return null;
  }
  if (versionMeta === undefined || versionMeta === null) {
    return `v${DEFAULT_URI_VERSION}`;
  }
  return `v${String(versionMeta)}`;
}

function normalizeMethodRouteSegment(methodPathRaw: string): string {
  if (!methodPathRaw || methodPathRaw === '/') {
    return '';
  }
  return methodPathRaw.startsWith('/') ? methodPathRaw.slice(1) : methodPathRaw;
}

function joinPathSegments(base: string, tail: string): string {
  const b = base.endsWith('/') ? base.slice(0, -1) : base;
  const t = tail.startsWith('/') ? tail.slice(1) : tail;
  return `${b}/${t}`.replace(/\/{2,}/g, '/');
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
 * En `sandbox` y `production`, añade prefijos con skip de éxitos por defecto (`/api/v1/pay`)
 * además de los definidos en env (4xx/5xx no se omiten).
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

/**
 * Quita barras finales para alinear con el header/path (sin `//` al concatenar `prefix + '/'`).
 * El prefijo raíz `/` se conserva.
 */
function normalizeSkipPathPrefix(prefix: string): string {
  if (prefix === '/') {
    return '/';
  }
  const withoutTrailing = prefix.replace(/\/+$/, '');
  return withoutTrailing.length > 0 ? withoutTrailing : '/';
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
    .map((p) => (p.startsWith('/') ? p : `/${p}`))
    .map((p) => normalizeSkipPathPrefix(p))
    .filter((p) => p !== '/');
}

/** Exportado para pruebas unitarias de reglas de exclusión por prefijo. */
export function pathMatchesSkipList(path: string, prefixes: string[]): boolean {
  for (const prefix of prefixes) {
    const normalized = normalizeSkipPathPrefix(prefix);
    if (normalized === '/') {
      continue;
    }
    if (path === normalized || path.startsWith(`${normalized}/`)) {
      return true;
    }
  }
  return false;
}

function rawContainsRootSkipPrefix(raw: string): boolean {
  if (!raw.trim()) {
    return false;
  }
  return raw
    .split(',')
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
    .map((p) => (p.startsWith('/') ? p : `/${p}`))
    .map((p) => normalizeSkipPathPrefix(p))
    .some((p) => p === '/');
}
