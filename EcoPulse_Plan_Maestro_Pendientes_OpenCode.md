# EcoPulse — Plan maestro de implementación sobre la versión local actual

**Fecha:** 17 de octubre de 2026  
**Fuentes:** `EcoPulse_Ideas_Diseno_Estructura_y_Mejoras(1).md` (visión funcional y visual, basada originalmente en un ZIP anterior), informe `Texto pegado(8).txt` (estado comunicado por OpenCode), capturas recientes del navegador y contexto del proyecto.  
**Naturaleza del documento:** instrucciones y criterios de aceptación para continuar el proyecto **existente**. Los estados indican la evidencia aportada, no una inspección directa de los archivos más recientes del PC.

## 1. Objetivo irrenunciable

Convertir EcoPulse en una única aplicación pública confiable y usable en Montería que permita **identificar residuos → confirmar material → consultar guía → buscar centro validado → solicitar entrega → recepción y verificación autorizada → consultar impacto y EcoPuntos respaldados → canjear premios disponibles**. Cuando no haya centros/aliados ni acuerdos reales, mantener la información educativa funcional y explicar claramente por qué no está disponible una operación; nunca simular hechos ambientales, centros abiertos o premios.

### Stack y límites vigentes

- Conserva React, TypeScript, Vite, Wouter, Tailwind, Clerk, Express, PostgreSQL y Drizzle. Evita una reescritura.
- Proyecto local: `C:\Users\JAIRO\Desktop\appmariclaudia\Eco-Smart-Hub`.
- EcoPulse frontend `127.0.0.1:5174`; API `127.0.0.1:5001`; PostgreSQL `ecopulse_dev` en `5432`.
- **No tocar Chimbita Barber Shop en 5173**, ni modificar su contenido o procesos.
- Migraciones `0000_core` a `0003_reward_fulfillment` **ya aplicadas**. No volver a aplicarlas.
- Conservar todas las cuentas y datos persistentes. Estado histórico comunicado: 3 usuarios, 1 escaneo manual, 1 entrega V1 pendiente, 2 centros candidatos inactivos, 0 puntos concedidos/canjes/verificaciones/recompensas activas.
- Cambios de código y pruebas seguras: autorizados. Migraciones, grants/permisos sensibles, alteración o borrado de datos, activación de operaciones que impliquen premios/puntos físicos, push y despliegue: **pedir autorización explícita**, aportando primero el alcance preciso y rollback.
- Continuar con configuración y credenciales actuales. No imprimir secretos ni incluirlos en respuestas. No ocupar tiempo rotándolos ahora.
- **No revivir DEMO ni datos ilustrativos como si fueran reales.** Para pruebas, usar base/instancia aislada y datos sintéticos claramente etiquetados, sin operaciones falsas en el libro contable real.
- Mantener intactos módulos útiles, identidad visual botánica verde/crema/amarillo, DM Sans y Fraunces. No refactorizar masivamente sin necesidad.

## 2. Ya realizado o parcialmente implementado: no repetir

Según el último reporte, se cuenta con: login y roles Clerk, conexión PostgreSQL y API; dashboard real, escaneo manual e historial, infraestructura de IA con gate y consentimiento, solicitudes de entrega V1/V2 y paneles de recepción/verificación bajo gates, libro contable de EcoPuntos, estructura de recompensas/canjes e idempotencia, administración de borradores de centros, mapa OSM con vacío honesto, EcoGuía de reglas/contexto, seguridad TOTP, página `/profile`, campana funcional de actividad reciente, UI administrativa de cumplimiento de canjes y navegación responsive básica. Las últimas validaciones: TypeScript/build correctos, **50/50 pruebas automatizadas**, API `5001` sana y frontend `5174` sirviendo 200. Estos resultados **no equivalen a validación E2E autenticada ni a operación pública lista**.

Antes de implementar cualquier requisito, verificar en el código actual si ya se cumple; marcarlo `EXISTE`, `PARCIAL`, `FALTA` o `BLOQUEADO EXTERNO` con prueba concreta. No inventar fechas, porcentajes de precisión, material aceptado por un centro ni horarios operativos.

