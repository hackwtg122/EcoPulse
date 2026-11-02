# EcoPulse — cobertura de producción, 2 nov 2026

## Veredicto: NO TERMINADO

### Actualización de desbloqueo (posterior a la entrega inicial)

- Activación CI/CD: `RENDER_API_KEY` confirmado en Repository secrets; ya no falta
  ese secreto. Token Git aún scope `repo`, sin `workflow`; cero workflows
  publicados. Archivo local endurecido a repo oficial/main, sin PR, acciones por
  SHA y sin credencial persistida. YAML/política estática y sintaxis JS PASS;
  ejecución remota sigue BLOCKED hasta publicación autorizada del workflow.

- Publicados `93b71d4` (verificadores/despliegue preparado) y `d261b18b2a2035c1614905c17ee1b84cc75e69aa`
  (cobertura/configuración agrupada). Netlify API confirma publicado `d261b18`,
  deploy `6ae8e86ac7e9eddd7544b425`, ready, `2026-11-02T19:46:06.088Z`.
  Render sigue 404 en `/api/version`; no hay SHA Render confirmado.

- **Neon PASS de inventario remoto real**, usando TLS y `BEGIN READ ONLY`,
  terminado en ROLLBACK: 15 tablas públicas, 8 centros, 16 horarios, 3 recompensas,
  6 materiales, 17 asociaciones centro/material, 1 usuario admin, 0 scans,
  entregas, movimientos, canjes y favoritos. Journal Drizzle con cuatro entradas
  correspondientes en timestamp a 0000–0003. `role_change_events` NO existe.
- Rol `ecopulse_app` existe sin superuser/createdb/createrole/bypassrls; grants de
  tablas/columnas inspeccionados. La conexión disponible es de owner, pero se
  forzó read-only. No se verificó qué credencial usa Render; no propagar esa URL
  owner a GitHub ni atribuir PASS al mínimo privilegio de la aplicación remota.
- **Clerk PASS de correspondencia de configuración**: JWKS obtenidos con la
  clave secreta disponible coinciden con los JWKS de la instancia que aparece en
  el bundle publicado de Netlify; es instancia `test`. NO acredita el secreto
  configurado en Render ni login/registro/sesiones/roles de prueba.
- **Render BLOCKED**: ruta montada confirmada en código, producción 404 HTML,
  sin API key/deploy hook/CLI/MCP de Render. GitHub: token con scope `repo`, sin
  `workflow`, y cero secretos de Actions. Cero checks del commit, por lo que
  `After CI Checks Pass` sería una posible causa a comprobar, NO diagnóstico
  confirmado de sus settings privados.
- Preparados `deploy-render.mjs` (API, servicio exacto, SHA Live, sin SQL),
  verificador Neon read-only, inspección Clerk y QA anónimo para los 44 métodos.
  Workflow local mejorado: tests → deploy Render → comparación de ambos SHA →
  Playwright. **Aún no publicado/ejecutado** por permiso `workflow` y API key.
- Esta actualización reemplaza los bloqueos antiguos de conexión Neon y clave
  Clerk indicados más abajo. Ningún flujo privado obtiene PASS por inventario.

PASS significa únicamente la comprobación concreta indicada, no todo el módulo.
BLOCKED significa que falta acceso, autorización o despliegue; FAIL señala un
defecto identificado. TypeScript/build no equivalen a PASS funcional.

## Publicación y evidencia de este bloque

- Push confirmado a `origin/main`: `81e628c9971b642c0941e134e0b768f957506f85`.
- Commits: `93d9906` (versión pública/404 JSON/política), `85e1ccc`
  (configuración IA con puertas explícitas), `81e628c` (usuarios/auditoría/gates).
- Netlify API pública: deploy `6ae8e3eabc42c345311ac950`, `ready`,
  `commit_ref=81e628c9971b642c0941e134e0b768f957506f85`.
- Render todavía sirve una versión anterior: GET `/api/version` devuelve 404
  HTML y la ruta inexistente también devuelve HTML. SHA efectivo **no probado**.
- HTTP de producción, sin sesión ni escrituras: healthz 200 `{"status":"ok"}`;
  `/api/pilot/me`, `/admin/users` y `/verifier/deliveries` devuelven 401
  `authentication_required`. Primer sondeo health devolvió 503; después 200.
- TypeScript API/frontend: ambos exit 0. Build API/Vite: ambos exit 0.
  No se arrancó aplicación ni base local. No se ejecutó SQL contra Neon.
- GitHub rechazó publicar `.github/workflows/production-public-qa.yml`: token
  sin scope `workflow`. El código se publicó en una historia separada sin ese
  archivo. Workflow conservado localmente y en la rama local `main`, no publicado.
- Tests unitarios nuevos y Playwright remoto **NO EJECUTADOS en este bloque**.
  Las cifras históricas de Playwright en `PRODUCTION_AUDIT.md` no prueban este SHA.

## Infraestructura

