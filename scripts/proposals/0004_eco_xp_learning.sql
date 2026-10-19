-- =============================================================================
-- PROPUESTA DE MIGRACIÓN — EcoXP: eventos de aprendizaje persistidos
-- =============================================================================
-- ESTADO: NO EJECUTADA. Requiere autorización explícita del responsable.
-- UBICACIÓN: fuera de lib/db/drizzle/ a propósito, para que drizzle-kit migrate
--            NO la aplique y no se genere en el journal.
--
-- MOTIVO
--   El endpoint GET /pilot/progress ya calcula EcoXP, niveles, insignias,
--   misiones y rachas desde eventos REALES que ya viven en PostgreSQL
--   (tabla `scans` y tabla `deliveries`). Eso funciona hoy sin migraciones.
--
--   Lo único que todavía NO se persiste en el servidor son los eventos de
--   aprendizaje del visitante o usuario (abrir una ficha de material, aprobar
--   un cuestionario). Hoy esa parte vive solo en localStorage del navegador y
--   se etiqueta como tal. Esta migración crea la tabla para que esos eventos
--   sean autoritativos, sobrevivan a otro dispositivo y no se puedan inflar
--   desde el cliente sin control del servidor.
--
-- IMPACTO
--   Solo aditivo: crea una tabla nueva y sus índices. No modifica datos
--   existentes ni tablas actuales. No otorga ni canjea EcoPuntos.
--
-- ROLLBACK
--   Ver 0004_eco_xp_learning.rollback.sql
-- =============================================================================

begin;

create table if not exists learning_events (
  id          uuid primary key default gen_random_uuid(),
  user_id     text not null references users (clerk_user_id) on delete cascade,
  kind        text not null,
  reference   text not null,
  score       integer,
  created_at  timestamptz not null default now(),
  constraint learning_events_kind_check
    check (kind in ('material_read', 'quiz_passed')),
  constraint learning_events_reference_check
    check (length(reference) between 1 and 64),
  constraint learning_events_score_check
    check (score is null or (score between 0 and 100))
);

-- Un material leído cuenta una sola vez por usuario; los cuestionarios pueden
-- repetirse (se conserva el mejor puntaje por lógica de consulta, no aquí).
create unique index if not exists learning_events_material_once_idx
  on learning_events (user_id, reference)
  where kind = 'material_read';

create index if not exists learning_events_user_kind_idx
  on learning_events (user_id, kind, created_at desc);

commit;

-- =============================================================================
-- CAMBIOS DE CÓDIGO ASOCIADOS (también pendientes de autorización)
-- =============================================================================
-- 1. api-server: POST /pilot/learning/events  (auth requerida)
--      body: { kind: 'material_read' | 'quiz_passed', reference: string, score?: number }
--      - valida kind/reference/score y hasOnlyFields
--      - insert ... on conflict do nothing para material_read
--      - rate-limit por usuario
-- 2. api-server: computeProgress() incorpora learning_events:
--      +5 EcoXP por material leído (tope = tamaño del catálogo),
--      +15 por cuestionario con score >= 70.
--      Insignias «Explorador» pasan a ser autoritativas.
-- 3. Frontend: explorer-progress.ts deja de usar localStorage y llama al
--      endpoint; se elimina la etiqueta «Solo en este navegador».
-- =============================================================================
