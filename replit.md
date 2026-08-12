# EcoPulse

EcoPulse ayuda a identificar residuos, encontrar puntos ecológicos y convertir el reciclaje diario en puntos y recompensas.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/eco-pulse/src/App.tsx` — experiencia principal, navegación, autenticación Clerk y estado local de la demo.
- `artifacts/eco-pulse/src/index.css` — tokens visuales y estilos globales de EcoPulse.
- `artifacts/api-server/src/middlewares/clerkProxyMiddleware.ts` — proxy de Clerk para producción.

## Architecture decisions

- Clerk gestiona cuentas, sesiones y el inicio de sesión; el navegador usa cookies de sesión y no tokens manuales.
- El escaneo, los puntos, los canjes y el chatbot funcionan localmente para que la primera versión sea usable sin APIs externas.
- El proxy de Clerk vive en el API server y solo se activa en producción.

## Product

- Landing pública, login y registro personalizados.
- Dashboard de progreso, escaneo demo/subida, puntos cercanos, recompensas, chatbot EcoGuía y centro de seguridad.
- La persistencia de la demo usa almacenamiento local del navegador y está lista para migrarse a servicios reales.

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

_Populate as you build — sharp edges, "always run X before Y" rules._

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
