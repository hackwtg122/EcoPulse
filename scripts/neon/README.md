# Scripts Neon — `neondb`, no reinicializar

Estado remoto ya comprobado en solo lectura: 15 tablas, 8 centros, 16 horarios,
3 recompensas y 1 admin; journal0000–0003. La tabla de auditoría0004 sigue ausente.
No asumir una base vacía ni repetir migraciones, grants o seed como despliegue.

## Seed corregido: propuesta, NO ejecutado

`neon-seed.sql` conserva el catálogo académico como **borradores inactivos**.
No asigna roles, no contiene IDs Clerk y no publica ni dota de inventario una
recompensa ilustrativa. No actualiza ni borra filas existentes: los datos
previamente activos de Neon no cambian al editar este archivo.

Antes de BEGIN exige los parámetros psql `authorize_academic_seed=true` y
`seed_week` (lunes ISO explícito). No equivalen a una autorización del propietario:
su ejecución sigue requiriendo aprobación específica y respaldo restaurable.
Repetir la misma fecha mantiene ventanas estables. Las franjas se serializan con
el mismo advisory lock del trigger y se filtran por solapamiento **antes** del
INSERT; `ON CONFLICT` por sí solo no evita un trigger BEFORE INSERT.

No ejecutar para preparar cuentas QA, completar producción o rellenar datos.
No es bootstrap del primer administrador. Su prueba actual es estática, sin
ejecución SQL; la reejecución real queda BLOCKED hasta autorización y aislamiento.

## Auditoría0004 y permisos

Requisitos exactos en `../../AUDIT_BACKUP_APPROVAL.md`. Falta evidencia de respaldo
restaurable; no se ha aplicado la migración. No ejecutar `neon-grants.sql` completo
para añadir auditoría: contiene REVOKE global. Cualquier concesión futura debe
limitarse a SELECT/INSERT de la tabla nueva y estar expresamente autorizada.
El rol `ecopulse_app` ya existe: no recrearlo, no cambiar contraseña ni privilegios.

`neon-academic-materials.sql` y `neon-academic-favorites.sql` también son scripts
de escritura, no preflight. Sus tablas ya existen en la base verificada.

## Lecturas autorizadas

`verify-production-readonly.mjs` valida destino Neon/neondb/TLS y abre READ ONLY.
Solo informa metadatos/conteos y termina ROLLBACK. No usar la URL owner disponible
como secreto CI ni exportar filas de usuarios. No conectar a una base local.
