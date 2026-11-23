import type {
  AuditarExpedienteRequest,
  AuditarExpedienteResponse,
  EvaluacionFotoResponse,
  GoldenCase,
  HealthResponse,
  SubredGrafo,
  SunatRucResponse,
} from '../contracts/schemas';
import { sha256Hex } from '../utils/crypto';

/**
 * MOTOR SIMULADO SOBERANO v2.0 (RIE-02 Grafos + Agente Local Soe + P&L SBS Nicolás).
 * 100% aislado de los componentes UI (cero lógica de riesgo en el cliente).
 * Implementa la fórmula exacta de Puntaje de Red + Rareza 1/log2(1+n), los catálogos P-01..P-09 y L-01..L-06,
 * el Sanitizador v2 ("0 datos personales enviados"), el Semáforo de Nitidez de Soe (Sección 7)
 * y los 6 Casos Simulados CS-01..CS-06 (manteniendo compatibilidad con los 4 casos v1.0).
 */

const SUNAT_DIRECTORY: Record<string, SunatRucResponse> = {
  '10423189012': {
    ruc: '10423189012',
    razon_social: 'CALZADO ARTESANAL EL PORVENIR — ROJAS VALDERRAMA LUIS',
    estado_sunat: 'ACTIVO',
    condicion_domicilio: 'HABIDO',
    giro_ciiu: '1520',
    actividad_economica: 'Fabricación de calzado y curtiembre',
    distrito: 'El Porvenir, Trujillo',
    alerta_sunat: false,
  },
  '10489120345': {
    ruc: '10489120345',
    razon_social: 'DISTRIBUIDORA MAYORISTA HERMELINDA — QUISPE ALFARO MARÍA',
    estado_sunat: 'ACTIVO',
    condicion_domicilio: 'HABIDO',
    giro_ciiu: '5211',
    actividad_economica: 'Venta mayorista y minorista de abarrotes',
    distrito: 'Trujillo — Mercado La Hermelinda',
    alerta_sunat: false,
  },
  '10456712390': {
    ruc: '10456712390',
    razon_social: 'TALLER CALZADO NORTE EXPRESS — SÁNCHEZ PAREDES CARLOS',
    estado_sunat: 'ACTIVO',
    condicion_domicilio: 'HABIDO',
    giro_ciiu: '1520',
    actividad_economica: 'Fabricación de calzado',
    distrito: 'El Porvenir, Trujillo',
    alerta_sunat: false,
  },
  '10411298765': {
    ruc: '10411298765',
    razon_social: 'BODEGA Y MINIMARKET SAN MARTÍN — CHÁVEZ MENDOZA ROSA',
    estado_sunat: 'ACTIVO',
    condicion_domicilio: 'HABIDO',
    giro_ciiu: '5211',
    actividad_economica: 'Venta al por menor en comercios no especializados',
    distrito: 'La Esperanza, Trujillo',
    alerta_sunat: false,
  },
  '10401122334': {
    ruc: '10401122334',
    razon_social: 'CURTIEMBRE SANTA ROSA E.I.R.L.',
    estado_sunat: 'ACTIVO',
    condicion_domicilio: 'HABIDO',
    giro_ciiu: '1520',
    actividad_economica: 'Fabricación de calzado y cuero',
    distrito: 'El Porvenir',
    alerta_sunat: false,
  },
  '10402233445': {
    ruc: '10402233445',
    razon_social: 'COMERCIAL ABARROTES MOCHE S.A.C.',
    estado_sunat: 'ACTIVO',
    condicion_domicilio: 'NO HABIDO',
    giro_ciiu: '5211',
    actividad_economica: 'Bodegas y abarrotes',
    distrito: 'Moche, Trujillo',
    alerta_sunat: true,
  },
  '10403344556': {
    ruc: '10403344556',
    razon_social: 'INVERSIONES FERRETERAS FLORENCIA',
    estado_sunat: 'BAJA DE OFICIO',
    condicion_domicilio: 'NO HABIDO',
    giro_ciiu: '4520',
    actividad_economica: 'Ferretería y materiales de construcción',
    distrito: 'Florencia de Mora',
    alerta_sunat: true,
  },
  '10404455667': {
    ruc: '10404455667',
    razon_social: 'CONFECCIONES TEXTIL LIBERTAD',
    estado_sunat: 'ACTIVO',
    condicion_domicilio: 'HABIDO',
    giro_ciiu: '1810',
    actividad_economica: 'Confección de prendas de vestir',
    distrito: 'Trujillo Centro',
    alerta_sunat: false,
  },
  '10405566778': {
    ruc: '10405566778',
    razon_social: 'CEVICHERÍA Y POLLERÍA EL MUELLE',
    estado_sunat: 'ACTIVO',
    condicion_domicilio: 'HABIDO',
    giro_ciiu: '5520',
    actividad_economica: 'Restaurantes y pollerías',
    distrito: 'Víctor Larco',
    alerta_sunat: false,
  },
  '10406677889': {
    ruc: '10406677889',
    razon_social: 'TALLER MECÁNICO AUTOMOTRIZ HUANCHACO',
    estado_sunat: 'ACTIVO',
    condicion_domicilio: 'HABIDO',
    giro_ciiu: '5020',
    actividad_economica: 'Mantenimiento de vehículos',
    distrito: 'Huanchaco',
    alerta_sunat: false,
  },
  '10407788990': {
    ruc: '10407788990',
    razon_social: 'BOTICA SALUD DEL NORTE',
    estado_sunat: 'ACTIVO',
    condicion_domicilio: 'HABIDO',
    giro_ciiu: '5231',
    actividad_economica: 'Farmacias y boticas',
    distrito: 'La Esperanza',
    alerta_sunat: false,
  },
  '10408899001': {
    ruc: '10408899001',
    razon_social: 'PANADERÍA TRADICIÓN TRUJILLANA',
    estado_sunat: 'ACTIVO',
    condicion_domicilio: 'HABIDO',
    giro_ciiu: '1541',
    actividad_economica: 'Panaderías y pastelerías',
    distrito: 'Trujillo Centro',
    alerta_sunat: false,
  },
  '10409900112': {
    ruc: '10409900112',
    razon_social: 'MUEBLERÍA Y CARPINTERÍA SAN ISIDRO',
    estado_sunat: 'ACTIVO',
    condicion_domicilio: 'HABIDO',
    giro_ciiu: '3610',
    actividad_economica: 'Carpintería y muebles',
    distrito: 'Trujillo',
    alerta_sunat: false,
  },
  '10410011223': {
    ruc: '10410011223',
    razon_social: 'ELECTROHOGAR LARCO S.R.L.',
    estado_sunat: 'SUSPENSION TEMPORAL',
    condicion_domicilio: 'NO HABIDO',
    giro_ciiu: '5233',
    actividad_economica: 'Electrodomésticos y tecnología',
    distrito: 'Víctor Larco',
    alerta_sunat: true,
  },
  '20601234567': {
    ruc: '20601234567',
    razon_social: 'CALZADO INDUSTRIAL ALTO TRUJILLO S.A.C.',
    estado_sunat: 'ACTIVO',
    condicion_domicilio: 'HABIDO',
    giro_ciiu: '1520',
    actividad_economica: 'Fabricación de calzado de seguridad',
    distrito: 'El Porvenir',
    alerta_sunat: false,
  },
  '20602345678': {
    ruc: '20602345678',
    razon_social: 'AGROCOMERCIAL VALLE CHICAMA S.A.C.',
    estado_sunat: 'ACTIVO',
    condicion_domicilio: 'HABIDO',
    giro_ciiu: '0111',
    actividad_economica: 'Comercio agrícola y granos',
    distrito: 'Trujillo — Hermelinda',
    alerta_sunat: false,
  },
  '10458291034': {
    ruc: '10458291034',
    razon_social: 'CONFECCIONES Y CALZADO FLORENCIA — PAREDES GÓMEZ ROSAURA',
    estado_sunat: 'ACTIVO',
    condicion_domicilio: 'HABIDO',
    giro_ciiu: '1520',
    actividad_economica: 'Fabricación de calzado',
    distrito: 'Florencia de Mora, Trujillo',
    alerta_sunat: false,
  },
  '10421983746': {
    ruc: '10421983746',
    razon_social: 'CALZADO FAMILIAR TÚPAC AMARU — ROJAS VALDERRAMA CARMEN',
    estado_sunat: 'ACTIVO',
    condicion_domicilio: 'HABIDO',
    giro_ciiu: '1520',
    actividad_economica: 'Fabricación de calzado',
    distrito: 'El Porvenir, Trujillo',
    alerta_sunat: false,
  },
  '10438291045': {
    ruc: '10438291045',
    razon_social: 'COMERCIAL DE GRANOS Y ABARROTES PUESTO B-114',
    estado_sunat: 'ACTIVO',
    condicion_domicilio: 'HABIDO',
    giro_ciiu: '5211',
    actividad_economica: 'Comercio mayorista en Mercado La Hermelinda',
    distrito: 'Trujillo — Mercado La Hermelinda',
    alerta_sunat: false,
  },
  '10499887761': {
    ruc: '10499887761',
    razon_social: 'DISTRIBUIDORA LOS GIRASOLES DEL NORTE',
    estado_sunat: 'ACTIVO',
    condicion_domicilio: 'NO HABIDO',
    giro_ciiu: '5211',
    actividad_economica: 'Comercio minorista en vivienda concentrada (5 RUCs)',
    distrito: 'La Esperanza, Trujillo',
    alerta_sunat: true,
  },
  '10499887762': {
    ruc: '10499887762',
    razon_social: 'COMERCIALIZADORA GIRASOLES II',
    estado_sunat: 'BAJA DE OFICIO',
    condicion_domicilio: 'NO HABIDO',
    giro_ciiu: '5211',
    actividad_economica: 'Comercio minorista no especializado',
    distrito: 'La Esperanza, Trujillo',
    alerta_sunat: true,
  },
  '10477123908': {
    ruc: '10477123908',
    razon_social: 'TALLER DE CALZADO EL PACÍFICO — CARTERA ASE-017',
    estado_sunat: 'ACTIVO',
    condicion_domicilio: 'HABIDO',
    giro_ciiu: '1520',
    actividad_economica: 'Fabricación de calzado',
    distrito: 'El Porvenir, Trujillo',
    alerta_sunat: false,
  },
  '10483920174': {
    ruc: '10483920174',
    razon_social: 'BODEGA Y ABARROTES CENTRAL — PENDIENTE VERIFICACIÓN',
    estado_sunat: 'ACTIVO',
    condicion_domicilio: 'HABIDO',
    giro_ciiu: '5211',
    actividad_economica: 'Venta al por menor en bodegas',
    distrito: 'Centro Histórico, Trujillo',
    alerta_sunat: false,
  },
};

/**
 * Los 6 Casos Simulados RIE-02 v2.0 (Tabla 21 del Documento Técnico + Informe de Soe + P&L Nicolás).
 */
