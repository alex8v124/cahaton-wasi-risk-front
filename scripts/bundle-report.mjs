import { readdirSync, statSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const distDir = new URL('../dist', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1');

function walk(dir) {
  let files = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      files = files.concat(walk(full));
    } else {
      files.push(full);
    }
  }
  return files;
}

try {
  const files = walk(distDir);
  console.log('\n📦 WASI-RISK AI (Nodux Flow PWA) · Reporte de Bundle:');
  console.log('---------------------------------------------------------------------');

  let plano1Raw = 0;
  let plano1Gzip = 0;
  let totalGzip = 0;

  // Chunks que NO pertenecen a la carga inicial de Plano 1 (/campo) en producción VPS
  const excludedFromPlano1 = [
    'ConsolaView',
    'ExecutiveModal',
    'DictamenPrintModal',
    'mockBackend',
    'sw.js',
    'workbox-',
  ];

  for (const file of files) {
    const rel = file.replace(distDir, '').replace(/^[\\/]/, '');
    const buf = readFileSync(file);
    const rawSize = buf.length;
    const gzSize = gzipSync(buf).length;
    totalGzip += gzSize;

    const isCodeAsset = rel.endsWith('.js') || rel.endsWith('.css') || rel.endsWith('.html');
    const isPlano1 =
      isCodeAsset && !excludedFromPlano1.some((token) => rel.includes(token));

    if (isPlano1) {
      plano1Raw += rawSize;
      plano1Gzip += gzSize;
    }

    const rawKb = (rawSize / 1024).toFixed(2);
    const gzKb = (gzSize / 1024).toFixed(2);
    const tag = isPlano1 ? ' [PLANO 1]' : isCodeAsset ? ' [LAZY]' : '';

    console.log(
      `  ${(rel + tag).padEnd(48)} | raw: ${rawKb.padStart(7)} KB | gzip: ${gzKb.padStart(6)} KB`
    );
  }

  console.log('---------------------------------------------------------------------');
  const plano1GzKb = plano1Gzip / 1024;
  const plano1RawKb = plano1Raw / 1024;
  console.log(`  PLANO 1 (/campo PWA): ${plano1GzKb.toFixed(2)} KB gzip (${plano1RawKb.toFixed(2)} KB raw)`);
  console.log(`  TOTAL DIST (incl. Consola + Modales + SW): ${(totalGzip / 1024).toFixed(2)} KB gzip`);

  const MAX_KB = 150;
  if (plano1GzKb < MAX_KB) {
    console.log(
      `  ✔ ÉXITO: Plano 1 PWA en ${plano1GzKb.toFixed(2)} KB gzip (< ${MAX_KB} KB). Cumple Brief Técnico.\n`
    );
  } else {
    console.warn(`  ⚠ ALERTA: Plano 1 excede ${MAX_KB} KB gzip. Optimizar chunks.\n`);
  }
} catch (err) {
  console.error('Error calculando bundle size:', err.message);
}