## 3. Pendientes ordenados por prioridad y criterios verificables

### FASE 1 — P0: cerrar producto educativo público sin dependencias comerciales

**P0.1 Biblioteca pública «Materiales y guías» (RF-03, 07, 10, 11, 33; HU-01, 04, 07, 19).**

Crear ruta pública `/materials` y ficha individual, reutilizando catálogo y guías locales validadas. Buscador con términos cotidianos/sinónimos (`botella plástica`, `icopor`, `cartón`, `lata`, `pilas`), categorías, pasos **sí/no/antes de entregar**, residuos de manejo especial, fuente y fecha de revisión. Mantener textos apoyados por guías revisadas; contenido local no revisado se marca como orientación general. Lectura sin registro Clerk. Enlaces desde Landing, escaneo, EcoGuía y mapa. **Aceptación:** visitante sin cuenta puede buscar dos materiales, abrir ficha, consultar preparación/precauciones y volver; API pública no expone datos personales.

**P0.2 Flujo continuo y claro.**

Desde escaneo manual o confirmación de sugerencia IA, ofrecer CTA `Consultar guía` y `Buscar dónde entregarlo` con filtro por material; cuando no haya centros activos, mostrar estado vacío útil y opción de información general sin fabricar centros. Desde una ficha de centro publicada, ofrecer solicitud de entrega solo si el centro está autorizado para recibir y hay capacidad/configuración válida. **Aceptación:** el usuario nunca queda atrapado en una pantalla o botón decorativo.

**P0.3 Landing, legales, privacidad y soporte (RF-04, 41).**

Publicar secciones útiles: cómo funciona, cobertura real, preguntas frecuentes, privacidad/política de datos, términos y contacto. No inventar email, teléfono, entidad legal ni condiciones; usar contenido validado o texto neutral indicando información pendiente de facilitar. Soportar el flujo de tratamiento de datos personales y eliminación/rectificación según políticas definidas; no prometer eliminación completa sin mecanismo implementado. **Aceptación:** acceso público a información y avisos correctos; sin afirmaciones de impacto ni convenios falsos.

**P0.4 Perfil, preferencias y sesiones (RF-04, 05).**

La ruta `/profile` ya existe, pero hoy es principalmente consulta de datos. Completar edición de perfil con mecanismos seguros de Clerk y, cuando aplique, preferencias persistentes; estados correctos, sin atribuir a PostgreSQL cambios no guardados. Revisar que recuperar acceso, cerrar sesión y MFA funcionen end-to-end. Notificaciones: la campana actual es un panel de actividad, **no notificaciones push reales**; etiquetarla correctamente, evitar punto rojo permanente sin eventos nuevos. **Aceptación:** cambios sobreviven recarga/otra sesión según fuente, sin mezcla de cuentas.

**P0.5 Calidad visual y accesibilidad (todas las pantallas).**

Revisar en ancho 375/390/768/1366 px, zoom 200%, teclado y errores de red. Corregir espacios vacíos sin propósito, desbordes, contraste, textos, formularios, menús, estados vacíos y botones inertes. Mantener estética verde/crema/amarillo; tarjetas y encabezados consistentes. Probar en navegador renderizado real (ideal Playwright si ya disponible); un HTTP 200 no prueba diseño. **Aceptación:** sin scroll horizontal accidental, botones alcanzables y mensajes de éxito/error/espera correctos.

### FASE 2 — P0/P1: directorio confiable (RF-13 a 20; HU-08 a 12)

**Puntos y mapa:** ficha individual real con dirección, coordenadas verificadas, contacto público autorizado, materiales aceptados, horarios confirmados, restricciones, estado/fuente/fecha de revisión; filtros de nombre, zona y material, mapa con marcadores conectados a la lista para puntos públicos **validados**, enlace «Cómo llegar», manejo de ubicación permitida/denegada sin fingir distancia. No mostrar «abierto ahora» sin horarios confirmados ni calcular km sin coordenadas. Incorporar reportes de datos incorrectos con ID de seguimiento y revisión admin, sin publicación automática. Añadir favoritos solo si es útil y hay mecanismo de persistencia por cuenta. Si no hay centros publicados, mapa/lista en vacío honesto.

