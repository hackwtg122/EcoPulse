# Coordinación local EcoPulse

Este archivo rige el trabajo concurrente de Codex y OpenCode en este checkout. Antes de editar, leer `AGENTS.md`, `COORDINATION.md`, `git status --short` y los archivos de la tarea. El código actual prevalece sobre planes anteriores. No reanudar `/demo`.

## Límites compartidos

- EcoPulse real: React/Vite 127.0.0.1:5174, Express 127.0.0.1:5001, Clerk y PostgreSQL `ecopulse_dev`. No tocar Chimbita (5173).
- Preservar cambios existentes y datos. Sin migraciones, grants/roles sensibles, cambios de credenciales, push ni despliegue. Dejar pendientes los pasos que los requieran.
- Sin puntos, canjes o verificaciones reales basados en datos inventados. Mantener puertas de activación cerradas hasta pruebas, política y autorización.
- No mostrar secretos ni tokens. No llamar a modelos remotos sin verificar consentimiento, límites de imagen/entrada y configuración válida. Preferir el modo manual cuando OpenRouter no esté configurado.
- No editar archivos del otro agente simultáneamente. Registrar reserva, resultado y pruebas en `COORDINATION.md` antes de pasar un archivo común.
- No eliminar módulos, pruebas ni funciones existentes por considerarlos obsoletos. Proponer la limpieza en `COORDINATION.md` y esperar revisión de Codex.

## Reparto inicial

- **OpenCode**: EcoScan AI, integración OpenRouter y EcoGuía AI, únicamente cuando `COORDINATION.md` indique una tarea activa con archivos exclusivos. No editar `App.tsx`, `pilot.ts`, esquema/migraciones, configuración compartida ni `.env.local`; proponer aquí cualquier cambio necesario.
- **Codex**: arquitectura, integración, seguridad, UX/UI, pruebas y optimización. No editar archivos reservados a OpenCode mientras su sesión esté activa. Revisar su entrega antes de integrarla.

Al acabar cada bloque, escribir en `COORDINATION.md`: archivos, comportamiento, resultados exactos de TypeScript/tests/build, riesgos y próxima dependencia. Codex revisa e integra tras la entrega. No arrancar agentes recursivos ni procesos de larga duración sin propósito concreto.
