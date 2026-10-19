# Propuesta pendiente: puntos y recompensas

Estado: **sin aprobar y desactivada**. Este documento no establece tarifas, valor monetario ni inventario.

1. Un escaneo, una estimación o una solicitud de entrega no genera puntos.
2. Una persona verificadora autorizada registra material y peso efectivamente recibido. No puede verificar su propia entrega. El servidor conserva evidencia, actor y fecha.
3. Antes de habilitar puntos, la administración debe aprobar por escrito una tabla versionada de categorías elegibles, unidad, tasa de puntos por peso verificado, vigencia y límites antifraude. Los valores siguen **pendientes**. Cada movimiento referencia una única verificación y versión de política; la base impide duplicados y el libro contable es inmutable.
4. El saldo se calcula en el servidor desde movimientos confirmados. Cualquier reversión requiere un movimiento compensatorio trazable, nunca editar o borrar un asiento.
5. Antes de publicar una recompensa se exige convenio vigente, costo aprobado, inventario real documentado, reglas de entrega y validación por un administrador distinto de quien la cargó cuando sea viable. Los borradores no se ofrecen para canje.
6. El canje bloquea de forma transaccional saldo e inventario, usa clave de idempotencia y conserva el estado de cumplimiento. Las pruebas de concurrencia deben pasar en una base aislada antes de activar permisos y banderas.

Decisiones pendientes: entidades aliadas y convenios, categorías aceptadas, medición certificada, tasas y límites, costos, inventario inicial, proceso de entrega y aprobación explícita para cualquier cambio sensible de permisos o activación. `PILOT_VERIFICATION_ENABLED`, `PILOT_POINTS_ENABLED`, `PILOT_REWARDS_ENABLED` y `PILOT_REWARD_FULFILLMENT_ENABLED` siguen apagadas.
