# Matriz de aceptación EcoPulse

Actualización de implementación de la incidencia #2 (2026-11-06): publicación de los tres premios existentes desde el registro real de archivos con cupos digitales declarados; vinculación estricta entre título/archivo/huella y cumplimiento/descarga; estados e instrucciones de centros y horarios; activación con requisitos actuales y recarga de estado. Los registros heredados no se han publicado ni convertido automáticamente. Guía administrativa: `OPERACION_ENTREGAS_RECOMPENSAS.md`. La aceptación autenticada de estos cambios sigue pendiente y se mantiene la matriz de alcance siguiente.

Esta matriz no declara terminada la auditoría de todos los controles. Una ruta protegida, un build correcto o una consulta SQL preparada no demuestran su recorrido autenticado. La revisión de cada botón/formulario y las pruebas de persistencia con administrador y participante siguen pendientes cuando así se indica.

El propietario confirmó inicio de sesión en su Mozilla Firefox instalado. No se han leído cookies, contraseñas ni tokens de su perfil. Las herramientas actuales no están conectadas a esa sesión; no se atribuyen a ella operaciones que no se observaron.

| Apartado / ruta | Estado | Alcance comprobado y aceptación pendiente |
| --- | --- | --- |
| Inicio `/`, guía rápida | FUNCIONAL Y PROBADO | QA público existente: navegación, preguntas de referencia, scroll, Escape, foco y enlace a Clerk. No equivale a IA autenticada. |
| Biblioteca `/materials` y fichas | FUNCIONAL Y PROBADO | QA público existente de búsqueda, filtros, estado vacío y acceso a materiales. La revisión exhaustiva de todos los enlaces de todas las fichas no está concluida. |
| FAQ, privacidad, términos, contacto | FUNCIONAL Y PROBADO | Alcance limitado: carga pública y encabezados en tres tamaños; textos de consentimiento/almacenamiento en FAQ y privacidad. No se ha probado recepción de comunicaciones ni una validación jurídica. |
| Registro e inicio `/sign-up`, `/sign-in` | PENDIENTE DE PRUEBA AUTENTICADA | Formulario Clerk visible; falta observar registro/login completo y retorno con cuentas autorizadas. No cambiar credenciales principales. |
| Panel `/dashboard` | PENDIENTE DE PRUEBA AUTENTICADA | Falta comprobar datos propios, enlaces, recarga, errores y aislamiento entre cuentas. |
| Progreso `/progress` | PENDIENTE DE PRUEBA AUTENTICADA | Falta comparar progreso e historial con registros propios persistidos. |
| EcoScan `/scan` | PENDIENTE DE PRUEBA AUTENTICADA | Proveedor y contratos probados por separado; falta inferencia, consentimiento, guardado, reintento y recarga en Firefox autorizado. |
| Mapa `/map`, filtros y favoritos | PENDIENTE DE PRUEBA AUTENTICADA | Falta observar catálogo real, ubicación autorizada, favoritos propios y persistencia. |
| Entregas `/deliveries` | PENDIENTE DE PRUEBA AUTENTICADA | Falta solicitud real, validación de materiales, reserva concurrente, reintento, agenda/cancelación e historial con recursos confirmados. |
| Recompensas `/rewards`, saldo y movimientos | PENDIENTE DE PRUEBA AUTENTICADA | Falta comparar saldo/catálogo con Neon y ejecutar canje autorizado, reintento y recarga sin doble débito. |
| Descarga de recompensa entregada | PENDIENTE DE PRUEBA AUTENTICADA | Existen PDF y dos SVG reales. Falta descargar desde un canje propio cumplido y comprobar denegación a otra cuenta. |
| EcoGuía `/chat`, conversaciones | PENDIENTE DE PRUEBA AUTENTICADA | Falta consulta IA, consentimiento separado, creación/continuación/listado/borrado propios, recarga y aislamiento. |
| Perfil `/profile` | PENDIENTE DE PRUEBA AUTENTICADA | Falta guardar nombre con Clerk y comprobar recarga sin tocar la identidad del administrador principal. |
| Seguridad `/security` y salida | PENDIENTE DE PRUEBA AUTENTICADA | Falta observar gestión de sesiones y cierre de sesión autorizado. No cambiar contraseñas/MFA para aparentar una prueba. |
| Configuración general `/admin?section=settings` | PENDIENTE DE PRUEBA AUTENTICADA | Implementación nueva: preparación reutilizada y explícita, activación persistente, requisitos y acceso a todas las gestiones existentes. Falta observar los botones desde Firefox autenticado y su persistencia tras recarga. |
| Biblioteca administrativa de archivos digitales | PENDIENTE DE PRUEBA AUTENTICADA | Metadatos derivados de bytes reales; descarga exclusiva de administrador y rutas limitadas a archivos registrados. Falta descarga administrativa observada en Firefox. |
| Centros `/admin/centers` | PENDIENTE DE PRUEBA AUTENTICADA | Falta crear/editar, ubicación, materiales, horarios, cupos, publicación y desactivación autorizadas, incluyendo conflictos concurrentes. |
| Recepción/verificación `/admin` | PENDIENTE DE PRUEBA AUTENTICADA | Administrador puede operar entregas ajenas; prohibida autoverificación. Falta operación real observada y acreditación exactamente una vez. |
| Premios `/admin/rewards` | PENDIENTE DE PRUEBA AUTENTICADA | Falta recuperación explícita de legado, edición, precios, publicación, reposición documentada e historiales desde sesión administrativa. |
| Cumplimiento e historial de canjes | PENDIENTE DE PRUEBA AUTENTICADA | Falta cumplimiento autorizado, referencia de archivo correcta, reintento y actualización de historial. |
| Usuarios y roles `/admin/users` | PENDIENTE DE PRUEBA AUTENTICADA | Falta comprobar listado/paginación y denegaciones con ambas cuentas. No modificar rol/credenciales del administrador principal. |
| Recepción física de residuos | BLOQUEADO POR RECURSO EXTERNO | Falta material efectivamente entregado por un participante, centro/horario/cupo confirmados y evidencia de recepción/verificación. El software no sustituye estos actos. |
| Disponibilidad física de premios | BLOQUEADO POR RECURSO EXTERNO | Falta disponibilidad y evidencia autorizadas para premios físicos. Los archivos digitales existentes no justifican inventario físico. |
| Credencial técnica de mínimo privilegio | BLOQUEADO POR RECURSO EXTERNO | El QA real de Render confirmó que su conexión no usa `ecopulse_app` y posee permisos de mutación sobre la nueva auditoría. Se añaden protecciones contra UPDATE/DELETE/TRUNCATE; sigue pendiente conectar el servicio con la credencial existente del rol técnico restringido. No se conocen ni se rotan sus contraseñas y no se modifican la identidad ni las credenciales del administrador principal. |

