# Recepción, verificación y puntos: preparación controlada

Estado en desarrollo local: código y panel preparados; operaciones reales desactivadas. No aplicar este documento como orden de activación.

## Flujo y garantías

- Roles `verifier` y `admin` consultan una cola paginada que excluye sus propias entregas y no devuelve nombres ni correos. El servidor obtiene identidad y rol desde Clerk/PostgreSQL; ignora identificadores de cuenta enviados por el cliente.
- La recepción física pasa una solicitud `pending` o `scheduled` a `received`. Usa `SELECT ... FOR UPDATE`, transacción y evento de estado inmutable. Un reintento del mismo actor devuelve el resultado previo; otros actores reciben conflicto.
- Una entrega `received` puede rechazarse con un motivo codificado o aprobarse con peso real total en gramos y código de comprobante físico. El mismo verificador no puede actuar sobre su entrega. La transición, verificación y eventual movimiento de puntos forman una sola transacción.
- El índice único de `verifications.delivery_id` impide decisiones duplicadas; el índice único de `point_movements(kind, source_id)` impide duplicar créditos. Los movimientos y eventos son inmutables por trigger. Los reintentos concurrentes se serializan mediante bloqueo de fila.
- La aprobación requiere una política explícita: `POINTS_PER_KG` (entero positivo de 1 a 1000) y `POINTS_MAX_PER_DELIVERY` (entero positivo de 1 a 100000). Se usan exclusivamente gramos verificados. El evento de aprobación registra la tasa y el tope aplicados para auditoría; el saldo se calcula desde movimientos persistidos.
- `GET /api/pilot/deliveries/:id/events` permite consultar los eventos al propietario o a roles autorizados y oculta el actor. Un participante ajeno recibe 404.

## Bloqueos de activación

Todos estos valores siguen desactivados o vacíos en `.env.local`:

- `PILOT_RECEIPT_ENABLED=false`
- `PILOT_VERIFICATION_ENABLED=false`
- `PILOT_POINTS_ENABLED=false`
- `POINTS_PER_KG=`
- `POINTS_MAX_PER_DELIVERY=`

La activación de recepción, decisiones y puntos es independiente. La API devuelve capacidades al panel y aplica las mismas compuertas en cada ruta. No configurar valores reales sin una política aprobada ni un proceso operativo de recepción física.

El script `scripts/grant-physical-lifecycle-permissions.sql` está **preparado, no ejecutado**. Reduce `ecopulse_app` a `UPDATE(status)` de entregas y concede lectura de solo las columnas de verificación necesarias para reintentos. La aplicación nunca debe usar las credenciales de `ecopulse_migrator`. Su ejecución sobre `ecopulse_dev` exige autorización de permisos y una revisión de privilegios efectivos antes de habilitar acciones.

Las tablas actuales solo registran el peso real total de la entrega. Si se necesita registrar pesos reales por material, se requiere una migración adicional y permiso expreso; no se representa el total como desglose. El código de comprobante no sustituye un documento o evidencia fotográfica, ni prueba por sí mismo una recepción real.

## Pruebas y activación posterior

1. Conservar un respaldo verificado y comprobar que la base objetivo es exclusivamente `ecopulse_dev` local.
2. Revisar y autorizar el ajuste mínimo de permisos, aplicarlo una sola vez y comprobar privilegios DML/DDL efectivos.
3. En `ecopulse_test`, repetir las pruebas sintéticas de autorrechazo, recepción, aprobación, rechazo, concurrencia, idempotencia, reversión y topes. El entorno aislado se limpia después de las pruebas.
4. Definir una política de puntos real, comprobable y aprobada. Configurar verificador autorizado y procedimiento físico con comprobante, peso y supervisión. Después de autorización separada, activar recepción y decisiones de forma progresiva. Activar puntos solo cuando todo el proceso real y las pruebas estén aceptados.
5. Antes y después de la activación, verificar el historial de migraciones, entregas anteriores, centros inactivos, movimientos y saldos. Las solicitudes V1 permanecen con su estado e identidad.

No se han creado entregas, verificaciones ni puntos reales para esta preparación. Los dos centros existentes permanecen como borradores sin horarios activos.
