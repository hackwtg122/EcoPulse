# EcoPulse — cobertura de producción, 2 nov 2026

## Veredicto: NO TERMINADO

## Resultados funcionales posteriores a la activación

- **PASS EcoGuía, inferencia real**: tras desplegar7bb34ec, el reintento desde
  Firefox produjo POSTguide/ask HTTP200 y respuesta IA sobre vidrio. No se
  duplicó la pregunta del intento fallido. Alcance: una respuesta remota; no
  acredita historial durable entre sesiones ni todas las preguntas/contextos.
- **PASS mapa/directorio visible**: Actions41572070420 SUCCESS de
  `08cf595fa0d62a0eac9f906ae16550fbd089270b`, Renderdep-dbkl8aajnfac7398r5s0
  Live/runtimeverificado. MapaOSM carga y muestra8de8 centros, sin marcadores
  geográficos inventados; todos rotulados como ensayo académico.
- **PASS favoritos, escritura reversible real**: primer centro inicialmente no
  favorito; guardar cambia estado, recarga conserva favorito; quitar y recargar
  devuelve estado inicial. Solo2operacionesUI del propietario, sin tocar roles,
  puntos o entregas. No se alteraron favoritos preexistentes.
- **FAIL EcoScan, inferencia real**: foto pública de botella PNG del fixture,
  sin datos personales, consentimiento marcado; proveedor respondió pero el
  resultado fue rechazado como inválido. No se confirmó ni guardó clasificación.
  Corrección en curso: parámetros estructurados obligatorios y techo precio0,
  razonamiento bajo/excluido, presupuesto visión2048, timeoutacotado y menos
  reintentos; diagnóstico cerrado de truncamiento/JSON/esquema, sin contenido
  proveedor ni secretos. No se acepta JSON parcial ni se relaja la validación.

PreflightNeon focalizadoREADONLY/ROLLBACK:8centrosactivos, los8académicos;
8horariosfuturosactivos;1admin,0verifiers,0participants; auditoría de roles
role_change_events ausente; tablas materiales/favoritos presentes. No existe
una tabla catalog_validations, pero NO es requisito del código: la validación
de catálogo usa columnas validated_at en centros/horarios, no esa tabla.
No deducir una migración de catálogo pendiente de ese nombre inexistente.

Pruebas puras posteriores de IA/configuración/activación/despliegue36/36PASS,
TypeScriptAPI0. Incluyen rechazo de respuesta truncada sin reintentar, redacción
de diagnósticos y respeto de AI_MAX_RETRIES=0. Pendiente desplegar/volver a probar
EcoScan; no declarar el sistema completo ni inferencia de visiónPASS.

## Activación final autorizada — ejecución en curso

### Evidencia de despliegue y diagnóstico real

IA configuración: Actions **41566820679 SUCCESS**, SHA
`7bb34ec67f8b0a44b9d2f32f2355803ef1b319dc`, Render
`dep-dbkkfv6c6qcc73an0v90` Live/runtime confirmado. Actualización de
AI_CHAT_MODEL/AI_VISION_MODEL confirmada; alcance configuración, no inferencia.

Mapa/favoritos: causa concreta corregida en código: consulta de centros ligada
al flag de creación detallada y favoritos no conectados a la lista publicada sin
coordenadas. GETdelivery-points ahora consulta el catálogo existente con SELECT,
sin activar POSTdeliveries; MapPage usa ese lector y siempre conserva mapa base.
Lista publicada muestra favoritos y advertencia explícita para centros académicos.
Sin crear/publicar centros, coordenadas, horarios o entregas ficticios.
Tests focalizados11/11 PASS, TypeScriptAPI/frontendPASS; buildAPI23/23tests+bundle
PASS y frontend10/10tests+VitePASS. Algunas pruebas de cableado son estáticas;
validación visual/favorito persistido pendientes de publicar y desplegar el bloque.

Actions41564969699/4771d0d FAIL antes de modificar variables: consulta anónima de
referencia GitHub HTTP403. Corregida con Git público y validación exacta del SHA.
Actions **41565221688 SUCCESS**, SHA **5099564f015bdbaa4666ce6293cc94f3d6185550**,
Render `dep-dbkk8onb9u1s73fl54e0` Live + runtime verificado. Cambios confirmados:
`PILOT_CATALOG_ADMIN_ENABLED=true`, `PILOT_REWARD_ADMIN_ENABLED=true`.
El runner reportó las otras puertas ordinarias de entregas/verificación/valor
ausentes; `PILOT_AI_ENABLED` ya estaba habilitado. No se imprimieron secretos.

