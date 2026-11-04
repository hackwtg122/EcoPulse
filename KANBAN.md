# Kanban EcoPulse

Una tarea solo pasa a TERMINADO tras comprobar su funcionamiento en producción. No se crean datos operativos ficticios.

## POR HACER

- Habilitar y comprobar solicitudes reales de entrega.
- Comprobar recepción y verificación por operadores autorizados y acreditación de EcoPuntos por residuos recibidos y verificados.
- Completar y comprobar recompensas y canjes reales con inventario y cumplimiento.
- Corregir errores de interfaz, persistencia, permisos e integración; mejorar la experiencia sin rediseños innecesarios.

## EN PROCESO

- Persistencia real de EcoGuía: backend y UI implementados; migración aditiva aplicada en Neon. Build y tipos aprobados. En curso: integración, despliegue y comprobación pública; la comprobación con sesión es una tarea separada.

## BLOQUEADO

- Comprobación con sesión real de EcoScan IA/EcoGuía y de creación, recarga, reingreso, continuación, idempotencia, aislamiento y borrado de conversaciones propias: el secreto GitHub `PRODUCTION_QA_ACCOUNTS` falla con `qa_fixture_json_invalid` en `root`. [Ejecución autorizada](https://github.com/hackwtg122/EcoPulse/actions/runs/41788171785). Metadatos comprobados de nuevo: el secreto sigue sin actualizarse desde 2026-11-02T22:43:08Z. Corrección exacta para el propietario: [AUTHENTICATED_QA_SETUP.md](scripts/qa/AUTHENTICATED_QA_SETUP.md). No solicitar credenciales en chat, inventar cuentas, suplantar usuarios ni eludir MFA. Esto bloquea la comprobación privada, no el desarrollo ni las migraciones aditivas.
- Correcciones IA integradas y desplegadas en `0550039e866896383d385f03e3bca984b5c06ba0`; falta comprobar inferencia y guardado con sesión real. Incluyen alternativa gratuita verificada ante 404 dentro del presupuesto de reintentos y cuota, 429 sin reintento automático, chat estricto de 1–800 caracteres, contexto con evidencia operativa y recuperación de conexión/protección de guardado en EcoScan. No pasan a TERMINADO solo por el despliegue.
- Agenda sin cita: integrada en main en `5f0b3aa`, desplegada en Netlify y Render; build, tipos y QA público aprobados. Comprobación funcional pendiente de una sesión autorizada y una solicitud real en un destino validado que no requiera cita. No se crearán entregas ficticias para comprobarla.
- Mapa sin sustitución por ubicaciones de evaluación: integrado en main y desplegado en Netlify y Render en `f473bae`. Bundle público comprobado; requiere sesión autorizada para comprobar visualmente el catálogo privado y su estado vacío sin modificar registros reales. No se considera terminado el flujo privado.
- Comprobar el flujo operativo completo de centros y disponibilidad: requiere centros reales activos, materiales y disponibilidad respaldados por evidencia operativa verificable, y acceso autorizado para la comprobación de extremo a extremo.

## TERMINADO

- Integración segura y despliegue técnico de `f473bae3df9ee49f82445a73031231b1c16d81aa`: SHA exacto comprobado en Render (`/api/version`) y Netlify (`published_deploy`, estado ready). [QA de producción aprobado](https://github.com/hackwtg122/EcoPulse/actions/runs/41786760138): políticas, despliegue Render, API pública y navegador público.
- Comprobación directa de lectura en Chrome sobre https://ecopulseef.netlify.app: inicio y materiales HTTP 200 sin errores de JavaScript; `/map` y `/deliveries` redirigen al inicio sin sesión. Esto verifica disponibilidad pública y protección, no solicitudes ni operaciones privadas.

### Evidencia IA (no equivale a TERMINADO en producción)

- 2026-11-04: catálogo público real de OpenRouter consultado. `nvidia/nemotron-3.5-super-vl:free` publica coste de entrada/salida cero, imagen y salida estructurada.
- `scripts/qa/ai-provider-live.mjs` ejecutado con autorización explícita (`AI_LIVE_VERIFY=true`) y credencial local existente, sin imprimir secretos ni contexto de cuenta inventado. EcoGuía: modelo configurado HTTP 404 → alternativa HTTP 200, respuesta válida de 433 caracteres. EcoScan: modelo configurado HTTP 404 → alternativa HTTP 200, fotografía real de referencia clasificada como plástico; `persisted:false`, `points:0`. Son llamadas directas al proveedor, no pruebas de sesión de producción.
- Build completo y tipos aprobados. Suite dirigida de proveedor, configuración, guía, cuota y catálogo: 46 pruebas aprobadas. Se corrigió la ejecución multiproceso de cuotas para usar Node 22 y la URL del módulo, sin depender del directorio actual ni de `tsx`.
- QA privado preparado para `real_ai_calls=true` mediante el flujo existente `production-private-qa.yml`: solo participante validado, UI real, consentimiento explícito, dos inferencias sujetas a cuotas, fotografía real de referencia y ninguna escritura de clasificación. Sintaxis, política de cuentas y definición YAML comprobadas; la ejecución real continúa bloqueada por el secreto inválido. No se declara comprobado ese flujo.
- Producción `0550039`: [QA público aprobado](https://github.com/hackwtg122/EcoPulse/actions/runs/41789469599), SHA exacto confirmado en Netlify (ready) y Render (`/api/version`). Comprobación directa con Chrome: `/scan` y `/chat` protegidas sin sesión, sin errores de JavaScript; ambos POST de inferencia devuelven 401 sin autenticación. Archivos publicados contienen las correcciones de consentimiento y recuperación de conexión. Nada de esto sustituye una inferencia autenticada ni una prueba de persistencia.

### Evidencia de persistencia EcoGuía

- 2026-11-04: `migrate-ecoguide.mjs --dry-run` validó la migración en transacción con rollback; después `--apply` creó `guide_conversations` y `guide_turns` en el PostgreSQL Neon existente. Sin tocar registros existentes, sin alterar el journal Drizzle previo y sin crear usuarios, preguntas ni respuestas de prueba.
- Dos tablas con RLS forzado, políticas propias `USING`/`WITH CHECK`, FK compuesta de propietario y permisos limitados a las tablas nuevas para `ecopulse_app`; sin acceso PUBLIC. No se concedió membresía de roles ni se simuló una sesión para probarlas.
- `verify-ecoguide-schema.mjs`: comprobación real de esquema y preparación de 20 consultas SQL del servicio en transacción READ ONLY, sin ejecutar las operaciones de conversación. No equivale a una prueba funcional autenticada.
- Consentimiento de almacenamiento separado del envío a IA y desmarcado inicialmente. Solo se almacenan preguntas, respuestas reales y metadatos mínimos; no se copia el contexto del proveedor, imágenes, email ni el resumen de cuenta en columnas adicionales. El contenido de una respuesta puede incluir datos de cuenta que el propio usuario haya consultado. Límite de 50 conversaciones y 100 preguntas por conversación; bloqueo de credenciales reconocibles.
- Listado y recuperación por cuenta Clerk; continuación con historial reconstruido en backend; borrado de una conversación propia con sus turnos. Reintentos con la misma clave devuelven la respuesta guardada sin otra inferencia; respuestas tardías no recrean conversaciones eliminadas. Pendiente de comprobar con sesión real.