| Comprobación | Estado | Evidencia/dependencia |
|---|---|---|
| Frontend SHA y deploy | PASS | Netlify ready, SHA exacto arriba |
| Backend salud | PASS | HTTP 200; antes hubo 503 |
| Backend SHA nuevo/404 JSON | BLOCKED | Render sigue respondiendo 404 HTML; revisar despliegue en Render |
| Acceso anónimo a 3 rutas privadas | PASS | 401; no demuestra autorización entre usuarios autenticados |
| Neon conexión, tablas, migraciones y grants | BLOCKED | Falta conexión segura de solo lectura |
| Conteos 15 tablas/8 centros/16 horarios/3 recompensas/1 admin | BLOCKED | Son afirmaciones históricas, no verificadas; NO asumir base vacía |
| Clerk claves de misma instancia/sesiones | BLOCKED | Sin cuenta de prueba autorizada/configuración remota verificable |
| Flags Render/políticas/proveedores | BLOCKED | Sin acceso autorizado al panel/API de configuración |
| Ejecución GitHub Actions/Playwright remoto | BLOCKED | Credencial sin permiso workflow |

## UI y acciones (sin sesión autorizada)

| Área/rutas | Acciones existentes que deben probarse | Estado de flujo real |
|---|---|---|
| `/` | Navegación, CTA, chat informativo local (no presentarlo como IA remota) | BLOCKED: navegador remoto pendiente |
| `/materials`, `/materials/:id` | Búsqueda, filtro, limpiar, ficha, volver | BLOCKED: navegador remoto pendiente |
| `/faq`, `/privacy`, `/terms`, `/contact` | Lectura y navegación; no inferir envío de contacto | BLOCKED: navegador remoto pendiente |
| `/sign-in/*` | Login, recuperación, verificación y redirección | BLOCKED: cuenta Clerk de prueba |
| `/sign-up/*` | Registro, validación, rol participante, persistencia | BLOCKED: alta de prueba autorizada |
| Sesión | Recarga, expiración, aislamiento, logout, revocación | BLOCKED: sesiones de prueba |
| `/profile` | Nombre/datos de cuenta, errores y persistencia Clerk | BLOCKED |
| `/security` | Contraseña, MFA, sesiones y reverificación | BLOCKED |
| `/dashboard` | Cinco lecturas, refresh, saldo, actividad, errores y accesos | BLOCKED |
| Notificaciones | Panel local de actividad y marca leída local por cuenta | BLOCKED; no es notificación persistida en servidor |
| `/progress` | EcoXP, niveles, misiones, insignias y racha derivados | BLOCKED; no otorga EcoPuntos |
| `/scan` manual | Elegir categoría, guardar, historial e idempotencia | BLOCKED: escritura de prueba autorizada |
| `/scan` IA | Consentimiento, imagen válida, modelo real, cuota, error, fallback | BLOCKED: sesión y configuración remota |
| `/chat` | Consentimiento, pregunta/historial/contexto, cuota, respuesta real | BLOCKED: sesión y configuración remota |
| `/map` | Centro, material, mapa, horarios, geolocalización, navegación | BLOCKED |
| Favoritos | Listar, añadir, quitar y persistir por cuenta | BLOCKED; gate evaluación eliminado en código |
| `/deliveries` | Crear solicitud, materiales/peso/centro/horario, historial, eventos | BLOCKED: registros de prueba autorizados |
| `/admin` verificador | Cola, recepción física, rechazo/aprobación y comprobante | BLOCKED: cuentas por rol y operación física autorizada |
| EcoPuntos | Política, peso verificado, libro contable, concurrencia, saldo | BLOCKED: política y prueba física; no inventar puntos |
| `/rewards` | Catálogo, coste, saldo, canje idempotente, historial | BLOCKED: recompensa/inventario y registros autorizados |
| `/admin/rewards` | Borrador, editar, inventario, fulfillment y reserva concurrente | BLOCKED; publicación de recompensa sigue pendiente |
| `/admin/centers` | Crear/editar centro/horario, validar/publicar, capacidad, desactivar | BLOCKED; defectos pendientes abajo |
| Estadísticas | Conteos reales y manejo de esquema anterior | BLOCKED; guard 0003 añadido en código |
| `/admin/users` | Listar, confirmar cambio, proteger propio/último admin, denegar roles | BLOCKED: UI publicada; API nueva aún sin SHA verificado |
| Auditoría de roles | Cambio y evento atómicos, concurrencia, rollback sin permisos | BLOCKED: 0004 y grants requieren autorización/respaldo |
| Responsive | Móvil/tableta/escritorio y formularios privados | BLOCKED: Playwright remoto pendiente |

## API: cada operación privada identificada

Prefijo `/api/pilot`. Todas requieren sesión; admin/verifier tienen además gate de rol.
Estado funcional de **cada operación**: BLOCKED por falta de cuentas/datos de prueba
autorizados y del nuevo backend desplegado. Los tres 401 arriba son pruebas
específicas de denegación anónima, no PASS de sus flujos autenticados.

