import { Injectable, Logger } from '@nestjs/common';
import { PaymentOperation, PaymentProviderName } from './domain/payment-status';

type MetricsBucket = {
  total: number;
  success: number;
  failed: number;
  retries: number;
  attemptPersistFailed: number;
  latencies: number[];
};

/** Contador aparte de `provider:operation`: el gate de readiness no debe tratarlo como tasa de fallo de proveedor. */
type MerchantIsActiveFreshBucket = {
  total: number;
  passed: number;
  blocked: number;
  latencies: number[];
};

@Injectable()
export class PaymentsV2ObservabilityService {
  private readonly log = new Logger(PaymentsV2ObservabilityService.name);
  private readonly metrics = new Map<string, MetricsBucket>();
  private readonly merchantIsActiveFresh: MerchantIsActiveFreshBucket = {
    total: 0,
    passed: 0,
    blocked: 0,
    latencies: [],
  };

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
      attemptPersistFailed: 0,
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

  registerAttemptPersistFailure(params: {
    provider: PaymentProviderName;
    operation: PaymentOperation;
  }): void {
    const key = `${params.provider}:${params.operation}`;
    const current = this.metrics.get(key) ?? {
      total: 0,
      success: 0,
      failed: 0,
      retries: 0,
      attemptPersistFailed: 0,
      latencies: [],
    };
    current.attemptPersistFailed += 1;
    this.metrics.set(key, current);
  }

  /**
   * `createIntent` y otras rutas que exigen lectura fresca de `Merchant.isActive` (kill-switch sin ventana de caché “activo”).
   */
  recordMerchantIsActiveFreshAssertion(params: { latencyMs: number; passed: boolean }): void {
    const b = this.merchantIsActiveFresh;
    b.total += 1;
    if (params.passed) {
      b.passed += 1;
    } else {
      b.blocked += 1;
    }
    b.latencies.push(params.latencyMs);
    if (b.latencies.length > 200) {
      b.latencies.shift();
    }
  }

  merchantIsActiveFreshSnapshot(): Record<string, number> {
    const b = this.merchantIsActiveFresh;
    return {
      total: b.total,
      passed: b.passed,
      blocked: b.blocked,
      passRate: b.total > 0 ? Number((b.passed / b.total).toFixed(4)) : 0,
      blockRate: b.total > 0 ? Number((b.blocked / b.total).toFixed(4)) : 0,
      p95LatencyMs: this.p95(b.latencies),
      p99LatencyMs: this.pQuantile(b.latencies, 0.99),
    };
  }

  snapshot(): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [key, metric] of this.metrics) {
      out[key] = {
        total: metric.total,
        successRate: metric.total > 0 ? Number((metric.success / metric.total).toFixed(4)) : 0,
        retryRate: metric.total > 0 ? Number((metric.retries / metric.total).toFixed(4)) : 0,
        attemptPersistFailed: metric.attemptPersistFailed,
        p95LatencyMs: this.p95(metric.latencies),
      };
    }
    return out;
  }

  logProviderEvent(payload: Record<string, unknown>) {
    this.log.log(JSON.stringify({ event: 'payments_v2.provider_attempt', ...payload }));
  }

  private p95(values: number[]): number {
    return this.pQuantile(values, 0.95);
  }

  private pQuantile(values: number[], q: number): number {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const idx = Math.ceil(sorted.length * q) - 1;
    return sorted[Math.max(0, idx)];
  }
}
