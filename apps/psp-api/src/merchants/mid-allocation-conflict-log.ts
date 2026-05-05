import { MerchantMidAllocationFailedError } from './allocate-unique-merchant-mid';

const URL_IN_MSG = /[a-zA-Z][a-zA-Z0-9+\-.]*:\/\/[^\s"'>]*/g;

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max)}…`;
}

function sanitizeText(s: string): string {
  return truncate(s.replace(URL_IN_MSG, '[redacted-url]'), 200);
}

type ConflictLayerLog = {
  name: string;
  message: string;
  prismaCode?: string;
  postgresSqlState?: string;
  prismaModelName?: string;
  prismaTarget?: unknown;
};

function extractCodes(o: object): Pick<
  ConflictLayerLog,
  'prismaCode' | 'postgresSqlState' | 'prismaModelName' | 'prismaTarget'
> {
  const rec = o as Record<string, unknown>;
  const code = rec.code;
  const out: Pick<
    ConflictLayerLog,
    'prismaCode' | 'postgresSqlState' | 'prismaModelName' | 'prismaTarget'
  > = {};
  if (typeof code !== 'string') {
    return out;
  }
  if (/^P\d{4}$/.test(code)) {
    out.prismaCode = code;
    const meta = rec.meta;
    if (meta && typeof meta === 'object') {
      const m = meta as Record<string, unknown>;
      if (typeof m.modelName === 'string') {
        out.prismaModelName = m.modelName;
      }
      out.prismaTarget = m.target;
    }
    return out;
  }
  if (/^[0-9A-Z]{5}$/.test(code)) {
    out.postgresSqlState = code;
  }
  return out;
}

function layerFromUnknown(layer: unknown): ConflictLayerLog | null {
  if (layer instanceof Error) {
    return {
      name: layer.name,
      message: sanitizeText(layer.message),
      ...extractCodes(layer),
    };
  }
  if (layer && typeof layer === 'object' && typeof (layer as Record<string, unknown>).code === 'string') {
    const rec = layer as Record<string, unknown>;
    const rawMsg = rec.message;
    const message =
      typeof rawMsg === 'string' ? rawMsg : rawMsg !== undefined ? JSON.stringify(rawMsg) : '';
    return {
      name: 'ErrorLike',
      message: sanitizeText(message),
      ...extractCodes(layer as object),
    };
  }
  if (layer !== null && layer !== undefined) {
    return {
      name: 'NonError',
      message: sanitizeText(String(layer)),
    };
  }
  return null;
}

function causeOf(layer: unknown): unknown | undefined {
  if (!(layer instanceof Error)) {
    return undefined;
  }
  return (layer as { cause?: unknown }).cause;
}

/**
 * Resume error / `.cause` para logs internos antes de traducir a 409 genérico (sin exponer detalle al cliente).
 */
export function midAllocationConflictDiagnostics(error: unknown): {
  midAllocationReason?: MerchantMidAllocationFailedError['reason'];
  layers: ConflictLayerLog[];
} {
  const layers: ConflictLayerLog[] = [];
  let midAllocationReason: MerchantMidAllocationFailedError['reason'] | undefined;

  let cur: unknown = error;
  const seen = new Set<unknown>();
  const maxDepth = 8;

  for (let depth = 0; depth < maxDepth && cur != null; depth += 1) {
    if (seen.has(cur)) {
      break;
    }
    seen.add(cur);

    if (cur instanceof MerchantMidAllocationFailedError) {
      midAllocationReason = cur.reason;
    }

    const layer = layerFromUnknown(cur);
    if (layer) {
      layers.push(layer);
    }

    const next = causeOf(cur);
    if (next === undefined) {
      break;
    }
    cur = next;
  }

  return { midAllocationReason, layers };
}
