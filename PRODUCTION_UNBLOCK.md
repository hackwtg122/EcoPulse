# Desbloqueo operativo de producción

## Activación CI/CD — estado vigente

**RENDER_API_KEY confirmado en Repository secrets** por consulta de nombres, sin
acceder a su valor. No hay que volver a configurarlo. La credencial Git sigue
con scope `repo`, sin `workflow`; GitHub aún informa cero workflows publicados.

El archivo definitivo es **`.github/workflows/production-public-qa.yml`** del
checkout. Usa `secrets.RENDER_API_KEY`, acepta solo push/main o dispatch/main del
repo oficial, nunca PR/PR-target; acciones checkout/setup-node fijadas por SHA,
checkout sin token persistido y permisos GITHUB_TOKEN solo de lectura. Neon es
opcional y también restringido a main. El secreto Render solo llega al paso de
deploy. Una ejecución obsoleta no puede volver a desplegar un SHA anterior a main.

**Único procedimiento de publicación si el push es rechazado por workflow:**
abrir <https://github.com/hackwtg122/EcoPulse/new/main>, nombre
`.github/workflows/production-public-qa.yml`, pegar el contenido completo del
archivo local y **Commit changes** a main (o merge del PR que exija la protección
de rama). Esto usa los permisos del operador en GitHub, no elude los del token.
Ese commit debe disparar la cadena automáticamente en Actions →
**Production functional QA**; no hay que ejecutar comandos ni desplegar Render
manualmente. Si GitHub requiere habilitar Actions, usar su aviso para el repo.

Las comprobaciones previas fueron YAML/política estática y sintaxis JS, no tests
remotos. Hasta publicar el archivo no puede usarse el secreto para ejecutar el
deploy desde Actions: GitHub no permite leer el valor de un Repository secret.
No se ha intentado extraerlo. Esta sección reemplaza la solicitud antigua de
volver a configurar RENDER_API_KEY o de ampliar la credencial automáticamente.

## Configuración inicial agrupada para automatizar (sin despliegues manuales)

La autorización ya permite automatizar, pero faltan estas capacidades técnicas:

1. **Credencial GitHub con permiso de publicar workflows**: configurar una
   credencial autorizada para esta sesión, con acceso a este repo y scope
   `workflow` (el token existente solo tiene `repo`). Guardarla en el gestor de
   credenciales Git del equipo, nunca en chat/archivos versionados. Alternativa
   de una sola vez: publicar el archivo desde GitHub como se indica abajo.
   No se ampliaron permisos ni se intentó eludir el rechazo.
2. **`RENDER_API_KEY`**, en GitHub → repositorio → Settings → Secrets and
   variables → Actions → New repository secret. La clave debe acceder al servicio
   oficial existente. No hace falta contratar un plan ni crear servicio alguno.
   Con el workflow publicado, cada push aprobado a main ejecutará pruebas,
   descubrirá el servicio por URL exacta, verificará repo/branch, ajustará solo
   root/build/start si hace falta y desplegará el SHA. Se negará a desplegar si
   detecta un pre-deploy command no vacío (no autorizar SQL implícito).
3. **Cuentas/registros de prueba delimitados**: designar participant/verifier/
   admin de prueba (no último admin real). Provisionar su acceso al runner en
   secretos, sin passwords por chat. No se necesita otra clave Neon para la
   inspección directa: ya se encontró y se consultó la conexión disponible.
   Para habilitar el job Neon opcional sí usar una URL autorizada de solo lectura,
   nunca copiar la conexión owner disponible a los secretos de Actions.
4. Auditoría 0004 continúa como autorización separada: respaldo restaurable
   comprobado + permiso específico. No se incluye dentro de CI/CD automático.

La automatización está **preparada, no activada ni validada** mientras falten
los puntos 1 y 2. No requiere intervención en cada despliegue después de esa
configuración inicial. Netlify ya despliega automáticamente desde main.

### Datos ya verificados sin escrituras

Neon neondb: 15 tablas, 8 centros, 16 horarios, 3 recompensas y 1 admin; cuatro
entradas de migración, tabla de auditoría ausente. Clave Clerk disponible y
frontend desplegado corresponden a la misma instancia test (comparación JWKS).
Esto sustituye las afirmaciones anteriores de que no había acceso a Neon/Clerk;
las secciones originales inferiores conservan pasos alternativos de operador.

