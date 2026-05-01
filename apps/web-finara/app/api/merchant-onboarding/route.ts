import { NextResponse } from "next/server";

const UPSTREAM_TIMEOUT_MS = 25_000;

function getPspApiBaseUrl(): string | null {
  const raw = process.env.PSP_API_BASE_URL?.trim();
  if (!raw) return null;
  return raw.replace(/\/+$/, "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Proxy same-origin para `POST /api/merchant-onboarding` → `POST {PSP_API_BASE_URL}/api/v1/merchant-onboarding/applications`.
 * Evita CORS y no expone la URL base de la API al cliente.
 */
export async function POST(request: Request): Promise<Response> {
  const baseUrl = getPspApiBaseUrl();
  if (!baseUrl) {
    return NextResponse.json(
      { message: "PSP_API_BASE_URL no está configurado en el servidor." },
      { status: 500 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ message: "Cuerpo JSON inválido." }, { status: 400 });
  }

  if (!isRecord(body)) {
    return NextResponse.json({ message: "Formato de solicitud inválido." }, { status: 400 });
  }

  const name = body.name;
  const email = body.email;
  const phone = body.phone;
  if (typeof name !== "string" || typeof email !== "string" || typeof phone !== "string") {
    return NextResponse.json(
      { message: "Faltan campos obligatorios: name, email, phone." },
      { status: 400 },
    );
  }

  const upstream = `${baseUrl}/api/v1/merchant-onboarding/applications`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);

  try {
    const upstreamResponse = await fetch(upstream, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, email, phone }),
      signal: controller.signal,
    });

    const text = await upstreamResponse.text();
    const contentType = upstreamResponse.headers.get("content-type") ?? "";

    if (contentType.includes("application/json")) {
      try {
        const json = JSON.parse(text) as unknown;
        return NextResponse.json(json, { status: upstreamResponse.status });
      } catch {
        return NextResponse.json(
          { message: "Respuesta inválida del servicio de onboarding." },
          { status: 502 },
        );
      }
    }

    if (!upstreamResponse.ok) {
      return NextResponse.json(
        { message: text || "Error al crear la solicitud de onboarding." },
        { status: upstreamResponse.status >= 400 ? upstreamResponse.status : 502 },
      );
    }

    return NextResponse.json({ ok: true, message: text });
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    if (err.name === "AbortError") {
      return NextResponse.json(
        { message: `Tiempo de espera agotado al contactar la API (${UPSTREAM_TIMEOUT_MS} ms).` },
        { status: 504 },
      );
    }
    return NextResponse.json({ message: "No se pudo contactar la API de onboarding." }, { status: 502 });
  } finally {
    clearTimeout(timeoutId);
  }
}
