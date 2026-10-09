# EcoPulse: auditoría del repositorio y plan de primera fase

Fecha: 9 de octubre de 2026. Inspección del árbol de trabajo y del último commit (`e680128`). La descripción del producto no se tomó como prueba de implementación.

## Estado comprobado

Al comenzar, el árbol de trabajo tenía **174 archivos rastreados eliminados**, incluidos `artifacts/api-server`, `artifacts/eco-pulse`, `lib/db`, las bibliotecas de API y `replit.md`. Estas eliminaciones existían antes de la auditoría. Los paquetes se examinaron primero con `git show HEAD:<ruta>`. Tras confirmación del usuario se recuperaron `artifacts/` y `lib/`; `replit.md` sigue eliminado por ser ajeno a esa confirmación. No hay `node_modules`, `DATABASE_URL` ni variables Clerk visibles en el entorno inspeccionado.

| Hallazgo comprobado | Archivo implicado (en `HEAD`, actualmente eliminado) | Riesgo | Prioridad | Solución propuesta |
| --- | --- | --- | --- | --- |
| Aplicación, API y bibliotecas ausentes al inicio (recuperadas durante esta fase) | `artifacts/**`, `lib/**` | No era posible arrancar ni compilar el producto inicial | P0 | Recuperadas desde `HEAD` tras confirmación. Verificar instalación y compilación cuando haya acceso al registro. |
| La API solo registra una ruta de salud; no hay rutas de escaneos, entregas, saldo o canjes | `artifacts/api-server/src/routes/index.ts`, `health.ts` | No existe lógica de negocio ni autorización de recursos | P0 | Añadir rutas autenticadas por Clerk y limitar consultas por ID de usuario del servidor. |
| Drizzle abre un pool de PostgreSQL, pero no hay entidades ni migraciones | `lib/db/src/index.ts`, `schema/index.ts` | Sin persistencia; la existencia de `DATABASE_URL` no demuestra una base provisionada | P0 | Crear esquema y migración revisable; ejecutarla manualmente solo en un entorno confirmado. |
| El saldo se calcula de escaneos locales con 1240 puntos iniciales; los canjes mantienen otro saldo editable en `localStorage` | `artifacts/eco-pulse/src/App.tsx` | Puntos duplicables, balances inconsistentes y canjes sin control | P0 | Saldo exclusivo de movimientos en servidor; transacción e idempotencia por operación. |
| Confirmar un escaneo de ejemplo concede puntos sin entrega física | `artifacts/eco-pulse/src/App.tsx` | Incentivo falso y fraude | P0 | Separar orientación por escaneo de entrega verificada; el escaneo no acredita puntos. |
| Se muestran 8,2 kg, rachas, porcentajes de IA y lugares/aliados de ejemplo como si fueran reales | `artifacts/eco-pulse/src/App.tsx` | Información engañosa para un piloto | P0 | Etiquetar la demostración y quitar afirmaciones no validadas del flujo operativo. |
| Elegir imagen acepta `image/*` sin comprobar tamaño o formato; crea URL de objeto sin liberarla | `artifacts/eco-pulse/src/App.tsx` | Consumo de memoria y archivos no esperados | P1 | Restringir MIME y bytes, liberar URL al sustituir/desmontar; validar de nuevo en cualquier API de carga. |
| La geolocalización comunica éxito aun al fallar y la lista de puntos tiene distancias/horarios fijos | `artifacts/eco-pulse/src/App.tsx` | Confianza indebida en datos locales | P1 | No persistir coordenadas; pedir permiso solo si se usa y mostrar estado/error honestos. Validar puntos con responsables reales antes del piloto. |
| CORS permite cualquier origen con credenciales y JSON no tiene límite explícito | `artifacts/api-server/src/app.ts` | Superficie de abuso innecesaria | P1 | Configurar orígenes permitidos y límite de cuerpo; limitar frecuencia de rutas mutables. |
| Clerk gestiona la UI de registro, entrada y salida, pero el servidor no autentica rutas de negocio | `artifacts/eco-pulse/src/App.tsx`, `artifacts/api-server/src/app.ts` | Una sesión en el navegador no protege una API | P0 | Verificar sesión en Express y aplicar permisos por recurso y rol. Mantener `/sign-in`, `/sign-up` y logout. |
| `LocalAuthFallback` permite navegar en modo local si falta la clave pública de Clerk | `artifacts/eco-pulse/src/App.tsx` | Puede confundirse una demo con una sesión real | P1 | Mantenerlo solo como demostración explícita; impedir operaciones reales sin sesión. |
| No se hallaron scripts de prueba en los paquetes de aplicación | `package.json`, paquetes en `HEAD` | Cambios sin verificación automática | P1 | Pruebas de autorización, idempotencia, transacciones, recarga y canje al crear las rutas. |

## Verificaciones ejecutadas

| Verificación | Resultado |
| --- | --- |
| Inventario de archivos y `git status --short` | Confirma 174 eliminaciones preexistentes; 48 archivos permanecen, incluidos recursos binarios. |
| Lectura de `package.json`, `pnpm-workspace.yaml`, scripts, rutas y esquema en `HEAD` | Confirma React 19, TypeScript, Vite, Express 5, Clerk y Drizzle declarados; solo salud implementada en API. |
| `pnpm --version` | 11.25.0. |
| `pnpm run typecheck` y `pnpm run build` | No concluyeron: pnpm intentó verificar/instalar 492 entradas del lockfile, el registro npm respondió `ECONNREFUSED`; se detuvo tras los reintentos iniciales. No se afirma que compilen. |
| `pnpm run typecheck --offline` | También intentó acceder al registro y se detuvo por la misma restricción. |
| Pruebas automatizadas existentes | No hay script `test` en los paquetes examinados. |

## Plan priorizado

1. **Fase 1 (acotada):** resolver el estado de las eliminaciones; recuperar los paquetes de aplicación si corresponde. Quitar la concesión de puntos por escaneo demo, señalizar los datos de ejemplo, validar la imagen local y documentar variables en `.env.example`. Añadir pruebas focalizadas donde la infraestructura permita ejecutarlas. Mantener las rutas Clerk. Esta fase quedó implementada en el árbol de trabajo; no equivale a persistencia real.
2. **Fase 2:** con PostgreSQL accesible, crear el esquema Drizzle para usuarios (solo ID de Clerk y rol), escaneos, entregas, verificaciones, movimientos, recompensas y canjes; generar migración revisable sin aplicarla automáticamente. Enlazar rutas con sesión Clerk y filtros de propiedad.
3. **Fase 3:** verificar entregas por un operador autorizado; acreditar y canjear en transacciones, con claves de idempotencia y restricciones únicas. Probar concurrencia, autorización, recargas, duplicados y canjes contra PostgreSQL de pruebas.
4. **Antes del piloto:** validar puntos de recolección y recompensas con responsables reales, política de retención y protección de menores; medir resultados sin presentar estadísticas demo como reales.

La decisión de desplegar o migrar debe esperar a una base provisionada y pruebas ejecutables. Este plan no implica que las funciones de las fases 2 y 3 ya existan.
