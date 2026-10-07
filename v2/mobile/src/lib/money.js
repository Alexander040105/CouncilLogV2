/** Port of web/src/lib/money.js — the API stores everything as centavos
 *  (bigint), never floats. Convert at the edges. */

const fmt = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' });

export function peso(centavos) {
  return fmt.format((centavos ?? 0) / 100);
}

export function toCentavos(str) {
  const n = parseFloat(String(str ?? '').replace(/[₱,\s]/g, ''));
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100);
}
