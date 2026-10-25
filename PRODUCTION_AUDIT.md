# EcoPulse — auditoría inicial de producción (25 oct 2026)

## Continuación: rendimiento móvil (versión publicada, antes de este cambio)

Se midió **la versión publicada**, no los cambios locales: Chrome headless + Lighthouse CLI instalado previamente, 3 ejecuciones por URL, perfil móvil predeterminado, categorías performance/accessibility/best-practices/SEO, flags `--headless --no-sandbox --disable-gpu --disable-dev-shm-usage`. Los seis JSON completos están en `C:\Users\JAIRO\AppData\Local\Temp\opencode\ecopulse-lh-mobile-before-20261025\{home,materials}-{1,2,3}.json`; el primer intento con LHCI falló al iniciar Chrome, por lo que se repitió con la CLI de Lighthouse y los seis informes válidos comparten configuración. Las medianas son de cada métrica por separado (no de una corrida representativa).

| Ruta | Performance (3) | Mediana | A11y / BP / SEO (mediana) | LCP ms (3; mediana) | TBT ms (3; mediana) | FCP ms (mediana) |
| --- | --- | ---: | --- | --- | --- | ---: |
| `/` | 42, 58, 51 | **51** | 96 / 79 / 100 | 7058, 6285, 7030; **7030** | 1880, 527, 674; **674** | 2980 |
| `/materials` | 52, 48, 46 | **48** | 98 / 79 / 100 | 6648, 6802, 6434; **6648** | 598, 727, 896; **727** | 2833 |

**Causas observadas:** el LCP de `/` es el título de texto y el de `/materials` es el texto introductorio. En `/`, el HTML publicado carga ~372 kB de JS principal (sin comprimir), 209 kB de React y 94 kB de Clerk local, más JS remoto de Clerk; Lighthouse marca entre 167 y 300 KiB de JS no usado según ruta/ejecución y trabajo de terceros en el hilo principal. Google Fonts ya usa `display=swap`; su CSS de ~1,1 kB sigue en la lista de recursos bloqueantes (en una corrida, 817 ms de duración atribuida), aunque el total estimado por la auditoría para esa oportunidad aparece como 0 ms. No se atribuye todo el LCP/TBT a fuentes ni al propio bundle.

**Cambios locales para validar antes de publicar:** se retiró el intento incorrecto de montar `AuthenticatedRouter` fuera de `ClerkProvider` (sus hooks requieren contexto y el cambio rompía la portada). Se conserva el proveedor en todas las rutas para respetar sesiones y redirecciones existentes: **Clerk remoto sigue siendo coste inicial** hasta contar con una estrategia de sesión comprobada. `materials-page`/catálogo y `interactive-map` pasan a importación dinámica, conservando las rutas públicas y privadas y mostrando un estado de carga accesible. Build local: JS principal **372343 → 169510 bytes** sin comprimir (−54,5 %); materiales aportan 12,92 + 13,69 kB al visitarlos y el mapa 176,72 kB JS + 15,61 kB CSS solo al cargarlo. Se usa preload no bloqueante para Google Fonts, conservando `display=swap` y `<noscript>`; una prueba de navegador confirma que el stylesheet termina aplicándose. Un Lighthouse **local, una sola corrida, NO comparable con producción** dio 65 / LCP 5715 ms / TBT 450 ms para `/` y dejó únicamente el CSS propio entre los recursos bloqueantes. No se declara mejora de puntuación en producción sin despliegue y tres nuevas corridas.

**Verificación local:** `corepack pnpm --filter @workspace/eco-pulse typecheck` PASS (0 errores); `corepack pnpm --filter @workspace/eco-pulse build` PASS; `test:pilot-api` 14/14 y `test:scan-catalog` 1/1 PASS; `scripts/qa/local-performance-smoke.mjs` 38/38 PASS con Chrome en 390 y 1366 px: 6 rutas públicas, ficha y navegación, formularios de login/registro, transición SPA y ocho rutas privadas redirigiendo sin sesión; `/` no descarga el mapa ni la biblioteca. El script acepta `QA_BASE_URL=https://ecopulseef.netlify.app` además del preview local, restringe los destinos a esos dos y no envía formularios ni modifica datos. La prueba de superficie de producción publicada mostró `/sign-in` 2 inputs, `/sign-up` 4, `/dashboard` anónimo redirige a `/`. **Pendiente**: una cuenta Clerk autorizada para probar sesión existente, credenciales válidas, guardado de perfil y logout; no se han simulado cuentas, tocado datos ni probado acciones mutantes. Push autorizado exclusivamente para cinco archivos; las corridas post-despliegue y comparación de medianas requieren confirmación del nuevo SHA en Netlify. No incluir cambios NVIDIA.

