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
  hash_sha256: string;
  tipo_documento: string;
  texto_ocr: string;
  laplaciano_1600px: number;
  perdida_detalle_texto: number;
  contraste: number;
  semaforo_esperado: 'VERDE' | 'AMARILLO' | 'ROJO';
  datos_tapados_resumen: string;
  hallazgo_demostrado: string;
}

export const SOE_KIT_DOCUMENTS_CATALOG: readonly SoeKitDocumentSample[] = [
  {
    id: 'DOC-MAY-001',
    label: '1. Factura Curtiembre (S/ 3,840 · 4 ítems · VERDE)',
    nombre_archivo: 'DOC-MAY-001_factura_curtiembre_calzado.png',
    hash_sha256: '6fe7e7159913704c88ec1b583629395b87e51978d9fca325b05e65f40b67e67b',
    tipo_documento: 'FACTURA_MAYORISTA',
    texto_ocr:
      '[RAZON_SOCIAL_01] | R.U.C. [RUC_01]\n[DIRECCION_01]\nF001-0004821 | Senor(es): [NOMBRE_01] | R.U.C.: [RUC_02] | 04/11/2026\n180 | pies | Cuero Box Calf Negro 1ra | 10.50 | 1,890.00\n80 | pies | Badana Forro Natural | 7.00 | 560.00\n10 | doc | Suela Expanso Escolar | 120.00 | 1,200.00\n2 | gal | Pegamento Amarillo Contacto | 95.00 | 190.00\nTOTAL: | S/ 3,840.00 (OCR: 0.99)',
    laplaciano_1600px: 914,
    perdida_detalle_texto: 0.019,
    contraste: 76,
    semaforo_esperado: 'VERDE',
    datos_tapados_resumen: '5 tapados (1 nombre, 1 razón social, 2 RUC, 1 dirección)',
    hallazgo_demostrado: 'Computable S/ 3,840.00 · 4 ítems (pies, doc, gal) + 5 datos personales tapados',
  },
  {
    id: 'DOC-MAY-002',
    label: '2. Boleta Hermelinda (S/ 4,815 · 5 ítems · VERDE)',
    nombre_archivo: 'DOC-MAY-002_boleta_molino_hermelinda.png',
    hash_sha256: 'e2cb28da1bece859f966984812ee97ddb47dc3e2eefe15dc82db3ee29b657163',
    tipo_documento: 'BOLETA_MAYORISTA',
    texto_ocr:
      '[RAZON_SOCIAL_01] | R.U.C. [RUC_01] | [DIRECCION_01]\nBOLETA DE VENTA ELECTRONICA | B002-0019021 | Senor(a): [NOMBRE_01] | R.U.C.: [RUC_02] | 08/11/2026\n15 | saco | Arroz Extra Norteno 50kg | 165.00 | 2,475.00\n20 | arr | Papa Blanca Seleccionada | 24.00 | 480.00\n10 | cj | Aceite Vegetal x 12 | 92.00 | 920.00\n15 | fdo | Fideos Tallarin x 20 | 36.00 | 540.00\n25 | pl | Huevos Rosados x 30 | 16.00 | 400.00\nTOTAL: | S/ 4,815.00 (OCR: 0.99)',
    laplaciano_1600px: 1229,
    perdida_detalle_texto: 0.017,
    contraste: 82,
    semaforo_esperado: 'VERDE',
    datos_tapados_resumen: '5 tapados (1 nombre, 1 razón social, 2 RUC, 1 dirección)',
    hallazgo_demostrado: '5 unidades normalizadas (saco, arr, cj, fdo, pl) y suma exacta S/ 4,815.00',
  },
  {
    id: 'DOC-MAY-003',
    label: '3. Factura Ferretera (Trampa de Giro · Computable S/ 0.00)',
    nombre_archivo: 'DOC-MAY-003_factura_ferreteria_incoherencia.png',
    hash_sha256: 'df53dc6e8bab98ee9ce0184ffdcb22f3473a8d02547a743173fa60e39c454667',
    tipo_documento: 'FACTURA_MAYORISTA',
    texto_ocr:
      '[RAZON_SOCIAL_01] | R.U.C. [RUC_01] | [DIRECCION_01]\nFACTURA ELECTRONICA | F004-0007712 | Cliente: [NOMBRE_01] | R.U.C.: [RUC_02] | 10/11/2026\n60 | bls | Cemento Pacasmayo Tipo I | 29.50 | 1,770.00\n35 | und | Varilla Fierro 1/2 Aceros | 38.00 | 1,330.00\n12 | und | Tubo PVC Desague 4 pulg | 22.00 | 264.00\nTOTAL: | S/ 3,364.00 (OCR: 0.99)',
    laplaciano_1600px: 838,
    perdida_detalle_texto: 0.022,
    contraste: 71,
    semaforo_esperado: 'VERDE',
    datos_tapados_resumen: '5 tapados (1 nombre, 1 razón social, 2 RUC, 1 dirección)',
    hallazgo_demostrado: 'FLAG_INCOHERENCIA_GIRO_CIIU: computable S/ 0.00 (cemento/fierro en bodega)',
  },
  {
    id: 'DOC-MAN-004',
    label: '4. Nota Gamarrita (S/ 1,530 · 4 ítems · Video Modo Avión)',
    nombre_archivo: 'DOC-MAN-004_nota_mostrador_gamarrita_valida.png',
    hash_sha256: '7a23abd2dcd0c56dedf50dd6cc54553723b96c55e4e17ac435a7bfc64b9bec97',
    tipo_documento: 'NOTA_MANUSCRITA',
    texto_ocr:
      'COMERCIAL TEXTIL | NOTA DE PEDIDO | N° 001458 | 11/11/2026\n[DIRECCION_01] | Sr(a): | [NOMBRE_01]\n3 rll | Tela Algodon Jersey 30/1 | 420.00 | 1,260.00\n2 cto | Botones camisa nacar | 18.00 | 36.00\n5 doc | Cierres metalicos 18cm | 24.00 | 120.00\n12 tira | Elastico | pretina x rollito | 9.50 | 114.00\nCANCELADO | TOTAL S/ | 1,530.00 (OCR: 0.98)',
    laplaciano_1600px: 510,
    perdida_detalle_texto: 0.024,
    contraste: 64,
    semaforo_esperado: 'VERDE',
    datos_tapados_resumen: '3 tapados (1 nombre, 2 dirección)',
    hallazgo_demostrado: 'Computable S/ 1,530.00 · 4 ítems (ROLLO, CIENTO, DOCENA, UNIDAD) verificado en Python',
  },
  {
    id: 'DOC-MAN-005',
    label: '5. Nota Borrosa (Trampa Poka-Yoke · Computable S/ 0.00)',
    nombre_archivo: 'DOC-MAN-005_nota_borrosa_poka_yoke_5000.png',
    hash_sha256: '990607896f09c2b368daa07292601cb50960ee6a071779481a3f7883e872d632',
    tipo_documento: 'NOTA_MANUSCRITA',
    texto_ocr:
      'NOTA DE COMPRA S/N | Proveedor: [NOMBRE_01]\nCompras varios materiales calzado taller (sin detalle de unidades) -> TOTAL: S/ 5.0OO.00 (OCR: 0.79)',
    laplaciano_1600px: 28,
    perdida_detalle_texto: 0.385,
    contraste: 34,
    semaforo_esperado: 'AMARILLO',
    datos_tapados_resumen: '1 tapado (1 proveedor)',
    hallazgo_demostrado: 'FLAG_BAJA_CONFIANZA_OCR_POKA_YOKE + FLAG_MONTO_REDONDO_SIN_DESGLOSE (Excluido de provisión SBS)',
  },
  {
    id: 'DOC-WAL-006',
    label: '6. Voucher Yape (S/ 870 · Op tapada + Comisión S/ 0.00)',
    nombre_archivo: 'DOC-WAL-006_voucher_yape_870.png',
    hash_sha256: '59f7646860618bb269e1d20504f8fb253cd5537398a281f11483259777e3ef88',
    tipo_documento: 'VOUCHER_YAPE',
    texto_ocr:
      '4:18 p. m. | 4G 84%\nyape | Yapeaste! | S/ 870.00 | [DESTINATARIO_01] | 12 nov. 2026 - 04:18 p. m.\nMensaje del pago: pago 4 tr aparado + 3 gal pegamento amarillo\nCelular destino | [CELULAR_01] | [CELULAR_02] | N° de operación | [NUM_OPERACION_01] | Comisión | S/ 0.00 (Gratis) (OCR: 1.00)',
    laplaciano_1600px: 363,
    perdida_detalle_texto: 0.022,
    contraste: 68,
    semaforo_esperado: 'VERDE',
    datos_tapados_resumen: '4 tapados (1 destinatario, 2 celular, 1 N° operación)',
    hallazgo_demostrado: 'Computa S/ 870.00 (ignora Comisión S/ 0.00) y extrae 2 ítems de la glosa (TAREA + GALON)',
  },
  {
    id: 'DOC-WAL-007',
    label: '7. Voucher Plin (S/ 1,240 · 3 ítems en glosa · VERDE)',
    nombre_archivo: 'DOC-WAL-007_voucher_plin_1240.png',
    hash_sha256: 'cbf845c5f7ff6cbea1a5c3fa0a51051ded9889ecff719ecc2ed71b896d822336',
    tipo_documento: 'VOUCHER_PLIN',
    texto_ocr:
      '06:45 a. m. | PLIN | Transferencia Exitosa | S/ 1,240.00 | [DESTINATARIO_01] | 13/11/2026 06:45 AM\nGlosa: 30 arr papa yungay + 15 jaba tomate + 1 flete hermelinda\nCelular | [CELULAR_01] | Operación | [NUM_OPERACION_01] (OCR: 0.99)',
    laplaciano_1600px: 386,
    perdida_detalle_texto: 0.024,
    contraste: 69,
    semaforo_esperado: 'VERDE',
    datos_tapados_resumen: '3 tapados (1 destinatario, 1 celular, 1 operación)',
    hallazgo_demostrado: 'Computa S/ 1,240.00 y extrae 3 ítems de la glosa (ARROBA, JABA, VIAJE_FLETE)',
  },
] as const;

export function getCiiuLabel(code: string): string {
  const match = CIIU_CATALOG.find((item) => item.codigo === code);
  return match ? `${match.codigo} — ${match.nombre}` : `CIIU ${code}`;
}