EcoGuía: **FAIL real** desde sesión existente, consentimiento UI marcado,
pregunta sobre vidrio, POST `/guide/ask` HTTP502, respuesta cerrada
`ai_provider_unavailable`. No se leyeron cabeceras de autenticación ni cookies.
La respuesta de error JSON sola se inspeccionó, sin HAR ni exportación de sesión.

Catálogo público de OpenRouter consultado directamente: chat antiguo super120b:free
ausente; nanoOmni:free sin parámetro response_format anunciado; respaldo ya
allowlisted `nvidia/nemotron-3.5-super-vl:free` presente con precio cero, texto,
imagen y structured_outputs. Es evidencia de compatibilidad, no prueba de
inferencia ni identificación inequívoca de toda causa del502.
Se preparó actualización de defaults y flags de modelos antiguos conocidos,
validando el catálogo actual dentro de Actions antes de tocar cada variable.
Proveedores/modelos personalizados y kill-switches se conservan. No se activa
NVIDIA trial ni se cambia ninguna clave. Pruebas puras de proveedor/configuración/
activación/despliegue31/31 PASS; TypeScript API PASS, nodecheckdeployPASS.
La corrección de IA necesita despliegue y nueva inferencia real para PASS.

Etiqueta de cuentas publicada en main: `587f6fd`. El despliegue de activación usa
la credencial Render exclusivamente dentro de Actions, sin recuperarla. Cambia
solo `PILOT_CATALOG_ADMIN_ENABLED` y `PILOT_REWARD_ADMIN_ENABLED` para habilitar
borradores. No publica ejemplos ni convierte inventario académico en valor real.
Una revisión de activación única preserva futuras desactivaciones del operador;
el marcador de runtime solo se escribe después de Live + health + SHA.
Diagnóstico limitado a estados de flags conocidos, nunca valores secretos.
Pruebas puras de activación/despliegue: 12/12 PASS; node --check del deploy PASS.
No son pruebas funcionales de escrituras en producción. Resultado de Actions y
comprobación visible de las capacidades se anotarán tras el despliegue.

Política de puntos del repositorio sigue SIN APROBAR y sin tasas/categorías/vigencia
autorizadas: `REWARD_POINTS_POLICY_PROPOSAL.md`. Su existencia no autoriza usar los
ejemplos 20/kg y 100/entrega como política real. Auditoría0004 exige respaldo y
autorización específicos. El modo académico existente exige otra base aislada;
no activar EVALUATION_MODE_ENABLED en neondb ni reinicializar producción.

## Comprobación visible con sesión existente, autorizada por el propietario

Se utilizó Firefox mediante la interfaz de Windows contra Netlify producción,
sin leer cookies, contraseñas ni tokens. No se crearon cuentas, no se guardaron
formularios ni se cambiaron roles/configuración. No se ejecutó la suite QA ni
se repitió una auditoría pública. Alcance: una sesión administrativa existente,
no pruebas de aislamiento o de permisos con otras identidades.

| Área | Evidencia visible y límite real |
| --- | --- |
| Dashboard/progreso/puntos | Métricas cargadas y consistentes en cero; nivel Semilla y misiones pendientes. No prueba acumulación de puntos ni avance de misiones. |
| Administración/usuarios | Bandeja vacía y lista con un único administrador; selector propio deshabilitado. No se intentó cambiar roles ni verificar entregas. |
| Materiales | Búsqueda `pilas` devuelve una coincidencia; ficha de pilas muestra precauciones, preparación y referencia. No se revisó exhaustivamente todo el catálogo. |
| Centros/mapa | Resumen administrativo carga; edición desactivada. Mapa informa ausencia de horarios y no muestra centros en esta vista. No prueba publicación ni disponibilidad real. |
| EcoScan | Vista manual e historial vacío. Cambiar de papel a plástico actualiza la orientación. No se confirmó registro, no se envió fotografía ni se probó IA. |
| EcoGuía | Anuncia IA disponible; pulsar una pregunta sin consentimiento muestra la solicitud de autorización, sin respuesta remota. No se autorizó transferencia a OpenRouter ni se comprobó inferencia. |
| Entregas | Historial vacío; formulario básico compatible y botón inicialmente deshabilitado, aviso de volver a consultar disponibilidad. Sin crear solicitudes. |
| Recompensas | Catálogo académico de tres recompensas y saldo cero; aviso explícito de canjes desactivados. Administración indica creación/edición/publicación desactivadas. No se canjeó ni publicó. |
| Perfil/seguridad | Perfil y rol visibles; seguridad informa email verificado y TOTP sin configurar. No se editó identidad ni se configuró MFA ni se probaron recuperación/logout. |