**Entorno medido:** `https://ecopulseef.netlify.app` y `https://ecopulse-3xb4.onrender.com`; frontend publicado `e1c32208d6ee42fa08146888e8cb4976afc3ece1` según API de Netlify. Una respuesta HTTP o una compilación local no acredita un flujo autenticado. Sin SQL, test accounts, canjes, puntos, migraciones ni llamadas a modelos remotos. Sin push de estas correcciones.

## Evidencia reproducible

- Playwright Core 1.56.0 con Chrome headless contra **producción**: `node scripts/qa/production-public.mjs`, `CHROME_PATH` y `PROD_QA_MODULES_DIR` definidos en el ejecutor. 21/21 comprobaciones públicas PASS: seis rutas (`/`, `/materials`, `/faq`, `/privacy`, `/terms`, `/contact`) y flujo enlace → búsqueda → resultado vacío → limpiar → ficha → volver; móvil 390×844, tableta 768×1024, escritorio 1366×900; HTTP 200, encabezado visible, sin errores JS ni solicitudes fallidas de primera parte durante esas comprobaciones. No prueba todos los botones ni el diseño visual completo.
- Navegador de producción sin sesión: `/sign-in` HTTP 200 (2 inputs), `/sign-up` HTTP 200 (4 inputs); `/dashboard` redirige a `/`. No se envió formulario ni se creó ninguna cuenta.
- API de producción: `/api/healthz` 200 (1061 ms observado una vez); `/api/pilot/me`, `/scans/ai-capabilities`, `/guide/capabilities`, `/admin/users`, `/delivery-points` y `/delivery-options` respondieron 401 sin sesión (407–734 ms). `Cache-Control: no-store, private` en rutas privadas. `Origin: https://ecopulseef.netlify.app` recibe ACAO correspondiente y credenciales; `Origin: https://untrusted.example` no recibe ACAO. Comprobación limitada, no prueba permisos con sesión.
- Lighthouse CI 0.15.1 / Lighthouse 12.6.1 con Chrome 156.0.8078.47 contra producción, **una ejecución** por URL/modo (primera lectura 25 oct 2026, 07:27 UTC), emulación estándar. Informes JSON/HTML locales (fuera del repositorio) en `%LOCALAPPDATA%/Temp/opencode/ecopulse-prod-qa/.lighthouseci/lhr-*`; no hay datos de campo de Core Web Vitals ni INP. Google PageSpeed Insights respondió 429; no se repitió.

| Página y modo | Rendimiento | Accesibilidad | Buenas prácticas | SEO | LCP laboratorio | TBT | CLS |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `/` móvil | 28 | 90 | 79 | 100 | 8,897 ms | 2,576 ms | 0.054 |
| `/` escritorio | 78 | 90 | 78 | 100 | 2,340 ms | 12 ms | 0.001 |
| `/materials` móvil | 39 | 90 | 79 | 100 | 7,699 ms | 1,550 ms | 0.001 |

Los resultados son una **línea base de laboratorio**, no una promesa de rendimiento continuo; la muestra única y los cold starts introducen variación. En `/` Lighthouse atribuyó ~3,170 ms potenciales a recursos bloqueantes (incluido Google Fonts CSS), ~328 KiB de JS sin usar (Clerk y bundle de inicio) y 13.2 s de trabajo del hilo principal emulado. No se atribuye el resultado a Render: las páginas públicas no dependen del login/API para pintarse.

## Estado por módulo

| Módulo | Estado | Alcance comprobado / bloqueo |
| --- | --- | --- |
| Inicio y páginas informativas públicas | PASS | Navegador, tres tamaños, 18 navegaciones. |
| Biblioteca de materiales pública | PASS | Búsqueda, vacío, limpiar, abrir ficha y volver; tres tamaños. |
| Registro/inicio de sesión | BLOCKED | Formularios visibles, sin cuentas autorizadas ni envío. |
| Cierre de sesión; dashboard, perfil y progreso | BLOCKED | Requiere sesión Clerk autorizada; `/dashboard` sin sesión redirige a `/`. |
| EcoScan AI y registro manual | BLOCKED | Requieren sesión y consentimiento; no se consumió cuota de IA. |
| EcoGuía AI | BLOCKED | Requiere sesión, consentimiento y cuota; no se llamó al proveedor. |
| Mapa, ocho centros, filtros y horarios | BLOCKED | Solo mapa privado; no hay evidencia de ocho centros **publicados** en producción. No confundir centros académicos/ilustrativos con físicos. |
| Solicitudes/historial de entregas | BLOCKED | Requiere cuentas de prueba y operaciones autorizadas. |
| Recepción/verificación, EcoPuntos, canjes y recompensas | BLOCKED | Roles y operaciones que cambian datos; no autorizadas. |
| Panel admin y roles | BLOCKED | Solo 401 sin sesión; requiere cuentas ADMIN/VERIFIER de prueba y autorización específica. |
| API salud y denegación anónima | PASS | GET salud 200; siete rutas privadas 401; CORS verificado solo en esos orígenes. |
| Accesibilidad y rendimiento móvil públicos | FAIL | Lighthouse y problemas P1 abajo; no representa toda la app privada. |

