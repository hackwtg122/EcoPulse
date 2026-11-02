# QA privado: acceso mínimo y alcance seguro

CI/CD existente no se cambia. La corrida #3 (`41522011151`) confirmó
`2ab7b490326a0d3c2fa94dbeec66f6369d87f5e7` en ambos servicios, 44 denegaciones
anónimas y 21/21 pruebas públicas. Esto NO certifica ninguna escritura privada.

## Configuración imprescindible, agrupada una sola vez

Para **crear o designar** las cuentas: en la misma instancia de Clerk que usa
Netlify, abrir **Users → Create user** y usar correos controlados destinados solo
a QA, o seleccionar identidades de prueba existentes. No usar cuentas de terceros.
Primer login en EcoPulse provisiona el perfil como PARTICIPANT. Copiar su `userId`
real desde Clerk al secreto solo después de ese login. El campo `role` del JSON
es una expectativa del test, no concede permisos. VERIFIER/ADMIN viven en Neon:
su asignación requiere autorización específica y auditoría; no añadir metadatos
Clerk para intentar elevar privilegios. Puede empezarse solo con PARTICIPANT.
El admin de prueba no puede ser el último admin y no se crea/promueve desde el
runner. El workflow exacto sigue en `.github/workflows/production-private-qa.yml`.

1. GitHub → EcoPulse → **Settings → Secrets and variables → Actions**:
   crear **`PRODUCTION_QA_ACCOUNTS`** con el JSON de abajo, reemplazando valores
   únicamente en GitHub. No pegarlo en chat ni guardarlo/versionarlo con datos
   reales. Deben ser cuentas Clerk de prueba autorizadas, distintas entre sí,
   **ya existentes**, con perfil EcoPulse provisionado y rol correcto.
2. Publicar el archivo nuevo **`.github/workflows/production-private-qa.yml`**
   desde GitHub (Add file → Create new file, misma ruta, contenido local, commit
   a main/PR requerido). La credencial Git de esta sesión no dispone de workflow;
   no se ampliará ni eludirá. Es un workflow privado separado, no reconfigura el
   pipeline que ya funciona. Sus scripts/dependencias deben estar publicados antes.
3. Con el commit desplegado y el secreto disponible, la sesión puede disparar
   este workflow mediante GitHub API (`workflow_dispatch`, main,
   `confirm_test_accounts=true`). No hace falta compartir contraseñas ni desplegar
   manualmente. La suite nunca corre en PR, fork ni otra rama.

Plantilla (los valores son placeholders, NO credenciales válidas):

```json
{
  "version": 1,
  "authorized": true,
  "accounts": [
    {
      "role": "participant",
      "testOnly": true,
      "profilePreexists": true,
      "userId": "user_TestParticipant001",
      "email": "participant@example.invalid",
      "password": "REEMPLAZAR_SOLO_EN_GITHUB"
    },
    {
      "role": "verifier",
      "testOnly": true,
      "profilePreexists": true,
      "userId": "user_TestVerifier001",
      "email": "verifier@example.invalid",
      "password": "REEMPLAZAR_SOLO_EN_GITHUB"
    },
    {
      "role": "admin",
      "testOnly": true,
      "profilePreexists": true,
      "userId": "user_TestAdmin001",
      "email": "admin@example.invalid",
      "password": "REEMPLAZAR_SOLO_EN_GITHUB"
    }
  ]
}
```

Se puede comenzar solo con un participante autorizado y dejar las otras cuentas
fuera del array: los roles ausentes se reportarán BLOCKED. **No usar el único
administrador real** ni cambiar sus roles para preparar las pruebas. Si no existen
cuentas privilegiadas de prueba, su alta/asignación queda pendiente de autorización
específica y del procedimiento seguro de auditoría; el runner nunca las crea ni
promueve. Nunca desactivar MFA/CAPTCHA para conseguir un PASS. Si el login requiere
un factor interactivo, queda BLOCKED; no se suplanta con una clave backend.

## Qué ejecuta la suite

- Login mediante el formulario real de Clerk en Netlify; contraseña únicamente
  en memoria del proceso del runner/navegador. No usa master key ni genera tickets.
- Contexto de navegador nuevo por rol; compara identidad y rol de `/me` sin
  imprimir IDs, emails, tokens ni respuestas privadas.
- Dashboard con datos reales, 22 rutas GET por rol y comprobaciones 200/403,
  carga de páginas privadas, persistencia de identidad tras reload y logout con
  rechazo posterior de una ruta privada. GET de eventos necesita entrega de
  prueba delimitada y no está incluido en esas 22 rutas.
- Admin de prueba solo continúa si hay al menos dos administradores. No toca
  el último admin ni modifica roles. No se exportan filas, screenshots, trazas,
  vídeo, cookies o storageState.
- Bloquea POST/PATCH/DELETE del navegador hacia la API de EcoPulse. Login/logout
  sí crea/revoca sesiones Clerk de las cuentas de prueba. El middleware actual
  de la API intenta INSERT de perfil incluso en GET: por eso se exigen perfiles
  existentes y esta suite NO se anuncia como transacción SQL de solo lectura.
- Comprueba SHA de Render y del frontend Netlify antes de escribir credenciales
  y al finalizar; una ejecución durante otro despliegue no certifica una única
  versión. No se repite la auditoría pública, solo se fija la identidad del build.

## Qué NO pasa a PASS con estas pruebas

Registro/perfil automático nuevo, recuperación/MFA, guardar cambios de perfil,
favoritos, escaneo manual, inferencia IA real, entregas, eventos de una entrega,
verificación física, puntos, canjes, publicación/fulfillment y cambios de rol:
requieren fixtures/registros/políticas y autorizaciones delimitadas adicionales.
Las métricas derivadas pueden leerse sin inventar entregas o puntos.

La suite devuelve código no cero si hay FAIL/BLOCKED en su alcance de lecturas y
sesiones (incluidas cuentas de rol ausentes). Inferencias/escrituras aplazadas se
imprimen como BLOCKED con scope separado; el resumen siempre indica
`systemComplete: false`. Un job verde de lectura NO aprueba esos flujos.
Un PASS `route_shell_load` solo prueba cargar la estructura de esa ruta,
no todos sus botones. No confundir el pipeline público verde con EcoPulse al100%.

## Auditoría y valor real

Publicación de recompensas: endpoint nuevo POST `/api/pilot/admin/rewards/:id/publish`,
protegido por admin, esquema, inventario, evidencia HTTPS y puerta explícita
`PILOT_REWARD_PUBLICATION_ENABLED` (cerrada por defecto). No habilitarla ni publicar
los ejemplos del seed para lograr un PASS. Requiere política y cumplimiento real
aprobados, o un fixture sin valor real autorizado con plan de reversión específico.
La suite de lecturas no ejecuta este POST ni canjes/verificaciones.

Para las escrituras futuras, el permiso debe identificar cuenta/IDs, operaciones,
prefijo o idempotency keys QA, valores máximos, evidencia física si corresponde y
plan de reversión autorizado. No hay cleanup SQL implícito: si falta un mecanismo
de reversión seguro, el flujo permanece BLOCKED. Reponer stock o borrar auditoría
no es una reversión aceptable de un canje real.

0004, permisos, promociones y cualquier SQL de escritura siguen pendientes de
respaldo restaurable comprobado y autorización específica. No se reinicializa
Neon, no se duplica el catálogo, no se crean puntos ficticios y no se ejecutan
modelos remotos ni servicios de pago como parte de esta suite de lectura/sesión.