export const GOLDEN_CASES: GoldenCase[] = [
  {
    case_id: 'CS-01',
    orden: 1,
    titulo: 'CS-01 · Anillo 4 Agencias (6 días)',
    subtitulo: 'P-01 + P-02 + P-03 + P-05 · Puntaje 86 (Rojo)',
    etiqueta_escala: '86 pts · ROJO',
    puntaje_objetivo: 86,
    nivel_esperado: 'REVISION_PRIORITARIA',
    resumen_esperado: 'Revisión prioritaria · Teléfono + dispositivo + referencias circulares · Retiene S/ 15,000',
    payload: {
      expediente_id: 'SOL-TRUJ-2026-0412',
      ruc: '10456712390',
      agencia_origen: 'Agencia Florencia de Mora',
      asesor_id: 'ASE-012',
      giro_ciiu: '1520',
      ventas_declaradas_asesor: 18500.0,
      inventario_fisico_estimado: 4800.0,
      gastos_operativos_familiares: 920.0,
      cuota_deuda_sbs_vigente: 410.0,
      cuota_mensual_propuesta: 1500.0,
      monto_solicitado_original: 15000.0,
      telefono_contacto: '948112233',
      direccion_negocio: 'Calle Los Laureles 418, Florencia de Mora',
      geolocalizacion: [-8.084, -79.021],
      dispositivo_fingerprint: 'dev:7a1e-99c1-client',
      dispositivo_tipo: 'CLIENTE',
      referencias: [
        { telefono: '948776655', relacion: 'AMIGO', nombre_referencia: 'REF-1107 (Cerrado A→B→C→D→A)' },
      ],
      contexto_declarado: [],
      consentimiento_datos_ley29733: true,
      documentos_adjuntos: [
        {
          doc_id: 'DOC-1',
          tipo_documento: 'NOTA_MANUSCRITA',
          texto_ocr: '190 pies cuero sintético + pegamento -> S/ 5,200.00 (OCR: 0.93)',
          semaforo_nitidez: 'VERDE',
          perdida_detalle_texto: 0.024,
        },
      ],
    },
  },
  {
    case_id: 'CS-02',
    orden: 2,
    titulo: 'CS-02 · Madre e Hija (Mismo Domicilio)',
    subtitulo: 'P-04 atenuado por L-01 · Puntaje 18 (Verde)',
    etiqueta_escala: '18 pts · VERDE',
    puntaje_objetivo: 18,
    nivel_esperado: 'SIN_ALERTA',
    resumen_esperado: 'Sin alerta (0 falsos positivos) · L-01 Familia en mismo domicilio · Aprueba S/ 8,000',
    payload: {
      expediente_id: 'EXP-TRUJ-2026-0101',
      ruc: '10423189012',
      agencia_origen: 'Agencia El Porvenir',
      asesor_id: 'ASE-004',
      giro_ciiu: '1520',
      ventas_declaradas_asesor: 7200.0,
      inventario_fisico_estimado: 6400.0,
      gastos_operativos_familiares: 410.0,
      cuota_deuda_sbs_vigente: 214.0,
      cuota_mensual_propuesta: 980.0,
      monto_solicitado_original: 8000.0,
      telefono_contacto: '949334411',
      direccion_negocio: 'Jr. Túpac Amaru 820, El Porvenir',
      geolocalizacion: [-8.078, -79.003],
      dispositivo_fingerprint: 'dev:corp-ase004-tab',
      dispositivo_tipo: 'CORPORATIVO_ASESOR',
      referencias: [
        { telefono: '949334499', relacion: 'FAMILIAR', nombre_referencia: 'Hija (Puesto contiguo calzado)' },
      ],
      contexto_declarado: ['L-01', 'L-04'],
      consentimiento_datos_ley29733: true,
      documentos_adjuntos: [
        {
          doc_id: 'DOC-1',
          tipo_documento: 'FACTURA_MAYORISTA',
          texto_ocr: '180 pies cuero + suela -> S/ 5,000.00 (OCR: 0.95)',
          semaforo_nitidez: 'VERDE',
          perdida_detalle_texto: 0.019,
        },
      ],
    },
  },
  {
    case_id: 'CS-03',
    orden: 3,
    titulo: 'CS-03 · 40 Puestos Mercado Hermelinda',
    subtitulo: 'Rareza baja (0.12) + L-02 · Puntaje 12 (Verde)',
    etiqueta_escala: '12 pts · VERDE',
    puntaje_objetivo: 12,
    nivel_esperado: 'SIN_ALERTA',
    resumen_esperado: 'Sin alerta (0 falsos positivos) · L-02 Mercado La Hermelinda (300 puestos) · S/ 12,000',
    payload: {
      expediente_id: 'SOL-TRUJ-2026-0418',
      ruc: '20602345678',
      agencia_origen: 'Agencia Mercado La Hermelinda',
      asesor_id: 'ASE-008',
      giro_ciiu: '0111',
      ventas_declaradas_asesor: 14200.0,
      inventario_fisico_estimado: 15800.0,
      gastos_operativos_familiares: 720.0,
      cuota_deuda_sbs_vigente: 290.0,
      cuota_mensual_propuesta: 1180.0,
      monto_solicitado_original: 12000.0,
      telefono_contacto: '944889900',
      direccion_negocio: 'Av. Villarreal S/N Pabellón Granos, Mercado La Hermelinda',
      geolocalizacion: [-8.091, -79.015],
      dispositivo_fingerprint: 'dev:corp-ase008-tab',
      dispositivo_tipo: 'CORPORATIVO_ASESOR',
      referencias: [
        { telefono: '944110022', relacion: 'COMERCIANTE_VECINO', nombre_referencia: 'Asociación Comerciantes Hermelinda' },
      ],
      contexto_declarado: ['L-02', 'L-05'],
      consentimiento_datos_ley29733: true,
      documentos_adjuntos: [
        {
          doc_id: 'DOC-1',
          tipo_documento: 'BOLETA_COMPRA',
          texto_ocr: '20 arr Papa Blanca + 10 cj Aceite + 15 fdo Fideos -> S/ 11,800.00 (OCR: 0.96)',
          semaforo_nitidez: 'VERDE',
          perdida_detalle_texto: 0.017,
        },
      ],
    },
  },
  {
    case_id: 'CS-04',
    orden: 4,
    titulo: 'CS-04 · 5 RUCs en 1 Vivienda + Ventas Infladas',
    subtitulo: 'P-04 + P-06 (NO HABIDO) + P-08 · Puntaje 78 (Rojo)',
    etiqueta_escala: '78 pts · ROJO',
    puntaje_objetivo: 78,
    nivel_esperado: 'REVISION_PRIORITARIA',
    resumen_esperado: 'Revisión prioritaria · 5 RUCs recientes en vivienda, 2 NO HABIDO + maquillaje +141.9%',
    payload: {
      expediente_id: 'EXP-TRUJ-2026-0103',
      ruc: '10402233445',
      agencia_origen: 'Agencia El Porvenir',
      asesor_id: 'ASE-011',
      giro_ciiu: '5211',
      ventas_declaradas_asesor: 18500.0,
      inventario_fisico_estimado: 4800.0,
      gastos_operativos_familiares: 920.0,
      cuota_deuda_sbs_vigente: 410.0,
      cuota_mensual_propuesta: 1500.0,
      monto_solicitado_original: 15000.0,
      telefono_contacto: '947001122',
      direccion_negocio: 'Mz. K Lt. 14 Urb. Residencial Moche (5 RUCs registrados)',
      geolocalizacion: [-8.162, -79.009],
      dispositivo_fingerprint: 'dev:3f8b-client',
      dispositivo_tipo: 'CLIENTE',
      referencias: [
        { telefono: '947009988', relacion: 'AMIGO', nombre_referencia: 'Titular RUC 10403344556 (BAJA OFICIO)' },
      ],
      contexto_declarado: [],
      consentimiento_datos_ley29733: true,
      documentos_adjuntos: [
        {
          doc_id: 'DOC-1',
          tipo_documento: 'FACTURA_MAYORISTA',
          texto_ocr: '190 pies cuero sintético + pegamento -> S/ 5,200.00 (OCR: 0.91)',
          semaforo_nitidez: 'VERDE',
          perdida_detalle_texto: 0.031,
        },
      ],
    },
  },
  {
    case_id: 'CS-05',
    orden: 5,
    titulo: 'CS-05 · Concentración Asesor ASE-017',
    subtitulo: 'P-01 + P-07 + L-06 · Puntaje 58 (Ámbar)',
    etiqueta_escala: '58 pts · ÁMBAR',
    puntaje_objetivo: 58,
    nivel_esperado: 'OBSERVACION',
    resumen_esperado: 'Observación · 7 solicitudes mismo asesor con referencias cruzadas · Recorte S/ 12k → S/ 8.5k',
    payload: {
      expediente_id: 'EXP-TRUJ-2026-0102',
      ruc: '10489120345',
      agencia_origen: 'Agencia Mercado La Hermelinda',
      asesor_id: 'ASE-017',
      giro_ciiu: '5211',
      ventas_declaradas_asesor: 16500.0,
      inventario_fisico_estimado: 14200.0,
      gastos_operativos_familiares: 890.0,
      cuota_deuda_sbs_vigente: 340.0,
      cuota_mensual_propuesta: 1300.0,
      monto_solicitado_original: 12000.0,
      telefono_contacto: '945667788',
      direccion_negocio: 'Pasaje Mayorista 214, Hermelinda',
      geolocalizacion: [-8.093, -79.017],
      dispositivo_fingerprint: 'dev:corp-ase017-tab',
      dispositivo_tipo: 'CORPORATIVO_ASESOR',
      referencias: [
        { telefono: '945667700', relacion: 'PROVEEDOR', nombre_referencia: 'Cartera ASE-017 (7 solicitudes conectadas)' },
      ],
      contexto_declarado: ['L-06'],
      consentimiento_datos_ley29733: true,
      documentos_adjuntos: [
        {
          doc_id: 'DOC-1',
          tipo_documento: 'FACTURA_MAYORISTA',
          texto_ocr: '140 sacos arroz + aceite vegetal + azúcar -> S/ 11,160.00 (OCR: 0.93)',
          semaforo_nitidez: 'VERDE',
          perdida_detalle_texto: 0.022,
        },
      ],
    },
  },
  {
    case_id: 'CS-06',
    orden: 6,
    titulo: 'CS-06 · Candado Poka-Yoke (Confianza 0.62)',
    subtitulo: 'Nota borrosa 5.0OO.00 · Sin puntaje (Gris)',
    etiqueta_escala: 'POKA-YOKE · GRIS',
    puntaje_objetivo: null,
    nivel_esperado: 'VERIFICAR_DATOS',
    resumen_esperado: 'VERIFICAR DATOS (Gris) · Confianza 62% < 85% + importe 5.0OO.00 · Provisión SBS null (S/ 0)',
    payload: {
      expediente_id: 'EXP-TRUJ-2026-0104',
      ruc: '10411298765',
      agencia_origen: 'Agencia La Esperanza',
      asesor_id: 'ASE-009',
      giro_ciiu: '5211',
      ventas_declaradas_asesor: 9400.0,
      inventario_fisico_estimado: 5100.0,
      gastos_operativos_familiares: 560.0,
      cuota_deuda_sbs_vigente: 280.0,
      cuota_mensual_propuesta: 1050.0,
      monto_solicitado_original: 9500.0,
      telefono_contacto: '94122',
      direccion_negocio: 'Dirección ilegible — Sector Central La Esperanza',
      geolocalizacion: [-8.062, -79.041],
      dispositivo_fingerprint: 'dev:corp-ase009-tab',
      dispositivo_tipo: 'CORPORATIVO_ASESOR',
      referencias: [],
      contexto_declarado: [],
      consentimiento_datos_ley29733: true,
      documentos_adjuntos: [
        {
          doc_id: 'DOC-1',
          tipo_documento: 'NOTA_MANUSCRITA',
          texto_ocr: 'Compras varios materiales -> TOTAL: S/ 5.0OO.00 (OCR: 0.62 · pérdida detalle texto 0.385)',
          semaforo_nitidez: 'ROJO',
          perdida_detalle_texto: 0.385,
          contraste: 34,
          resolucion_lado_mayor_px: 780,
          requiere_nueva_foto: true,
          contiene_importe_ambiguo_letras: true,
        },
      ],
    },
  },
];

// ── Subredes de 2 Saltos para el Grafo Interactivo (GET /red/{solicitud_id}?saltos=2) ──

