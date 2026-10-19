-- =============================================================================
-- ROLLBACK de 0004_eco_xp_learning.sql
-- =============================================================================
-- ESTADO: NO EJECUTADA. Solo se usa si la migración llegara a aplicarse y se
-- decide revertirla. Elimina únicamente lo creado por esa migración; no toca
-- `scans`, `deliveries`, `users` ni datos existentes.
-- =============================================================================

begin;

drop index if exists learning_events_user_kind_idx;
drop index if exists learning_events_material_once_idx;
drop table if exists learning_events;

commit;