Defecto confirmado: resumen de centros rotula como “Participantes” un conteo
de todas las cuentas (API usa COUNT de users sin filtro, y la única cuenta visible
es admin). Corrección local mínima en `catalog-admin-panel.tsx`: “Cuentas
registradas”. TypeScript frontend PASS; sin build, commit, push ni despliegue.
No es una corrección acreditada todavía en producción. La sesión visual no
desbloquea automáticamente el secreto JSON inválido de la suite privada.

## Estado E2E privado vigente — sustitución de bloqueos anteriores

Workflow privado activo405072408 y secretoPRODUCTION_QA_ACCOUNTS **confirmados
existentes**. Run41554609146 de b782056 falló en setup, no en un login acreditado.
Confirmación explícita, checkout, Node, mocks e instalación PASS; el catch genérico
impedía diferenciar fixture, despliegue o browser. No inferir cuentas inexistentes,
roles erróneos o secreto ausente de ese mensaje. Se añadió diagnóstico seguro por
etapa/campo/índice y códigos cerrados, sin recuperar ni volcar el secreto.
Se usa el workflow publicado sin editarlo. Se permiten únicamente normalizaciones
de formato inocuas; no se infieren permisos/roles/declaraciones de perfiles.
La identidad Clerk debe coincidir antes de habilitar cualquier lectura/upsert de
la API. Diagnóstico, credenciales y MFA se distinguen sin exponer respuestas.
Pruebas puras del parser/redacción:7/7 PASS; no constituyen login real.

## Correcciones de los tres FAIL — bloque en curso

### Publicación comprobada (posterior a la implementación)

Commits publicados: `bde56a4` (sin cita), `f7bf82b` (publicación rewards),
`1418d6e` (seed protegido), **`a6a2e1af0266e5f9b5c0c34cc551b661722684fd`**
(regresiones/build/condiciones QA). Actions **#5 / 41538114143 SUCCESS**:
https://github.com/hackwtg122/EcoPulse/actions/runs/41538114143.
Render `dep-dbkgv4qjnfac73c1e4ig` Live+health/version/SHA verificados; Netlify
`6ae90f758c9be12cf3a80cf3` ready mismoSHA (ambos confirmados también por HTTP/API).
El gate de seguridad comprobó **45 denegaciones anónimas** (44 originales+publish)
y21/21 navegador público del pipeline normal. No es verificación autenticada.

Los tres defectos tienen corrección de código desplegada, **NO PASS de escritura**:
sin datos/roles QA autorizados no se publicó recompensa ni centro ni se creó
entrega. Seed y auditoría no ejecutados. Nueva consulta de nombres al finalizar:
secret `PRODUCTION_QA_ACCOUNTS` y workflow privado todavía ausentes. Archivo exacto
local listo para GitHub; la plantilla se entregó primero en la conversación.
Las escrituras siguen BLOCKED hasta autorización/aislamiento/reversión; respaldo
restaurable no acreditado, por lo que no se solicita ejecutar0004 a ciegas.

Causas contrastadas antes de editar con source y consulta **READ ONLY a Neon**:
trigger `enforce_delivery_destination` admite slotNULL cuando no requiere cita;
`guard_catalog_slot` rechaza solapamientos BEFORE INSERT; las cinco columnas de
publicación de rewards existen y el trigger protege detalles publicados. Hay
0 centros sin cita entre los8 actuales: el caso necesita un fixture autorizado,
no se modificó uno real para probarlo. Auditoría0004 sigue ausente. No hay acceso
de gestión Neon configurado para acreditar backups ni evidencia de restore probada.