## Fallos reales y correcciones

1. **P1 — Accesibilidad móvil:** Lighthouse detectó `<meta name="viewport" ... maximum-scale=1>` (bloquea zoom), contraste bajo (33 nodos auditados en `/` móvil; ejemplo titular coral 2.38:1 y texto secundario 3.9:1), y `alt="EcoPulse"` duplicado junto al texto de la marca. **Causa:** `index.html`, tokens claros en `src/index.css`, y `IconLogo` en `src/App.tsx`. **Preparado localmente, no desplegado:** eliminar `maximum-scale`, oscurecer tokens claros con ratios calculadas ≥4.5:1 en superficies principales, ajustar contraste del texto sobre acento y tratar el logo decorativo como tal. Requiere verificar con Lighthouse de producción tras push autorizado; no declarar PASS ahora.
2. **P1 — Rendimiento móvil:** `/` 28/100 (LCP 8.9 s, TBT 2.6 s); `/materials` 39/100. **Evidencia:** informes Lighthouse arriba. **Preparado localmente:** mover el `@import` de Google Fonts del CSS a `<link>` en el HTML, para que el navegador lo descubra antes y en paralelo. **Pendiente de perfilado/validación en producción:** carga de Clerk en páginas públicas y JS no utilizado; no desactivar Clerk ni garantías de autenticación sin evidencia.
3. **P1 externo/BLOCKED — MFA Clerk:** evidencia de sesión del usuario (captura previa) «This feature is not enabled on this instance» al configurar TOTP. Requiere habilitar la estrategia en Clerk Dashboard y un plan de producción compatible; no se contrató nada. Código publicado del flujo no elimina el bloqueo del proveedor.
4. **P2 — Metadatos sociales:** `og:description` y `twitter:description` publicados aún contienen «built on Replit. Update this description...». Preparada descripción real en `index.html`; pendiente de despliegue.
5. **P2 — Sitemap:** `GET /sitemap.xml` responde 200 **HTML** (fallback SPA), no XML; `robots.txt` responde 200 y solo contiene `Allow: /` (no anuncia sitemap). No afirmar sitemap funcional ni crear uno falso; necesita rutas canónicas públicas y publicación deliberada.
6. **P2 — Cabeceras:** homepage responde con HSTS, pero sin CSP, Referrer-Policy ni X-Frame-Options en la respuesta medida. El riesgo específico requiere evaluación de orígenes Clerk/Netlify antes de imponer CSP; no se aplicó una política que pudiera romper login.

## Herramientas y siguiente dependencia

- Multi-Agent-QA-Orchestrator: repositorio público **sin licencia declarada** según GitHub; README exige clave LLM y almacena credenciales/capturas. No instalar ni transferir datos personales sin licencia, seguridad y costes aprobados. Se eligió Playwright Core Apache-2.0 y Lighthouse CI Apache-2.0, versiones fijas. Instalación única de herramientas fuera del repo para medir producción; ningún servidor local.
- Se preparó `.github/workflows/production-public-qa.yml` **solo `workflow_dispatch`**: ejecutor gratuito de GitHub Actions, Chrome, Playwright público sin login, Lighthouse móvil/escritorio sobre `/` y `/materials`, artefactos con retención de siete días, permisos `contents: read`. Aún no publicado/ejecutado en Actions: requiere autorización de commit/push; no se necesitan secretos para el job público. Nunca subir trazas o capturas autenticadas como artefactos públicos.
- Para pruebas privadas: al menos cuentas de prueba Clerk aisladas, roles autorizados y datos reversibles; cargar credenciales como **GitHub Actions secrets** tras aprobación, sin escribirlas en repo/chat. Separar expresamente cualquier aprobación/verificación/canje real; no crear puntos basados en datos ficticios. Verificar nuevas correcciones **en producción después del despliegue**; hasta entonces su estado es «preparado», no «corregido».
