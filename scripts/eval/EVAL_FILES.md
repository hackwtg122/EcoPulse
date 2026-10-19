# Archivos creados para entorno ecopulse_eval

## DB (SQL)
- scripts/eval/db/drizzle/0000_eval_init.sql — Esquema completo aislado (ecopulse_eval)
- scripts/eval/db/drizzle/0001_eval_triggers.sql — Triggers/funciones para integridad
- scripts/eval/db/eval-seed.sql — 8 puntos eval-01..eval-08, slots futuros, recompensas
- scripts/eval/db/eval-grants.sql — Permisos mínimos
- scripts/eval/db/eval-rollback.sql — Rollback seguro (no elimina sin autorización)

## Config
- scripts/eval/config/eval.env.example — Flags recomendadas

## Backend (ya preparado para usar conexión separada)
- artifacts/api-server/src/lib/evalConnection.ts — Selector de pool (ecopulse_eval vs ecopulse_dev)
- artifacts/api-server/src/lib/evalCatalog.ts — Catálogo de evaluación desde BD

## Documentación
- scripts/eval/README.md — Instrucciones de uso
- scripts/eval/EVAL_FILES.md — Este resumen

## Observaciones
- No se modificó ecopulse_dev
- Numeración no duplica 0000–0003 (se usa prefijo eval separado)
- Aislamiento por base completa (no columnas is_test añadidas a tablas existentes)
- Seeds idempotentes (ON CONFLICT)
- Rollback no destructivo por defecto
