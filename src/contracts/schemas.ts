import { z } from 'zod';

/**
 * CONTRATO JSON UNIFICADO v2.0 (RIE-02 Grafos + Informe Agente Local Soe + P&L SBS Nicolás)
 * Mantiene compatibilidad total con v1.0 (4 bloques) y extiende con los bloques de red RIE-02.
 */

export const SemaforoNitidezSchema = z.enum(['VERDE', 'AMARILLO', 'ROJO']);

export const DocumentoAdjuntoSchema = z.object({
  doc_id: z.string().min(1),
  tipo_documento: z.string().min(1),
  texto_ocr: z.string().min(1),
  hash_sha256: z.string().optional(),
  nombre_archivo: z.string().optional(),
  semaforo_nitidez: SemaforoNitidezSchema.optional(),
  perdida_detalle_texto: z.number().min(0).max(1).optional(),
  contraste: z.number().nonnegative().optional(),
  resolucion_lado_mayor_px: z.number().nonnegative().optional(),
  requiere_nueva_foto: z.boolean().optional(),
  contiene_importe_ambiguo_letras: z.boolean().optional(),
});

export const ReferenciaVinculoSchema = z.object({
  telefono: z.string().min(6),
  relacion: z.string().min(2),
  nombre_referencia: z.string().optional(),
});

export const AuditarExpedienteRequestSchema = z.object({
  expediente_id: z.string().min(1),
  solicitud_id: z.string().optional(),
  ruc: z.string().regex(/^\d{11}$/, 'El RUC debe tener exactamente 11 dígitos'),
  agencia_origen: z.string().min(1),
  asesor_id: z.string().optional(),
  giro_ciiu: z.string().min(4),
  ventas_declaradas_asesor: z.number().nonnegative(),
  inventario_fisico_estimado: z.number().nonnegative(),
  gastos_operativos_familiares: z.number().nonnegative(),
  cuota_deuda_sbs_vigente: z.number().nonnegative(),
  cuota_mensual_propuesta: z.number().positive(),
  monto_solicitado_original: z.number().positive(),
  documentos_adjuntos: z.array(DocumentoAdjuntoSchema).min(1),
  // Vínculos de red RIE-02 (Plano 1)
  telefono_contacto: z.string().optional(),
  direccion_negocio: z.string().optional(),
  geolocalizacion: z.tuple([z.number(), z.number()]).optional(),
  dispositivo_fingerprint: z.string().optional(),
  dispositivo_tipo: z.enum(['CLIENTE', 'CORPORATIVO_ASESOR']).optional(),
  referencias: z.array(ReferenciaVinculoSchema).optional(),
  contexto_declarado: z.array(z.string()).optional(),
  consentimiento_datos_ley29733: z.boolean().optional(),
});

export const ValidacionFiscalSchema = z.object({
  ruc: z.string().min(11),
  estado_sunat: z.string().min(1),
  condicion_domicilio: z.string().min(1),
  giro_ciiu: z.string().min(4),
  coherencia_insumos_giro: z.boolean(),
  confianza_extraccion_ia: z.number().min(0).max(1),
});

export const TriangulacionFinancieraSchema = z.object({
  moneda: z.literal('PEN'),
  ventas_declaradas_asesor: z.number(),
  compras_comprobadas_documentos: z.number(),
  ventas_implicitas_calculadas: z.number(),
  delta_desviacion_declarativa: z.number(),
  flujo_neto_disponible: z.number(),
  cuota_mensual_propuesta: z.number(),
  ratio_cobertura_cuota_rcc: z.number(),
});

/**
 * Acuerdo Soe + Nicolás + Alexander (Sección 8 & 10):
 * Cuando se activa el Candado Poka-Yoke (VERIFICAR_DATOS / PENDIENTE_REVISION_DOCUMENTAL),
 * clasificacion_sbs_proyectada y tasa_provision_sbs pueden ser null para no inflar pérdidas SBS.
 */
