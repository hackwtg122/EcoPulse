# Corregir el acceso autorizado de QA

Diagnóstico confirmado de nuevo en el commit de persistencia `1b13a1b`: [ejecución 41794416699](https://github.com/hackwtg122/EcoPulse/actions/runs/41794416699), `qa_fixture_json_invalid`, campo `root`. El secreto `PRODUCTION_QA_ACCOUNTS` no se puede analizar como JSON. El fallo ocurre antes de iniciar sesión: no demuestra una contraseña incorrecta ni un fallo de Clerk. El agente no puede recuperar el valor de un secreto de Actions mediante la API. Sus metadatos siguen indicando última actualización en 2026-11-02T22:43:08Z.

El propietario debe editar **Settings → Secrets and variables → Actions → Repository secrets → PRODUCTION_QA_ACCOUNTS** en `hackwtg122/EcoPulse`:

- Guardar un objeto JSON válido, no código JavaScript, una lista sola ni texto de instrucciones. Usar comillas dobles; sin comentarios ni comas finales. No publicar su contenido en issues, commits, logs o chat.
- Raíz: `version` (número `1`), `authorized` (booleano `true`), `accounts` (lista de una a tres cuentas existentes y expresamente autorizadas).
- Cada cuenta: `role` (`participant`, `verifier` o `admin`), `userId` (ID Clerk real que cumpla `^user_[A-Za-z0-9]{3,64}$`), `email` y `password` reales de esa cuenta, `testOnly: true` y `profilePreexists: true`.
- `testOnly` y `profilePreexists` son afirmaciones que el propietario debe poder confirmar. No marcar cuentas personales reales como aisladas de QA si no lo son; no crear identidades ficticias para satisfacer la prueba. La cuenta debe existir en Clerk y en PostgreSQL con el rol indicado. Identidades, emails y roles deben ser distintos en la lista.
- `password` debe ser una cadena de al menos ocho caracteres; nunca reemplazarla por un texto de ejemplo. No se omiten CAPTCHA, MFA ni factores interactivos: si son obligatorios, esa sesión permanece bloqueada hasta disponer de acceso autorizado compatible.

El esquema exacto y las comprobaciones sin imprimir valores están en `scripts/qa/private-qa-policy.mjs`. Tras corregir el secreto, ejecutar **Production private QA (authorized test accounts)** sobre `main`, confirmando las cuentas existentes. `real_ai_calls=true` autoriza inferencias reales con cuota y foto de referencia, pero no guarda clasificaciones. Las pruebas de creación/borrado de conversaciones requieren autorización independiente y no deben tocar conversaciones ajenas.

No cambiar las claves de Clerk, los roles de usuarios ni las políticas de seguridad para resolver un error de sintaxis del secreto.
