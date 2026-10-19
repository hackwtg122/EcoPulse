# Recompensas y sugerencias de imagen: despliegue por etapas

Estado: `0003` aplicada en `ecopulse_dev`; canjes, puntos, verificaciones e IA desactivados.

## Recompensas

- `0003_reward_fulfillment.sql` agrega inventario, referencia de validación, actor/fecha de validación y estado de cumplimiento. Está aplicada y registrada como cuarta migración en el historial Drizzle de `ecopulse_dev`.
- El catálogo público solo devuelve premios activos con inventario positivo y evidencia de validación cuando existe 0003. La administración permite consultar borradores. Los permisos de columna para borradores ya están aplicados; crear/editar permanece bloqueado mientras `PILOT_REWARD_ADMIN_ENABLED` esté desactivado.
- Crear borradores usa una clave de idempotencia por actor; reutilizarla con otro título, descripción o costo produce conflicto. Editar exige que coincida la versión de valores leída por el administrador; no permite editar filas activas.
- El canje bloquea la cuenta y la recompensa en una transacción, calcula saldo desde `point_movements`, reserva una unidad, registra el canje y el débito juntos. Dos canjes simultáneos no pueden gastar el mismo saldo ni la última unidad. Reintentos con la misma clave devuelven el canje previo.
- El cumplimiento queda reservado hasta confirmar una referencia verificable. No se publican ni activan premios ficticios. Aún no existen convenios, existencias o tarifas aprobadas.
- El canje exige 0003, `PILOT_REWARDS_ENABLED=true`, `PILOT_POINTS_ENABLED=true`, `PILOT_REWARD_FULFILLMENT_ENABLED=true` y `REWARD_POLICY_REFERENCE` válida. Todos están desactivados o vacíos por defecto. La publicación de premios requiere intervención del migrador tras validación real; la API admin no puede activar premios.
- `scripts/grant-reward-draft-permissions.sql` se aplicó: solo permite INSERT/UPDATE de columnas de borradores inactivos. `scripts/grant-reward-runtime-permissions.sql` permanece sin ejecutar: no hay UPDATE de inventario ni cumplimiento. `ecopulse_app` no recibe DDL, DELETE ni propiedad de tablas.

## IA de imagen

- La API de IA requiere `PILOT_AI_ENABLED=true`, `OPENAI_API_KEY` y `OPENAI_VISION_MODEL` en el backend; no hay secreto `VITE_`. El modo manual sigue disponible.
- El usuario debe consentir el envío de una imagen. El navegador convierte JPG/PNG a PNG sin metadatos; el servidor acepta solo PNG de hasta 5 MB, limita dimensiones y elimina chunks de metadatos antes de enviarlo al proveedor mediante Responses API con `store:false` y tiempo máximo de 15 segundos.
- La respuesta solo puede ser una de seis categorías permitidas o `unknown`. Se presenta como sugerencia; no se guarda automáticamente ni concede puntos. El usuario puede llevarla al formulario manual y confirmar allí.
- EcoPulse no conserva la fotografía ni usa el resultado para certificar reciclaje. El tratamiento posterior por el proveedor depende de su política y del contrato que se configure.

## Pruebas verificadas

- `drizzle-kit check`, TypeScript, build y pruebas unitarias de validación, compuertas, contrato autenticado y eliminación de metadatos pasaron. La prueba de IA utiliza un proveedor simulado; no se ha realizado una llamada real.
- `scripts/test-rewards-isolated.ps1` aplicó `0000`–`0003` únicamente en un clúster desechable `127.0.0.1:55434/ecopulse_test`, con un rol `ecopulse_app` sintético requerido por `0002`. Verificó cuatro migraciones, restricciones, borradores idempotentes, permisos mínimos, inventario, canjes concurrentes, saldo de movimientos, reversión completa ante fallo y cumplimiento idempotente. La instancia temporal se eliminó al terminar.
- El error de privilegios detectado en la prueba se corrigió: el canje usa un bloqueo transaccional por identificador de usuario y ya no exige `UPDATE` sobre `users`. La prueba confirma que ese permiso no se concedió.
- `ecopulse_dev` tiene `0000`–`0003`: tres usuarios, un escaneo manual, una entrega pendiente, dos centros inactivos, cero recompensas, cero canjes y cero movimientos de puntos. Los hashes aplicados coinciden con los archivos SQL.
- En navegador local se comprobó que el catálogo real muestra ausencia de recompensas y canjes desactivados, y que la clasificación manual continúa disponible. Se corrigió un botón compartido que omitía el texto e iconos de sus hijos. No se creó ningún escaneo en esta verificación.
## Antes de activar

1. Confirmar política, aliados e inventario reales antes de considerar cualquier activación comercial.
2. El respaldo previo a 0003 quedó en `backups/` (ignorado por Git), fue restaurado en un clúster temporal y sus datos e historial coincidieron. Antes de otra migración, crear un nuevo respaldo.
3. Revisar y autorizar por separado los permisos de canje/cumplimiento solo cuando existan política, inventario y operación verificados.
4. Validar aliados, inventario real, política de puntos y canjes, operación de cumplimiento y modelos/privacidad de IA. Configurar secretos localmente sin incluirlos en Git.
5. Activar flags de forma independiente solo después de las pruebas y acuerdos reales. Nunca usar la cuenta migradora en la aplicación.