| Defecto | Corrección de código | Verificación real pendiente |
|---|---|---|
| Centro sin cita se podía crear pero no publicar/solicitar | Quitado filtro incorrecto en publicación, disponibilidad admite walk-ins, API exige slot solo donde corresponde; solicitud sin cita queda pendiente y no promete cupo | E2E con centro/cuenta QA y escritura autorizada |
| Publicación de recompensas no existía | POST admin/rewards/:id/publish + formulario; inventario/evidencia/política, actor revalidado bajo lock, snapshot del borrador, retry sin reponer stock; bandera explícita default cerrada | Cuenta admin QA, política/fixture y reversión autorizados; no activación automática |
| Seed promovía ID fijo y fallaba por trigger antes de ON CONFLICT | Sin usuarios/roles ni IDs Clerk; solo fixtures inactivos, fecha lunes explícita, lock compatible y NOT EXISTS de solapamiento antes del INSERT; filas existentes intactas | Ejecución SQL NO autorizada ni ejecutada; pruebas solo estáticas |

Tests puros **28/28 PASS** (20 dominio API,6 cliente rewards,2 estructura seed).
TypeScript API/frontend y builds PASS. Los builds ahora ejecutan respectivamente
22 y6 tests sin DB; se comprueban también en los ejecutores de Render/Netlify sin
cambiar el workflow CI/CD. No confundirlos con PASS de escritura en producción.
Suite privada distingue lecturas/sesión de inferencias/escrituras aplazadas y
siempre informa `systemComplete:false`. Plantilla/cuentas: PRODUCTION_PRIVATE_QA.md.
Backup y autorización acotada, sin aplicar: AUDIT_BACKUP_APPROVAL.md.
Se mantiene el inventario de44 originales más el endpoint nuevo de publicación
(45 métodos privados en el router); no omitir el endpoint nuevo en la cobertura.

## Estado vigente tras Actions #3 (las notas inferiores son históricas)

### Publicación posterior de la corrección privada preparada

Commits **25da6b5** (paginación usuarios) y **b4cd8b13b07b7fdcdd64cee98a0576ebb814065d**
(suite privada/guía) publicados. Actions **#4 / 41524727219 SUCCESS**:
https://github.com/hackwtg122/EcoPulse/actions/runs/41524727219.
Render deploy `dep-dbkflbqfngtc73f5nsq0`, Live+health+version/SHA verificados;
Netlify deploy `6ae8fa7a44516a4b38852e5e`, mismo SHA b4cd8b1. Contratos frontend
17/17 y políticas/proveedor remotos PASS; 21/21 pruebas públicas de CI PASS.
No se lanzó una auditoría pública aparte: fue el pipeline normal del push.

**Nada de esto acredita E2E privado.** Última comprobación de nombres/permisos:
`PRODUCTION_QA_ACCOUNTS` ausente y workflow privado no publicado. Archivo exacto
preservado en commit local **1ab0aa8**; push normal rechazado por scope workflow,
sin eludirlo. Sigue la única configuración agrupada en `PRODUCTION_PRIVATE_QA.md`.
La paginación está desplegada pero su aprobación funcional autenticada permanece
BLOCKED. Ninguna cuenta, rol, punto, catálogo o fila Neon fue creada/modificada
por estas comprobaciones de la sesión.

Run **41522011151**, #3 SUCCESS, SHA
**2ab7b490326a0d3c2fa94dbeec66f6369d87f5e7**. Confirmado por jobs/logs reales y
GET `/api/version`; Netlify published deploy `6ae8f64076b01a1157c44276`, mismo SHA.
44 denegaciones anónimas y 21/21 pruebas públicas. No se repitió la auditoría
pública ni la configuración CI/CD. El workflow remoto ya tiene timeout25min.

