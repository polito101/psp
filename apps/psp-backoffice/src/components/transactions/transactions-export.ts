/** Carácter significativo tras espacios iniciales que Excel/Sheets tratan como inicio de fórmula en CSV. */
const CSV_FORMULA_TRIGGER = /^\s*[=+\-@]/;

/**
 * Evita CSV injection (fórmulas al abrir en Excel/Sheets) y escapa comillas dobles para el formato RFC 4180.
 *
 * @param value Valor bruto de celda antes de envolver en comillas.
 * @returns Texto seguro para interpolar dentro de `"..."` en una línea CSV.
 */
export function sanitizeCsvCell(value: unknown): string {
  const raw = value === null || value === undefined ? "" : String(value);
  const neutralized = CSV_FORMULA_TRIGGER.test(raw) ? `'${raw}` : raw;
  return neutralized.replaceAll('"', '""');
}

/**
 * Construye el contenido CSV (cabecera + filas), una fila por línea.
 */
export function buildCsvDocument(headers: string[], rows: unknown[][]): string {
  const headerLine = headers.map((h) => `"${sanitizeCsvCell(h)}"`).join(",");
  const lines = rows.map((cells) => cells.map((c) => `"${sanitizeCsvCell(c)}"`).join(","));
  return [headerLine, ...lines].join("\n");
}
