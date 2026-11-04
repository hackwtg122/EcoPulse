# Kanban EcoPulse

Una tarea solo pasa a TERMINADO tras comprobar su funcionamiento en producción. No se crean datos operativos ficticios.

## POR HACER

- Habilitar y comprobar solicitudes reales de entrega.
- Comprobar recepción y verificación por operadores autorizados y acreditación de EcoPuntos por residuos recibidos y verificados.
- Completar y comprobar recompensas y canjes reales con inventario y cumplimiento.
- Corregir errores de interfaz, persistencia, permisos e integración; mejorar la experiencia sin rediseños innecesarios.

## EN PROCESO

- Desplegar y comprobar las correcciones de EcoScan IA/EcoGuía: alternativa gratuita verificada ante 404 dentro del presupuesto de reintentos y cuota; 429 sin reintento automático; respuestas de chat estrictas de 1–800 caracteres; contexto solo con evidencia operativa; recuperación de conexión y protección de guardado en EcoScan.

## BLOQUEADO

- EcoScan IA/EcoGuía de extremo a extremo con sesión y persistencia real: el secreto GitHub `PRODUCTION_QA_ACCOUNTS` falla con `qa_fixture_json_invalid`. [Ejecución autorizada](https://github.com/hackwtg122/EcoPulse/actions/runs/41788171785). Requiere que el responsable corrija ese secreto con cuentas existentes autorizadas (JSON según `scripts/qa/private-qa-policy.mjs`), o facilite una sesión autorizada por un canal seguro. No solicitar tokens en chat, crear cuentas ficticias, suplantar usuarios ni eludir MFA. EcoScan solo registra una categoría tras confirmación explícita; no acredita puntos. El chat actual no conserva conversaciones tras recargar: no se declara persistencia de conversaciones en PostgreSQL.
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