**Bloqueo externo:** los candidatos ASO-RECICLADOR ESP y RECICOL **son borradores**, no aliados confirmados ni puntos habilitados. No activar/publicar sin evidencia de convenio, aceptación, ubicación, horario y responsable reales, y sin aprobación para grants/flags.

### FASE 3 — P0: entregas, operadores, puntos y canjes reales (RF-21 a 27, 30 a 32; HU-13 a 17, 20)

**Cierre de implementación y pruebas aisladas:** asegurar roles estrictos en servidor (participant, verifier, admin), independencia del gestor, asignación de centros, idempotencia de solicitudes y validaciones, estados de entrega, eventos/auditoría, rollback transaccional, concurrencia, balance único en cada pantalla y flujos de reserva/inventario/canje/cumplimiento/devolución. Añadir UI admin clara para colas y evidencia, pero no activar flujos físicos sin política y operadores reales. Probar con fixtures sintéticos en PostgreSQL aislado; las transacciones de prueba en `ecopulse_dev` deben revertirse y preservar los datos originales si se usa ese entorno.

**Políticas aún por aprobar:** `POINTS_PER_KG`, `POINTS_MAX_PER_DELIVERY`, elegibilidad por material, tope/antifraude, responsable y prueba de pesaje, procedimiento de validación, referencia de política de recompensas, patrocinadores, stock y plazos de cumplimiento. Pueden diseñarse propuestas y formularios de configuración; no asignar arbitrariamente valores públicos. Grants para roles runtime y flags `PILOT_RECEIPT_ENABLED`, `PILOT_VERIFICATION_ENABLED`, `PILOT_POINTS_ENABLED`, `PILOT_REWARDS_ENABLED`, `PILOT_REWARD_FULFILLMENT_ENABLED`, `PILOT_CATALOG_PUBLICATION_ENABLED` requieren autorización explícita y condiciones verificadas. Nunca afirmar que está funcionando al público mientras sigan desactivados.

### FASE 4 — P1: progreso educativo, EcoXP y misiones (RF-28, 29; HU-18)

Definir separadamente **EcoXP no canjeable** por lectura, cuestionarios y aprendizajes comprobables vs **EcoPuntos canjeables** por acciones físicas validadas. Añadir ruta «Mi progreso», misiones, insignias y niveles calculados desde eventos reales de aprendizaje. Evitar «rachas», avances o medallas ficticias y puntos por subir imagen. Implementación que requiera tablas nuevas: diseñar migración SQL y rollback **sin ejecutarlos** hasta autorización. Si no existe persistencia suficiente, entregar la propuesta implementable y bloqueo exacto, no simular almacenamiento permanente.

### FASE 5 — P1: EcoGuía y IA responsables (RF-09, 34 a 36)

Mejorar EcoGuía actual basada en reglas: respuestas apoyadas por guías revisadas, enlaces a material/mapa/entregas y estados explícitos de incertidumbre; no declarar «IA generativa» si no la usa. IA visual: ya existe UI/endpoint condicionados; verificar contrato, consentimiento, validación MIME/tamaño, rechazo seguro, corrección manual y guía especial para pilas/químicos/medicamentos/cortopunzantes. Solo habilitar al disponer de proveedor/clave/selección de modelo y pruebas de calidad: no inventar confianza ni precisión. Mantener clasificación manual plenamente funcional sin proveedor externo.

### FASE 6 — P1: administración, reportes y observabilidad (RF-38 a 41)

Unificar panel por rol con estado resumido de entregas pendientes, centros por revisar, incidentes, canjes reservados, recompensas e inventario; auditoría y métricas agregadas con denominadores/fuentes claros. Implementar moderación de reportes de centros y gestión segura de guías/materiales sin autoasignación de roles. Proteger exposición de usuarios y evidencias. Proponer sistema de logs no sensibles, gestión de errores, backups restaurables, comprobaciones de salud y protección antiabuso. Cambios de schema/permisos requieren autorización antes de ejecutar.

