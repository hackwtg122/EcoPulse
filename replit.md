# EcoPulse

EcoPulse es un piloto juvenil de reciclaje en Montería. La interfaz incluye una demostración explícita; las operaciones reales requieren PostgreSQL y Clerk configurados.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — servidor API (puerto local 5000 por defecto)
- `pnpm --filter @workspace/eco-pulse run dev` — frontend Vite (puerto local 5173 por defecto)
- `WINDOWS.md` — preparación con Corepack y comandos de PowerShell
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run generate` — generar una migración Drizzle para revisión; **no la aplica**
- `lib/db/migrations/0001_core.sql` — migración inicial SQL redactada para revisión; **no se ejecuta automáticamente**
- No usar `push` ni `push-force` sobre producción. Revisar y respaldar antes de cualquier migración.
- Variables requeridas: ver `.env.example` y `FASE_2.md`. Las claves secretas solo van en el servidor.

## Stack

- pnpm workspaces, Node.js 22+ (el entorno original documentaba 24), TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild y Vite

## Where things live

- `artifacts/eco-pulse/src/App.tsx` — experiencia principal, navegación, autenticación Clerk y estado local de la demo explícita.
- `artifacts/eco-pulse/src/index.css` — tokens visuales y estilos globales de EcoPulse.
- `artifacts/api-server/src/middlewares/clerkProxyMiddleware.ts` — proxy de Clerk para producción.
- `artifacts/api-server/src/routes/pilot.ts` — API persistente condicionada a configuración real.
- `lib/db/src/schema/index.ts` — entidades Drizzle.

## Architecture decisions

- Clerk gestiona cuentas, sesiones y el inicio de sesión. La API piloto valida la sesión con Clerk.
- El escaneo demo no verifica entrega física ni concede puntos. El saldo real se calcula desde movimientos del servidor.
- El catálogo y el mapa de la interfaz siguen siendo ejemplos sin aliados o puntos de recolección validados.
- El proxy de Clerk vive en el API server y solo se activa en producción.

## Product

- Landing pública, login y registro personalizados conservados.
- Dashboard, escaneo demo, puntos cercanos, recompensas, chatbot EcoGuía y centro de seguridad son experiencias de demostración hasta conectar los servicios reales.
- La API piloto se desactiva con `503` cuando faltan variables críticas; no se sustituye por datos falsos.

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

_Populate as you build — sharp edges, "always run X before Y" rules._

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
