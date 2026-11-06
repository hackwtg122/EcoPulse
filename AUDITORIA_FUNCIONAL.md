# Matriz de aceptación EcoPulse

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

## Evidencia técnica de la nueva configuración (no es aceptación autenticada)

- Migración aditiva `platform_activation_events`: historial append-only, permisos SELECT/INSERT y uso de secuencia para `ecopulse_app`; sin UPDATE/DELETE/TRUNCATE.
- Ensayo con rollback y aplicación: cuatro consultas preparadas; cero eventos de activación, cuentas o movimientos de negocio creados por la migración.
- Lectura real de Neon: esquema y consultas de estado disponibles; cero eventos de activación. La conexión local no puede asumir el rol técnico, por lo que no se alteraron membresías: la comprobación del rol real de Render se incorporó al QA remoto existente.
- Activación: rol administrativo vuelto a comprobar dentro de transacción, bloqueo global, clave idempotente, rollback y flags estrictamente permitidos. No acepta políticas, credenciales ni inventario enviados por el navegador.
- Las comprobaciones públicas remotas siguen siendo públicas, no pruebas de la sesión Firefox del propietario.
