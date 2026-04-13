import { Injectable, Logger } from '@nestjs/common';
import { PaymentOperation, PaymentProviderName } from './domain/payment-status';

type MetricsBucket = {
  total: number;
  success: number;
  failed: number;
  retries: number;
  latencies: number[];
};

@Injectable()
export class PaymentsV2ObservabilityService {
  private readonly log = new Logger(PaymentsV2ObservabilityService.name);
  private readonly metrics = new Map<string, MetricsBucket>();

  registerAttempt(params: {
    provider: PaymentProviderName;
    operation: PaymentOperation;
    success: boolean;
    retried: boolean;
    latencyMs: number;
  }): void {
    const key = `${params.provider}:${params.operation}`;
    const current = this.metrics.get(key) ?? {
      total: 0,
      success: 0,
      failed: 0,
      retries: 0,
      latencies: [],
    };
    current.total += 1;
    current.success += params.success ? 1 : 0;
    current.failed += params.success ? 0 : 1;
    current.retries += params.retried ? 1 : 0;
    current.latencies.push(params.latencyMs);
    if (current.latencies.length > 200) {
      current.latencies.shift();
    }
    this.metrics.set(key, current);
  }

  snapshot(): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [key, metric] of this.metrics) {
      out[key] = {
        total: metric.total,
        successRate: metric.total > 0 ? Number((metric.success / metric.total).toFixed(4)) : 0,
        retryRate: metric.total > 0 ? Number((metric.retries / metric.total).toFixed(4)) : 0,
        p95LatencyMs: this.p95(metric.latencies),
      };
    }
    return out;
  }

  logProviderEvent(payload: Record<string, unknown>) {
    this.log.log(JSON.stringify({ event: 'payments_v2.provider_attempt', ...payload }));
  }

  private p95(values: number[]): number {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const idx = Math.ceil(sorted.length * 0.95) - 1;
    return sorted[Math.max(0, idx)];
  }
}