export const DictamenRiesgosSchema = z.object({
  alerta_fraude_maquillaje: z.boolean(),
  requiere_revision_humana: z.boolean(),
  banderas_fraude_detectadas: z.array(z.string()),
  clasificacion_sbs_proyectada: z.string().nullable(),
  tasa_provision_sbs: z.number().min(0).max(1).nullable(),
  escala_interna_caja_trujillo: z.string().min(1),
  accion_operativa: z.string().min(1),
  monto_solicitado_original: z.number().nonnegative(),
  monto_maximo_recomendado: z.number().nonnegative(),
  explicacion_agente_sbs: z.string().min(1),
  provision_sbs_evitada_pen: z.number().nonnegative().optional(),
});

// ── Bloques RIE-02 v2.0 + Agente Local Soe ────────────────────────

export const CalidadDatosSchema = z.object({
  confianza_resolucion: z.number().min(0).max(1),
  requiere_verificacion_manual: z.boolean(),
  semaforo_nitidez: SemaforoNitidezSchema.optional(),
  perdida_detalle_texto: z.number().min(0).max(1).optional(),
  contraste: z.number().nonnegative().optional(),
  resolucion_lado_mayor_px: z.number().nonnegative().optional(),
  requiere_nueva_foto: z.boolean().optional(),
  contiene_importe_ambiguo_letras: z.boolean().optional(),
  pii_enviados_contador: z.number().int().nonnegative().default(0),
  motor_ocr: z.string().optional(),
  motivo_calidad: z.string().optional(),
});

export const ResumenRedSchema = z.object({
  nodos_subred: z.number().int().nonnegative(),
  aristas_subred: z.number().int().nonnegative(),
  comunidad_id: z.string().min(1),
  tamano_comunidad: z.number().int().nonnegative(),
});

export const PatronDetectadoSchema = z.object({
  codigo: z.string().min(1),
  nombre: z.string().optional(),
  descripcion: z.string().min(1),
  evidencia: z.array(z.string()),
  peso: z.number().min(0).max(1),
  rareza: z.number().min(0).max(1),
  entidades_compartidas: z.number().int().positive().optional(),
});

export const ContextoLegitimoAplicadoSchema = z.object({
  codigo: z.string().min(1),
  nombre: z.string().optional(),
  descripcion: z.string().min(1),
  factor: z.number().min(0).max(1),
});

export const NivelPrioridadRedSchema = z.enum([
  'SIN_ALERTA',
  'OBSERVACION',
  'REVISION_PRIORITARIA',
  'VERIFICAR_DATOS',
]);

export const PriorizacionRedSchema = z.object({
  puntaje_red: z.number().min(0).max(100).nullable(),
  componentes: z
    .object({
      patrones: z.number().min(0).max(1),
      anomalia: z.number().min(0).max(1),
      comunidad: z.number().min(0).max(1),
    })
    .nullable(),
  factor_contexto: z.number().min(0).max(1),
  nivel: NivelPrioridadRedSchema,
});

export const EvidenciaCitadaGrafoSchema = z.object({
  arista_id: z.string().min(1),
  descripcion: z.string().min(1),
  fuente: z.string().min(1),
  fecha: z.string().min(1),
});

export const ExpedienteAgenteInvestigadorSchema = z.object({
  resumen: z.string().min(1),
  evidencias_citadas: z.array(EvidenciaCitadaGrafoSchema).optional(),
  explicaciones_alternativas: z.array(z.string()),
  pasos_sugeridos: z.array(z.string()),
});

export const AccionRecomendadaSchema = z.enum([
  'CONTINUAR',
  'MONITOREAR',
  'RETENER_HASTA_REVISION',
  'VERIFICAR_DATOS',
]);

export const ImpactoFinancieroSbsSchema = z.object({
  exposicion_red_pen: z.number().nonnegative(),
  provision_sbs_evitada_pen: z.number().nonnegative(),
  escala_referencial_caja: z.string().min(1),
  clasificacion_sbs_referencial: z.string().nullable(),
  delta_maquillaje_p08: z.number(),
});

export const GrafoNodoTipoSchema = z.enum([
  'SOLICITUD',
  'PERSONA',
  'NEGOCIO',
  'TELEFONO',
  'DISPOSITIVO',
  'DIRECCION',
  'REFERENCIA',
  'ASESOR',
]);

