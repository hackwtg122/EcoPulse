# Auditoría0004: condición previa y autorización acotada

**Estado: BLOCKED. No migración ni GRANT ejecutados.**

## Inspección de Neon Console tras login del propietario

Sesión de gestión **ya autenticada y comprobada**, sin extraer cookies/tokens.
Proyecto `EcoPulse` (`summer-scene-27362851`), rama predeterminada `production`
(`br-plain-pine-b5o29nbi`), plan **Free**, una sola rama. El compute mostrado
coincide con el endpoint SQL autorizado y la base es `neondb`; comparación en
memoria sin imprimir conexión ni credenciales.

Backup & Restore muestra **ventana de historial de 6 horas**, **0 snapshots**
y ninguna programación. No se ha probado una restauración. No se pulsó Restore
ni se creó snapshot/rama. El historial visible por sí solo no satisface el gate.
Página: https://console.neon.tech/app/projects/summer-scene-27362851/branches/br-plain-pine-b5o29nbi/restore

### Autorización siguiente, separada de la migración

> Autorizo crear un snapshot manual `pre-audit-0004` de la rama `production`
> del proyecto `summer-scene-27362851` y comprobarlo mediante una restauración
> exclusivamente en una rama nueva aislada `qa-restore-0004`, con consultas de
> solo lectura para contrastar esquema, integridad, conteos y privilegios.
> Solo si estas operaciones están incluidas en el plan Free: no contratar,
> ampliar plan ni activar recursos de pago. No restaurar ni reemplazar
> `production`, no modificar su conexión ni aplicar migraciones, GRANT,
> promociones, seed, canjes o puntos. Conservar el snapshot y la evidencia.

Si la interfaz no permite restaurar el snapshot a un destino nuevo aislado,
detenerse y pedir el alcance alternativo; nunca probar el botón Restore sobre
producción. La prueba y sus resultados deben preceder al permiso SQL de abajo.

La conexión SQL autorizada solo permite inspeccionar el estado actual; no prueba
la existencia de un respaldo restaurable del proveedor. Hay sesión UI de gestión
autorizada, pero no clave API Neon ni evidencia de una restauración probada.
No basta con que Neon ofrezca historial o con que un backup figure como creado.

## Evidencia necesaria (sin secretos ni filas personales)

- Proyecto/branch de Neon y base `neondb` exactos que cubre el respaldo.
- Identificador del respaldo o punto de restauración y fecha UTC, retención y
  estado disponible. Debe cubrir datos + esquema + privilegios necesarios.
- Evidencia saneada de restauración comprobada a un destino aislado autorizado,
  con validación de integridad/esquema y conteos; nunca restaurar sobre producción
  como experimento. No crear branch, activar plan o contratar backup automáticamente.
- Procedimiento y responsable de rollback. No pegar URL de conexión, claves,
  dumps con datos personales o enlaces de gestión que contengan tokens.

El operador puede proporcionar esa evidencia saneada desde Neon; alternativamente
haría falta acceso autorizado de lectura a sus metadatos de backup. No se solicita
copiar una clave owner a GitHub ni dar permisos de escritura al runner de QA.

## Solo después de comprobar esa evidencia

Se solicitará autorización específica con este alcance, no una autorización
general de SQL ni de roles:

> Autorizo aplicar únicamente `0004_role_change_events` del commit revisado a
> `neondb`, proyecto/branch [identificadores], con respaldo restaurable [ID/UTC]
> ya verificado. Autorizo únicamente los permisos SELECT e INSERT necesarios
> sobre `public.role_change_events` para el rol existente `ecopulse_app`.
> No autorizo seed, cambios de credenciales, promociones de cuentas, borrados,
> REVOKE global ni otras migraciones.

El preflight deberá confirmar que0000–0003 están aplicadas, que no hay otro DDL
pendiente que se ejecutaría por accidente y que0004 coincide con el archivo/hash
revisado. Conservar la evidencia de resultado y comprobar auditoría atómica,
rollback de operación y último admin usando cuentas de prueba autorizadas.

Crear/promover un ADMIN/VERIFIER de prueba es una autorización sensible distinta,
referida a los IDs exactos de esas cuentas. Nunca usar o demover al último admin
real para comprobar la protección. El seed corregido no asigna privilegios.
