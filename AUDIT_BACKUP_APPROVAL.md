# Auditoría0004: condición previa y autorización acotada

**Estado: BLOCKED. No migración ni GRANT ejecutados.**

La conexión SQL autorizada solo permite inspeccionar el estado actual; no prueba
la existencia de un respaldo restaurable del proveedor. No hay credencial de
gestión Neon configurada en esta sesión ni evidencia de una restauración probada.
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