export const GrafoNodoSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  tipo: GrafoNodoTipoSchema,
  detalle: z.string().optional(),
  monto_pen: z.number().optional(),
  fecha: z.string().optional(),
  agencia: z.string().optional(),
  alerta: z.boolean().optional(),
});

export const GrafoAristaSchema = z.object({
  id: z.string().min(1),
  source: z.string().min(1),
  target: z.string().min(1),
  relacion: z.string().min(1),
  fuente: z.string().optional(),
  fecha: z.string().optional(),
  es_evidencia: z.boolean().default(false),
});

export const SubredGrafoSchema = z.object({
  solicitud_id: z.string().min(1),
  saltos: z.number().int().positive().default(2),
  nodos: z.array(GrafoNodoSchema),
  aristas: z.array(GrafoAristaSchema),
});

export const AuditarExpedienteResponseSchema = z.object({
  expediente_id: z.string().min(1),
  solicitud_id: z.string().optional(),
  modo_inferencia: z.string().min(1),
  latencia_ms: z.number().nonnegative(),
  hash_integridad_sha256: z.string().min(8),
  validacion_fiscal: ValidacionFiscalSchema,
  triangulacion_financiera: TriangulacionFinancieraSchema,
  dictamen_riesgos: DictamenRiesgosSchema,
  // Bloques v2.0 RIE-02 + Agente Local Soe
  calidad_datos: CalidadDatosSchema.optional(),
  red: ResumenRedSchema.optional(),
  patrones_detectados: z.array(PatronDetectadoSchema).optional(),
  contexto_legitimo: z.array(ContextoLegitimoAplicadoSchema).optional(),
  priorizacion: PriorizacionRedSchema.optional(),
  expediente_agente: ExpedienteAgenteInvestigadorSchema.optional(),
  accion_recomendada: AccionRecomendadaSchema.optional(),
  impacto_financiero_sbs: ImpactoFinancieroSbsSchema.optional(),
  subred_grafo: SubredGrafoSchema.optional(),
});

export const HealthResponseSchema = z.object({
  status: z.enum(['ok', 'degraded']),
  modo_activo: z.string().min(1),
  vps_soberano: z.boolean(),
  latencia_ms: z.number().nonnegative().optional(),
  version: z.string().optional(),
  pii_enviados_total: z.number().int().nonnegative().optional(),
});

export const SunatRucResponseSchema = z.object({
  ruc: z.string().regex(/^\d{11}$/),
  razon_social: z.string().min(1),
  estado_sunat: z.string().min(1),
  condicion_domicilio: z.string().min(1),
  giro_ciiu: z.string().min(4),
  actividad_economica: z.string().optional(),
  distrito: z.string().optional(),
  alerta_sunat: z.boolean().optional(),
  latencia_ms: z.number().nonnegative().optional(),
});

export const GoldenCaseSchema = z.object({
  case_id: z.string().min(1),
  orden: z.number().int().positive(),
  titulo: z.string().min(1),
  subtitulo: z.string().min(1),
  etiqueta_escala: z.string().min(1),
  puntaje_objetivo: z.number().nullable().optional(),
  nivel_esperado: NivelPrioridadRedSchema.optional(),
  resumen_esperado: z.string().min(1),
  payload: AuditarExpedienteRequestSchema,
});

export const GoldenCasesResponseSchema = z.object({
  cases: z.array(GoldenCaseSchema).min(1),
});

export const DecisionEspecialistaSchema = z.object({
  accion: z.enum(['CONFIRMAR', 'DESCARTAR', 'ESCALAR']),
  motivo: z.string().min(3, 'El motivo es obligatorio para registrar la decisión (RN-07).'),
  especialista_id: z.string().default('ESP-TRUJ-01'),
  fecha: z.string(),
  hash_decision_sha256: z.string(),
});