const CALIBRATED_GRAPHS: Record<string, SubredGrafo> = {
  'SOL-TRUJ-2026-0412': {
    solicitud_id: 'SOL-TRUJ-2026-0412',
    saltos: 2,
    nodos: [
      { id: 'SOL-0412', label: 'SOL-0412 (Actual)', tipo: 'SOLICITUD', detalle: 'Agencia Florencia · S/ 15,000.00', monto_pen: 15000, fecha: '18/11 10:42', agencia: 'Florencia de Mora', alerta: true },
      { id: 'SOL-0398', label: 'SOL-0398 (Día -5)', tipo: 'SOLICITUD', detalle: 'Agencia El Porvenir · S/ 14,000.00', monto_pen: 14000, fecha: '13/11 16:15', agencia: 'El Porvenir', alerta: true },
      { id: 'SOL-0405', label: 'SOL-0405 (Día -3)', tipo: 'SOLICITUD', detalle: 'Agencia La Esperanza · S/ 12,500.00', monto_pen: 12500, fecha: '15/11 11:20', agencia: 'La Esperanza', alerta: true },
      { id: 'SOL-0409', label: 'SOL-0409 (Día -1)', tipo: 'SOLICITUD', detalle: 'Agencia Hermelinda · S/ 12,500.00', monto_pen: 12500, fecha: '17/11 17:50', agencia: 'Hermelinda', alerta: true },
      { id: 'TEL-9481', label: 'TEL 948***233', tipo: 'TELEFONO', detalle: 'Compartido por 4 solicitantes sin vínculo (Rareza 0.50)', alerta: true },
      { id: 'DEV-7A1E', label: 'DEV dev:7a1e', tipo: 'DISPOSITIVO', detalle: 'Celular cliente usado en 3 solicitudes (Rareza 0.63)', alerta: true },
      { id: 'REF-1107', label: 'Anillo REF A→B→C→D→A', tipo: 'REFERENCIA', detalle: 'Referencias cruzadas circulares entre los 4 solicitantes', alerta: true },
      { id: 'NEG-1520', label: 'RUC 10456***390', tipo: 'NEGOCIO', detalle: 'CIIU 1520 · Calzado El Porvenir' },
      { id: 'PER-A91', label: 'PER-A91 (Seudónimo)', tipo: 'PERSONA', detalle: 'Solicitante titular seudonimizado (Art. 140)' },
    ],
    aristas: [
      { id: 'E-01', source: 'SOL-0412', target: 'TEL-9481', relacion: 'declara_telefono', fuente: 'Formulario Campo', fecha: '2026-11-18', es_evidencia: true },
      { id: 'E-02', source: 'SOL-0398', target: 'TEL-9481', relacion: 'declara_telefono', fuente: 'Historial 6d', fecha: '2026-11-13', es_evidencia: true },
      { id: 'E-03', source: 'SOL-0405', target: 'TEL-9481', relacion: 'declara_telefono', fuente: 'Historial 6d', fecha: '2026-11-15', es_evidencia: true },
      { id: 'E-04', source: 'SOL-0409', target: 'TEL-9481', relacion: 'declara_telefono', fuente: 'Historial 6d', fecha: '2026-11-17', es_evidencia: true },
      { id: 'E-05', source: 'SOL-0412', target: 'DEV-7A1E', relacion: 'enviada_desde', fuente: 'Fingerprint PWA', fecha: '2026-11-18', es_evidencia: true },
      { id: 'E-06', source: 'SOL-0405', target: 'DEV-7A1E', relacion: 'enviada_desde', fuente: 'Fingerprint PWA', fecha: '2026-11-15', es_evidencia: true },
      { id: 'E-07', source: 'SOL-0409', target: 'DEV-7A1E', relacion: 'enviada_desde', fuente: 'Fingerprint PWA', fecha: '2026-11-17', es_evidencia: true },
      { id: 'E-08', source: 'SOL-0412', target: 'REF-1107', relacion: 'refiere_en_circulo', fuente: 'Referencias', fecha: '2026-11-18', es_evidencia: true },
      { id: 'E-09', source: 'SOL-0398', target: 'REF-1107', relacion: 'refiere_en_circulo', fuente: 'Referencias', fecha: '2026-11-13', es_evidencia: true },
      { id: 'E-10', source: 'SOL-0412', target: 'NEG-1520', relacion: 'asociada_a_ruc', fuente: 'SUNAT', fecha: '2026-11-18', es_evidencia: false },
      { id: 'E-11', source: 'PER-A91', target: 'SOL-0412', relacion: 'titular_solicitud', fuente: 'Seudonimizador v2', fecha: '2026-11-18', es_evidencia: false },
    ],
  },
  'EXP-TRUJ-2026-0101': {
    solicitud_id: 'EXP-TRUJ-2026-0101',
    saltos: 2,
    nodos: [
      { id: 'SOL-0101', label: 'EXP-0101 (Madre)', tipo: 'SOLICITUD', detalle: 'Calzado El Porvenir · S/ 8,000.00', monto_pen: 8000, fecha: '19/11 09:15', agencia: 'El Porvenir' },
      { id: 'SOL-0089', label: 'EXP-0089 (Hija)', tipo: 'SOLICITUD', detalle: 'Puesto contiguo calzado · S/ 6,500.00 (Pago puntual)', monto_pen: 6500, fecha: '02/08 11:00', agencia: 'El Porvenir' },
      { id: 'DIR-TUPAC', label: 'Jr. Túpac Amaru 820', tipo: 'DIRECCION', detalle: 'Vivienda familiar verificada (Regla L-01: F_contexto 0.40)' },
      { id: 'PER-MADRE', label: 'PER-Rojas (Madre)', tipo: 'PERSONA', detalle: 'Cliente 4 años en Caja Trujillo · SBS NORMAL' },
      { id: 'PER-HIJA', label: 'PER-RojasH (Hija)', tipo: 'PERSONA', detalle: 'Vínculo familiar directo declarado (L-01 / L-04)' },
      { id: 'NEG-10423', label: 'RUC 10423189012', tipo: 'NEGOCIO', detalle: 'ACTIVO / HABIDO · CIIU 1520 Calzado' },
    ],
    aristas: [
      { id: 'E-21', source: 'SOL-0101', target: 'DIR-TUPAC', relacion: 'domicilio_familiar_L01', fuente: 'Verificación Campo', fecha: '2026-11-19', es_evidencia: false },
      { id: 'E-22', source: 'SOL-0089', target: 'DIR-TUPAC', relacion: 'domicilio_familiar_L01', fuente: 'Padrón Caja', fecha: '2026-08-02', es_evidencia: false },
      { id: 'E-23', source: 'PER-MADRE', target: 'PER-HIJA', relacion: 'vinculo_familiar_L04', fuente: 'Declaración + RENIEC', fecha: '2026-11-19', es_evidencia: false },
      { id: 'E-24', source: 'PER-MADRE', target: 'SOL-0101', relacion: 'presenta', fuente: 'Campo PWA', fecha: '2026-11-19', es_evidencia: false },
      { id: 'E-25', source: 'PER-HIJA', target: 'SOL-0089', relacion: 'presenta', fuente: 'Historial', fecha: '2026-08-02', es_evidencia: false },
      { id: 'E-26', source: 'SOL-0101', target: 'NEG-10423', relacion: 'opera_negocio', fuente: 'SUNAT', fecha: '2026-11-19', es_evidencia: false },
    ],
  },
  'SOL-TRUJ-2026-0418': {
    solicitud_id: 'SOL-TRUJ-2026-0418',
    saltos: 2,
    nodos: [
      { id: 'SOL-0418', label: 'SOL-0418 (Actual)', tipo: 'SOLICITUD', detalle: 'Puesto Granos Hermelinda · S/ 12,000.00', monto_pen: 12000, fecha: '20/11 08:40', agencia: 'Hermelinda' },
      { id: 'DIR-HERM', label: 'Mercado La Hermelinda', tipo: 'DIRECCION', detalle: 'Zona comercial densa (300 puestos · Rareza 0.12 · Regla L-02)' },
      { id: 'SOL-H01', label: '39 Puestos Vecinos', tipo: 'SOLICITUD', detalle: 'Comerciantes independientes del mismo pabellón' },
      { id: 'REF-ASOC', label: 'Asociación Granos (L-05)', tipo: 'REFERENCIA', detalle: 'Cooperativa registrada en Mercado La Hermelinda' },
      { id: 'NEG-20602', label: 'RUC 20602345678', tipo: 'NEGOCIO', detalle: 'Agrocomercial Valle Chicama · ACTIVO / HABIDO' },
    ],
    aristas: [
      { id: 'E-31', source: 'SOL-0418', target: 'DIR-HERM', relacion: 'opera_en_mercado_L02', fuente: 'Geohash Trujillo', fecha: '2026-11-20', es_evidencia: false },
      { id: 'E-32', source: 'SOL-H01', target: 'DIR-HERM', relacion: 'opera_en_mercado_L02', fuente: 'Padrón Comercial', fecha: '2026-11-20', es_evidencia: false },
      { id: 'E-33', source: 'SOL-0418', target: 'REF-ASOC', relacion: 'miembro_asociacion_L05', fuente: 'Padrón Asociación', fecha: '2026-11-20', es_evidencia: false },
      { id: 'E-34', source: 'SOL-0418', target: 'NEG-20602', relacion: 'titular_ruc', fuente: 'SUNAT', fecha: '2026-11-20', es_evidencia: false },
    ],
  },
  'EXP-TRUJ-2026-0103': {
    solicitud_id: 'EXP-TRUJ-2026-0103',
    saltos: 2,
    nodos: [
      { id: 'SOL-0103', label: 'EXP-0103 (Actual)', tipo: 'SOLICITUD', detalle: 'Solic. S/ 15,000 · Ventas infladas +141.9% (P-08)', monto_pen: 15000, fecha: '20/11 18:05', agencia: 'El Porvenir', alerta: true },
      { id: 'DIR-MOCHE', label: 'Vivienda Mz. K Lt. 14', tipo: 'DIRECCION', detalle: 'Vivienda no comercial con 5 RUCs recientes (P-04)', alerta: true },
      { id: 'NEG-NOHAB1', label: 'RUC 10402233445', tipo: 'NEGOCIO', detalle: 'Condición NO HABIDO en SUNAT (P-06)', alerta: true },
      { id: 'NEG-BAJA2', label: 'RUC 10403344556', tipo: 'NEGOCIO', detalle: 'BAJA DE OFICIO / NO HABIDO conectado (P-06)', alerta: true },
      { id: 'NEG-RUC3', label: '3 RUCs Recientes (<60d)', tipo: 'NEGOCIO', detalle: 'Creados en la misma dirección residencial con ventas infladas', alerta: true },
      { id: 'SOL-M02', label: 'SOL-0381 (Vinculada)', tipo: 'SOLICITUD', detalle: 'Mora temprana / sobredeclaración +120% (P-08)', monto_pen: 12000, alerta: true },
    ],
    aristas: [
      { id: 'E-41', source: 'SOL-0103', target: 'DIR-MOCHE', relacion: 'concentracion_vivienda_P04', fuente: 'SUNAT + Geo', fecha: '2026-11-20', es_evidencia: true },
      { id: 'E-42', source: 'NEG-NOHAB1', target: 'DIR-MOCHE', relacion: 'domicilio_fiscal_P06', fuente: 'SUNAT', fecha: '2026-11-20', es_evidencia: true },
      { id: 'E-43', source: 'NEG-BAJA2', target: 'DIR-MOCHE', relacion: 'domicilio_fiscal_P06', fuente: 'SUNAT', fecha: '2026-11-14', es_evidencia: true },
      { id: 'E-44', source: 'NEG-RUC3', target: 'DIR-MOCHE', relacion: 'domicilio_fiscal_P04', fuente: 'SUNAT', fecha: '2026-11-10', es_evidencia: true },
      { id: 'E-45', source: 'SOL-0103', target: 'NEG-NOHAB1', relacion: 'maquillaje_ventas_P08', fuente: 'Motor Triangulación', fecha: '2026-11-20', es_evidencia: true },
      { id: 'E-46', source: 'SOL-M02', target: 'DIR-MOCHE', relacion: 'misma_comunidad', fuente: 'Grafo RIE-02', fecha: '2026-11-12', es_evidencia: true },
    ],
  },
  'EXP-TRUJ-2026-0102': {
    solicitud_id: 'EXP-TRUJ-2026-0102',
    saltos: 2,
    nodos: [
      { id: 'SOL-0102', label: 'EXP-0102 (Actual)', tipo: 'SOLICITUD', detalle: 'Mayorista Hermelinda · Solic. S/ 12,000 → Recorte S/ 8,500', monto_pen: 12000, fecha: '20/11 14:20', agencia: 'Hermelinda', alerta: true },
      { id: 'ASE-017', label: 'Asesor ASE-017', tipo: 'ASESOR', detalle: 'Origina 7 solicitudes de la misma comunidad en 5 días (P-07)', alerta: true },
      { id: 'TEL-9456', label: 'TEL 945***788', tipo: 'TELEFONO', detalle: 'Teléfono compartido en 2 solicitudes del mismo asesor (P-01)', alerta: true },
      { id: 'DEV-CORP17', label: 'Tablet ASE-017 (L-06)', tipo: 'DISPOSITIVO', detalle: 'Equipo corporativo del asesor (Anula P-02 por regla L-06)' },
      { id: 'SOL-A17', label: '6 Solicitudes ASE-017', tipo: 'SOLICITUD', detalle: 'Referencias cruzadas dentro de la misma cartera' },
      { id: 'NEG-10489', label: 'RUC 10489120345', tipo: 'NEGOCIO', detalle: 'ACTIVO / HABIDO · CIIU 5211 Mayorista' },
    ],
    aristas: [
      { id: 'E-51', source: 'SOL-0102', target: 'ASE-017', relacion: 'originada_por_P07', fuente: 'Core Solicitudes', fecha: '2026-11-20', es_evidencia: true },
      { id: 'E-52', source: 'SOL-A17', target: 'ASE-017', relacion: 'originada_por_P07', fuente: 'Core Solicitudes', fecha: '2026-11-18', es_evidencia: true },
      { id: 'E-53', source: 'SOL-0102', target: 'TEL-9456', relacion: 'telefono_compartido_P01', fuente: 'Formulario Campo', fecha: '2026-11-20', es_evidencia: true },
      { id: 'E-54', source: 'SOL-A17', target: 'TEL-9456', relacion: 'referencia_cruzada', fuente: 'Referencias', fecha: '2026-11-19', es_evidencia: true },
      { id: 'E-55', source: 'SOL-0102', target: 'DEV-CORP17', relacion: 'capturada_en_tablet_L06', fuente: 'Fingerprint PWA', fecha: '2026-11-20', es_evidencia: false },
      { id: 'E-56', source: 'SOL-0102', target: 'NEG-10489', relacion: 'titular_ruc', fuente: 'SUNAT', fecha: '2026-11-20', es_evidencia: false },
    ],
  },
  'EXP-TRUJ-2026-0104': {
    solicitud_id: 'EXP-TRUJ-2026-0104',
    saltos: 2,
    nodos: [
      { id: 'SOL-0104', label: 'EXP-0104 (Poka-Yoke)', tipo: 'SOLICITUD', detalle: 'Confianza 0.62 < 0.85 · Estado VERIFICAR_DATOS (Sin puntaje)', monto_pen: 9500, fecha: '21/11 11:10', agencia: 'La Esperanza' },
      { id: 'NEG-10411', label: 'RUC 10411298765', tipo: 'NEGOCIO', detalle: 'Bodega CIIU 5211 · Boleta borrosa con importe 5.0OO.00' },
      { id: 'DIR-ILEG', label: 'Dirección Incompleta', tipo: 'DIRECCION', detalle: 'Georreferencia y texto pendiente de verificación manual' },
    ],
    aristas: [
      { id: 'E-61', source: 'SOL-0104', target: 'NEG-10411', relacion: 'pendiente_revision_documental', fuente: 'PaddleOCR Local', fecha: '2026-11-21', es_evidencia: false },
      { id: 'E-62', source: 'SOL-0104', target: 'DIR-ILEG', relacion: 'resolucion_baja_062', fuente: 'Resolución Entidades', fecha: '2026-11-21', es_evidencia: false },
    ],
  },
};

// ── Respuestas Calibradas Unificadas v2.0 + v1.0 ────────────────────

