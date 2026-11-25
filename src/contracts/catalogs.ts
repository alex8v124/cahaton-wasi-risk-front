export interface CiiuOption {
  codigo: string;
  nombre: string;
  categoria: string;
}

/**
 * Los 14 sectores CIIU MYPE de Caja Trujillo (La Libertad / Norte del Perú).
 */
export const CIIU_CATALOG: readonly CiiuOption[] = [
  { codigo: '1520', nombre: 'Fabricación de calzado y cuero', categoria: 'Manufactura El Porvenir' },
  { codigo: '5211', nombre: 'Bodegas, abarrotes y mayoristas de alimentos', categoria: 'Comercio Hermelinda' },
  { codigo: '1810', nombre: 'Confección de prendas de vestir y textil', categoria: 'Manufactura' },
  { codigo: '5520', nombre: 'Restaurantes, pollerías y cevicherías', categoria: 'Gastronomía' },
  { codigo: '5020', nombre: 'Mantenimiento y reparación de vehículos', categoria: 'Servicios Técnicos' },
  { codigo: '4520', nombre: 'Ferretería y materiales de construcción', categoria: 'Comercio / Obra' },
  { codigo: '5231', nombre: 'Farmacias, boticas y productos médicos', categoria: 'Salud MYPE' },
  { codigo: '5232', nombre: 'Comercio minorista de ropa y calzado', categoria: 'Retail' },
  { codigo: '5233', nombre: 'Electrodomésticos, repuestos y tecnología', categoria: 'Comercio' },
  { codigo: '1541', nombre: 'Panaderías, pastelerías y molinería', categoria: 'Alimentos' },
  { codigo: '6021', nombre: 'Transporte urbano, taxi y carga ligera', categoria: 'Transporte' },
  { codigo: '0111', nombre: 'Comercio agrícola, granos y avicultura', categoria: 'Agro MYPE' },
  { codigo: '3610', nombre: 'Carpintería, melamina y fabricación de muebles', categoria: 'Manufactura' },
  { codigo: '7499', nombre: 'Servicios técnicos, imprentas y talleres', categoria: 'Servicios' },
] as const;

export const DOCUMENT_TYPES = [
  { value: 'FACTURA_MAYORISTA', label: 'Factura Mayorista / Proveedor' },
  { value: 'BOLETA_COMPRA', label: 'Boleta de Compra' },
  { value: 'NOTA_MANUSCRITA', label: 'Nota Manuscrita / Cuaderno de Ventas' },
  { value: 'VOUCHER_YAPE_PLIN', label: 'Voucher Yape / Plin' },
] as const;

export const AGENCIAS_TRUJILLO = [
  'Agencia El Porvenir',
  'Agencia Mercado La Hermelinda',
  'Agencia La Esperanza',
  'Agencia Trujillo Centro',
  'Agencia Florencia de Mora',
  'Agencia Víctor Larco',
] as const;

/**
 * Catálogo P-01 a P-09 de patrones de riesgo en red (Tabla 13 — Documento Técnico RIE-02 v2.0).
 */
export interface PatronRiesgoCatalogItem {
  codigo: string;
  nombre: string;
  senal: string;
  peso_inicial: number;
}

export const PATRONES_RIESGO_CATALOG: readonly PatronRiesgoCatalogItem[] = [
  {
    codigo: 'P-01',
    nombre: 'Teléfono compartido',
    senal: 'El mismo teléfono aparece en solicitudes de personas sin vínculo declarado.',
    peso_inicial: 0.3,
  },
  {
    codigo: 'P-02',
    nombre: 'Dispositivo compartido',
    senal: 'El mismo dispositivo de cliente envía solicitudes de varias personas.',
    peso_inicial: 0.35,
  },
  {
    codigo: 'P-03',
    nombre: 'Referencias circulares',
    senal: 'Los solicitantes se refieren entre sí en cadena cerrada (A→B→C→A).',
    peso_inicial: 0.3,
  },
  {
    codigo: 'P-04',
    nombre: 'Dirección concentrada atípica',
    senal: 'Varias personas o negocios declaran una vivienda que no es zona comercial.',
    peso_inicial: 0.2,
  },
  {
    codigo: 'P-05',
    nombre: 'Ráfaga temporal',
    senal: 'Solicitudes conectadas presentadas en ventana corta y en agencias distintas.',
    peso_inicial: 0.2,
  },
  {
    codigo: 'P-06',
    nombre: 'Negocios recientes o irregulares',
    senal: 'RUC con poca antigüedad, NO HABIDO o BAJA conectados entre sí.',
    peso_inicial: 0.15,
  },
  {
    codigo: 'P-07',
    nombre: 'Concentración en asesor',
    senal: 'Un asesor origina muchas solicitudes de una misma comunidad con vínculos cruzados.',
    peso_inicial: 0.2,
  },
  {
    codigo: 'P-08',
    nombre: 'Ventas infladas en la red',
    senal: 'Nodos declaran ventas muy superiores (>30%) a sus compras comprobadas.',
    peso_inicial: 0.25,
  },
  {
    codigo: 'P-09',
    nombre: 'Vínculo con casos confirmados',
    senal: 'La subred incluye clientes con fraude confirmado o mora temprana.',
    peso_inicial: 0.25,
  },
] as const;

