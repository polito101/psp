import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { correlationIdStorage } from './correlation-id.storage';
import {
  normalizeCorrelationIdOrGenerate,
  OUTGOING_CORRELATION_HEADER,
  readIncomingCorrelationId,
} from './correlation-id';

@Injectable()
export class CorrelationIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const incoming = readIncomingCorrelationId(req.headers);
    const id = normalizeCorrelationIdOrGenerate(incoming);
    res.setHeader(OUTGOING_CORRELATION_HEADER, id);
    correlationIdStorage.run({ correlationId: id }, () => next());
  }
}
