# Scripts Neon (base `neondb`, proyecto Neon «EcoPulse»)

Preparados por OpenCode; **aplicados: no**. Requieren autorización escrita por ejecución.
Orden exacto (todo con `psql -X -v ON_ERROR_STOP=1` contra la URL de `neondb`):

1. **Migraciones Drizzle 0000–0003** (si la base está vacía):
   `corepack pnpm --filter @workspace/db migrate` con `MIGRATION_DATABASE_URL` apuntando a `neondb`
   (drizzle-kit registra el journal; alternativa manual: los 4 SQL de `lib/db/drizzle/` + journal, sin mezclar ambos métodos).
2. `neon-academic-materials.sql` — tabla `delivery_point_materials`.
3. `neon-academic-favorites.sql` — tabla `favorite_centers`.
4. `neon-seed.sql` — bootstrap del primer ADMIN (`user_3KUsHCqCaJlD7fTErwmWLX0R1Ai`),
   8 centros, materiales por centro, 2 horarios futuros por centro y 3 recompensas.
   Todo `ON CONFLICT DO NOTHING`; reejecutable sin romper reservas ni canjes.
5. `neon-grants.sql` — permisos mínimos del rol `ecopulse_app` (incluye `UPDATE (role) ON users`
   para la gestión de roles del panel admin).

## Rol de aplicación (requisito previo del paso 5)

El rol no lo crea este repo (requiere privilegios de dueño). En la consola de Neon o con psql
como `neondb_owner`:

```sql
CREATE ROLE ecopulse_app LOGIN PASSWORD '<generar contraseña fuerte y guardarla en Render>';
```

Después, la variable `DATABASE_URL` de Render debe ser la URI de conexión de `ecopulse_app`
(no la del owner) para que los grants apliquen de verdad.

## Verificación posterior (solo lectura)

- `SELECT role, count(*) FROM users GROUP BY role;` → debe existir 1 fila `admin`.
- `SELECT count(*) FROM delivery_points;` → 8. `delivery_slots` → 16. `rewards` → 3.
- `SELECT grantee, privilege_type FROM information_schema.role_table_grants WHERE grantee='ecopulse_app' AND table_name='users';` → SELECT, INSERT, UPDATE.

Nunca ejecutar estos scripts contra `ecopulse_dev` (local) ni repetirlos contra una base con datos ajenos; los guards los rechazan.
