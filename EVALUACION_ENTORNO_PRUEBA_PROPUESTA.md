# Propuesta: Entorno de Evaluación (Solo Prueba)

Esta propuesta habilitaría un entorno de evaluación aislado para ejecutar el ciclo completo sin afectar datos reales.

## Flags (configuración)
- `EVALUATION_MODE_ENABLED` (default: `false`): activa modos de prueba
- `EVALUATION_ISOLATED_SCHEMA` (opcional): `evaluation` o prefijo
- `EVALUATION_TEST_POINTS_ENABLED` (default: falso) — ya aplicado en UI como visualización; ciclo requiere flags DB

## Cambios de BD (requerido ejecución manual + aprobación)
Crear esquema/tables aditivos (no destructivos):
1. `evaluation_test_points` — puntos de prueba (mismos 8) con capacidad/horarios/responsable, flag activo
2. `evaluation_runs` — trazabilidad de ciclos de evaluación (idempotencia)
3. `evaluation_test_deliveries` / ampliar con flag `is_test` en `deliveries`, `scans`, `rewards_redemptions`, `pilot_balance_movements`? 
   - Añadir columnas opcionales: `is_test BOOLEAN NOT NULL DEFAULT false`, `evaluation_run_id UUID NULL` con FK
   - Crear índices parciales `(is_test)` donde útil

Migración propuesta: `scripts/proposals/0005_evaluation_test_env.sql`
Rollback: `scripts/proposals/0005_evaluation_test_env.rollback.sql`

Permisos: revisar grants existentes; no cambiar permisos sensibles globales. Solo añadir grants sobre nuevas tablas (propuesta en `.sql`).

## Código (ya implementado parcialmente)
- UI mapa interactivo con puntos de prueba, claramente marcados "PRUEBA"/"Solo para evaluación"
- Separación visual entre datos ilustrativos y UI de ciclo (por flag)

## Lo que REQUIERE APROBACIÓN ESCRITA
1. Ejecutar migración `0005_evaluation_test_env.sql` (no ejecutado)
2. Aplicar grants asociados (si aplica)
3. Habilitar flags en `.env` para entorno de demo (`EVALUATION_MODE_ENABLED=true`)

## Aislamiento (garantías)
- Todos los registros de prueba deben tener `is_test=true`
- Servicios deben filtrar por `is_test` al calcular saldos/inventarios públicos
- Nunca mezclar: endpoints de evaluación usarán tenant/run aislado y validarán flag
- Transacciones + auditoría preservadas (logs con contexto `evaluation_run_id`)

## Estado actual
- Código frontend mapa listo (solo visualización). Ciclo completo (entrega→recepción→verificación→EcoPuntos→recompensas/canjes) requiere backend con aislamiento y endpoints de operador de prueba. Eso se puede añadir con guardas por feature flag una vez aprobada migración.
- No se ejecutaron migraciones ni cambios de permisos.
- Build/TS/tests pasan.

**Solicitud de aprobación**: autorizar solo ejecución de migración propuesta + grants mínimos; NO push/despliegue a producción.
