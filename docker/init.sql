-- WASI-RISK AI (NODUX SENTINEL) — Esquema PostgreSQL 17
-- Sigue buenas prácticas Postgres (bigint identity, numeric para PEN S/, timestamptz, checks e índices).

create table if not exists public.sunat_padron (
  id bigint generated always as identity primary key,
  ruc text not null unique check (ruc ~ '^\d{11}$'),
  razon_social text not null,
  estado_sunat text not null,
  condicion_domicilio text not null,
  giro_ciiu text not null check (char_length(giro_ciiu) >= 4),
  actividad_economica text,
  distrito text,
  alerta_sunat boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_sunat_padron_ciiu on public.sunat_padron (giro_ciiu);
create index if not exists idx_sunat_padron_alerta on public.sunat_padron (alerta_sunat) where alerta_sunat = true;

create table if not exists public.golden_cases (
  id bigint generated always as identity primary key,
  case_id text not null unique,
  orden integer not null unique check (orden > 0),
  titulo text not null,
  subtitulo text not null,
  etiqueta_escala text not null,
  resumen_esperado text not null,
  payload jsonb not null,
  calibrated_response jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists public.expedientes_auditados (
  id bigint generated always as identity primary key,
  expediente_id text not null unique,
  titulo_caso text,
  razon_social text,
  agencia_origen text not null,
  ruc text not null check (ruc ~ '^\d{11}$'),
  giro_ciiu text not null,
  moneda text not null default 'PEN' check (moneda = 'PEN'),
  escala_interna_caja_trujillo text not null,
  clasificacion_sbs_proyectada text,
  puntaje_red integer check (puntaje_red is null or (puntaje_red >= 0 and puntaje_red <= 100)),
  nivel_priorizacion text,
  alerta_fraude_maquillaje boolean not null default false,
  requiere_revision_humana boolean not null default false,
  monto_solicitado_original numeric(12, 2) not null check (monto_solicitado_original > 0),
  monto_maximo_recomendado numeric(12, 2) not null check (monto_maximo_recomendado >= 0),
  provision_sbs_evitada_pen numeric(12, 2) not null default 0 check (provision_sbs_evitada_pen >= 0),
  delta_desviacion_declarativa numeric(8, 4) not null default 0,
  ratio_cobertura_cuota_rcc numeric(8, 2) not null default 0,
  confianza_extraccion_ia numeric(5, 4) not null default 0 check (confianza_extraccion_ia >= 0 and confianza_extraccion_ia <= 1),
  latencia_ms numeric(10, 2) not null default 0,
  hash_integridad_sha256 text not null,
  origen text not null default 'CAMPO_ONLINE' check (origen in ('CAMPO_ONLINE', 'CAMPO_OFFLINE_SYNC', 'DEMO_RAPIDA')),
  estado_local text not null default 'AUDITADO' check (estado_local in ('AUDITADO', 'DESEMBOLSADO', 'BLOQUEADO_FRAUDE', 'DERIVADO_AUDITOR')),
  decision_especialista jsonb,
  request_payload jsonb not null,
  response_payload jsonb not null,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

create index if not exists idx_expedientes_actualizado on public.expedientes_auditados (actualizado_en desc);
create index if not exists idx_expedientes_ruc on public.expedientes_auditados (ruc);
create index if not exists idx_expedientes_escala on public.expedientes_auditados (escala_interna_caja_trujillo);
create index if not exists idx_expedientes_agencia on public.expedientes_auditados (agencia_origen);
create index if not exists idx_expedientes_alertas on public.expedientes_auditados (alerta_fraude_maquillaje, requiere_revision_humana);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_sunat_padron_updated_at on public.sunat_padron;
create trigger trg_sunat_padron_updated_at
before update on public.sunat_padron
for each row execute function public.set_updated_at();

-- ── Seed: 30 RUCs de Trujillo (4 Casos Testigo + 26 MYPEs con alertas NO HABIDO / BAJA) ──

insert into public.sunat_padron
  (ruc, razon_social, estado_sunat, condicion_domicilio, giro_ciiu, actividad_economica, distrito, alerta_sunat)
values
  ('10423189012', 'CALZADO ARTESANAL EL PORVENIR — ROJAS VALDERRAMA LUIS', 'ACTIVO', 'HABIDO', '1520', 'Fabricación de calzado y curtiembre', 'El Porvenir, Trujillo', false),
  ('10489120345', 'DISTRIBUIDORA MAYORISTA HERMELINDA — QUISPE ALFARO MARÍA', 'ACTIVO', 'HABIDO', '5211', 'Venta mayorista y minorista de abarrotes', 'Trujillo — Mercado La Hermelinda', false),
  ('10456712390', 'TALLER CALZADO NORTE EXPRESS — SÁNCHEZ PAREDES CARLOS', 'ACTIVO', 'HABIDO', '1520', 'Fabricación de calzado', 'El Porvenir, Trujillo', false),
  ('10411298765', 'BODEGA Y MINIMARKET SAN MARTÍN — CHÁVEZ MENDOZA ROSA', 'ACTIVO', 'HABIDO', '5211', 'Venta al por menor en comercios no especializados', 'La Esperanza, Trujillo', false),
  ('10401122334', 'CURTIEMBRE SANTA ROSA E.I.R.L.', 'ACTIVO', 'HABIDO', '1520', 'Fabricación de calzado y cuero', 'El Porvenir', false),
  ('10402233445', 'COMERCIAL ABARROTES MOCHE S.A.C.', 'ACTIVO', 'NO HABIDO', '5211', 'Bodegas y abarrotes', 'Moche, Trujillo', true),
  ('10403344556', 'INVERSIONES FERRETERAS FLORENCIA', 'BAJA DE OFICIO', 'NO HABIDO', '4520', 'Ferretería y materiales de construcción', 'Florencia de Mora', true),
  ('10404455667', 'CONFECCIONES TEXTIL LIBERTAD', 'ACTIVO', 'HABIDO', '1810', 'Confección de prendas de vestir', 'Trujillo Centro', false),
  ('10405566778', 'CEVICHERÍA Y POLLERÍA EL MUELLE', 'ACTIVO', 'HABIDO', '5520', 'Restaurantes y pollerías', 'Víctor Larco', false),
  ('10406677889', 'TALLER MECÁNICO AUTOMOTRIZ HUANCHACO', 'ACTIVO', 'HABIDO', '5020', 'Mantenimiento de vehículos', 'Huanchaco', false),
  ('10407788990', 'BOTICA SALUD DEL NORTE', 'ACTIVO', 'HABIDO', '5231', 'Farmacias y boticas', 'La Esperanza', false),
  ('10408899001', 'PANADERÍA TRADICIÓN TRUJILLANA', 'ACTIVO', 'HABIDO', '1541', 'Panaderías y pastelerías', 'Trujillo Centro', false),
  ('10409900112', 'MUEBLERÍA Y CARPINTERÍA SAN ISIDRO', 'ACTIVO', 'HABIDO', '3610', 'Carpintería y muebles', 'Trujillo', false),
  ('10410011223', 'ELECTROHOGAR LARCO S.R.L.', 'SUSPENSION TEMPORAL', 'NO HABIDO', '5233', 'Electrodomésticos y tecnología', 'Víctor Larco', true),
  ('20601234567', 'CALZADO INDUSTRIAL ALTO TRUJILLO S.A.C.', 'ACTIVO', 'HABIDO', '1520', 'Fabricación de calzado de seguridad', 'El Porvenir', false),
  ('20602345678', 'AGROCOMERCIAL VALLE CHICAMA S.A.C.', 'ACTIVO', 'HABIDO', '0111', 'Comercio agrícola y granos', 'Trujillo — Hermelinda', false),
  ('20603456789', 'TRANSPORTES CARGA LIBERTAD E.I.R.L.', 'ACTIVO', 'HABIDO', '6021', 'Transporte urbano y carga ligera', 'La Esperanza', false),
  ('20604567890', 'MODA Y CALZADO GALERÍA ESPAÑA S.A.C.', 'ACTIVO', 'HABIDO', '5232', 'Comercio minorista de ropa y calzado', 'Trujillo Centro', false),
  ('20605678901', 'IMPRENTA Y SERVICIOS GRÁFICOS UPAO', 'ACTIVO', 'HABIDO', '7499', 'Servicios técnicos e imprenta', 'Víctor Larco', false),
  ('20606789012', 'FERRETERÍA EL CONSTRUCTOR DEL NORTE', 'ACTIVO', 'HABIDO', '4520', 'Ferretería y materiales', 'El Porvenir', false),
  ('10412345671', 'AVÍCOLA SAN NICOLÁS — VARGAS RÍOS PEDRO', 'ACTIVO', 'HABIDO', '0111', 'Comercio agrícola y avicultura', 'Hermelinda', false),
  ('10413456782', 'ZAPATERÍA MODELO GRAN CHIMÚ', 'ACTIVO', 'HABIDO', '1520', 'Fabricación de calzado', 'El Porvenir', false),
  ('10414567893', 'MINIMARKET LAS QUINTANAS', 'ACTIVO', 'HABIDO', '5211', 'Bodegas y abarrotes', 'Trujillo', false),
  ('10415678904', 'COMERCIAL TEXTIL MAYORISTA CENTRAL', 'ACTIVO', 'NO HABIDO', '1810', 'Confección textil', 'La Esperanza', true),
  ('10416789015', 'POLLERÍA BRASAS DEL PORVENIR', 'ACTIVO', 'HABIDO', '5520', 'Restaurantes y pollerías', 'El Porvenir', false),
  ('10417890126', 'SERVICIOS AUTOMOTRICES AMÉRICA', 'ACTIVO', 'HABIDO', '5020', 'Talleres mecánicos', 'Trujillo Centro', false),
  ('10418901237', 'FARMACIA VIRGEN DE LA PUERTA', 'ACTIVO', 'HABIDO', '5231', 'Farmacias y boticas', 'Florencia de Mora', false),
  ('10419012348', 'PASTELERÍA DULCE NORTE', 'ACTIVO', 'HABIDO', '1541', 'Panaderías y pastelerías', 'Víctor Larco', false),
  ('10420123459', 'CARPINTERÍA METÁLICA LA ESPERANZA', 'BAJA DEFINITIVA', 'NO HABIDO', '3610', 'Carpintería y muebles', 'La Esperanza', true),
  ('10421234560', 'TECNOCELULARES PIZARRO E.I.R.L.', 'ACTIVO', 'HABIDO', '5233', 'Electrodomésticos y tecnología', 'Trujillo Centro', false)
on conflict (ruc) do nothing;

-- ── Seed: 4 Casos Testigo Calibrados del Brief Técnico ──

insert into public.golden_cases
  (case_id, orden, titulo, subtitulo, etiqueta_escala, resumen_esperado, payload, calibrated_response)
values
  (
    'GC-01', 1, '1. Calzado El Porvenir', 'CIIU 1520 · Fast-Track AAA', 'AAA',
    'Aprueba S/ 8,000.00 sin recorte · Delta -2.1% · RCC 1.71x',
    '{
      "expediente_id": "EXP-TRUJ-2026-0101",
      "ruc": "10423189012",
      "agencia_origen": "Agencia El Porvenir",
      "giro_ciiu": "1520",
      "ventas_declaradas_asesor": 7200.00,
      "inventario_fisico_estimado": 6400.00,
      "gastos_operativos_familiares": 410.00,
      "cuota_deuda_sbs_vigente": 214.00,
      "cuota_mensual_propuesta": 980.00,
      "monto_solicitado_original": 8000.00,
      "documentos_adjuntos": [
        { "doc_id": "DOC-1", "tipo_documento": "FACTURA_MAYORISTA", "texto_ocr": "180 pies cuero + suela -> S/ 5,000.00 (OCR: 0.95)" }
      ]
    }'::jsonb,
    '{
      "expediente_id": "EXP-TRUJ-2026-0101",
      "modo_inferencia": "HIBRIDO_SANITIZADO_DEEPSEEK_POSTGRES",
      "latencia_ms": 680.4,
      "validacion_fiscal": {
        "ruc": "10423189012", "estado_sunat": "ACTIVO", "condicion_domicilio": "HABIDO",
        "giro_ciiu": "1520", "coherencia_insumos_giro": true, "confianza_extraccion_ia": 0.95
      },
      "triangulacion_financiera": {
        "moneda": "PEN", "ventas_declaradas_asesor": 7200.00, "compras_comprobadas_documentos": 5000.00,
        "ventas_implicitas_calculadas": 7352.94, "delta_desviacion_declarativa": -0.021,
        "flujo_neto_disponible": 1680.00, "cuota_mensual_propuesta": 980.00, "ratio_cobertura_cuota_rcc": 1.71
      },
      "dictamen_riesgos": {
        "alerta_fraude_maquillaje": false, "requiere_revision_humana": false,
        "banderas_fraude_detectadas": [], "clasificacion_sbs_proyectada": "NORMAL", "tasa_provision_sbs": 0.01,
        "escala_interna_caja_trujillo": "AAA", "accion_operativa": "FAST_TRACK_DESEMBOLSO_INMEDIATO",
        "monto_solicitado_original": 8000.00, "monto_maximo_recomendado": 8000.00,
        "provision_sbs_evitada_pen": 0.00,
        "explicacion_agente_sbs": "AUDITORÍA PRE-DESEMBOLSO SBS [CIIU 1520 — Calzado El Porvenir]: RUC 10423189012 ACTIVO y HABIDO en SUNAT. Insumos de boleta/factura mayorista (cuero + suela por S/ 5,000.00, OCR 95%) plenamente coherentes con giro calzado. Ventas implícitas estimadas (S/ 7,352.94) superan ligeramente las declaradas (S/ 7,200.00; Delta -2.1%). Flujo Neto Disponible de S/ 1,680.00 respalda la cuota propuesta de S/ 980.00 con RCC 1.71x. Calificación AAA / NORMAL (provisión 1%). Se autoriza Fast-Track por S/ 8,000.00 sin recorte."
      }
    }'::jsonb
  ),
  (
    'GC-02', 2, '2. Mayorista Hermelinda', 'CIIU 5211 · Recorte Auto A', 'A',
    'Recorte automático S/ 12,000 → S/ 8,500 · Delta +21.2% · RCC 1.16x',
    '{
      "expediente_id": "EXP-TRUJ-2026-0102",
      "ruc": "10489120345",
      "agencia_origen": "Agencia Mercado La Hermelinda",
      "giro_ciiu": "5211",
      "ventas_declaradas_asesor": 16500.00,
      "inventario_fisico_estimado": 14200.00,
      "gastos_operativos_familiares": 890.00,
      "cuota_deuda_sbs_vigente": 340.00,
      "cuota_mensual_propuesta": 1300.00,
      "monto_solicitado_original": 12000.00,
      "documentos_adjuntos": [
        { "doc_id": "DOC-1", "tipo_documento": "FACTURA_MAYORISTA", "texto_ocr": "140 sacos arroz + aceite vegetal + azúcar -> S/ 11,160.00 (OCR: 0.93)" }
      ]
    }'::jsonb,
    '{
      "expediente_id": "EXP-TRUJ-2026-0102",
      "modo_inferencia": "HIBRIDO_SANITIZADO_DEEPSEEK_POSTGRES",
      "latencia_ms": 742.8,
      "validacion_fiscal": {
        "ruc": "10489120345", "estado_sunat": "ACTIVO", "condicion_domicilio": "HABIDO",
        "giro_ciiu": "5211", "coherencia_insumos_giro": true, "confianza_extraccion_ia": 0.93
      },
      "triangulacion_financiera": {
        "moneda": "PEN", "ventas_declaradas_asesor": 16500.00, "compras_comprobadas_documentos": 11160.00,
        "ventas_implicitas_calculadas": 13609.76, "delta_desviacion_declarativa": 0.212,
        "flujo_neto_disponible": 1508.00, "cuota_mensual_propuesta": 1300.00, "ratio_cobertura_cuota_rcc": 1.16
      },
      "dictamen_riesgos": {
        "alerta_fraude_maquillaje": false, "requiere_revision_humana": false,
        "banderas_fraude_detectadas": ["DESVIACION_MODERADA_VENTAS_21_PCT", "RCC_AJUSTADO_ZONA_AMBAR"],
        "clasificacion_sbs_proyectada": "CPP", "tasa_provision_sbs": 0.05,
        "escala_interna_caja_trujillo": "A", "accion_operativa": "RECORTE_AUTOMATICO_MONTO_O_GARANTIA",
        "monto_solicitado_original": 12000.00, "monto_maximo_recomendado": 8500.00,
        "provision_sbs_evitada_pen": 2100.00,
        "explicacion_agente_sbs": "AUDITORÍA PRE-DESEMBOLSO SBS [CIIU 5211 — Mayorista Hermelinda]: RUC 10489120345 ACTIVO y HABIDO. Insumos de abarrotes (S/ 11,160.00, OCR 93%) coherentes con giro. Las Ventas Declaradas (S/ 16,500.00) exceden en +21.2% a las Ventas Implícitas (S/ 13,609.76), comprimiendo el RCC a 1.16x. El motor aplica recorte prudencial automático de S/ 12,000.00 a S/ 8,500.00 (evitando S/ 2,100.00 en provisión SBS proyectada)."
      }
    }'::jsonb
  ),
  (
    'GC-03', 3, '3. Maquillado Viernes 6pm', 'CIIU 1520 · Bloqueo Fraude C', 'C',
    'BLOQUEO ROJO (+141.9% maquillaje) · RCC 0.77x · Solic. S/ 15,000',
    '{
      "expediente_id": "EXP-TRUJ-2026-0103",
      "ruc": "10456712390",
      "agencia_origen": "Agencia El Porvenir",
      "giro_ciiu": "1520",
      "ventas_declaradas_asesor": 18500.00,
      "inventario_fisico_estimado": 4800.00,
      "gastos_operativos_familiares": 920.00,
      "cuota_deuda_sbs_vigente": 410.00,
      "cuota_mensual_propuesta": 1500.00,
      "monto_solicitado_original": 15000.00,
      "documentos_adjuntos": [
        { "doc_id": "DOC-1", "tipo_documento": "NOTA_MANUSCRITA", "texto_ocr": "190 pies cuero sintético + pegamento -> S/ 5,200.00 (OCR: 0.91)" }
      ]
    }'::jsonb,
    '{
      "expediente_id": "EXP-TRUJ-2026-0103",
      "modo_inferencia": "HIBRIDO_SANITIZADO_DEEPSEEK_POSTGRES",
      "latencia_ms": 815.2,
      "validacion_fiscal": {
        "ruc": "10456712390", "estado_sunat": "ACTIVO", "condicion_domicilio": "HABIDO",
        "giro_ciiu": "1520", "coherencia_insumos_giro": true, "confianza_extraccion_ia": 0.91
      },
      "triangulacion_financiera": {
        "moneda": "PEN", "ventas_declaradas_asesor": 18500.00, "compras_comprobadas_documentos": 5200.00,
        "ventas_implicitas_calculadas": 7647.06, "delta_desviacion_declarativa": 1.419,
        "flujo_neto_disponible": 1155.00, "cuota_mensual_propuesta": 1500.00, "ratio_cobertura_cuota_rcc": 0.77
      },
      "dictamen_riesgos": {
        "alerta_fraude_maquillaje": true, "requiere_revision_humana": false,
        "banderas_fraude_detectadas": [
          "MAQUILLAJE_VENTAS_SUPERIOR_30_PCT",
          "DESVIACION_DECLARATIVA_CRITICA_141_9_PCT",
          "RCC_INSUFICIENTE_0_77X",
          "CIERRE_VIERNES_HORARIO_CRITICO"
        ],
        "clasificacion_sbs_proyectada": "PERDIDA", "tasa_provision_sbs": 1.0,
        "escala_interna_caja_trujillo": "C", "accion_operativa": "BLOQUEO_PRE_DESEMBOLSO_FRAUDE_MAQUILLAJE",
        "monto_solicitado_original": 15000.00, "monto_maximo_recomendado": 0.00,
        "provision_sbs_evitada_pen": 15000.00,
        "explicacion_agente_sbs": "BLOQUEO CRÍTICO SBS — ALERTA FRAUDE MAQUILLAJE [CIIU 1520]: Compras comprobadas (S/ 5,200.00) sustentan únicamente S/ 7,647.06 en ventas implícitas frente a S/ 18,500.00 declarados (+141.9%, excediendo umbral duro SBS de +30%). RCC real de 0.77x. Desembolso de S/ 15,000.00 BLOQUEADO automáticamente; se evita S/ 15,000.00 en provisión SBS."
      }
    }'::jsonb
  ),
  (
    'GC-04', 4, '4. Bodega OCR 0.74', 'CIIU 5211 · Candado Poka-Yoke', 'C (PY)',
    'POKA-YOKE (OCR 74% < 85% + Cemento en Bodega) · S/ 0 → Auditor Senior',
    '{
      "expediente_id": "EXP-TRUJ-2026-0104",
      "ruc": "10411298765",
      "agencia_origen": "Agencia La Esperanza",
      "giro_ciiu": "5211",
      "ventas_declaradas_asesor": 9400.00,
      "inventario_fisico_estimado": 5100.00,
      "gastos_operativos_familiares": 560.00,
      "cuota_deuda_sbs_vigente": 280.00,
      "cuota_mensual_propuesta": 1050.00,
      "monto_solicitado_original": 9500.00,
      "documentos_adjuntos": [
        { "doc_id": "DOC-1", "tipo_documento": "BOLETA_COMPRA", "texto_ocr": "45 bolsas cemento Sol + varillas fierro 1/2 -> S/ 2,400.00 (OCR: 0.74)" }
      ]
    }'::jsonb,
    '{
      "expediente_id": "EXP-TRUJ-2026-0104",
      "modo_inferencia": "HIBRIDO_SANITIZADO_DEEPSEEK_POSTGRES",
      "latencia_ms": 694.6,
      "validacion_fiscal": {
        "ruc": "10411298765", "estado_sunat": "ACTIVO", "condicion_domicilio": "HABIDO",
        "giro_ciiu": "5211", "coherencia_insumos_giro": false, "confianza_extraccion_ia": 0.74
      },
      "triangulacion_financiera": {
        "moneda": "PEN", "ventas_declaradas_asesor": 9400.00, "compras_comprobadas_documentos": 2400.00,
        "ventas_implicitas_calculadas": 2926.83, "delta_desviacion_declarativa": 2.212,
        "flujo_neto_disponible": 0.00, "cuota_mensual_propuesta": 1050.00, "ratio_cobertura_cuota_rcc": 0.00
      },
      "dictamen_riesgos": {
        "alerta_fraude_maquillaje": false, "requiere_revision_humana": true,
        "banderas_fraude_detectadas": [
          "CONFIANZA_OCR_INFERIOR_UMBRAL_085",
          "INCOHERENCIA_INSUMOS_CEMENTO_EN_BODEGA_5211"
        ],
        "clasificacion_sbs_proyectada": "DUDOSO", "tasa_provision_sbs": 0.60,
        "escala_interna_caja_trujillo": "C (PY)", "accion_operativa": "DERIVACION_POKA_YOKE_AUDITOR_SENIOR",
        "monto_solicitado_original": 9500.00, "monto_maximo_recomendado": 0.00,
        "provision_sbs_evitada_pen": 5700.00,
        "explicacion_agente_sbs": "CANDADO POKA-YOKE ACTIVADO [CIIU 5211 — Bodega]: Doble anomalía documental pre-desembolso: (1) Confianza OCR de 74% (<85% obligatorio) por imagen borrosa; y (2) Incoherencia semántica — comprobante de 45 bolsas cemento Sol + fierro incompatible con giro CIIU 5211 (Bodega). Monto recomendado S/ 0.00. Expediente DERIVADO A AUDITOR SENIOR."
      }
    }'::jsonb
  )
on conflict (case_id) do nothing;