| Función / alcance exacto | Estado vigente | Qué falta |
|---|---|---|
| CI/CD, Live+health+versión, ambos SHA | PASS | Evidencia de #3, no implica flujos privados |
| Páginas públicas y búsqueda/ficha materiales | PASS | 21/21 Playwright, alcance público |
| Denegación anónima de 44 métodos/endpoints | PASS | No acredita 200/403 entre roles autenticados |
| Registro y perfil automático nuevo | BLOCKED | Identidad/inbox de registro de prueba y alta delimitada |
| Login por rol, sesiones, reload, logout | BLOCKED | `PRODUCTION_QA_ACCOUNTS` ausente; nueva suite preparada, no ejecutada |
| Recuperación, MFA, expiración de sesión | BLOCKED | Factores/inbox y flujo de prueba autorizado; no desactivar seguridad |
| Perfil: leer/guardar y persistencia | BLOCKED | Cuenta de prueba; guardar queda fuera de suite de lectura |
| Dashboard y refresh | BLOCKED | GET privados con sesión válida y cuenta aislada |
| Mapa, filtros, geolocalización y centros | BLOCKED | Sesión y E2E privado; page_load no prueba todas sus acciones |
| Favoritos: leer/crear/quitar/persistir | BLOCKED | Cuenta y registros de prueba delimitados |
| EcoScan manual e historial | BLOCKED | Escritura idempotente autorizada, no solo UI visible |
| EcoScan y EcoGuía IA real | BLOCKED | Cuenta, consentimiento, proveedor gratuito/configuración y entrada autorizados |
| Entregas, historial y eventos | BLOCKED | IDs/registros de prueba, sin duplicar centros/horarios |
| Recepción/verificación y comprobantes | BLOCKED | Verificador aislado y acto físico autorizado |
| EcoPuntos y saldo contable | BLOCKED | Política/evidencia física; no fabricar puntos |
| EcoXP, misiones, racha, insignias | BLOCKED | Lecturas privadas y datos reales autorizados |
| Recompensas, inventario, canjes/fulfillment | BLOCKED | Cuentas/fixtures sin valor real y política aprobada |
| Catálogo y estadísticas admin | BLOCKED | Admin de prueba que no sea el último admin |
| Usuarios y paginación | BLOCKED E2E | Paginación implementada con cursor; contrato probado con mocks |
| Cambios de rol/auditoría/último admin | BLOCKED | 0004/permisos, respaldo restaurable y autorización específica; no se toca admin real |
| Aislamiento de registros entre usuarios | BLOCKED | Dos usuarios/registros de prueba delimitados |
| Publicación de recompensa | BLOCKED de E2E; código implementado | Endpoint/formulario nuevos con puerta explícita cerrada; no activar con SQL |
| Centro sin cita y seed | BLOCKED de validación real | Inconsistencias corregidas; seed inactivo propuesto y NO ejecutado |

Acceso imprescindible agrupado: **`PRODUCTION_QA_ACCOUNTS`** en secretos Actions,
con cuentas existentes, testOnly, perfil existente y rol asignado (no crear ni
promover en el runner). Nuevo workflow manual privado preparado separado del
CI/CD: `.github/workflows/production-private-qa.yml`; falta publicación autorizada
por permiso workflow. Detalle/plantilla: `PRODUCTION_PRIVATE_QA.md`.

Suite preparada: contextos aislados por rol, login real sin bypass MFA, 22 GET
por rol y denegaciones200/403, carga privada, reload y logout. No exporta PII,
tokens, contraseñas, screenshots, trazas o cookies; bloquea mutaciones API. Marca
BLOCKED todo flujo no ejercitado, no obtiene PASS por mostrar una página.

Corrección independiente: GET admin/users tenía límite200 sin continuación;
ahora cursor validado, orden estable,200+1, nextCursor y botón Cargar más con
deduplicación. No se crean usuarios para simular200 filas. Tests de contrato
frontend y política fixture: **20/20 PASS con mocks**; tsc API/frontend exit0.
No es aún verificación funcional autenticada en producción.

## Historial preservado de etapas anteriores

### Actualización de desbloqueo (posterior a la entrega inicial)

#### Resultado posterior: corrida real PASS de a2cf355

- GitHub Actions run **41521102043** success:
  https://github.com/hackwtg122/EcoPulse/actions/runs/41521102043.
  role-policy, deploy-render, public-api y public-browser success; Neon omitido
  deliberadamente. No se consultó ni modificó Neon en este bloque.
