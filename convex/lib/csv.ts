/** CSV helpers shared by the materials order list and the data export. */

/**
 * One CSV cell. Cells starting with = + - @ (or a tab/CR) could run as
 * formulas when opened in Excel or Sheets, so they're prefixed with '.
 */
export function csvCell(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return "";
  let s = String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Rows (first row = header) → CSV text with CRLF line endings. */
export function toCsv(rows: (string | number | boolean | null | undefined)[][]): string {
  return rows.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
