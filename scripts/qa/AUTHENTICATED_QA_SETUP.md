# QA con veinte identidades autorizadas, sin contraseñas

El flujo nuevo de concurrencia no usa `PRODUCTION_QA_ACCOUNTS` ni solicita contraseñas. Usa tickets oficiales de inicio de sesión de Clerk, de corta duración, exclusivamente para veinte identidades de prueba existentes y autorizadas. Los tickets y las sesiones viven solo en memoria del runner; no se exportan a logs, archivos, capturas o artefactos. No se modifica la cuenta administradora principal.

Requisitos de **Twenty authenticated accounts QA**:

- Secreto `CONCURRENCY_QA_IDENTITIES`: objeto JSON con `version: 1`, `authorized: true` y `accounts`, una lista de exactamente veinte cuentas distintas.
- Cada entrada contiene únicamente `userId` (ID Clerk existente), `role: "participant"`, `testOnly: true` y `profilePreexists: true`. No admite correos, contraseñas ni identidades administrativas.
- Las atestaciones deben ser reales: no marcar cuentas personales como fixtures, no crear cuentas en producción para llenar una lista y no inferir autorización a partir de que una cuenta exista.
- La cuenta debe estar provisionada en Clerk y Neon como participante antes de ejecutar la carga. El runner comprueba el principal de Clerk y el rol real de la API antes de usarlo.
- Secreto `CLERK_SECRET_KEY` de la instancia autorizada en el runner remoto. No se cambia la clave existente ni se imprime su valor.
- Ejecutar primero con `validate_only: true`: comprueba la lista sin iniciar sesión. Para la carga, `validate_only: false` y `accounts_verified: true` requieren confirmación explícita del propietario.

El runner `scripts/qa/concurrency-ticket.mjs` abre veinte contextos de navegador independientes y navega por el panel y los retos; inicia los cinco minutos después de verificar las veinte identidades. En producción solo permite lecturas y aborta mutaciones de la API. Informa p50/p95, estados HTTP, errores y número de contextos; no afirma disponer de CPU/memoria de Render. Las escrituras concurrentes de retos, puntos, solicitudes y canjes se prueban por separado en PostgreSQL restaurado y aislado, sin confundirlas con sesiones Clerk.

El secreto legado inválido no se considera reparado ni se utiliza como alternativa. No hace falta compartir ninguna contraseña. Sin las veinte identidades expresamente autorizadas, la prueba autenticada permanece bloqueada aunque la integración aislada pase.