/**
 * Reglas L-01 a L-06 de contexto legítimo para reducción de falsos positivos (Tabla 15 — RIE-02 v2.0).
 */
export interface ContextoLegitimoCatalogItem {
  codigo: string;
  nombre: string;
  reconocimiento: string;
  efecto: string;
  factor_default: number;
}

export const CONTEXTO_LEGITIMO_CATALOG: readonly ContextoLegitimoCatalogItem[] = [
  {
    codigo: 'L-01',
    nombre: 'Familia en el mismo domicilio',
    reconocimiento: 'Vínculo familiar declarado o apellidos y domicilio coincidentes.',
    efecto: 'F_contexto hasta 0.40',
    factor_default: 0.4,
  },
  {
    codigo: 'L-02',
    nombre: 'Mercado o galería comercial',
    reconocimiento: 'Dirección catalogada como zona comercial densa (ej. La Hermelinda).',
    efecto: 'Rareza baja + F_contexto hasta 0.50',
    factor_default: 0.5,
  },
  {
    codigo: 'L-03',
    nombre: 'Negocio familiar',
    reconocimiento: 'Teléfono del negocio compartido por socios o familiares directos.',
    efecto: 'F_contexto hasta 0.50',
    factor_default: 0.5,
  },
  {
    codigo: 'L-04',
    nombre: 'Referencias entre familiares',
    reconocimiento: 'Referencias recíprocas entre familiares directos declarados.',
    efecto: 'Anula P-03 en ese tramo',
    factor_default: 0.55,
  },
  {
    codigo: 'L-05',
    nombre: 'Asociación de comerciantes',
    reconocimiento: 'Miembros de una misma asociación o cooperativa registrada.',
    efecto: 'F_contexto hasta 0.60',
    factor_default: 0.6,
  },
  {
    codigo: 'L-06',
    nombre: 'Dispositivo corporativo del asesor',
    reconocimiento: 'Solicitudes capturadas en campo desde la tablet oficial del asesor.',
    efecto: 'Anula P-02 para ese dispositivo',
    factor_default: 0.78,
  },
] as const;

export const RELACIONES_REFERENCIA = [
  { value: 'FAMILIAR', label: 'Familiar directo' },
  { value: 'PROVEEDOR', label: 'Proveedor comercial' },
  { value: 'COMERCIANTE_VECINO', label: 'Comerciante / Puesto vecino' },
  { value: 'AMIGO', label: 'Conocido / Amigo' },
] as const;

/**
 * Los 7 Documentos del Kit probados por Soe (Sección 2, 4, 6 y 7 del Informe Técnico Agente Local).
 * Permiten demostrar en 1 clic los hallazgos D3/D4 (Yape S/ 870 con comisión S/ 0.00 y op 09482716),
 * D5/D8 (Plin CAMPOS ALVA RICARDO y Factura PAREDESGOMEZROSAURA), D7 (Factura ferretera cemento en bodega)
 * y D12 (Nota borrosa 5.0OO.00 con pérdida de detalle 0.385 y contraste 34).
 */
export interface SoeKitDocumentSample {
  id: string;
  label: string;
  nombre_archivo: string;
  tipo_documento: string;
  texto_ocr: string;
  laplaciano_1600px: number;
  perdida_detalle_texto: number;
  contraste: number;
  semaforo_esperado: 'VERDE' | 'AMARILLO' | 'ROJO';
  hallazgo_demostrado: string;
}

