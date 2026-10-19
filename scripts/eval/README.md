# EcoPulse — Entorno de evaluación aislado (ecopulse_eval)

## Objetivo
Crear y mantener una base `ecopulse_eval` completamente independiente de `ecopulse_dev`. Nunca mezclar conexiones, usuarios, saldos, inventarios ni entregas entre ambas.

## Requisitos
- Base separada: `ecopulse_eval`
- No tocar `ecopulse_dev`
- No ejecutar migraciones/SQL sin autorización explícita
- Mantener separación visual "Centros publicados" vs "Modo evaluación"
- Ciclo completo funcional con persistencia real, transacciones, idempotencia, concurrencia

## Orden de inicialización (propuesto para autorización)
1. Crear base `ecopulse_eval` con usuarios mínimos (si no existe)
2. Aplicar `scripts/eval/db/drizzle/0000_eval_init.sql` en orden
3. Aplicar seeds `scripts/eval/db/eval-seed.sql` (idempotentes)
4. Aplicar permisos mínimos `scripts/eval/db/eval-grants.sql`
5. Habilitar flags en `.env.local` (solo local)
6. Probar con API+Vite

## Flags
```env
EVALUATION_MODE_ENABLED=false
EVALUATION_DB_NAME=ecopulse_eval
EVALUATION_OPERATOR_USER_ID=<clerk_user_id_verifier>
VITE_EVALUATION_MODE_ENABLED=false
```

## Verificación
- Endpoint `/api/evaluation/options` usa conexión a `ecopulse_eval` cuando modo activo
- Creación/recepción/verificación marcan contexto evaluación
- Dashboard/recompensas muestran solo datos de entorno activo
- No hay lecturas cruzadas entre bases

## Rollback
Ver `scripts/eval/db/eval-rollback.sql` (seguro, no elimina datos sin justificación)