| Método | Ruta | Rol adicional |
|---|---|---|
| GET | `/me` | — |
| GET | `/balance` | — |
| GET | `/point-movements` | — |
| GET | `/favorites` | — |
| POST | `/favorites/:id` | — |
| DELETE | `/favorites/:id` | — |
| GET | `/progress` | — |
| GET | `/scans/ai-capabilities` | — |
| POST | `/scans/classify` | consentimiento IA |
| GET | `/guide/capabilities` | — |
| POST | `/guide/ask` | consentimiento IA |
| GET | `/scans` | — |
| POST | `/scans` | — |
| GET | `/admin/catalog` | admin |
| GET | `/admin/stats` | admin |
| POST | `/admin/catalog/points` | admin |
| POST | `/admin/catalog/slots` | admin |
| PATCH | `/admin/catalog/points/:id` | admin |
| PATCH | `/admin/catalog/slots/:id` | admin |
| POST | `/admin/catalog/points/:id/validate` | admin |
| POST | `/admin/catalog/slots/:id/validate` | admin |
| PATCH | `/admin/catalog/slots/:id/capacity` | admin |
| POST | `/admin/catalog/:kind/:id/deactivate` | admin |
| GET | `/delivery-points` | — |
| GET | `/evaluation-points` | modo evaluación o lista vacía |
| GET | `/delivery-options` | — |
| GET | `/deliveries` | — |
| POST | `/deliveries` | — |
| GET | `/verifier/capabilities` | admin/verifier |
| GET | `/deliveries/:id/events` | propietario o admin/verifier |
| GET | `/verifier/deliveries` | admin/verifier |
| POST | `/deliveries/:id/receive` | admin/verifier |
| POST | `/deliveries/:id/verify` | admin/verifier |
| GET | `/rewards/capabilities` | — |
| GET | `/rewards` | — |
| GET | `/admin/rewards` | admin |
| POST | `/admin/rewards` | admin |
| PATCH | `/admin/rewards/:id` | admin |
| GET | `/redemptions` | — |
| POST | `/redemptions` | — |
| GET | `/admin/redemptions` | admin |
| POST | `/admin/redemptions/:id/fulfill` | admin |
| GET | `/admin/users` | admin |
| PATCH | `/admin/users/:clerkUserId/role` | admin, revalidado dentro de transacción |

## Defectos conocidos: no ocultar ni declarar cierre total

| Defecto | Estado |
|---|---|
| Faltaba UI de usuarios | Implementado/publicado frontend; E2E BLOCKED |
| Cambio de rol sin auditoría / último admin / actor demovido concurrente | Corregido en código con lock transaccional; producción BLOCKED por 0004/permisos/despliegue |
| Errores admin fuera del handler | Rutas movidas antes del handler; producción pendiente |
| Favoritos ligados a modo evaluación y ausencia de tabla daba 500 | Corregido en código; persistencia BLOCKED |
| Puntos de prueba expuestos fuera de evaluación | Gate añadido; comprobar flag remoto |
| Lecturas admin de columnas 0003 sin guard | Guard añadido; producción pendiente |
| Guía/centros ignoraban flag de entregas detalladas | Corregido en código; producción pendiente |
| Fallback legacy con flag activo y esquema faltante | Ahora 503 sin crear entrega; producción pendiente |
| Seed con Clerk ID fijo/promoción fallida al existir participante | FAIL pendiente; no ejecutar |
| Seed de horarios no reejecutable por trigger de solapamiento | FAIL pendiente; no ejecutar |
| Editar horario borrador expirado | BLOCKED: el código admite reprogramarlo a futuro; conservar fechas pasadas se rechaza deliberadamente. Falta prueba E2E, no debilitar validación temporal |
| Publicar centro sin cita obligatoria | FAIL pendiente de corrección y prueba |
| No existe endpoint de publicar recompensa | FAIL pendiente de implementación y política verificable |
| Lista admin limitada a 200 sin paginación | FAIL de cobertura de cuentas por encima del límite |

## Dependencias para continuar con evidencia real

1. Render: revisar/autorizadamente desplegar `81e628c` y confirmar `/api/version`.
2. Habilitar publicación del workflow mediante una credencial autorizada con
   permiso `workflow`, o un operador que lo añada desde GitHub. No ampliar permisos
   de la credencial automáticamente. Ejecutar QA contra los servicios oficiales.
3. Conexión Neon de solo lectura provisionada fuera del chat. Primero comprobar
   tablas/conteos/migraciones/grants, sin modificar datos ni asumir base vacía.
4. Autorizar específicamente 0004 y sus permisos mínimos solo tras respaldo
   restaurable comprobado; **no ejecutar** el script completo de grants a ciegas.
5. Cuentas Clerk de prueba participant/verifier/admin y registros delimitados
   autorizados para CRUD. No enviar tokens, contraseñas ni HAR por chat.
6. Evidencia de políticas de puntos, centros, recompensas y acceso gratuito IA.

Esta matriz registra todos los endpoints encontrados y áreas/actions del
inventario disponible; no certifica cobertura automatizada de cada botón ni
ausencia de defectos todavía no descubiertos.