## Evidencia técnica de la nueva configuración (no es aceptación autenticada)

- Migración aditiva `platform_activation_events`: historial append-only, permisos SELECT/INSERT y uso de secuencia para `ecopulse_app`; sin UPDATE/DELETE/TRUNCATE.
- Ensayo con rollback y aplicación: cuatro consultas preparadas; cero eventos de activación, cuentas o movimientos de negocio creados por la migración.
- Lectura real de Neon: esquema y consultas de estado disponibles; cero eventos de activación. La conexión local no puede asumir el rol técnico, por lo que no se alteraron membresías: la comprobación del rol real de Render se incorporó al QA remoto existente.
- Activación: rol administrativo vuelto a comprobar dentro de transacción, bloqueo global, clave idempotente, rollback y flags estrictamente permitidos. No acepta políticas, credenciales ni inventario enviados por el navegador.
- Las comprobaciones públicas remotas siguen siendo públicas, no pruebas de la sesión Firefox del propietario.
- Primera publicación `e87eabd`: Netlify y Render con el mismo SHA y 45/45 comprobaciones públicas aprobadas. QA de esquema falló al exigir al usuario efectivo de Render privilegios de auditoría limitados: diagnóstico `1c80afa` confirmó `dedicatedRole:false` y `mutableAudit:true`. No se oculta esa limitación: se separa la integridad de la nueva auditoría (triggers y permisos limitados de `ecopulse_app`) del endurecimiento pendiente de la credencial técnica efectiva.
- Auditoría adicional: reproducida en memoria la creación de borradores por una petición cuyo rol administrativo ya fue revocado. Corrección: doce mutaciones de centros, horarios, coordenadas, materiales, disponibilidad y premios revalidan y bloquean el rol actual durante la transacción. 24 regresiones cubren denegación, éxito y rollback sin escrituras reales. La prueba autenticada sigue pendiente.
- Publicación técnica final `de068cd2a486a697b5367ec9b87fba81015c711b`: Netlify `ready` y Render mismo SHA, [QA aprobado](https://github.com/hackwtg122/EcoPulse/actions/runs/42161028473), 45/45 comprobaciones públicas, tipos/build y 119 pruebas API. El QA con la conexión real de Render confirma la auditoría inmutable y los requisitos de centros, edición/publicación de premios, recepción/verificación y política de puntos. Las solicitudes carecen de un destino operativo válido y los canjes de una recompensa disponible publicada. La conexión técnica restringida sigue pendiente (`runtimeUsesDedicatedRole:false`); no se equipara un QA verde con haber resuelto ese endurecimiento ni con aceptación autenticada.
