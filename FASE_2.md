# Fase 2: preparación técnica y límites de verificación

Fecha: 9 de octubre de 2026. La API persistente y el esquema están preparados en código, pero **no se han compilado ni probado contra PostgreSQL o Clerk** porque este entorno no tiene dependencias instaladas, base de pruebas ni credenciales de desarrollo. Ninguna migración se aplicó.

## Estado del repositorio y dependencias

- Se cotejaron `artifacts/` y `lib/` contra `HEAD`, incluidos archivos ocultos: 175 archivos esperados, 175 presentes, cero faltantes y cero extras antes de los archivos nuevos de esta fase.
- La fase 1 está en los commits `3c82c41` y `b510198`; `git diff 3c82c41..b510198 --check` no mostró errores. La revisión detectó cifras ficticias restantes en la portada; se corrigieron en `629e056`. El árbol tenía una eliminación posterior de `AUDITORIA_FASE_1.md` confirmada por el usuario, que se conserva sin incluirla en estos commits.
- `pnpm` usa `https://registry.npmjs.org/`, `minimumReleaseAge: 1440` y el lockfile. El entorno fija `HTTP_PROXY`, `HTTPS_PROXY`, `ALL_PROXY` y proxies Git a `http://127.0.0.1:9`; `curl` al registro falla al conectarse a ese puerto. `NPM_CONFIG_OFFLINE=true`, no hay `node_modules` ni almacén pnpm utilizable. No se desactivó el control de antigüedad ni se cambió el registro.
- La ejecución de `pnpm --filter @workspace/api-server exec tsc --version` volvió a intentar descargar paquetes y produjo `ECONNREFUSED`; se interrumpió para evitar reintentos inútiles. Los binarios `tsc`, `vite` y `drizzle-kit` no están disponibles en `node_modules/.bin`. No se puede afirmar que `typecheck` o `build` pasen.

## Datos y API preparados

`lib/db/src/schema/index.ts` define usuarios mínimos vinculados a Clerk, escaneos, entregas, verificaciones, movimientos de puntos, recompensas y canjes. `lib/db/migrations/0001_core.sql` es una **migración SQL manual para revisión**, con claves foráneas, unicidad, límites, comprobaciones de signo y un disparador que impide modificar o borrar movimientos. No está registrada en el historial de Drizzle Kit. Antes de aplicarla, elegir una sola ruta de migración: revisar y ejecutar este SQL en una base vacía, **o** generar una migración equivalente con `pnpm --filter @workspace/db run generate` cuando haya dependencias; no ejecutar ambas. No usar `push-force`.

La API bajo `/api/pilot` devuelve `503 pilot_api_unconfigured` si faltan `DATABASE_URL`, `CLERK_SECRET_KEY`, `CLERK_PUBLISHABLE_KEY` o `PILOT_ALLOWED_ORIGINS`. Con configuración, Clerk valida la sesión; el ID de usuario se toma de la sesión y el rol de la base, nunca del cuerpo de una petición. Las rutas preparadas son:

| Método y ruta | Efecto |
| --- | --- |
| `GET /me`, `/balance` | Perfil mínimo y saldo calculado de movimientos. |
| `GET/POST /scans` | Historial propio y escaneo manual sin puntos ni imagen almacenada. |
| `GET/POST /deliveries` | Historial propio y solicitud de entrega pendiente. |
| `POST /deliveries/:id/verify` | Solo verificador o administrador, nunca su propia entrega. Exige código de recibo físico único para aprobar; aprobación, gramos verificados y crédito en una transacción. Requiere `POINTS_PER_KG` válido. |
| `GET /rewards` | Solo recompensas activas; la base comienza vacía. |
| `GET/POST /redemptions` | Canjes propios; `Idempotency-Key` obligatoria, bloqueo por usuario, cálculo de saldo y débito en una transacción. |