export const SOE_KIT_DOCUMENTS_CATALOG: readonly SoeKitDocumentSample[] = [
  {
    id: 'DOC-SOE-1',
    label: '1. Boleta Hermelinda (S/ 4,815 · 5 ítems)',
    nombre_archivo: 'DOC-MAY-002_boleta_molino_hermelinda.png',
    tipo_documento: 'BOLETA_COMPRA',
    texto_ocr:
      '20 arr Papa Blanca S/ 480.00 + 10 cj Aceite Vegetal S/ 920.00 + 15 fdo Fideos S/ 540.00 + 25 pl Huevos S/ 725.00 + 15 saco Arroz S/ 2,150.00 -> TOTAL S/ 4,815.00 (OCR: 0.96)',
    laplaciano_1600px: 1229,
    perdida_detalle_texto: 0.017,
    contraste: 82,
    semaforo_esperado: 'VERDE',
    hallazgo_demostrado: '5 unidades normalizadas (arr, cj, fdo, pl, saco) y suma exacta S/ 4,815.00',
  },
  {
    id: 'DOC-SOE-2',
    label: '2. Factura Curtiembre (S/ 5,000 · IGV 1.18)',
    nombre_archivo: 'DOC-MAY-001_factura_curtiembre_calzado.png',
    tipo_documento: 'FACTURA_MAYORISTA',
    texto_ocr:
      'Señor(a): ROJAS VALDERRAMA LUIS · RUC10423189012 · 180 pies cuero + suela (Base Gravada S/ 4,237.29 × 1.18 IGV) -> TOTAL S/ 5,000.00 (OCR: 0.95)',
    laplaciano_1600px: 914,
    perdida_detalle_texto: 0.019,
    contraste: 76,
    semaforo_esperado: 'VERDE',
    hallazgo_demostrado: 'Verificador Python: Base gravada × 1.18 = Total + Sanitizador RUC pegado',
  },
  {
    id: 'DOC-SOE-3',
    label: '3. Factura Ferretera (S/ 2,400 · PAREDESGOMEZROSAURA)',
    nombre_archivo: 'DOC-MAY-003_factura_ferreteria_incoherencia.png',
    tipo_documento: 'FACTURA_MAYORISTA',
    texto_ocr:
      'Cliente: PAREDESGOMEZROSAURA · 45 bolsa cemento Sol + 20 varilla fierro 1/2 -> TOTAL S/ 2,400.00 (OCR: 0.94)',
    laplaciano_1600px: 838,
    perdida_detalle_texto: 0.022,
    contraste: 71,
    semaforo_esperado: 'VERDE',
    hallazgo_demostrado: 'D5/D11: Tapa nombre pegado sin espacios (PAREDESGOMEZROSAURA) + D7 giro',
  },
  {
    id: 'DOC-SOE-4',
    label: '4. Nota Gamarrita (S/ 5,200 · Cuero sintético)',
    nombre_archivo: 'DOC-MAN-004_nota_mostrador_gamarrita_valida.png',
    tipo_documento: 'NOTA_MANUSCRITA',
    texto_ocr:
      '190 pie cuero sintético + 12 gal pegamento calzado -> TOTAL S/ 5,200.00 (OCR: 0.91)',
    laplaciano_1600px: 510,
    perdida_detalle_texto: 0.031,
    contraste: 64,
    semaforo_esperado: 'VERDE',
    hallazgo_demostrado: 'Triangulación P-08: sustenta S/ 7,647.06 frente a S/ 18,500 declarados (+141.9%)',
  },
  {
    id: 'DOC-SOE-5',
    label: '5. Voucher Plin (S/ 1,240 · CAMPOS ALVA RICARDO)',
    nombre_archivo: 'DOC-WAL-007_voucher_plin_1240.png',
    tipo_documento: 'VOUCHER_YAPE_PLIN',
    texto_ocr:
      'Enviaste Plin S/ 1,240.00 · Destinatario: CAMPOS ALVA RICARDO · Cel +51 948332190 · Compra insumos cuero (OCR: 0.96)',
    laplaciano_1600px: 386,
    perdida_detalle_texto: 0.028,
    contraste: 69,
    semaforo_esperado: 'VERDE',
    hallazgo_demostrado: 'D5/Sección 7: Laplaciano 386 (<400) pero pérdida 0.028 (VERDE) y tapa proveedor Plin',
  },
  {
    id: 'DOC-SOE-6',
    label: '6. Voucher Yape (S/ 870 · Op 09482716 + Comisión S/ 0.00)',
    nombre_archivo: 'DOC-WAL-006_voucher_yape_870.png',
    tipo_documento: 'VOUCHER_YAPE_PLIN',
    texto_ocr:
      '¡Yapeaste! S/ 870.00 · Para: QUISPE ALFARO MARIA · pago 4 tr aparado + 3 gal pegamento amarillo · Comisión S/ 0.00 (Gratis) · N° op 09482716 (OCR: 0.97)',
    laplaciano_1600px: 363,
    perdida_detalle_texto: 0.035,
    contraste: 68,
    semaforo_esperado: 'VERDE',
    hallazgo_demostrado: 'D3/D4/D8: Computa S/ 870.00 (ignora Comisión S/ 0.00) y preserva N° op 09482716',
  },
  {
    id: 'DOC-SOE-7',
    label: '7. Nota Borrosa (S/ 5.0OO.00 · Pérdida 0.385 · Poka-Yoke)',
    nombre_archivo: 'DOC-MAN-005_nota_borrosa_poka_yoke_5000.png',
    tipo_documento: 'NOTA_MANUSCRITA',
    texto_ocr:
      'Compras varios materiales calzado taller (sin detalle de unidades) -> TOTAL: S/ 5.0OO.00 (OCR: 0.62) CASO TRAMPA POKA-YOKE',
    laplaciano_1600px: 28,
    perdida_detalle_texto: 0.385,
    contraste: 34,
    semaforo_esperado: 'ROJO',
    hallazgo_demostrado: 'D10/D12/Sección 7: Rechaza 5.0OO.00, filtra pie CASO TRAMPA y envía a Gris (Excluido de provisión SBS)',
  },
] as const;

export function getCiiuLabel(code: string): string {
  const match = CIIU_CATALOG.find((item) => item.codigo === code);
  return match ? `${match.codigo} — ${match.nombre}` : `CIIU ${code}`;
}
