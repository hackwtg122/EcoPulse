# Catálogo de centros y horarios: estado local

0002_catalog_validation está aplicada en 127.0.0.1:5432/ecopulse_dev mediante Drizzle. Su historial contiene 0000_core, 0001_delivery_details y 0002_catalog_validation. El rol ecopulse_app conserva INSERT de borradores y recibió únicamente UPDATE en columnas de nombre, dirección, municipio, zona horaria y modalidad de cita del centro, y fechas y capacidad del horario. No puede insertar ni actualizar active o las columnas de validación, ni ejecutar DDL.

El panel administrativo está disponible para el rol admin de la base, obtenido a partir de la sesión Clerk. PILOT_CATALOG_ADMIN_ENABLED=true figura solo en .env.local, ignorado por Git. PILOT_CATALOG_PUBLICATION_ENABLED, PILOT_VERIFICATION_ENABLED y PILOT_REWARDS_ENABLED siguen desactivadas. Hay dos centros documentados como borradores inactivos en la base principal y ningún horario. Las fuentes y los límites de su verificación figuran en CATALOG_CANDIDATES_MONTERIA.md. No se ha publicado ningún centro ni horario.

## Borradores

El administrador puede registrar un centro real en estado inactivo y un horario real si dispone de información comprobada. Los horarios de atención generales no constituyen cupos reservables. Las entregas V2 exigen una franja activa con capacidad comprobada. Las rutas validan entradas y rol en Express; PostgreSQL impide solapamientos y sobrecupos. Una prueba aislada confirma que un borrador persiste entre conexiones y que la aplicación no puede activar registros con los permisos actuales. No usar datos sintéticos en ecopulse_dev.

## Publicación posterior, aún no autorizada

1. Reunir y revisar evidencia de existencia, dirección y disponibilidad de cada centro y horario; conservar solo una referencia acotada, sin documentos personales.
2. Revisar de nuevo las rutas administrativas, la identidad Clerk del administrador y las restricciones de reservas; mantener deshabilitados puntos, verificaciones y canjes.
3. Solicitar autorización específica antes de ejecutar scripts/grant-catalog-publication-permissions.sql. El archivo solo prepara UPDATE en cuatro columnas de validación/publicación para cada tabla y verifica base, host, puerto y migrador. No está aplicado.
4. Tras probar permisos y rechazo de participantes, autorizar por separado PILOT_CATALOG_PUBLICATION_ENABLED=true y reiniciar exclusivamente la API EcoPulse. Publicar solo registros reales con referencia de evidencia.
5. Verificar API, panel, historial Drizzle, ausencia de puntos automáticos y datos existentes. No ejecutar migraciones adicionales ni tocar Chimbita.

El rol SQL ecopulse_app es compartido por la aplicación; el aislamiento entre administradores y participantes depende de Clerk y de los controles de Express. Conceder permisos SQL de publicación amplía la capacidad del proceso y requiere una autorización separada.