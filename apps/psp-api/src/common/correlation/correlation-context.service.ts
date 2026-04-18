import { Injectable } from '@nestjs/common';
import { getCorrelationIdFromStore } from './correlation-id.storage';

@Injectable()
export class CorrelationContextService {
  getId(): string | undefined {
    return getCorrelationIdFromStore();
  }
}
