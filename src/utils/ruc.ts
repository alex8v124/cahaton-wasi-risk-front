/**
 * Utilidades de validación SUNAT portadas de Nodux Flow (backend/src/validation.mjs & money.js).
 */

/** Dígito verificador de RUC (algoritmo Módulo 11 oficial SUNAT). */
export function isValidRucChecksum(ruc: string): boolean {
  const clean = String(ruc || '').replace(/\D/g, '');
  if (!/^(10|15|17|20)\d{9}$/.test(clean)) return false;
  const weights = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  const sum = weights.reduce((acc, w, i) => acc + w * Number(clean[i]), 0);
  let check = 11 - (sum % 11);
  if (check === 10) check = 0;
  if (check === 11) check = 1;
  return check === Number(clean[10]);
}

/** Sanitiza caracteres de control para evitar inyección en logs, CSV o mensajes WhatsApp. */
export function sanitizeText(value: string, maxLen = 280): string {
  return String(value || '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .trim()
    .slice(0, maxLen);
}
