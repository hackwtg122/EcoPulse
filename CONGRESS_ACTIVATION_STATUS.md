# EcoPulse: evidencia funcional y siguiente requisito

No terminado. Solo pruebas sobre producción y sesión explícitamente autorizada;
tests puros/build se indican por separado. Un PASS es del alcance descrito, no de
todos los botones del módulo. No se activaron planes de pago ni SQL de escritura.

## Evidencia reciente

- `587f6fd`: etiqueta de cuentas corregida y visible en producción.
- `5099564`, Actions41565221688 SUCCESS: flags de edición de borradores de
  centros/recompensas habilitados. Formularios visibles y habilitados; no se
  inventaron objetos ni se declaró su persistencia probada.
- `7bb34ec`, Actions41566820679 SUCCESS: modelos actualizados al respaldo gratuito
  con catálogo y parámetros verificados. EcoGuía pasó de502 a respuestaIA200 real.
- `08cf595`, Actions41572070420 SUCCESS: catálogo/mapa/favoritos conectados.
- `796a55e`, Actions41573979385 SUCCESS: salida estructurada de visión, límites
  acotados y diagnóstico seguro. Foto pública PNG de botella obtuvo sugerencia
  “Plástico”, explicación y confianza; sin confirmar registro ni puntos.

## PASS / FAIL / BLOCKED por operación

| Operación | Estado y alcance |
| --- | --- |
| Sesión existente / navegación autenticada | PASS, sin extraer cookies, tokens ni contraseñas. Login nuevo no probado. |
| Registro / recuperación / cambio de contraseña / MFA | BLOCKED de prueba positiva: no crear identidades ni cambiar el acceso del único admin sin autorización específica de cuentas de ensayo. |
| Dashboard / perfil / estadísticas | PASS de lectura real. Guardar perfil no ejecutado para no modificar la identidad del propietario. |
| Usuarios y roles | PASS listado y control propio deshabilitado. BLOCKED cambio real: falta role_change_events0004, respaldo probado, autorización e identidades aisladas. |
| Materiales | PASS búsqueda de pilas y ficha con preparación y precauciones. Catálogo completo no auditado de nuevo. |
| Centros / mapa | PASS8de8 centros y mapa OSM; avisos académicos explícitos. No se inventaron coordenadas. |
| Favoritos | PASS guardar, recargar/persistir, quitar y recargar/restaurar el estado inicial; dos operaciones reversibles UI. |
| Borradores de centros/horarios/recompensas | PASS configuración y formularios habilitados. BLOCKED persistencia E2E sin fixtures y reversión acordados; no confundir habilitación con CRUD aprobado. |
| Publicación de centros / horarios / walk-in | BLOCKED de operación legítima: actuales8centros son académicos, ningún walk-in; faltan evidencia/política de operadores reales o ensayo aislado autorizado. No modificar los existentes para forzar PASS. |
| Clasificación manual | PASS selección/orientación. BLOCKED guardado positivo: necesita registro de prueba delimitado y autorización sin contaminar cuenta real. |
| EcoScan imagen / IA | PASS inferencia real de botella con modelo gratuito, consentimiento, explicación y categoría válida. Guardado de la confirmación no probado. |
| EcoGuía IA | PASS respuesta remota real y rechazo sin consentimiento. Continuación conversacional y persistencia entre sesiones no se consideran aprobadas por una respuesta. |
| Entregas / seguimiento | PASS lectura vacía. BLOCKED creación detallada, recepción, comprobante y transición: requieren centro legítimo o ensayo aislado, dos identidades y reversión. |
| Verificar / aprobar / rechazar / historial | BLOCKED positivo: no hay cuentas participantes/verificadoras ni entregas autorizadas. No usar auto-verificación ni inventar peso/recepción. |
| EcoPuntos / movimientos | PASS saldo leído en cero. BLOCKED cálculo/asignación: propuesta de tasas/categorías/vigencia/límites aún sin aprobar; nunca usar el20/kg y100de ejemplo como aprobación. |
| EcoXP / misiones / insignias | PASS lectura de nivel Semilla/misiones pendientes. Progresión positiva BLOCKED hasta registros de ensayo autorizados. EcoXP no es saldo canjeable. |
| Recompensas / inventario / publicación / canjes / cumplimiento | PASS catálogo académico leído. BLOCKED operaciones de valor/inventario: política e inventario/convenio verificables o ensayo aislado sin valor real, además de fixtures y concurrencia verificadas. |
| Recorrido de ensayo integral | BLOCKED: el modo existente selecciona una base independiente ecopulse_eval para todo un proceso API. No activarlo sobre la API principal/neondb ni mezclar pruebas con usuarios reales. Requiere recurso remoto aislado expresamente autorizado. |

## Próximo requisito indispensable

El propietario **ya inició sesión en NeonConsole** y se inspeccionó el proyecto
EcoPulse (`summer-scene-27362851`), rama `production` (`br-plain-pine-b5o29nbi`).
La identidad de su compute coincide con el endpoint SQL autorizado/neondb.
PlanFree, una sola rama, historial6h, **0snapshots y sin restore probado**.
No volver a pedir login ni crear secretos/workflows que ya existen.

La intervención indispensable ahora es autorizar únicamente un snapshot manual
`pre-audit-0004` y su comprobación mediante restore en una rama nueva aislada
`qa-restore-0004`, solo si está incluido en Free. Alcance exacto en
`AUDIT_BACKUP_APPROVAL.md`. Sin restaurar production, SQL de escritura, cambios
de roles/conexiones ni recursos de pago. No se ha ejecutado ninguna de esas acciones.

Después de inspeccionar respaldo y aislamiento se pedirá la autorización acotada
exacta para0004 y permisos nuevos según `AUDIT_BACKUP_APPROVAL.md`. No aplicar
DDL/grants, crear recursos de pago ni cambiar roles reales con una aprobación
genérica. El secreto QA inválido permanece intacto; la sesión del propietario
no autoriza convertir sus credenciales en fixtures ni exportarla a Actions.