No usar localhost, no ejecutar migraciones ni cargar seed. No pegar secretos,
cookies, contraseñas o HAR en chat. Este archivo contiene acciones, no otra
auditoría general. Cobertura funcional vigente: `PRODUCTION_COVERAGE.md`.

## 1. Render: acción mínima del operador

La ruta existe en `81e628c9971b642c0941e134e0b768f957506f85`:
`src/app.ts` monta `/api` → `routes/index.ts` monta `healthRouter` →
`routes/health.ts` registra `/version`. La API pública devuelve 404 HTML:
**no acredita ejecutar ese código**. No hay credencial/API/MCP de Render en esta
sesión; no se pueden leer los settings, SHA activo ni logs privados desde aquí.

1. Abrir <https://dashboard.render.com> y el Web Service cuya URL sea
   **`https://ecopulse-3xb4.onrender.com`**. No crear otro servicio ni contratar plan.
2. En **Settings → Build & Deploy**, comprobar, sin cambiar secretos:
   - Repository: `https://github.com/hackwtg122/EcoPulse`.
   - Branch: `main`.
   - Root Directory: vacío (raíz del monorepo; requiere `lib/` y lockfile raíz).
   - Build Command, para esa raíz:
     `corepack pnpm install --frozen-lockfile && corepack pnpm --filter @workspace/api-server build`.
   - Start Command:
     `corepack pnpm --filter @workspace/api-server start`.
   - **No** `dev`, Vite, un bundle viejo en otra carpeta ni un comando `db:migrate`.
   - Pre-deploy Command: no debe ejecutar migraciones/seed/grants sin autorización.
   - Health Check Path: `/api/healthz` (solo salud, no prueba SHA).
   - Revisar Build Filters: no deben excluir `artifacts/api-server/**`, `lib/**`,
     `pnpm-lock.yaml`, `pnpm-workspace.yaml` o `package.json`.
3. Revisar **Auto-Deploy**. Si indica **After CI Checks Pass**, comprobar los
   checks del commit: Render no despliega si hay cero checks. Si el operador
   prefiere no cambiarlo, usar el deploy manual siguiente. Si desea autodeploy
   sin CI, elegir **On Commit**. No afirmar que este sea el ajuste actual:
   aún no se ha podido consultar.
4. Abrir **Deploys → Manual Deploy → Deploy latest commit**. Es un despliegue de
   código, sin SQL. Antes comprobar el SHA que Render ofrece como latest.
   **Restart service no incorpora commits nuevos**. Si el último deploy falló
   por artefactos/build tras corregir comandos, usar **Clear build cache & deploy**.
5. Abrir el deploy y sus logs: confirmar checkout de SHA esperado, esbuild genera
   `artifacts/api-server/dist/index.mjs` y aparece `Server listening` sin errores.
   Si falla, compartir solo el SHA, estado y líneas de error saneadas; no todo el
   log ni variables de entorno. Un build/start fallido deja sirviendo el deploy
   anterior y explica cómo puede continuar health 200 con `/version` 404.
6. Consultar <https://ecopulse-3xb4.onrender.com/api/version>. Debe responder JSON
   con `service: "ecopulse-api"` y `commit` igual al SHA del deploy. No declarar
   éxito si es 404 o `commit: null`. Compararlo con el deploy Netlify.

Referencias oficiales: <https://render.com/docs/deploys> y
<https://render.com/docs/monorepo-support>.

## 2. GitHub Actions: publicar sin ampliar permisos del token

El workflow preparado está en **`.github/workflows/production-public-qa.yml`**
del checkout local. No se ha publicado con la credencial insuficiente.

1. Un operador con permiso de escritura abre
   <https://github.com/hackwtg122/EcoPulse> → **Add file → Create new file**.
2. Nombre exacto: `.github/workflows/production-public-qa.yml`.
3. Copiar el contenido completo del archivo local; **Commit changes** a `main`
   (o PR si la protección de rama lo exige). No incluir secretos en el YAML.
4. En **Actions → Production functional QA**, el push ejecuta los tests de
   políticas/contratos y después despliega Render mediante API, sin esperar al
   auto-deploy condicionado por CI. Los tests con mocks NO son PASS funcional.