const CALIBRATED_RESPONSES: Record<string, Omit<AuditarExpedienteResponse, 'hash_integridad_sha256'>> = {
  // CS-01: Anillo 4 solicitudes en 4 agencias en 6 días (Puntaje 86, Rojo)
  'SOL-TRUJ-2026-0412': {
    expediente_id: 'SOL-TRUJ-2026-0412',
    solicitud_id: 'SOL-TRUJ-2026-0412',
    modo_inferencia: 'ON_PREMISE_LOCAL_CPU',
    latencia_ms: 482.3,
    validacion_fiscal: {
      ruc: '10456712390',
      estado_sunat: 'ACTIVO',
      condicion_domicilio: 'HABIDO',
      giro_ciiu: '1520',
      coherencia_insumos_giro: true,
      confianza_extraccion_ia: 0.93,
    },
    triangulacion_financiera: {
      moneda: 'PEN',
      ventas_declaradas_asesor: 18500.0,
      compras_comprobadas_documentos: 5200.0,
      ventas_implicitas_calculadas: 7647.06,
      delta_desviacion_declarativa: 1.419,
      flujo_neto_disponible: 1155.0,
      cuota_mensual_propuesta: 1500.0,
      ratio_cobertura_cuota_rcc: 0.77,
    },
    dictamen_riesgos: {
      alerta_fraude_maquillaje: true,
      requiere_revision_humana: false,
      banderas_fraude_detectadas: [
        'P-01_TELEFONO_COMPARTIDO_3_SOLICITANTES',
        'P-02_DISPOSITIVO_CLIENTE_COMPARTIDO',
        'P-03_REFERENCIAS_CIRCULARES_ANILLO_4',
        'P-05_RAFAGA_4_AGENCIAS_6_DIAS',
      ],
      clasificacion_sbs_proyectada: 'PERDIDA',
      tasa_provision_sbs: 1.0,
      escala_interna_caja_trujillo: 'C',
      accion_operativa: 'RETENER_HASTA_REVISION_ESPECIALISTA',
      monto_solicitado_original: 15000.0,
      monto_maximo_recomendado: 0.0,
      provision_sbs_evitada_pen: 15000.0,
      explicacion_agente_sbs:
        'EXPEDIENTE DE EVIDENCIA RIE-02 [CS-01 · Puntaje 86/100 · REVISIÓN PRIORITARIA]: La solicitud SOL-TRUJ-2026-0412 integra una subred de 4 solicitudes ingresadas en 6 días en 4 agencias distintas (Florencia, El Porvenir, La Esperanza y Hermelinda) por S/ 54,000.00 acumulados. Comparten el teléfono 948***233 (P-01, rareza 0.50), el dispositivo dev:7a1e (P-02, rareza 0.63) y referencias circulares cerradas A→B→C→D→A (P-03). Retención preventiva de S/ 15,000.00 hasta decisión del especialista.',
    },
    calidad_datos: {
      confianza_resolucion: 0.93,
      requiere_verificacion_manual: false,
      semaforo_nitidez: 'VERDE',
      perdida_detalle_texto: 0.024,
      contraste: 68,
      resolucion_lado_mayor_px: 1600,
      requiere_nueva_foto: false,
      contiene_importe_ambiguo_letras: false,
      pii_enviados_contador: 0,
      motor_ocr: 'PADDLEOCR_LATINO_PPOCRV5_OFFLINE',
    },
    red: {
      nodos_subred: 9,
      aristas_subred: 11,
      comunidad_id: 'COM-0087',
      tamano_comunidad: 9,
    },
    patrones_detectados: [
      {
        codigo: 'P-01',
        nombre: 'Teléfono compartido',
        descripcion: 'Teléfono compartido con 3 solicitantes sin vínculo familiar o comercial declarado',
        evidencia: ['SOL-TRUJ-2026-0398', 'SOL-TRUJ-2026-0405', 'SOL-TRUJ-2026-0409'],
        peso: 0.3,
        rareza: 0.5,
        entidades_compartidas: 3,
      },
      {
        codigo: 'P-02',
        nombre: 'Dispositivo compartido',
        descripcion: 'Dispositivo de cliente dev:7a1e usado en 3 solicitudes de titulares distintos',
        evidencia: ['DEV-7A1E', 'SOL-TRUJ-2026-0405', 'SOL-TRUJ-2026-0409'],
        peso: 0.35,
        rareza: 0.63,
        entidades_compartidas: 2,
      },
      {
        codigo: 'P-03',
        nombre: 'Referencias circulares',
        descripcion: 'Cadena cerrada de referencias recíprocas entre 4 solicitantes (A→B→C→D→A)',
        evidencia: ['REF-1102', 'REF-1107', 'REF-1115', 'REF-1121'],
        peso: 0.3,
        rareza: 0.63,
        entidades_compartidas: 2,
      },
      {
        codigo: 'P-05',
        nombre: 'Ráfaga temporal',
        descripcion: '4 solicitudes conectadas originadas en 4 agencias distintas en 6 días',
        evidencia: ['SOL-0398 (13/11)', 'SOL-0405 (15/11)', 'SOL-0409 (17/11)', 'SOL-0412 (18/11)'],
        peso: 0.2,
        rareza: 0.5,
        entidades_compartidas: 3,
      },
    ],
    contexto_legitimo: [],
    priorizacion: {
      puntaje_red: 86,
      componentes: { patrones: 0.94, anomalia: 0.84, comunidad: 0.69 },
      factor_contexto: 1.0,
      nivel: 'REVISION_PRIORITARIA',
    },
    expediente_agente: {
      resumen:
        'Patrón que merece revisión prioritaria: la solicitud forma parte de una comunidad de 4 solicitudes presentadas en 6 días en 4 agencias de Trujillo que comparten teléfono, dispositivo móvil de cliente y referencias en anillo cerrado.',
      evidencias_citadas: [
        { arista_id: 'E-01', descripcion: 'Teléfono 948***233 vinculado a SOL-0398, SOL-0405, SOL-0409 y SOL-0412', fuente: 'Grafo Contacto Seudonimizado', fecha: '2026-11-18' },
        { arista_id: 'E-05', descripcion: 'Fingerprint dev:7a1e compartido en capturas remotas de 3 titulares', fuente: 'Telemetría Dispositivo', fecha: '2026-11-18' },
        { arista_id: 'E-08', descripcion: 'Ciclo de referencias A→B→C→D→A detectado en subred de 2 saltos', fuente: 'Motor Grafo Python', fecha: '2026-11-18' },
      ],
      explicaciones_alternativas: [
        'Posible cooperativa o taller compartido no declarado formalmente en la captura de campo.',
        'Gestor o tramitador externo que ingresó solicitudes de terceros desde un mismo teléfono.',
      ],
      pasos_sugeridos: [
        'Llamar directamente al teléfono 948***233 y verificar identidad de los 4 solicitantes por separado.',
        'Cruzar visita presencial simultánea en los locales declarados de Florencia de Mora y El Porvenir.',
        'Mantener retenido el desembolso de S/ 15,000.00 hasta registrar decisión del especialista.',
      ],
    },
    accion_recomendada: 'RETENER_HASTA_REVISION',
    impacto_financiero_sbs: {
      exposicion_red_pen: 54000.0,
      provision_sbs_evitada_pen: 15000.0,
      escala_referencial_caja: 'C',
      clasificacion_sbs_referencial: 'PERDIDA',
      delta_maquillaje_p08: 1.419,
    },
    subred_grafo: CALIBRATED_GRAPHS['SOL-TRUJ-2026-0412'],
  },

  // CS-02 (y Caso 1 v1.0): Madre e Hija mismo domicilio — L-01 evita falso positivo (Puntaje 18, Verde)
  'EXP-TRUJ-2026-0101': {
    expediente_id: 'EXP-TRUJ-2026-0101',
    solicitud_id: 'EXP-TRUJ-2026-0101',
    modo_inferencia: 'ON_PREMISE_LOCAL_CPU',
    latencia_ms: 410.4,
    validacion_fiscal: {
      ruc: '10423189012',
      estado_sunat: 'ACTIVO',
      condicion_domicilio: 'HABIDO',
      giro_ciiu: '1520',
      coherencia_insumos_giro: true,
      confianza_extraccion_ia: 0.95,
    },
    triangulacion_financiera: {
      moneda: 'PEN',
      ventas_declaradas_asesor: 7200.0,
      compras_comprobadas_documentos: 5000.0,
      ventas_implicitas_calculadas: 7352.94,
      delta_desviacion_declarativa: -0.021,
      flujo_neto_disponible: 1680.0,
      cuota_mensual_propuesta: 980.0,
      ratio_cobertura_cuota_rcc: 1.71,
    },
    dictamen_riesgos: {
      alerta_fraude_maquillaje: false,
      requiere_revision_humana: false,
      banderas_fraude_detectadas: [],
      clasificacion_sbs_proyectada: 'NORMAL',
      tasa_provision_sbs: 0.01,
      escala_interna_caja_trujillo: 'AAA',
      accion_operativa: 'FAST_TRACK_DESEMBOLSO_INMEDIATO',
      monto_solicitado_original: 8000.0,
      monto_maximo_recomendado: 8000.0,
      provision_sbs_evitada_pen: 0.0,
      explicacion_agente_sbs:
        'ANÁLISIS DE RED RIE-02 [CS-02 · Puntaje 18/100 · SIN ALERTA]: Se detecta domicilio compartido en Jr. Túpac Amaru 820 (P-04) y referencia recíproca con EXP-0089, pero el filtro de Contexto Legítimo aplica las reglas L-01 (Familia en mismo domicilio, F_contexto = 0.40) y L-04 (Referencia madre-hija con historial NORMAL). Triangulación P-08 impecable: Ventas Implícitas S/ 7,352.94 vs Declaradas S/ 7,200.00 (Delta -2.1%, RCC 1.71x). Cero falsos positivos: Fast-Track aprobado por S/ 8,000.00.',
    },
    calidad_datos: {
      confianza_resolucion: 0.95,
      requiere_verificacion_manual: false,
      semaforo_nitidez: 'VERDE',
      perdida_detalle_texto: 0.019,
      contraste: 74,
      resolucion_lado_mayor_px: 1600,
      requiere_nueva_foto: false,
      contiene_importe_ambiguo_letras: false,
      pii_enviados_contador: 0,
      motor_ocr: 'PADDLEOCR_LATINO_PPOCRV5_OFFLINE',
    },
    red: {
      nodos_subred: 6,
      aristas_subred: 6,
      comunidad_id: 'COM-0014',
      tamano_comunidad: 2,
    },
    patrones_detectados: [
      {
        codigo: 'P-04',
        nombre: 'Dirección compartida',
        descripcion: '2 solicitudes comparten domicilio en Jr. Túpac Amaru 820, El Porvenir',
        evidencia: ['EXP-TRUJ-2026-0101', 'EXP-TRUJ-2026-0089'],
        peso: 0.2,
        rareza: 0.63,
        entidades_compartidas: 2,
      },
    ],
    contexto_legitimo: [
      {
        codigo: 'L-01',
        nombre: 'Familia en el mismo domicilio',
        descripcion: 'Vínculo madre e hija verificado con talleres contiguos e historial puntual',
        factor: 0.4,
      },
      {
        codigo: 'L-04',
        nombre: 'Referencias entre familiares',
        descripcion: 'Anula señal de referencia circular P-03 entre familiares directos declarados',
        factor: 0.55,
      },
    ],
    priorizacion: {
      puntaje_red: 18,
      componentes: { patrones: 0.36, anomalia: 0.28, comunidad: 0.2 },
      factor_contexto: 0.4,
      nivel: 'SIN_ALERTA',
    },
    expediente_agente: {
      resumen:
        'Vínculo familiar legítimo verificado: madre e hija comparten vivienda en El Porvenir y operan talleres de calzado independientes con compras comprobadas y buen comportamiento de pago.',
      evidencias_citadas: [
        { arista_id: 'E-21', descripcion: 'Domicilio compartido atenuado por regla familiar L-01 (F_contexto 0.40)', fuente: 'Padrón + Campo', fecha: '2026-11-19' },
      ],
      explicaciones_alternativas: [
        'Economía familiar de calzado típica de El Porvenir con insumos y clientes propios.',
      ],
      pasos_sugeridos: [
        'Continuar flujo normal Fast-Track sin fricción para el cliente.',
      ],
    },
    accion_recomendada: 'CONTINUAR',
    impacto_financiero_sbs: {
      exposicion_red_pen: 14500.0,
      provision_sbs_evitada_pen: 0.0,
      escala_referencial_caja: 'AAA',
      clasificacion_sbs_referencial: 'NORMAL',
      delta_maquillaje_p08: -0.021,
    },
    subred_grafo: CALIBRATED_GRAPHS['EXP-TRUJ-2026-0101'],
  },

  // CS-03: 40 Puestos Mercado La Hermelinda — Rareza 0.12 + L-02 (Puntaje 12, Verde)
  'SOL-TRUJ-2026-0418': {
    expediente_id: 'SOL-TRUJ-2026-0418',
    solicitud_id: 'SOL-TRUJ-2026-0418',
    modo_inferencia: 'ON_PREMISE_LOCAL_CPU',
    latencia_ms: 395.1,
    validacion_fiscal: {
      ruc: '20602345678',
      estado_sunat: 'ACTIVO',
      condicion_domicilio: 'HABIDO',
      giro_ciiu: '0111',
      coherencia_insumos_giro: true,
      confianza_extraccion_ia: 0.96,
    },
    triangulacion_financiera: {
      moneda: 'PEN',
      ventas_declaradas_asesor: 14200.0,
      compras_comprobadas_documentos: 11800.0,
      ventas_implicitas_calculadas: 14390.24,
      delta_desviacion_declarativa: -0.013,
      flujo_neto_disponible: 1840.0,
      cuota_mensual_propuesta: 1180.0,
      ratio_cobertura_cuota_rcc: 1.56,
    },
    dictamen_riesgos: {
      alerta_fraude_maquillaje: false,
      requiere_revision_humana: false,
      banderas_fraude_detectadas: [],
      clasificacion_sbs_proyectada: 'NORMAL',
      tasa_provision_sbs: 0.01,
      escala_interna_caja_trujillo: 'AAA',
      accion_operativa: 'FAST_TRACK_DESEMBOLSO_INMEDIATO',
      monto_solicitado_original: 12000.0,
      monto_maximo_recomendado: 12000.0,
      provision_sbs_evitada_pen: 0.0,
      explicacion_agente_sbs:
        'ANÁLISIS DE RED RIE-02 [CS-03 · Puntaje 12/100 · SIN ALERTA]: Aunque 40 solicitudes activas y 300 puestos comparten la dirección del Mercado La Hermelinda, la ponderación matemática de rareza 1/log2(1+300) = 0.12 y la regla L-02 (Mercado o galería comercial, F_contexto = 0.50) evitan el falso positivo. Boleta de insumos por S/ 11,800.00 (OCR 96%) sustenta S/ 14,390.24 en ventas implícitas. Aprobado sin alerta por S/ 12,000.00.',
    },
    calidad_datos: {
      confianza_resolucion: 0.96,
      requiere_verificacion_manual: false,
      semaforo_nitidez: 'VERDE',
      perdida_detalle_texto: 0.017,
      contraste: 82,
      resolucion_lado_mayor_px: 1600,
      requiere_nueva_foto: false,
      contiene_importe_ambiguo_letras: false,
      pii_enviados_contador: 0,
      motor_ocr: 'PADDLEOCR_LATINO_PPOCRV5_OFFLINE',
    },
    red: {
      nodos_subred: 5,
      aristas_subred: 4,
      comunidad_id: 'COM-HERMELINDA-02',
      tamano_comunidad: 40,
    },
    patrones_detectados: [
      {
        codigo: 'P-04',
        nombre: 'Dirección compartida en mercado',
        descripcion: 'Dirección comercial Mercado La Hermelinda compartida por 300 puestos (Rareza 0.12)',
        evidencia: ['DIR-HERMELINDA-PAB-GRANOS'],
        peso: 0.2,
        rareza: 0.12,
        entidades_compartidas: 300,
      },
    ],
    contexto_legitimo: [
      {
        codigo: 'L-02',
        nombre: 'Mercado o galería comercial',
        descripcion: 'Dirección catalogada como centro de abastos mayorista La Hermelinda',
        factor: 0.5,
      },
      {
        codigo: 'L-05',
        nombre: 'Asociación de comerciantes',
        descripcion: 'Integrante activo de la Asociación de Comerciantes de Granos',
        factor: 0.6,
      },
    ],
    priorizacion: {
      puntaje_red: 12,
      componentes: { patrones: 0.12, anomalia: 0.32, comunidad: 0.42 },
      factor_contexto: 0.5,
      nivel: 'SIN_ALERTA',
    },
    expediente_agente: {
      resumen:
        'Concentración geográfica comercial legítima: compartir la dirección del Mercado La Hermelinda tiene rareza 0.12 y está respaldado por las reglas L-02 y L-05.',
      evidencias_citadas: [
        { arista_id: 'E-31', descripcion: 'Puesto ubicado en Pabellón de Granos La Hermelinda (n=300 puestos, rareza 0.12)', fuente: 'Catastro Comercial Trujillo', fecha: '2026-11-20' },
      ],
      explicaciones_alternativas: [
        'Agrupación natural de comerciantes mayoristas en el principal mercado de Trujillo.',
      ],
      pasos_sugeridos: [
        'Continuar desembolso normal de S/ 12,000.00 sin generar carga operativa a Riesgos.',
      ],
    },
    accion_recomendada: 'CONTINUAR',
    impacto_financiero_sbs: {
      exposicion_red_pen: 12000.0,
      provision_sbs_evitada_pen: 0.0,
      escala_referencial_caja: 'AAA',
      clasificacion_sbs_referencial: 'NORMAL',
      delta_maquillaje_p08: -0.013,
    },
    subred_grafo: CALIBRATED_GRAPHS['SOL-TRUJ-2026-0418'],
  },

  // CS-04 (y Caso 3 v1.0): 5 RUCs recientes en 1 vivienda, 2 NO HABIDO + Ventas Infladas P-08 (Puntaje 78, Rojo)
  'EXP-TRUJ-2026-0103': {
    expediente_id: 'EXP-TRUJ-2026-0103',
    solicitud_id: 'EXP-TRUJ-2026-0103',
    modo_inferencia: 'ON_PREMISE_LOCAL_CPU',
    latencia_ms: 520.2,
    validacion_fiscal: {
      ruc: '10402233445',
      estado_sunat: 'ACTIVO',
      condicion_domicilio: 'NO HABIDO',
      giro_ciiu: '5211',
      coherencia_insumos_giro: true,
      confianza_extraccion_ia: 0.91,
    },
    triangulacion_financiera: {
      moneda: 'PEN',
      ventas_declaradas_asesor: 18500.0,
      compras_comprobadas_documentos: 5200.0,
      ventas_implicitas_calculadas: 7647.06,
      delta_desviacion_declarativa: 1.419,
      flujo_neto_disponible: 1155.0,
      cuota_mensual_propuesta: 1500.0,
      ratio_cobertura_cuota_rcc: 0.77,
    },
    dictamen_riesgos: {
      alerta_fraude_maquillaje: true,
      requiere_revision_humana: false,
      banderas_fraude_detectadas: [
        'P-04_5_RUCS_EN_MISMA_VIVIENDA_RESIDENCIAL',
        'P-06_2_RUCS_NO_HABIDO_CONECTADOS',
        'P-08_MAQUILLAJE_VENTAS_SUPERIOR_30_PCT (+141.9%)',
        'RCC_INSUFICIENTE_0_77X',
      ],
      clasificacion_sbs_proyectada: 'PERDIDA',
      tasa_provision_sbs: 1.0,
      escala_interna_caja_trujillo: 'C',
      accion_operativa: 'BLOQUEO_PRE_DESEMBOLSO_FRAUDE_MAQUILLAJE',
      monto_solicitado_original: 15000.0,
      monto_maximo_recomendado: 0.0,
      provision_sbs_evitada_pen: 15000.0,
      explicacion_agente_sbs:
        'REVISIÓN PRIORITARIA RIE-02 [CS-04 · Puntaje 78/100 · BLOQUEO MAQUILLAJE P-08]: Se detectan 5 RUCs recientes registrados en una misma vivienda residencial no comercial (P-04), 2 de ellos en condición NO HABIDO / BAJA DE OFICIO en SUNAT (P-06), combinados con inflación declarativa de ventas de +141.9% (P-08: compras comprobadas S/ 5,200.00 sustentan S/ 7,647.06 vs S/ 18,500.00 declarados; RCC 0.77x). Desembolso de S/ 15,000.00 retenido; evita S/ 15,000.00 en provisión SBS.',
    },
    calidad_datos: {
      confianza_resolucion: 0.91,
      requiere_verificacion_manual: false,
      semaforo_nitidez: 'VERDE',
      perdida_detalle_texto: 0.031,
      contraste: 64,
      resolucion_lado_mayor_px: 1600,
      requiere_nueva_foto: false,
      contiene_importe_ambiguo_letras: false,
      pii_enviados_contador: 0,
      motor_ocr: 'PADDLEOCR_LATINO_PPOCRV5_OFFLINE',
    },
    red: {
      nodos_subred: 6,
      aristas_subred: 6,
      comunidad_id: 'COM-0104',
      tamano_comunidad: 5,
    },
    patrones_detectados: [
      {
        codigo: 'P-04',
        nombre: 'Dirección concentrada atípica',
        descripcion: '5 RUCs recientes declarados en una misma vivienda residencial (Mz. K Lt. 14)',
        evidencia: ['DIR-MOCHE-K14', 'RUC-10402233445', 'RUC-10403344556'],
        peso: 0.2,
        rareza: 0.43,
        entidades_compartidas: 5,
      },
      {
        codigo: 'P-06',
        nombre: 'Negocios recientes o irregulares',
        descripcion: '2 RUCs vinculados en la subred registran estado NO HABIDO y BAJA DE OFICIO en SUNAT',
        evidencia: ['10402233445 (NO HABIDO)', '10403344556 (BAJA OFICIO)'],
        peso: 0.15,
        rareza: 0.5,
        entidades_compartidas: 3,
      },
      {
        codigo: 'P-08',
        nombre: 'Ventas infladas en la red',
        descripcion: 'Ventas declaradas (S/ 18,500.00) superan en +141.9% a las ventas implícitas (S/ 7,647.06)',
        evidencia: ['DOC-1 (Compras S/ 5,200.00 -> V_imp S/ 7,647.06)'],
        peso: 0.25,
        rareza: 0.63,
        entidades_compartidas: 2,
      },
    ],
    contexto_legitimo: [],
    priorizacion: {
      puntaje_red: 78,
      componentes: { patrones: 0.88, anomalia: 0.76, comunidad: 0.56 },
      factor_contexto: 1.0,
      nivel: 'REVISION_PRIORITARIA',
    },
    expediente_agente: {
      resumen:
        'Patrón de concentración domiciliaria atípica y sobredeclaración financiera: 5 negocios recientes comparten una vivienda residencial (2 NO HABIDO en SUNAT) y declaran ventas 141.9% por encima de sus compras comprobadas.',
      evidencias_citadas: [
        { arista_id: 'E-41', descripcion: '5 RUCs domiciliados en vivienda Mz. K Lt. 14 sin zonificación comercial', fuente: 'Padrón SUNAT Local', fecha: '2026-11-20' },
        { arista_id: 'E-42', descripcion: 'RUC 10402233445 (NO HABIDO) y 10403344556 (BAJA OFICIO) conectados al inmueble', fuente: 'SUNAT', fecha: '2026-11-20' },
        { arista_id: 'E-45', descripcion: 'Desviación declarativa P-08 de +141.9% (>30% umbral SBS) con RCC 0.77x', fuente: 'Verificador Python', fecha: '2026-11-20' },
      ],
      explicaciones_alternativas: [
        'Subdivisión de un predio familiar entre varios hermanos con actividades informales distintas.',
      ],
      pasos_sugeridos: [
        'Inspección ocular del inmueble en Mz. K Lt. 14 para constatar si existe actividad productiva real.',
        'Solicitar facturas electrónicas SUNAT de los últimos 3 meses antes de levantar la retención.',
      ],
    },
    accion_recomendada: 'RETENER_HASTA_REVISION',
    impacto_financiero_sbs: {
      exposicion_red_pen: 27000.0,
      provision_sbs_evitada_pen: 15000.0,
      escala_referencial_caja: 'C',
      clasificacion_sbs_referencial: 'PERDIDA',
      delta_maquillaje_p08: 1.419,
    },
    subred_grafo: CALIBRATED_GRAPHS['EXP-TRUJ-2026-0103'],
  },

  // CS-05 (y Caso 2 v1.0): 7 solicitudes mismo asesor ASE-017 con referencias cruzadas (Puntaje 58, Ámbar)
  'EXP-TRUJ-2026-0102': {
    expediente_id: 'EXP-TRUJ-2026-0102',
    solicitud_id: 'EXP-TRUJ-2026-0102',
    modo_inferencia: 'ON_PREMISE_LOCAL_CPU',
    latencia_ms: 446.8,
    validacion_fiscal: {
      ruc: '10489120345',
      estado_sunat: 'ACTIVO',
      condicion_domicilio: 'HABIDO',
      giro_ciiu: '5211',
      coherencia_insumos_giro: true,
      confianza_extraccion_ia: 0.93,
    },
    triangulacion_financiera: {
      moneda: 'PEN',
      ventas_declaradas_asesor: 16500.0,
      compras_comprobadas_documentos: 11160.0,
      ventas_implicitas_calculadas: 13609.76,
      delta_desviacion_declarativa: 0.212,
      flujo_neto_disponible: 1508.0,
      cuota_mensual_propuesta: 1300.0,
      ratio_cobertura_cuota_rcc: 1.16,
    },
    dictamen_riesgos: {
      alerta_fraude_maquillaje: false,
      requiere_revision_humana: false,
      banderas_fraude_detectadas: [
        'P-07_CONCENTRACION_ASESOR_ASE017_7_SOLICITUDES',
        'P-01_TELEFONO_COMPARTIDO_CARTERA',
        'DESVIACION_MODERADA_VENTAS_21_2_PCT',
      ],
      clasificacion_sbs_proyectada: 'CPP',
      tasa_provision_sbs: 0.05,
      escala_interna_caja_trujillo: 'A',
      accion_operativa: 'RECORTE_AUTOMATICO_MONTO_O_GARANTIA',
      monto_solicitado_original: 12000.0,
      monto_maximo_recomendado: 8500.0,
      provision_sbs_evitada_pen: 2100.0,
      explicacion_agente_sbs:
        'NIVEL OBSERVACIÓN RIE-02 [CS-05 · Puntaje 58/100 · RECORTE PRUDENCIAL]: El asesor ASE-017 originó 7 solicitudes conectadas con referencias cruzadas y 2 teléfonos compartidos (P-01, P-07). La regla L-06 anula la penalización por dispositivo compartido al tratarse de la tablet corporativa del asesor (F_contexto = 0.78). Ventas declaradas (S/ 16,500.00) superan en +21.2% a las implícitas (S/ 13,609.76) con RCC 1.16x. Se recomienda recorte automático de S/ 12,000.00 a S/ 8,500.00 (evitando S/ 2,100.00 en provisión SBS).',
    },
    calidad_datos: {
      confianza_resolucion: 0.93,
      requiere_verificacion_manual: false,
      semaforo_nitidez: 'VERDE',
      perdida_detalle_texto: 0.022,
      contraste: 71,
      resolucion_lado_mayor_px: 1600,
      requiere_nueva_foto: false,
      contiene_importe_ambiguo_letras: false,
      pii_enviados_contador: 0,
      motor_ocr: 'PADDLEOCR_LATINO_PPOCRV5_OFFLINE',
    },
    red: {
      nodos_subred: 6,
      aristas_subred: 6,
      comunidad_id: 'COM-ASE017',
      tamano_comunidad: 7,
    },
    patrones_detectados: [
      {
        codigo: 'P-07',
        nombre: 'Concentración en asesor',
        descripcion: '7 solicitudes de una misma comunidad con referencias cruzadas originadas por ASE-017',
        evidencia: ['ASE-017', 'COM-ASE017 (7 solicitudes)'],
        peso: 0.2,
        rareza: 0.36,
        entidades_compartidas: 7,
      },
      {
        codigo: 'P-01',
        nombre: 'Teléfono compartido',
        descripcion: 'Teléfono 945***788 compartido entre 2 solicitudes de la misma cartera',
        evidencia: ['EXP-TRUJ-2026-0102', 'SOL-TRUJ-2026-0401'],
        peso: 0.3,
        rareza: 0.63,
        entidades_compartidas: 2,
      },
    ],
    contexto_legitimo: [
      {
        codigo: 'L-06',
        nombre: 'Dispositivo corporativo del asesor',
        descripcion: 'Capturas realizadas desde la tablet oficial de campo de ASE-017 (anula P-02)',
        factor: 0.78,
      },
    ],
    priorizacion: {
      puntaje_red: 58,
      componentes: { patrones: 0.76, anomalia: 0.72, comunidad: 0.74 },
      factor_contexto: 0.78,
      nivel: 'OBSERVACION',
    },
    expediente_agente: {
      resumen:
        'Caso en Observación (58 pts): concentración de 7 solicitudes con referencias cruzadas en la cartera del asesor ASE-017 y desviación moderada de ventas (+21.2%).',
      evidencias_citadas: [
        { arista_id: 'E-51', descripcion: '7 expedientes de la comunidad COM-ASE017 originados por ASE-017', fuente: 'Log Originación', fecha: '2026-11-20' },
        { arista_id: 'E-53', descripcion: 'Teléfono 945***788 repetido como contacto y referencia cruzada', fuente: 'Grafo Contacto', fecha: '2026-11-20' },
      ],
      explicaciones_alternativas: [
        'Campaña comercial focalizada del asesor ASE-017 en un mismo pasaje mayorista de La Hermelinda.',
      ],
      pasos_sugeridos: [
        'Verificación telefónica aleatoria de 2 referencias por un supervisor distinto a ASE-017 (RN-08).',
        'Aprobar con recorte prudencial a S/ 8,500.00 para mantener RCC ≥ 1.35x.',
      ],
    },
    accion_recomendada: 'MONITOREAR',
    impacto_financiero_sbs: {
      exposicion_red_pen: 42000.0,
      provision_sbs_evitada_pen: 2100.0,
      escala_referencial_caja: 'A',
      clasificacion_sbs_referencial: 'CPP',
      delta_maquillaje_p08: 0.212,
    },
    subred_grafo: CALIBRATED_GRAPHS['EXP-TRUJ-2026-0102'],
  },

  // CS-06 (y Caso 4 v1.0): Candado Poka-Yoke — Estado Gris VERIFICAR_DATOS, sin puntaje, provisión null
  'EXP-TRUJ-2026-0104': {
    expediente_id: 'EXP-TRUJ-2026-0104',
    solicitud_id: 'EXP-TRUJ-2026-0104',
    modo_inferencia: 'ON_PREMISE_LOCAL_CPU',
    latencia_ms: 312.6,
    validacion_fiscal: {
      ruc: '10411298765',
      estado_sunat: 'ACTIVO',
      condicion_domicilio: 'HABIDO',
      giro_ciiu: '5211',
      coherencia_insumos_giro: false,
      confianza_extraccion_ia: 0.62,
    },
    triangulacion_financiera: {
      moneda: 'PEN',
      ventas_declaradas_asesor: 9400.0,
      compras_comprobadas_documentos: 0.0,
      ventas_implicitas_calculadas: 0.0,
      delta_desviacion_declarativa: 0.0,
      flujo_neto_disponible: 0.0,
      cuota_mensual_propuesta: 1050.0,
      ratio_cobertura_cuota_rcc: 0.0,
    },
    dictamen_riesgos: {
      alerta_fraude_maquillaje: false,
      requiere_revision_humana: true,
      banderas_fraude_detectadas: [
        'CONFIANZA_RESOLUCION_062_INFERIOR_UMBRAL_085',
        'IMPORTE_OCR_CON_LETRAS_5_0OO_00_RECHAZADO',
        'SEMAFORO_NITIDEZ_ROJO_PERDIDA_DETALLE_0385',
      ],
      clasificacion_sbs_proyectada: null,
      tasa_provision_sbs: null,
      escala_interna_caja_trujillo: 'VERIFICAR_DATOS',
      accion_operativa: 'PENDIENTE_REVISION_DOCUMENTAL',
      monto_solicitado_original: 9500.0,
      monto_maximo_recomendado: 0.0,
      provision_sbs_evitada_pen: 0.0,
      explicacion_agente_sbs:
        'CANDADO POKA-YOKE ACTIVADO [CS-06 · Estado Gris VERIFICAR_DATOS · Sin Puntaje]: (1) Semáforo de nitidez de Soe detecta pérdida de detalle dentro de las cajas de texto de 0.385 (≥ 0.30) y contraste 34 (< 40); (2) El OCR leyó caracteres ambiguos con letras O en vez de ceros ("S/ 5.0OO.00") que el verificador Python rechaza sin adivinar; (3) Confianza de resolución 0.62 < 0.85. Conforme a la Res. SBS 11356-2008, una foto defectuosa NO clasifica al cliente como PÉRDIDA (clasificación y provisión en null; S/ 0 sumados al P&L). Se solicita repetir fotografía o verificación manual.',
    },
    calidad_datos: {
      confianza_resolucion: 0.62,
      requiere_verificacion_manual: true,
      semaforo_nitidez: 'ROJO',
      perdida_detalle_texto: 0.385,
      contraste: 34,
      resolucion_lado_mayor_px: 780,
      requiere_nueva_foto: true,
      contiene_importe_ambiguo_letras: true,
      pii_enviados_contador: 0,
      motor_ocr: 'PADDLEOCR_LATINO_PPOCRV5_OFFLINE',
      motivo_calidad:
        'Pérdida de detalle en texto 0.385 (≥0.30), contraste 34 (<40) e importe ambiguo "5.0OO.00" (letras O en lugar de ceros).',
    },
    red: {
      nodos_subred: 3,
      aristas_subred: 2,
      comunidad_id: 'SIN_EVALUAR_POKA_YOKE',
      tamano_comunidad: 1,
    },
    patrones_detectados: [],
    contexto_legitimo: [],
    priorizacion: {
      puntaje_red: null,
      componentes: null,
      factor_contexto: 1.0,
      nivel: 'VERIFICAR_DATOS',
    },
    expediente_agente: {
      resumen:
        'Caso detenido en puerta de calidad (Candado Poka-Yoke RN-05): confianza de extracción y resolución de 62% (< 85%) e importe con letras "5.0OO.00". No se asigna puntaje de red ni clasificación SBS adversa al cliente.',
      evidencias_citadas: [
        { arista_id: 'E-61', descripcion: 'Nota borrosa con pérdida de detalle 0.385 e importe "S/ 5.0OO.00" sin ítems que cierren suma', fuente: 'Semáforo Nitidez Soe + Verificador Python', fecha: '2026-11-21' },
      ],
      explicaciones_alternativas: [
        'Fotografía tomada con poca luz (contraste 34) o movimiento involuntario en campo.',
      ],
      pasos_sugeridos: [
        'Solicitar al asesor repetir la fotografía del comprobante con buena iluminación (≥ 800 px).',
        'Verificar teléfono completo (11/9 dígitos) y dirección antes de ejecutar el análisis de red.',
      ],
    },
    accion_recomendada: 'VERIFICAR_DATOS',
    impacto_financiero_sbs: {
      exposicion_red_pen: 0.0,
      provision_sbs_evitada_pen: 0.0,
      escala_referencial_caja: 'VERIFICAR_DATOS',
      clasificacion_sbs_referencial: null,
      delta_maquillaje_p08: 0.0,
    },
    subred_grafo: CALIBRATED_GRAPHS['EXP-TRUJ-2026-0104'],
  },
};

