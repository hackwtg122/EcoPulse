# Kanban EcoPulse

Una tarea solo pasa a TERMINADO tras comprobar su funcionamiento en producción. No se crean datos operativos ficticios.

## POR HACER

- Habilitar y comprobar solicitudes reales de entrega.
- Comprobar recepción y verificación por operadores autorizados y acreditación de EcoPuntos por residuos recibidos y verificados.
- Completar y comprobar recompensas y canjes reales con inventario y cumplimiento.
- Verificar EcoScan IA y EcoGuía con sus proveedores reales.
- Corregir errores de interfaz, persistencia, permisos e integración; mejorar la experiencia sin rediseños innecesarios.

## EN PROCESO

- Ninguna tarea activa. Continuar con una tarea POR HACER que no requiera inventar datos ni eludir permisos.

## BLOQUEADO

- Agenda sin cita: integrada en main en `5f0b3aa`, desplegada en Netlify y Render; build, tipos y QA público aprobados. Comprobación funcional pendiente de una sesión autorizada y una solicitud real en un destino validado que no requiera cita. No se crearán entregas ficticias para comprobarla.
- Mapa sin sustitución por ubicaciones de evaluación: integrado en main y desplegado en Netlify y Render en `f473bae`. Bundle público comprobado; requiere sesión autorizada para comprobar visualmente el catálogo privado y su estado vacío sin modificar registros reales. No se considera terminado el flujo privado.
- Comprobar el flujo operativo completo de centros y disponibilidad: requiere centros reales activos, materiales y disponibilidad respaldados por evidencia operativa verificable, y acceso autorizado para la comprobación de extremo a extremo.

## TERMINADO

- Integración segura y despliegue técnico de `f473bae3df9ee49f82445a73031231b1c16d81aa`: SHA exacto comprobado en Render (`/api/version`) y Netlify (`published_deploy`, estado ready). [QA de producción aprobado](https://github.com/hackwtg122/EcoPulse/actions/runs/41786760138): políticas, despliegue Render, API pública y navegador público.
- Comprobación directa de lectura en Chrome sobre https://ecopulseef.netlify.app: inicio y materiales HTTP 200 sin errores de JavaScript; `/map` y `/deliveries` redirigen al inicio sin sesión. Esto verifica disponibilidad pública y protección, no solicitudes ni operaciones privadas.