### FASE 7 — P2 tras P0/P1: campañas, recomendaciones y modo ligero

Campañas con organizador y asistencia verificados, favoritos, notificaciones configurables, estadísticas agregadas, experiencia de conectividad lenta, eventualmente PWA/guías offline. No bloquear el lanzamiento de una plataforma educativa honesta por no disponer aún de estos extras.

## 4. Reglas de producto innegociables

1. **Escaneo ≠ reciclaje:** nunca sumar EcoPuntos ni kg confirmados solo por una foto o clasificación manual.
2. **Centro en borrador ≠ centro público/operativo:** no inventar marcadores, convenios, horarios, capacidad o aceptaciones.
3. **Saldo único:** backend PostgreSQL y movimientos auditados; evitar `localStorage` como libro contable.
4. **EcoXP ≠ EcoPuntos:** aprendizaje y crédito canjeable son métricas distintas.
5. **Role authorization en API:** ocultar una pestaña no equivale a proteger endpoint.
6. **E2E demostrado:** pruebas UI con sesión autenticada y roles reales; comprobaciones por API sin token y build no bastan.
7. **Privacidad:** mínimo de datos, consentimiento para fotos/GPS, nunca secreto en cliente/logs, no compartir actividad privada entre cuentas.
8. **No bloquear estudio/consulta por falta de alianzas:** el recorrido informativo debe permanecer disponible al visitante.
9. **Todos los CTA realizan su acción o muestran motivo y alternativa**, sin capturar solicitud falsa.
10. **No declarar producción pública terminada** hasta cerrar P0, verificar despliegue, dominio/HTTPS, observabilidad, políticas y condiciones operativas de módulos físicos.

## 5. Secuencia operativa recomendada para OpenCode

1. Leer este plan y el documento fuente, luego inspeccionar solo los archivos necesarios. Comparar con código actual; no volver a inspeccionar migraciones ya aplicadas salvo indicio de fallo.
2. Implementar **FASE 1 por completo en cambios seguros** y probar. Priorizar biblioteca de materiales, navegación desde escaneo, accesibilidad y páginas públicas.
3. Continuar con FASE 2 preparando fichas/reportes y mejoras de lista/mapa, sin publicar candidatos.
4. Completar test y UI de FASE 3 en ambiente aislado sin activar flags ni grants; señalar bloqueos externos concretos.
5. Seguir con FASES 4–6 según autorización y dependencias reales, evitando crear tablas sin permiso.
6. Ejecutar test unitarios/integración relevantes, TypeScript, build y pruebas visuales de rutas/roles. Mostrar evidencias que especifiquen qué se comprobó, no afirmar navegador probado si solo hubo `fetch` de HTML.
7. Reportar en forma breve: `LISTO CON EVIDENCIA`, `IMPLEMENTADO PERO SIN E2E`, `BLOQUEADO POR OPERACIÓN EXTERNA`, `REQUIERE AUTORIZACIÓN`, junto con archivos modificados y próxima acción.

## 6. Condiciones reales de lanzamiento

**Listo para público informativo:** visitante consulta guías/materiales seguros y directorio verificado sin sesión; usuario registrado puede usar perfil y clasificación/historial; accesibilidad, legales, protección de datos, despliegue HTTPS, monitoreo y backups comprobados.

**Listo para operación de reciclaje con puntos/canjes:** además de lo anterior, hay centros/gestores validados, pesaje/validación física auditable, política de puntos aprobada, inventario/aliados y cumplimiento verificables, permisos mínimos y pruebas de concurrencia, y aprobación explícita para habilitar flags, cambios SQL y despliegue.

El primer nivel **no implica** que el segundo ya sea posible. Ningún mensaje comercial debe sugerir reciclaje, impacto o recompensas verificadas inexistentes.