- Render deploy **dep-dbkf9qk9v7es73bthj1g** Live y runtime verificado. GET real
  `/api/version` ahora devuelve `service=ecopulse-api`,
  `commit=a2cf3558c03375b9eb7c8d4aa331c58796d50ffb`; health 200, CORS y 404 JSON
  aprobados. Se resuelve el 404 observado; no atribuir una causa interna concreta
  al proveedor sin logs del artefacto anterior. La corrección asegura identidad
  del bundle compilado/arrancado y verifica el endpoint real antes de PASS.
- Netlify published deploy **6ae8f4d32dfb053e0c6f55d2**, ready con el MISMO SHA
  completo; confirmado por API después de la corrida.
- Denegación anónima de **44 endpoints/métodos PASS** (401), no autorización ni
  CRUD autenticados. Playwright público **21/21 PASS**, tres tamaños y flujo de
  materiales. No confundir estas pruebas con los flujos privados aún BLOCKED.
- El deploy tardó ~76 s hasta Live en esta corrida y pasó dentro del workflow
  remoto todavía limitado a12 min. Para soportar builds de hasta20 min sigue
  pendiente aplicar el diff del workflow (deploy-render timeout25 min).
- Estos resultados reemplazan los bloqueos de versión/QA público anteriores;
  cuentas/registros de prueba, auditoría0004 y flujos privados siguen pendientes.

- Código corrector timeout/artefacto publicado en `a2cf355`. Cambio del workflow
  conservado en commit local `b1f1d96`, rechazado por permiso workflow; diff exacto
  publicado en `PRODUCTION_CI_WORKFLOW.patch`. Es imprescindible cambiar solo el
  timeout de deploy-render a25 para soportar íntegramente los20min del script.
  Corrida remota de a2cf355 en observación; versión404 previa aún NO declarada
  resuelta. No se reejecutó el deploy dfdcb2f ni se creó una solicitud manual.

- Corrección focalizada del run 41518313424: job role-policy remoto PASS;
  deploy-render agotó su bucle de 35×15 s (log 20:20:51→20:29:41), no su límite
  Actions de 12 minutos. public-api/public-browser quedaron SKIPPED, no PASS.
  Live de dfdcb2f fue reportado por el usuario tras 9m02s. HTTP con cache-buster
  confirmó health 200, version 404 HTML y también 404 genérico HTML. El bundle
  compilado del repositorio sí contiene /version y 404 JSON: runtime servido no
  acredita ese artefacto; el origen exacto de esa divergencia sigue pendiente.
- Implementado plazo monotónico de sondeo de 20 minutos, reutilización por SHA
  de deploy activo/Live, aborto temprano Failed/Cancelled y gate health+versión
  esperada después de Live. Build emite manifiesto de SHA/hash; start verifica
  ambos y carga ese mismo bundle, rechazando un artefacto desfasado. Imports del
  router explícitos; versión devuelve SHA compilado, no solo variable runtime.
  Tests puros con reloj/fetch simulados 5/5 PASS (incluyen Live 9m02s, timeout,
  cancelación, version404/SHA incorrecto). TypeScript API y build exit 0; no se
  arrancó servidor ni consultó BD. Estas pruebas no son PASS funcional remoto.
- Diff mínimo para workflow en `PRODUCTION_CI_WORKFLOW.patch`: deploy job 25 min
  y añadir tests puros al comando existente. El script necesita 20 min + hasta
  2 min de verificación; no declarar compatible el límite antiguo de 12 min.

- Última publicación: `55eed4891a8574d4b3a984a40402415f0b7a83ad`, Netlify
  `published_deploy=6ae8ed2f26e129e85d8bd3ee`, ready, publicado 20:06:26 UTC.
  Workflow endurecido en commit **local** `1c9adef`: push rechazado por PAT sin
  scope workflow. No se eludió. Único paso de operador: publicar el archivo local
  `.github/workflows/production-public-qa.yml` desde el editor web de GitHub en
  main. RENDER_API_KEY ya está configurado; no pedirlo otra vez.
  Render comprobado: healthz 200, version 404 HTML; SHA pendiente. Actions,
  Playwright y flujos privados permanecen BLOCKED, no hay nuevas pruebas PASS
  funcionales por validación de YAML/sintaxis.

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
| POST | `/admin/rewards/:id/publish` | admin, política/flag explícito y esquema; actor revalidado en transacción |
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