export const EvaluacionFotoResponseSchema = z.object({
  semaforo_nitidez: SemaforoNitidezSchema,
  perdida_detalle_texto: z.number().min(0).max(1),
  contraste: z.number().nonnegative(),
  resolucion_lado_mayor_px: z.number().nonnegative(),
  confianza_ocr: z.number().min(0).max(1),
  requiere_nueva_foto: z.boolean(),
  contiene_importe_ambiguo_letras: z.boolean(),
  pii_enviados_contador: z.number().int().nonnegative(),
  texto_sanitizado: z.string(),
  motor_ocr: z.string(),
  motivo: z.string(),
});

export type SemaforoNitidez = z.infer<typeof SemaforoNitidezSchema>;
export type DocumentoAdjunto = z.infer<typeof DocumentoAdjuntoSchema>;
export type ReferenciaVinculo = z.infer<typeof ReferenciaVinculoSchema>;
export type AuditarExpedienteRequest = z.infer<typeof AuditarExpedienteRequestSchema>;
export type ValidacionFiscal = z.infer<typeof ValidacionFiscalSchema>;
export type TriangulacionFinanciera = z.infer<typeof TriangulacionFinancieraSchema>;
export type DictamenRiesgos = z.infer<typeof DictamenRiesgosSchema>;
export type CalidadDatos = z.infer<typeof CalidadDatosSchema>;
export type ResumenRed = z.infer<typeof ResumenRedSchema>;
export type PatronDetectado = z.infer<typeof PatronDetectadoSchema>;
export type ContextoLegitimoAplicado = z.infer<typeof ContextoLegitimoAplicadoSchema>;
export type NivelPrioridadRed = z.infer<typeof NivelPrioridadRedSchema>;
export type PriorizacionRed = z.infer<typeof PriorizacionRedSchema>;
export type EvidenciaCitadaGrafo = z.infer<typeof EvidenciaCitadaGrafoSchema>;
export type ExpedienteAgenteInvestigador = z.infer<typeof ExpedienteAgenteInvestigadorSchema>;
export type AccionRecomendada = z.infer<typeof AccionRecomendadaSchema>;
export type ImpactoFinancieroSbs = z.infer<typeof ImpactoFinancieroSbsSchema>;
export type GrafoNodoTipo = z.infer<typeof GrafoNodoTipoSchema>;
export type GrafoNodo = z.infer<typeof GrafoNodoSchema>;
export type GrafoArista = z.infer<typeof GrafoAristaSchema>;
export type SubredGrafo = z.infer<typeof SubredGrafoSchema>;
export type AuditarExpedienteResponse = z.infer<typeof AuditarExpedienteResponseSchema>;
export type HealthResponse = z.infer<typeof HealthResponseSchema>;
export type SunatRucResponse = z.infer<typeof SunatRucResponseSchema>;
export type GoldenCase = z.infer<typeof GoldenCaseSchema>;
export type DecisionEspecialista = z.infer<typeof DecisionEspecialistaSchema>;
export type EvaluacionFotoResponse = z.infer<typeof EvaluacionFotoResponseSchema>;

export type EstadoOperativoLocal =
  | 'AUDITADO'
  | 'DESEMBOLSADO'
  | 'BLOQUEADO_FRAUDE'
  | 'DERIVADO_AUDITOR'
  | 'ALERTA_CONFIRMADA'
  | 'ALERTA_DESCARTADA'
  | 'ESCALADO_JEFATURA';

export interface ExpedienteAuditadoRecord {
  expediente_id: string;
  titulo_caso?: string;
  agencia_origen: string;
  razon_social?: string;
  creado_en: string;
  actualizado_en: string;
  origen: 'CAMPO_ONLINE' | 'CAMPO_OFFLINE_SYNC' | 'DEMO_RAPIDA';
  estado_local: EstadoOperativoLocal;
  request: AuditarExpedienteRequest;
  response: AuditarExpedienteResponse;
  decision_especialista?: DecisionEspecialista;
  contract_warning?: string;
}

export interface OfflineQueueItem {
  queue_id: string;
  created_at: string;
  attempts: number;
  last_error?: string;
  titulo_caso?: string;
  razon_social?: string;
  payload: AuditarExpedienteRequest;
}