5. Provisionado `RENDER_API_KEY`, cada push a `main` debe recorrer la cadena
   automáticamente. **Run workflow** en branch main permite repetirla; mantener
   `neon_readonly` apagado hasta provisionar el secreto autorizado de solo lectura.
6. Revisar jobs: `public-api` compara ambos SHA, salud/CORS/404 y denegación
   anónima para **cada método de los 44 endpoints privados**, sin sesión ni
   mutaciones autenticadas. `public-browser` usa Playwright contra producción en
   móvil/tableta/escritorio y el flujo público de materiales. No certifican CRUD.

No usar un runner externo de pago ni el token actual para eludir el rechazo.

## 3. Neon: consulta autorizada de solo lectura

No se dispone de conexión Neon en esta sesión. No se han verificado ni alterado
las 15 tablas/8 centros/16 horarios/3 recompensas/1 admin reportados previamente.

1. En Neon Console elegir proyecto correcto, branch de producción y **neondb**.
   Obtener una conexión de una identidad **ya existente y autorizada para SELECT**.
   No crear roles ni grants. Si no existe, solicitar autorización específica para
   provisionarla o realizar las consultas desde el SQL Editor como operador.
2. En GitHub → **Settings → Secrets and variables → Actions → New repository
   secret**, guardar la URL como **`NEON_READONLY_URL`**, fuera del chat. Usar
   `sslmode=verify-full`, host real `*.neon.tech`, base `neondb`.
3. En el workflow manual activar `neon_readonly`. El verificador remoto
   `scripts/neon/verify-production-readonly.mjs` verifica destino y TLS, abre
   **BEGIN READ ONLY**, limita timeout y solo consulta catálogo, tablas/columnas,
   grants visibles, flags de roles, conteos y journal Drizzle. Termina ROLLBACK.
   Nunca exporta filas de usuarios, IDs Clerk, passwords o la URL.
4. Si hay `permission denied`, se informa BLOCKED: no conceder permisos ni
   cambiar a owner automáticamente. Puede faltar visibilidad para certificar
   todos los grants. Guardar la evidencia del runner para revisar discrepancias.

**Auditoría 0004:** ejecutar sigue prohibido sin autorización específica y
respaldo restaurable comprobado. Primero identificar branch/proyecto exactos,
método de backup o punto de restauración, retención y evidencia de restauración
aislada autorizada. No contratar backups, crear copias ni restaurar sobre
producción automáticamente. Revisar permisos mínimos de auditoría sin ejecutar
el REVOKE global del script histórico de grants.

## 4. Clerk y CRUD: cuentas de prueba, no contraseñas por chat

Hace falta que el operador designe cuentas de prueba **ya autorizadas** para
participant/verifier/admin y delimite qué registros pueden crear/modificar.
El admin de prueba no debe ser el último admin real. No promover cuentas como
parte de preparar pruebas sin autorización de privilegios.

- Configurar acceso al runner mediante secretos GitHub/Environment, nunca YAML,
  logs, issues ni chat. No usar sesiones o datos de participantes reales.
- Antes de pruebas autenticadas, confirmar misma instancia Clerk en Netlify y
  Render y los dominios autorizados. No sustituir claves ni desactivar validación.
- Registro crea datos en Clerk y perfil en Neon: requiere autorización expresa
  de altas de prueba. Las lecturas privadas actuales también intentan registrar
  el perfil si falta; por eso no se presentarán como consultas DB puramente
  read-only ni se ejecutarán con identidades no delimitadas.
- Registro/login/recuperación/sesión/logout, perfil, 403 entre roles, aislamiento,
  entregas, verificaciones y canjes siguen BLOCKED sin esas cuentas/registros.
- Ni el último administrador ni una recompensa de valor real se usarán como
  experimento. No inventar verificaciones físicas ni puntos. La política y la
  autorización deben preceder los tests que cambian valor o privilegios.

## Qué compartir para desbloquear sin secretos

Render: SHA marcado Live, build/start command, estado Auto-Deploy y error saneado
si lo hay. GitHub: URL de la corrida. Neon: resultados agregados del job, nunca
la URL. Clerk: confirmación de cuentas/roles de prueba autorizados y alcance de
registros, nunca contraseñas ni tokens. Esos datos permiten continuar sin repetir
el inventario ni atribuir PASS a builds.
