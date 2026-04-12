import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { finalize } from 'rxjs/operators';

/**
 * Emite una línea de log JSON por petición HTTP (método, path, status, duración).
 * Omite `GET /health` para no inundar logs de probes.
 */
@Injectable()
export class HttpLoggingInterceptor implements NestInterceptor {
  private readonly log = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') {
      return next.handle();
    }

    const http = context.switchToHttp();
    const req = http.getRequest<{ method?: string; url?: string }>();
    const rawPath = req.url ?? '';
    const path = rawPath.split('?')[0] ?? '';
    if (req.method === 'GET' && path === '/health') {
      return next.handle();
    }

    const start = Date.now();
    return next.handle().pipe(
      finalize(() => {
        const res = http.getResponse<{ statusCode?: number }>();
        const ms = Date.now() - start;
        const line = JSON.stringify({
          event: 'http.request',
          method: req.method ?? 'UNKNOWN',
          path,
          statusCode: res.statusCode ?? 0,
          ms,
        });
        this.log.log(line);
      }),
    );
  }
}
