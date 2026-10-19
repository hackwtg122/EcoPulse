> Estado actual: `0002_catalog_validation` está preparada pero NO aplicada a `ecopulse_dev`. No ejecute `db:migrate` sin autorización específica para 0002.

# Migraciones PostgreSQL de EcoPulse

La estrategia canónica es **Drizzle Kit `generate` + `migrate`**. No se usa `drizzle-kit push`, no se ejecutan los SQL de migración manualmente y una migración no se repite por otro mecanismo.

## Estado actual

| Migración | Estado en `ecopulse_dev` | Propósito |
| --- | --- | --- |
| `0000_core` | Aplicada | Siete tablas base y libro contable inmutable. |
| `0001_delivery_details` | Aplicada y verificada en `ecopulse_dev` el 16 de octubre de 2026 | Materiales estimados, centros, horarios, historial e idempotencia. |

`0001` no concede permisos, no activa centros u horarios, no crea verificaciones y no genera puntos. `0000_core.sql` permanece intacta.

## Archivos canónicos

- `lib/db/src/schema/index.ts`: esquema declarativo.
- `lib/db/drizzle/0000_core.sql`: migración inicial aplicada.
- `lib/db/drizzle/0001_delivery_details.sql`: migración incremental aplicada.
- `lib/db/drizzle/meta/_journal.json` y snapshots: orden y base de generación.
- `drizzle.__drizzle_migrations`: hashes aplicados en cada base.

## Alcance de `0001`

Se incluyen seis estructuras indispensables: `material_categories`, `delivery_items`, `delivery_points`, `delivery_slots`, `delivery_status_events` y `delivery_idempotency`.

Se aplazan los detalles de verificación, políticas, tarifas y adjudicaciones de puntos. Estas estructuras dependen de reglas y roles todavía no autorizados.

Las entregas existentes pasan a `request_version = 1` y conservan propietario, identificador, estado y fecha. No reciben materiales, centro ni horario inventados. La entrega `ece719a5-739e-5626-a6b8-727b5dca04ce` permanece pendiente y sin detalles.

## Integridad y concurrencia

- De 1 a 100.000 gramos estimados por material; máximo seis materiales y 100.000 gramos totales.
- Categorías, centros y horarios deben existir y estar activos.
- La clave foránea compuesta impide usar un horario de otro centro.
- Los triggers bloquean el horario con privilegios del propietario y `search_path` fijo. La aplicación no necesita permisos de actualización sobre catálogos u horarios.
- `request_version` es inmutable.
- La creación versión 2 y cada transición requieren un evento en la misma transacción.
- El historial es append-only.
- La idempotencia almacena SHA-256 de clave y cuerpo canónico. Un reintento idéntico devuelve el resultado anterior; la misma clave con otro cuerpo se rechaza.

## Activación gradual del backend

La variable permanece desactivada por defecto:

```dotenv
PILOT_DELIVERY_DETAILS_ENABLED=false
```

El servidor consulta la capacidad del esquema antes de usar cualquier tabla de `0001`:

- Esquema `0000`: mantiene solicitudes básicas versión 1.
- Esquema `0001` con bandera `false`: continúa creando versión 1 de forma explícita.
- Esquema `0001` con bandera `true`, sin centros u horarios válidos: muestra configuración pendiente y bloquea reservas.
- Esquema `0001` con bandera `true` y configuración válida: permite versión 2.

El cliente nunca envía propietario, estado, puntos ni resultado de verificación. La identidad procede exclusivamente de Clerk.

## Prueba aislada en Windows

```powershell
corepack pnpm run db:test:delivery-details:windows
```

El comando crea PostgreSQL 18 efímero en `127.0.0.1:55432`, aplica primero `0000`, comprueba el modo legado, migra a `0001` y prueba el servicio con un rol sintético de privilegios mínimos. Después elimina servidor, contraseña y datos.

Valida migración, compatibilidad V1, transacciones, rollback, aislamiento multiusuario, clave reutilizada con otro cuerpo, reintentos simultáneos, capacidad concurrente, centros inactivos, permisos DDL/DML denegados y ausencia de verificaciones y puntos.

## Respaldo y recuperación

El respaldo y su ensayo de restauración ya se completaron; los comandos quedan como referencia para futuras migraciones:

```powershell
node .\scripts\verify-persisted-delivery-state.mjs
& .\scripts\backup-local-database.ps1
```

El respaldo custom-format se guarda en `backups/`, se valida con `pg_restore --list` y se acompaña de SHA-256. La recuperación se ensaya primero en una base vacía separada. No se usa `--clean` ni se restaura encima de `ecopulse_dev` sin autorización específica.

## Estado posterior a `0001`

La migración se aplicó una sola vez mediante Drizzle el 16 de octubre de 2026. El historial contiene `0000_core` y `0001_delivery_details`, con hashes correctos y 13 tablas. Se concedieron únicamente los permisos incrementales revisados a `ecopulse_app`. Los dos usuarios, el escaneo manual y la entrega anterior permanecen intactos; no hay centros, horarios, verificaciones ni movimientos de puntos.

El respaldo validado es `backups/ecopulse_dev_pre_migration_20261015_023011.dump` (SHA-256 `E94AD101187AF2F3926A4C2573BE394596FDB362E07640EAC65B1D3B6C7059F4`). Se restauró y comparó en PostgreSQL aislado antes de la aplicación.

Las banderas de solicitudes detalladas y verificación siguen desactivadas. Antes de activarlas se necesitan centros y horarios reales validados, roles de verificador y una política de puntos aprobada.

## Procedimiento de `0001` ya ejecutado (registro histórico; no repetir)

Mantener detenidos backend y frontend durante los pasos 4 a 7 evita errores transitorios entre migración y permisos.

1. Mantener `PILOT_DELIVERY_DETAILS_ENABLED=false`.
2. Ejecutar las comprobaciones:

   ```powershell
   corepack pnpm run db:readiness
   corepack pnpm run db:verify:files
   corepack pnpm run db:check
   corepack pnpm run db:test:delivery-details:windows
   corepack pnpm run typecheck
   corepack pnpm run build
   ```

3. Crear y verificar el respaldo:

   ```powershell
   & .\scripts\backup-local-database.ps1
   ```

4. Con autorización específica, aplicar una sola vez mediante Drizzle:

   ```powershell
   corepack pnpm run db:migrate
   ```

5. Con autorización específica, conceder solo los permisos incrementales:

   ```powershell
   & .\scripts\apply-delivery-details-app-permissions.ps1
   ```

6. Verificar historial, trece tablas, entrega V1 intacta, cero verificaciones y cero movimientos.
7. Registrar centros y horarios únicamente mediante un conjunto de datos revisado y autorizado. No forman parte de la migración.
8. Consultar `/api/pilot/delivery-options`; debe seguir bloqueado si no existe disponibilidad real.
9. Cambiar `PILOT_DELIVERY_DETAILS_ENABLED=true`, reiniciar el backend y repetir las pruebas de navegador con cuentas de desarrollo.

No se debe ejecutar el script general de permisos como sustituto del incremental después de `0001`, porque revoca permisos de todas las tablas antes de restaurar únicamente el conjunto base.