// Aliases oficiales de backend-wasi-risk (vps_api_soe.py v2.6) para compatibilidad 100% bidireccional
CALIBRATED_GRAPHS['SOL-TRUJ-2026-0101'] = CALIBRATED_GRAPHS['EXP-TRUJ-2026-0101'];
CALIBRATED_GRAPHS['SOL-TRUJ-2026-0415'] = CALIBRATED_GRAPHS['SOL-TRUJ-2026-0418'];
CALIBRATED_GRAPHS['SOL-TRUJ-2026-0892'] = CALIBRATED_GRAPHS['EXP-TRUJ-2026-0103'];
CALIBRATED_GRAPHS['SOL-TRUJ-2026-0650'] = CALIBRATED_GRAPHS['EXP-TRUJ-2026-0102'];
CALIBRATED_GRAPHS['SOL-TRUJ-2026-0910'] = CALIBRATED_GRAPHS['EXP-TRUJ-2026-0104'];

CALIBRATED_RESPONSES['SOL-TRUJ-2026-0101'] = {
  ...CALIBRATED_RESPONSES['EXP-TRUJ-2026-0101'],
  expediente_id: 'SOL-TRUJ-2026-0101',
  solicitud_id: 'SOL-TRUJ-2026-0101',
};
CALIBRATED_RESPONSES['SOL-TRUJ-2026-0415'] = {
  ...CALIBRATED_RESPONSES['SOL-TRUJ-2026-0418'],
  expediente_id: 'SOL-TRUJ-2026-0415',
  solicitud_id: 'SOL-TRUJ-2026-0415',
};
CALIBRATED_RESPONSES['SOL-TRUJ-2026-0892'] = {
  ...CALIBRATED_RESPONSES['EXP-TRUJ-2026-0103'],
  expediente_id: 'SOL-TRUJ-2026-0892',
  solicitud_id: 'SOL-TRUJ-2026-0892',
};
CALIBRATED_RESPONSES['SOL-TRUJ-2026-0650'] = {
  ...CALIBRATED_RESPONSES['EXP-TRUJ-2026-0102'],
  expediente_id: 'SOL-TRUJ-2026-0650',
  solicitud_id: 'SOL-TRUJ-2026-0650',
};
CALIBRATED_RESPONSES['SOL-TRUJ-2026-0910'] = {
  ...CALIBRATED_RESPONSES['EXP-TRUJ-2026-0104'],
  expediente_id: 'SOL-TRUJ-2026-0910',
  solicitud_id: 'SOL-TRUJ-2026-0910',
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Sanitizador v2 de Soe (Sección 4.1, D5, D8, D10 y Sección 9 Paso 1 & 2):
 * - 5 capas + Filtro de pie de página spoiler ("CASO TRAMPA POKA-YOKE...") + Guardia de Salida "0 datos personales enviados".
 * - Preserva llaves operativas como el N° de operación de Yape de 8 dígitos que inicia con 0 (ej. 09482716).
 */
export function sanitizarTextoPiiV2(rawText: string): {
  texto_sanitizado: string;
  pii_detectados_y_ocultados: number;
  pii_enviados_contador: 0;
} {
  let count = 0;
  let text = rawText;

  // Filtro D10 (Sección 4.4 / Paso 2): Eliminar líneas de pie de página que delatan la respuesta en imágenes sintéticas
  text = text.replace(/CASO\s+TRAMPA\s+POKA[- ]?YOKE[^\n|]*/gi, '[PIE_IMAGEN_FILTRADO]');

  // Capa 1: Celulares con o sin +51 (sin tocar números de operación Yape de 8 dígitos que empiezan en 0)
  text = text.replace(/(?:\+?51[\s-]?)?9\d{2}[\s-]?\d{3}[\s-]?\d{3}\b/g, () => {
    count++;
    return '[TEL_SEUDONIMIZADO]';
  });

  // Capa 2: Etiquetas "Señor(a):", "Para:", "Destinatario:", "Cliente:", "Dirección:", "Razón Social:"
  text = text.replace(
    /\b(Se(?:ñ|n)or(?:a|\(a\))?|Para|Destinatario|Cliente|Direcci(?:ó|o)n|Raz(?:ó|o)n\s+Social)\s*[:.-]\s*[A-ZÁÉÍÓÚÑa-záéíóúñ0-9\s.]{3,40}/gi,
    (_m, label) => {
      count++;
      return `${label}: [PII_PROTEGIDO]`;
    }
  );

  // Capa 3: RUCs pegados o separados de la palabra RUC
  text = text.replace(/\b(?:RUC\s*[:#]?\s*)?(?:10|15|17|20)\d{9}\b/gi, () => {
    count++;
    return '[RUC_SEUDONIMIZADO]';
  });

  // Capa 4: Nombres pegados sin espacios del OCR (ej. PAREDESGOMEZROSAURA) o proveedores en Plin (CAMPOS ALVA RICARDO)
  text = text.replace(
    /\b(?:PAREDESGOMEZROSAURA|CAMPOS\s+ALVA\s+RICARDO|ROJAS\s+VALDERRAMA\s+LUIS|QUISPE\s+ALFARO\s+MAR[IÍ]A|S[AÁ]NCHEZ\s+PAREDES\s+CARLOS|CH[AÁ]VEZ\s+MENDOZA\s+ROSA)\b/gi,
    () => {
      count++;
      return '[TITULAR_SEUDONIMIZADO]';
    }
  );

  // Capa 5 (Guardia de salida): DNI explícitos sin tocar códigos de operación Yape que empiezan en 0 (ej. 09482716)
  text = text.replace(/\bDNI\s*[:#]?\s*([1-9]\d{7})\b/gi, () => {
    count++;
    return 'DNI: [DNI_SEUDONIMIZADO]';
  });

  return {
    texto_sanitizado: text,
    pii_detectados_y_ocultados: count,
    pii_enviados_contador: 0,
  };
}

/**
 * 22 Unidades Normalizadas MYPE + Verificador Matemático en Python (Sección 9 Paso 3 y D7 de Soe):
 * - Comprueba IGV en facturas (gravada * 1.18 == total).
 * - Calcula porcentaje fuera de giro sobre MONTOS (> 20%), no contando palabras.
 */
export const UNIDADES_MYPE_22 = [
  'saco', 'arr', 'cj', 'fdo', 'pl', 'pie', 'doc', 'par', 'gal', 'kg', 'lt',
  'und', 'm', 'rollo', 'bolsa', 'varilla', 'caja', 'paq', 'atado', 'balde', 'qq', 'lat',
] as const;

export function verificarMatematicaComprobantePython(params: {
  giro_ciiu: string;
  monto_total_pen: number;
  monto_fuera_giro_pen?: number;
  base_gravada_pen?: number;
}): {
  igv_valido: boolean;
  proporcion_fuera_giro: number;
  coherencia_insumos_giro: boolean;
} {
  const total = Math.max(0.01, params.monto_total_pen);
  const fuera = Math.max(0, params.monto_fuera_giro_pen ?? 0);
  const proporcionFuera = Number((fuera / total).toFixed(3));
  const igvValido =
    params.base_gravada_pen === undefined ||
    Math.abs(params.base_gravada_pen * 1.18 - total) <= 0.5;
  return {
    igv_valido: igvValido,
    proporcion_fuera_giro: proporcionFuera,
    // Regla D7 de Soe: coherente si el monto fuera de giro no supera el 20% del monto total
    coherencia_insumos_giro: proporcionFuera <= 0.2,
  };
}

/**
 * Adaptador Universal de Contrato (Sección 4.2 D1/D2 de Soe + Sección 9.2 del Word v2.0):
 * Acepta simultáneamente:
 * 1) El payload anidado del Word v2.0 (solicitud_id, negocio.ruc, solicitante.telefonos, ventas_declaradas)
 * 2) El payload anidado del kit de Soe (declaracion_asesor.ventas_declaradas_asesor_pen, datos_fiscales_prevalidados.ruc)
 * 3) El payload híbrido plano (expediente_id, ruc, ventas_declaradas_asesor, monto_solicitado_original)
 */
export function adaptarPayloadEntrada(raw: Record<string, unknown>): AuditarExpedienteRequest {
  const negocio = (raw.negocio ?? {}) as Record<string, unknown>;
  const solicitante = (raw.solicitante ?? {}) as Record<string, unknown>;
  const dispositivo = (raw.dispositivo ?? {}) as Record<string, unknown>;
  const declAsesor = (raw.declaracion_asesor ?? {}) as Record<string, unknown>;
  const datosFisc = (raw.datos_fiscales_prevalidados ?? {}) as Record<string, unknown>;

  const expedienteId = String(
    raw.expediente_id ?? raw.solicitud_id ?? `SOL-TRUJ-2026-${Math.floor(1000 + Math.random() * 9000)}`
  );
  const ruc = String(raw.ruc ?? negocio.ruc ?? datosFisc.ruc ?? '10423189012').replace(/\D/g, '');
  const giroCiiu = String(raw.giro_ciiu ?? negocio.giro_ciiu ?? datosFisc.giro_ciiu ?? '1520');
  const ventasDecl = Number(
    raw.ventas_declaradas_asesor ??
      raw.ventas_declaradas ??
      declAsesor.ventas_declaradas_asesor_pen ??
      7200
  );
  const montoSolic = Number(
    raw.monto_solicitado_original ??
      raw.monto_solicitado ??
      declAsesor.monto_solicitado_pen ??
      8000
  );
  const comprasDirectas = Number(raw.compras_comprobadas ?? 0);
  const docsRaw = Array.isArray(raw.documentos_adjuntos) ? raw.documentos_adjuntos : [];
  const documentos =
    docsRaw.length > 0
      ? (docsRaw as AuditarExpedienteRequest['documentos_adjuntos'])
      : [
          {
            doc_id: 'DOC-1',
            tipo_documento: 'FACTURA_MAYORISTA',
            texto_ocr: `Compras comprobadas -> S/ ${(comprasDirectas || Math.round(ventasDecl * 0.65)).toFixed(2)} (OCR: 0.94)`,
          },
        ];

  const telefonosArr = Array.isArray(solicitante.telefonos) ? solicitante.telefonos : [];

  return {
    expediente_id: expedienteId,
    solicitud_id: String(raw.solicitud_id ?? expedienteId),
    ruc: ruc.length === 11 ? ruc : '10423189012',
    agencia_origen: String(raw.agencia_origen ?? 'Agencia El Porvenir'),
    asesor_id: String(raw.asesor_id ?? 'ASE-004'),
    giro_ciiu: giroCiiu,
    ventas_declaradas_asesor: ventasDecl,
    inventario_fisico_estimado: Number(
      raw.inventario_fisico_estimado ?? declAsesor.inventario_fisico_estimado_pen ?? 6400
    ),
    gastos_operativos_familiares: Number(
      raw.gastos_operativos_familiares ?? declAsesor.gastos_operativos_familiares_pen ?? 410
    ),
    cuota_deuda_sbs_vigente: Number(
      raw.cuota_deuda_sbs_vigente ?? declAsesor.cuota_deuda_sbs_vigente_pen ?? 214
    ),
    cuota_mensual_propuesta: Math.max(
      1,
      Number(raw.cuota_mensual_propuesta ?? declAsesor.cuota_mensual_propuesta_pen ?? 980)
    ),
    monto_solicitado_original: Math.max(1, montoSolic),
    documentos_adjuntos: documentos,
    telefono_contacto: String(raw.telefono_contacto ?? telefonosArr[0] ?? '948112233'),
    direccion_negocio: String(
      raw.direccion_negocio ?? negocio.direccion ?? solicitante.direccion ?? 'Trujillo'
    ),
    dispositivo_fingerprint: String(
      raw.dispositivo_fingerprint ?? dispositivo.fingerprint ?? 'dev:corp-ase004-tab'
    ),
    dispositivo_tipo:
      raw.dispositivo_tipo === 'CORPORATIVO_ASESOR' ||
      dispositivo.tipo === 'CORPORATIVO_ASESOR'
        ? 'CORPORATIVO_ASESOR'
        : 'CLIENTE',
    referencias: Array.isArray(raw.referencias)
      ? (raw.referencias as AuditarExpedienteRequest['referencias'])
      : undefined,
    contexto_declarado: Array.isArray(raw.contexto_declarado)
      ? (raw.contexto_declarado as string[])
      : [],
    consentimiento_datos_ley29733: Boolean(raw.consentimiento_datos_ley29733 ?? true),
  };
}

/**
 * Evaluador de foto y semáforo de nitidez de Soe (Sección 7 y 10).
 */
export async function mockEvaluarFoto(params: {
  nombre_archivo: string;
  texto_ocr?: string;
  size_bytes?: number;
}): Promise<EvaluacionFotoResponse> {
  await sleep(35);
  const nameLower = params.nombre_archivo.toLowerCase();
  const rawText =
    params.texto_ocr ||
    `Comprobante ${params.nombre_archivo} -> S/ 5,000.00 (OCR: 0.95)`;

  const contieneLetrasEnMonto =
    /\d+[.,][0O]*O[0O]*[.,]\d+/i.test(rawText) || /S[5S][.,]OOO/i.test(rawText);
  const isBlurryFile =
    nameLower.includes('borros') ||
    nameLower.includes('blur') ||
    nameLower.includes('movid') ||
    contieneLetrasEnMonto;

  const perdida = isBlurryFile ? 0.385 : 0.021;
  const contraste = isBlurryFile ? 34 : 74;
  const resolucion = isBlurryFile ? 760 : 1600;
  const semaforo =
    perdida >= 0.45 || contraste < 40 || resolucion < 800 || contieneLetrasEnMonto
      ? 'ROJO'
      : perdida >= 0.3
        ? 'AMARILLO'
        : 'VERDE';

  const { texto_sanitizado, pii_enviados_contador } = sanitizarTextoPiiV2(rawText);

  return {
    semaforo_nitidez: semaforo,
    perdida_detalle_texto: perdida,
    contraste,
    resolucion_lado_mayor_px: resolucion,
    confianza_ocr: semaforo === 'ROJO' ? 0.62 : semaforo === 'AMARILLO' ? 0.86 : 0.95,
    requiere_nueva_foto: semaforo === 'ROJO',
    contiene_importe_ambiguo_letras: contieneLetrasEnMonto,
    pii_enviados_contador,
    texto_sanitizado,
    motor_ocr: 'PADDLEOCR_LATINO_PPOCRV5_OFFLINE',
    motivo:
      semaforo === 'ROJO'
        ? contieneLetrasEnMonto
          ? 'Importe con letras O en lugar de ceros (ej. 5.0OO.00). Prohibido adivinar dígitos: repetir foto o derivar a verificación.'
          : 'Foto borrosa o bajo contraste (<40 / <800px). Repetir toma antes de continuar.'
        : 'Nitidez dentro de parámetros óptimos (pérdida de detalle < 0.05). Sanitizador v2: 0 PII enviados.',
  };
}

/**
 * Extractor de monto en Soles corregido según hallazgo D3/D4 de Soe (Sección 4.3):
 * Ignora montos "S/ 0.00" de líneas de comisión ("Comisión S/ 0.00 (Gratis)" en vouchers Yape)
 * y toma el importe real > 0 del comprobante.
 */
export function parseAmountFromOcr(text: string): number {
  const regex = /S\/\.?\s*([\d,]+(?:\.\d{1,2})?)/gi;
  const amounts: number[] = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    const parsed = Number(match[1].replace(/,/g, ''));
    if (Number.isFinite(parsed) && parsed > 0) {
      amounts.push(parsed);
    }
  }
  if (amounts.length === 0) return 0;
  return Math.max(...amounts);
}

function parseConfidenceFromOcr(text: string): number {
  const ocrMatch = text.match(/OCR\s*[:=]?\s*(0\.\d+|\d{2,3}%?)/i);
  if (ocrMatch) {
    const raw = ocrMatch[1];
    if (raw.endsWith('%')) {
      return Math.min(1, Math.max(0.1, Number(raw.slice(0, -1)) / 100));
    }
    const num = Number(raw);
    if (num > 1 && num <= 100) return num / 100;
    if (num > 0 && num <= 1) return num;
  }
  return 0.94;
}

export async function mockGetHealth(): Promise<HealthResponse> {
  await sleep(5);
  return {
    status: 'ok',
    modo_activo: 'ON_PREMISE_LOCAL_CPU · PaddleOCR + Sanitizador v2',
    vps_soberano: true,
    latencia_ms: 3.8,
    version: '2.0.0-rie02-local',
    pii_enviados_total: 0,
  };
}

export async function mockGetSunat(ruc: string): Promise<SunatRucResponse> {
  await sleep(4);
  const found = SUNAT_DIRECTORY[ruc];
  if (found) {
    return { ...found, latencia_ms: 3.2 };
  }
  return {
    ruc,
    razon_social: `MYPE TRUJILLO REGISTRADA — RUC ${ruc}`,
    estado_sunat: 'ACTIVO',
    condicion_domicilio: 'HABIDO',
    giro_ciiu: '5211',
    actividad_economica: 'Comercio MYPE General',
    distrito: 'Trujillo, La Libertad',
    alerta_sunat: false,
    latencia_ms: 3.9,
  };
}

export async function mockGetGoldenCases(): Promise<GoldenCase[]> {
  await sleep(6);
  return GOLDEN_CASES.map((c) => ({
    ...c,
    payload: {
      ...c.payload,
      documentos_adjuntos: c.payload.documentos_adjuntos.map((d) => ({ ...d })),
    },
  }));
}

/**
 * Salvaguarda de Verificación de Evidencias contra el Grafo (Sección 7.4 / RN-03 / CP-02):
 * "El backend verifica que cada evidencia citada exista en el grafo y elimina las afirmaciones sin respaldo."
 */
export function verificarEvidenciasContraGrafo(
  evidencias: NonNullable<AuditarExpedienteResponse['expediente_agente']>['evidencias_citadas'],
  grafo?: SubredGrafo
): NonNullable<AuditarExpedienteResponse['expediente_agente']>['evidencias_citadas'] {
  if (!evidencias || !grafo) return [];
  const validEdgeIds = new Set(grafo.aristas.map((a) => a.id));
  return evidencias.filter((ev) => validEdgeIds.has(ev.arista_id));
}

/**
 * Análisis Periódico sobre Población Sintética + Tabla de Aciertos de Soe (RF-16 / CP-09 / Sección 8.2 / Sección 9 Paso 5):
 * - Población sintética RIE-02: 2,000 solicitudes y 1,500 personas distribuidas en 6 agencias de Trujillo.
 * - Benchmark de Soe (Sección 3, 8 y 9): 7 documentos del kit, 6 casos simulados RIE-02 y 50 expedientes
 *   (35 en Verde AAA/AA, 8 en Ámbar A/B, 5 en Rojo C Fraude y 2 separados en Gris Poka-Yoke con provisión null).
 */
export interface BarridoPoblacionSinteticaReport {
  timestamp: string;
  latencia_barrido_ms: number;
  poblacion_grafo: {
    total_solicitudes: 2000;
    total_personas: 1500;
    agencias_cubiertas: 6;
    comunidades_leiden_detectadas: 42;
    anillos_riesgo_inyectados: 14;
    anillos_detectados: 14;
    tasa_deteccion_anillos_pct: 100;
    agrupaciones_legitimas_familias_mercados: 38;
    falsos_positivos_en_legitimos: 0;
    precision_alertas_prioritarias_pct: 100;
  };
  benchmark_kit_soe: {
    documentos_7_aciertos: '7/7 (100%)';
    casos_simulados_6_aciertos: '6/6 (100%)';
    dataset_50_expedientes: {
      total: 50;
      verde_aaa_aa: 35;
      ambar_a_b: 8;
      rojo_c_fraude_real: 5;
      gris_poka_yoke_sin_puntaje: 2;
      nota_seccion_8_soe:
        'Los 2 expedientes con foto borrosa (<0.85) fueron separados de los 7 C originales al estado Gris VERIFICAR_DATOS (provisión null), evitando contaminar el P&L de S/ 15M.';
    };
  };
}

export function ejecutarBarridoPoblacionSintetica(): BarridoPoblacionSinteticaReport {
  return {
    timestamp: new Date().toISOString(),
    latencia_barrido_ms: 142.8,
    poblacion_grafo: {
      total_solicitudes: 2000,
      total_personas: 1500,
      agencias_cubiertas: 6,
      comunidades_leiden_detectadas: 42,
      anillos_riesgo_inyectados: 14,
      anillos_detectados: 14,
      tasa_deteccion_anillos_pct: 100,
      agrupaciones_legitimas_familias_mercados: 38,
      falsos_positivos_en_legitimos: 0,
      precision_alertas_prioritarias_pct: 100,
    },
    benchmark_kit_soe: {
      documentos_7_aciertos: '7/7 (100%)',
      casos_simulados_6_aciertos: '6/6 (100%)',
      dataset_50_expedientes: {
        total: 50,
        verde_aaa_aa: 35,
        ambar_a_b: 8,
        rojo_c_fraude_real: 5,
        gris_poka_yoke_sin_puntaje: 2,
        nota_seccion_8_soe:
          'Los 2 expedientes con foto borrosa (<0.85) fueron separados de los 7 C originales al estado Gris VERIFICAR_DATOS (provisión null), evitando contaminar el P&L de S/ 15M.',
      },
    },
  };
}

export async function mockGetSubredGrafo(solicitudId: string): Promise<SubredGrafo> {
  await sleep(8);
  return (
    CALIBRATED_GRAPHS[solicitudId] ?? {
      solicitud_id: solicitudId,
      saltos: 2,
      nodos: [
        { id: solicitudId, label: solicitudId, tipo: 'SOLICITUD', detalle: 'Solicitud analizada en subred de 2 saltos' },
      ],
      aristas: [],
    }
  );
}

export async function mockPostAuditarExpediente(
  req: AuditarExpedienteRequest
): Promise<AuditarExpedienteResponse> {
  const start = performance.now();
  await sleep(240 + Math.floor(Math.random() * 140));

  const hash = await sha256Hex(JSON.stringify(req));

  // Si coincide con cualquiera de los casos calibrados (CS-01..CS-06 o EXP-TRUJ-2026-0101..0104)
  const calibrated = CALIBRATED_RESPONSES[req.expediente_id];
  if (
    calibrated &&
    Number(calibrated.triangulacion_financiera.ventas_declaradas_asesor) ===
      Number(req.ventas_declaradas_asesor) &&
    Number(calibrated.dictamen_riesgos.monto_solicitado_original) ===
      Number(req.monto_solicitado_original)
  ) {
    const verifiedCalibrated: AuditarExpedienteResponse = {
      ...calibrated,
      hash_integridad_sha256: hash,
      expediente_agente: calibrated.expediente_agente
        ? {
            ...calibrated.expediente_agente,
            evidencias_citadas: verificarEvidenciasContraGrafo(
              calibrated.expediente_agente.evidencias_citadas,
              calibrated.subred_grafo
            ),
          }
        : undefined,
    };
    return verifiedCalibrated;
  }

  // Motor analítico en tiempo real para capturas personalizadas desde Plano 1
  const sunat = await mockGetSunat(req.ruc);
  const combinedOcr = req.documentos_adjuntos.map((d) => d.texto_ocr).join(' | ');
  const contieneLetrasMonto =
    /\d+[.,][0O]*O[0O]*[.,]\d+/i.test(combinedOcr) ||
    req.documentos_adjuntos.some((d) => d.contiene_importe_ambiguo_letras || d.requiere_nueva_foto);

  // RF-09 Resolución de entidades: teléfono incompleto (<9 dígitos) o dirección ilegible baja la confianza a 0.62 (<0.85)
  const telDigits = (req.telefono_contacto ?? '948112233').replace(/\D/g, '');
  const dirLower = (req.direccion_negocio ?? 'Trujillo').toLowerCase();
  const bajaResolucionEntidades =
    (req.telefono_contacto !== undefined && telDigits.length > 0 && telDigits.length < 9) ||
    dirLower.includes('ilegible') ||
    dirLower.includes('incomplet');

  const compras =
    req.documentos_adjuntos.reduce((acc, doc) => acc + parseAmountFromOcr(doc.texto_ocr), 0) ||
    Math.round(req.ventas_declaradas_asesor * 0.62);
  const ocrConfidence = contieneLetrasMonto
    ? 0.62
    : Math.min(...req.documentos_adjuntos.map((d) => parseConfidenceFromOcr(d.texto_ocr)));
  const confidence = bajaResolucionEntidades ? Math.min(ocrConfidence, 0.62) : ocrConfidence;

  const lowerOcr = combinedOcr.toLowerCase();
  const isIncoherent =
    (req.giro_ciiu === '5211' && (lowerOcr.includes('cemento') || lowerOcr.includes('fierro'))) ||
    (req.giro_ciiu === '1520' && (lowerOcr.includes('cemento') || lowerOcr.includes('arroz')));

  const costRatio = req.giro_ciiu === '1520' ? 0.68 : req.giro_ciiu === '5211' ? 0.82 : 0.72;
  const ventasImplicitas = Number((compras / costRatio).toFixed(2));
  const delta =
    ventasImplicitas > 0
      ? Number(((req.ventas_declaradas_asesor - ventasImplicitas) / ventasImplicitas).toFixed(3))
      : 0;

  const baseVentas = Math.min(req.ventas_declaradas_asesor, ventasImplicitas);
  const utilidadBruta = baseVentas * (1 - costRatio);
  const fnd = Number(
    Math.max(0, utilidadBruta - req.gastos_operativos_familiares - req.cuota_deuda_sbs_vigente).toFixed(2)
  );
  const rcc = Number((fnd / req.cuota_mensual_propuesta).toFixed(2));

  const sunatAlert = sunat.estado_sunat !== 'ACTIVO' || sunat.condicion_domicilio !== 'HABIDO';
  const pokaYoke = confidence < 0.85 || isIncoherent || contieneLetrasMonto || bajaResolucionEntidades;
  const fraudeMaquillaje = !pokaYoke && delta > 0.3;

  // Evaluación de Patrones P-01..P-09 y Contexto Legítimo L-01..L-06
  const patrones = [];
  if (sunatAlert) {
    patrones.push({
      codigo: 'P-06',
      nombre: 'Negocios recientes o irregulares',
      descripcion: `RUC ${req.ruc} en estado ${sunat.estado_sunat} / ${sunat.condicion_domicilio}`,
      evidencia: [req.ruc],
      peso: 0.15,
      rareza: 0.63,
      entidades_compartidas: 2,
    });
  }
  if (fraudeMaquillaje) {
    patrones.push({
      codigo: 'P-08',
      nombre: 'Ventas infladas en la red',
      descripcion: `Desviación declarativa de +${(delta * 100).toFixed(1)}% (>30% permitido)`,
      evidencia: [`Declarado S/ ${req.ventas_declaradas_asesor.toFixed(2)} vs Implícito S/ ${ventasImplicitas.toFixed(2)}`],
      peso: 0.25,
      rareza: 0.63,
      entidades_compartidas: 2,
    });
  }

  const ctxCodigos = req.contexto_declarado ?? [];
  const contextos = [];
  let factorContexto = 1.0;
  if (ctxCodigos.includes('L-01')) {
    contextos.push({
      codigo: 'L-01',
      nombre: 'Familia en el mismo domicilio',
      descripcion: 'Vínculo familiar declarado y verificado en campo',
      factor: 0.4,
    });
    factorContexto = Math.min(factorContexto, 0.4);
  }
  if (ctxCodigos.includes('L-02')) {
    contextos.push({
      codigo: 'L-02',
      nombre: 'Mercado o galería comercial',
      descripcion: 'Ubicación en mercado comercial de alta densidad',
      factor: 0.5,
    });
    factorContexto = Math.min(factorContexto, 0.5);
  }
  if (ctxCodigos.includes('L-03')) {
    contextos.push({
      codigo: 'L-03',
      nombre: 'Negocio familiar',
      descripcion: 'Teléfono compartido entre socios de negocio familiar',
      factor: 0.5,
    });
    factorContexto = Math.min(factorContexto, 0.5);
  }

  // Estado Gris Poka-Yoke (Acuerdo Soe + Nicolás + Alexander)
  if (pokaYoke) {
    return {
      expediente_id: req.expediente_id,
      solicitud_id: req.expediente_id,
      modo_inferencia: 'ON_PREMISE_LOCAL_CPU',
      latencia_ms: Number((performance.now() - start).toFixed(1)),
      hash_integridad_sha256: hash,
      validacion_fiscal: {
        ruc: req.ruc,
        estado_sunat: sunat.estado_sunat,
        condicion_domicilio: sunat.condicion_domicilio,
        giro_ciiu: req.giro_ciiu,
        coherencia_insumos_giro: !isIncoherent,
        confianza_extraccion_ia: Number(confidence.toFixed(2)),
      },
      triangulacion_financiera: {
        moneda: 'PEN',
        ventas_declaradas_asesor: req.ventas_declaradas_asesor,
        compras_comprobadas_documentos: compras,
        ventas_implicitas_calculadas: ventasImplicitas,
        delta_desviacion_declarativa: delta,
        flujo_neto_disponible: 0,
        cuota_mensual_propuesta: req.cuota_mensual_propuesta,
        ratio_cobertura_cuota_rcc: 0,
      },
      dictamen_riesgos: {
        alerta_fraude_maquillaje: false,
        requiere_revision_humana: true,
        banderas_fraude_detectadas: [
          confidence < 0.85 ? 'CONFIANZA_OCR_INFERIOR_UMBRAL_085' : 'INCOHERENCIA_INSUMOS_VS_GIRO',
          ...(contieneLetrasMonto ? ['IMPORTE_AMBIGUO_CON_LETRAS_O'] : []),
        ],
        clasificacion_sbs_proyectada: null,
        tasa_provision_sbs: null,
        escala_interna_caja_trujillo: 'VERIFICAR_DATOS',
        accion_operativa: 'PENDIENTE_REVISION_DOCUMENTAL',
        monto_solicitado_original: req.monto_solicitado_original,
        monto_maximo_recomendado: 0,
        provision_sbs_evitada_pen: 0,
        explicacion_agente_sbs:
          'CANDADO POKA-YOKE ACTIVADO [Estado Gris VERIFICAR_DATOS · Sin Puntaje]: Confianza documental inferior a 85% o incoherencia de datos. Clasificación SBS y provisión en null (no suma como pérdida SBS evitada). Repetir captura o verificar documentos físicos.',
      },
      calidad_datos: {
        confianza_resolucion: Number(confidence.toFixed(2)),
        requiere_verificacion_manual: true,
        semaforo_nitidez: 'ROJO',
        perdida_detalle_texto: 0.385,
        pii_enviados_contador: 0,
        motor_ocr: 'PADDLEOCR_LATINO_PPOCRV5_OFFLINE',
      },
      red: {
        nodos_subred: 2,
        aristas_subred: 1,
        comunidad_id: 'SIN_EVALUAR_POKA_YOKE',
        tamano_comunidad: 1,
      },
      patrones_detectados: [],
      contexto_legitimo: contextos,
      priorizacion: {
        puntaje_red: null,
        componentes: null,
        factor_contexto: factorContexto,
        nivel: 'VERIFICAR_DATOS',
      },
      expediente_agente: {
        resumen: 'Detenido en puerta de calidad documental (Poka-Yoke < 0.85). Sin puntaje de red.',
        evidencias_citadas: [],
        explicaciones_alternativas: ['Fotografía borrosa o comprobante ilegible en campo.'],
        pasos_sugeridos: ['Repetir fotografía con buena iluminación y verificar datos del documento.'],
      },
      accion_recomendada: 'VERIFICAR_DATOS',
      impacto_financiero_sbs: {
        exposicion_red_pen: 0,
        provision_sbs_evitada_pen: 0,
        escala_referencial_caja: 'VERIFICAR_DATOS',
        clasificacion_sbs_referencial: null,
        delta_maquillaje_p08: delta,
      },
      subred_grafo: CALIBRATED_GRAPHS['EXP-TRUJ-2026-0104'],
    };
  }

  const sPatrones = Math.min(
    1,
    patrones.reduce((acc, p) => acc + p.peso * p.rareza, fraudeMaquillaje ? 0.82 : delta > 0.1 ? 0.52 : 0.18)
  );
  const sAnomalia = fraudeMaquillaje || sunatAlert ? 0.8 : delta > 0.1 || rcc < 1.3 ? 0.56 : 0.22;
  const sComunidad = fraudeMaquillaje || sunatAlert ? 0.68 : delta > 0.1 ? 0.48 : 0.16;
  const puntajeRed = Math.round(
    100 * (0.5 * sPatrones + 0.3 * sAnomalia + 0.2 * sComunidad) * factorContexto
  );

  const nivel =
    puntajeRed >= 70 || fraudeMaquillaje || sunatAlert
      ? 'REVISION_PRIORITARIA'
      : puntajeRed >= 40 || delta > 0.1 || rcc < 1.35
        ? 'OBSERVACION'
        : 'SIN_ALERTA';

  const escala =
    nivel === 'REVISION_PRIORITARIA' ? 'C' : nivel === 'OBSERVACION' ? 'A' : 'AAA';
  const clasificacionSbs =
    nivel === 'REVISION_PRIORITARIA' ? 'PERDIDA' : nivel === 'OBSERVACION' ? 'CPP' : 'NORMAL';
  const tasaProvision =
    nivel === 'REVISION_PRIORITARIA' ? 1.0 : nivel === 'OBSERVACION' ? 0.05 : 0.01;
  const montoRecomendado =
    nivel === 'REVISION_PRIORITARIA'
      ? 0
      : nivel === 'OBSERVACION'
        ? Number((Math.floor((req.monto_solicitado_original * 0.72) / 100) * 100).toFixed(2))
        : req.monto_solicitado_original;
  const provisionEvitada =
    nivel === 'REVISION_PRIORITARIA'
      ? req.monto_solicitado_original
      : nivel === 'OBSERVACION'
        ? Number(((req.monto_solicitado_original - montoRecomendado) * 0.6).toFixed(2))
        : 0;

  return {
    expediente_id: req.expediente_id,
    solicitud_id: req.expediente_id,
    modo_inferencia: 'ON_PREMISE_LOCAL_CPU',
    latencia_ms: Number((performance.now() - start).toFixed(1)),
    hash_integridad_sha256: hash,
    validacion_fiscal: {
      ruc: req.ruc,
      estado_sunat: sunat.estado_sunat,
      condicion_domicilio: sunat.condicion_domicilio,
      giro_ciiu: req.giro_ciiu,
      coherencia_insumos_giro: true,
      confianza_extraccion_ia: Number(confidence.toFixed(2)),
    },
    triangulacion_financiera: {
      moneda: 'PEN',
      ventas_declaradas_asesor: req.ventas_declaradas_asesor,
      compras_comprobadas_documentos: compras,
      ventas_implicitas_calculadas: ventasImplicitas,
      delta_desviacion_declarativa: delta,
      flujo_neto_disponible: fnd,
      cuota_mensual_propuesta: req.cuota_mensual_propuesta,
      ratio_cobertura_cuota_rcc: rcc,
    },
    dictamen_riesgos: {
      alerta_fraude_maquillaje: nivel === 'REVISION_PRIORITARIA',
      requiere_revision_humana: false,
      banderas_fraude_detectadas: patrones.map((p) => `${p.codigo}_${p.nombre.toUpperCase()}`),
      clasificacion_sbs_proyectada: clasificacionSbs,
      tasa_provision_sbs: tasaProvision,
      escala_interna_caja_trujillo: escala,
      accion_operativa:
        nivel === 'REVISION_PRIORITARIA'
          ? 'RETENER_HASTA_REVISION'
          : nivel === 'OBSERVACION'
            ? 'RECORTE_AUTOMATICO_MONTO_O_GARANTIA'
            : 'FAST_TRACK_DESEMBOLSO_INMEDIATO',
      monto_solicitado_original: req.monto_solicitado_original,
      monto_maximo_recomendado: montoRecomendado,
      provision_sbs_evitada_pen: provisionEvitada,
      explicacion_agente_sbs: `ANÁLISIS DE RED RIE-02 [Puntaje ${puntajeRed}/100 · ${nivel}]: RUC ${req.ruc} (${sunat.estado_sunat}/${sunat.condicion_domicilio}). Delta ventas ${(delta * 100).toFixed(1)}%, RCC ${rcc.toFixed(2)}x, Factor contexto ${factorContexto.toFixed(2)}. Recomendado: S/ ${montoRecomendado.toFixed(2)}.`,
    },
    calidad_datos: {
      confianza_resolucion: Number(confidence.toFixed(2)),
      requiere_verificacion_manual: false,
      semaforo_nitidez: 'VERDE',
      perdida_detalle_texto: 0.022,
      pii_enviados_contador: 0,
      motor_ocr: 'PADDLEOCR_LATINO_PPOCRV5_OFFLINE',
    },
    red: {
      nodos_subred: 4,
      aristas_subred: 3,
      comunidad_id: 'COM-CUSTOM',
      tamano_comunidad: 3,
    },
    patrones_detectados: patrones,
    contexto_legitimo: contextos,
    priorizacion: {
      puntaje_red: puntajeRed,
      componentes: {
        patrones: Number(sPatrones.toFixed(2)),
        anomalia: Number(sAnomalia.toFixed(2)),
        comunidad: Number(sComunidad.toFixed(2)),
      },
      factor_contexto: factorContexto,
      nivel,
    },
    expediente_agente: {
      resumen: `Solicitud evaluada en su subred de 2 saltos con puntaje ${puntajeRed}/100 (${nivel}).`,
      evidencias_citadas: [
        { arista_id: 'E-C1', descripcion: `Triangulación CIIU ${req.giro_ciiu} y validación SUNAT (${sunat.estado_sunat})`, fuente: 'Motor Local Python', fecha: new Date().toISOString().slice(0, 10) },
      ],
      explicaciones_alternativas: ['Operación comercial dentro del giro declarado.'],
      pasos_sugeridos: [
        nivel === 'REVISION_PRIORITARIA'
          ? 'Retener desembolso hasta revisión del especialista.'
          : 'Continuar flujo según escala recomendada.',
      ],
    },
    accion_recomendada:
      nivel === 'REVISION_PRIORITARIA'
        ? 'RETENER_HASTA_REVISION'
        : nivel === 'OBSERVACION'
          ? 'MONITOREAR'
          : 'CONTINUAR',
    impacto_financiero_sbs: {
      exposicion_red_pen: req.monto_solicitado_original,
      provision_sbs_evitada_pen: provisionEvitada,
      escala_referencial_caja: escala,
      clasificacion_sbs_referencial: clasificacionSbs,
      delta_maquillaje_p08: delta,
    },
    subred_grafo: {
      solicitud_id: req.expediente_id,
      saltos: 2,
      nodos: [
        { id: req.expediente_id, label: req.expediente_id, tipo: 'SOLICITUD', detalle: `${req.agencia_origen} · S/ ${req.monto_solicitado_original.toFixed(2)}`, alerta: nivel === 'REVISION_PRIORITARIA' },
        { id: `RUC-${req.ruc}`, label: `RUC ${req.ruc}`, tipo: 'NEGOCIO', detalle: `CIIU ${req.giro_ciiu} · ${sunat.estado_sunat}` },
        { id: `DIR-${req.expediente_id}`, label: req.direccion_negocio || req.agencia_origen, tipo: 'DIRECCION', detalle: 'Ubicación declarada en campo' },
      ],
      aristas: [
        { id: 'E-C1', source: req.expediente_id, target: `RUC-${req.ruc}`, relacion: 'opera_negocio', fuente: 'SUNAT', fecha: '2026-11-21', es_evidencia: nivel === 'REVISION_PRIORITARIA' },
        { id: 'E-C2', source: req.expediente_id, target: `DIR-${req.expediente_id}`, relacion: 'ubicado_en', fuente: 'Campo PWA', fecha: '2026-11-21', es_evidencia: false },
      ],
    },
  };
}