El límite JSON es 64 KB; esta fase no ofrece carga de imágenes. Hay un límite preliminar de 20 mutaciones por usuario y minuto por proceso. Antes de escalar a varias instancias se requiere un límite distribuido en gateway o almacenamiento compartido. Tampoco se ha implementado aún la administración de recompensas, inventario o cumplimiento de canjes: no activar recompensas productivas antes de resolverlo.

## Configuración manual necesaria

Copiar `.env.example` a un archivo local ignorado por Git y configurar **sin publicar los valores**:

| Variable | Dónde | Uso |
| --- | --- | --- |
| `DATABASE_URL` | Servidor | URL de una base PostgreSQL dedicada al piloto o pruebas. |
| `CLERK_SECRET_KEY` | Servidor | Verificación de sesiones; jamás en `VITE_*`. |
| `CLERK_PUBLISHABLE_KEY` | Servidor | Instancia Clerk correspondiente a la clave secreta. |
| `PILOT_ALLOWED_ORIGINS` | Servidor | Orígenes exactos, separados por coma, de la interfaz autorizada. |
| `POINTS_PER_KG` | Servidor | Entero aprobado por el proyecto entre 1 y 1000; solo se usa tras pesaje verificado. |
| `PORT` | API/Vite | Puerto del proceso según el comando de ejecución. |
| `VITE_CLERK_PUBLISHABLE_KEY` | Frontend | Clave publicable de la misma instancia Clerk. |
| `VITE_CLERK_PROXY_URL` | Frontend, opcional | Proxy Clerk si la instalación lo usa. |
| `BASE_PATH` | Vite | Base pública del frontend, normalmente `/` para desarrollo. |

El primer usuario con rol `verifier` o `admin` debe designarse mediante un procedimiento administrativo auditado; **ninguna ruta pública asigna esos roles**. No introducir claves ni contraseñas en el repositorio. El frontend existente sigue en modo demostración y aún no consume `/api/pilot`; conectar vistas y estados reales requiere una fase posterior y pruebas de navegador.

## Comprobaciones pendientes antes de habilitar la API

1. Restaurar acceso autorizado al registro npm o proporcionar una caché pnpm confiable, conservando `minimumReleaseAge` y lockfile. Ejecutar `pnpm install --frozen-lockfile`, `pnpm run typecheck`, `pnpm run build` y las pruebas.
2. Probar registro, inicio de sesión, cierre de sesión, dashboard, escaneo y navegación en navegador con claves Clerk de desarrollo.
3. Revisar la migración contra una base PostgreSQL **vacía de pruebas**, aplicarla manualmente tras respaldo y probar consultas. No ejecutar migraciones sobre producción desde esta tarea.
4. Añadir pruebas de integración con base de pruebas para aislamiento por usuario, roles, verificación duplicada, recarga, canje repetido, saldo insuficiente y canjes concurrentes. Probar también la reversión completa ante fallos dentro de transacciones.
5. Definir operación real de recepción, verificación física, recompensa, inventario, revocaciones, retención de datos y atención a menores para el piloto de Montería.

Hasta completar estas comprobaciones, **el modo demostración es la única experiencia que puede presentarse**; las rutas preparadas no prueban por sí solas que el servicio esté listo para el piloto.

## Verificaciones locales completadas

- `node --experimental-strip-types artifacts/api-server/src/lib/pilotPolicy.test.mjs`: 3 pruebas aprobadas (cálculo de puntos, idempotencia y formato de recibo).
- Prueba de política de imágenes de fase 1: 1 aprobada.
- `node --experimental-strip-types --check` sobre rutas, esquema, aplicación Express y configuración Drizzle: sin errores de sintaxis. Esto **no** sustituye a TypeScript.
- Paquetes JSON válidos, `git diff --check` sin errores y cotejo de los siete nombres de tabla entre esquema y SQL: correcto.
- No se ejecutaron pruebas de navegador, integración con Clerk/PostgreSQL, compilación ni migración.
