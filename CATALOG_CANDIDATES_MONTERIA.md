# Candidatos de Montería para el catálogo EcoPulse

Consulta: 16 de octubre de 2026. Son **borradores inactivos**. La dirección publicada por cada operador acredita la existencia de una sede; no acredita un convenio con EcoPulse, recepción de entregas del piloto, horarios reservables ni cupos.

| Código en EcoPulse | Sede y dirección publicada | Fuente primaria | Estado |
| --- | --- | --- | --- |
| `asoreciclador_monteria` | ASO-RECICLADOR ESP, Cra. 43 # 27-103, Montería | https://asorecicladoresp.com/ | Borrador; confirmar recepción y acuerdo |
| `recicol_monteria` | RECICOL, Calle 29 # 41-64, barrio Villa Caribe, Montería | https://recicol.com/ | Borrador; confirmar recepción y acuerdo |

## Revisión cartográfica (16 de octubre de 2026)

- **ASO-RECICLADOR ESP:** su [página oficial](https://asorecicladoresp.com/) y un [certificado de Cámara de Comercio publicado por la organización](https://asorecicladoresp.com/wp-content/uploads/2023/06/camara-de-comercio-actualizada.pdf) coinciden en Cra. 43 # 27-103, Villa Caribe. OpenStreetMap registra el [edificio `way/1486874125`](https://www.openstreetmap.org/way/1486874125) con ese nombre; la posición aproximada publicada para el objeto es **8.73818, -75.8575**. Es una referencia cartográfica de un edificio, no una coordenada de acceso o recepción confirmada por el operador. Se ofrece solo a administradores y no se usa para reservas.
- **RECICOL:** la [página oficial de contacto](https://recicol.com/contactos) confirma Calle 29 # 41-64, Villa Caribe. No se encontró un objeto OSM inequívoco ni una coordenada primaria confirmada para esa sede. **Coordenada pendiente**; el panel administrativo ofrece una búsqueda textual en OSM, sin marcador propio.

Ambas sedes son **candidatas**, no centros autorizados de EcoPulse. Las fuentes de dirección y la cartografía no prueban convenio, recepción de materiales del piloto, disponibilidad ni cupos. Solo `delivery_points.active=true` alimenta el mapa público y las opciones de entregas V2. No se modificaron las filas existentes.

Las páginas de ambos operadores publican horarios generales de atención. **No** se han registrado como horarios de entrega en EcoPulse porque no indican disponibilidad específica del piloto ni capacidad por franja. No se creó ningún horario, reserva o entrega por esta investigación.

Antes de solicitar publicación:

1. Contactar a cada operador y documentar que acepta material del piloto, sus categorías, modalidad de recepción, fecha de vigencia y responsable institucional, sin guardar datos personales innecesarios.
2. Confirmar por escrito la franja reservable y su capacidad máxima. Solo entonces crear borradores de horarios.
3. Aportar una URL HTTPS pública que respalde cada validación. El panel la conserva en `validation_reference` al publicar. Una URL de sede no prueba cupos; se necesita evidencia adicional de la disponibilidad.
4. Obtener autorización específica para aplicar los permisos incrementales de publicación y habilitar `PILOT_CATALOG_PUBLICATION_ENABLED`. Actualmente ambos están desactivados. Verificar de nuevo reservas, roles y controles de PostgreSQL antes de publicar.

El flujo V2 solo ofrece centros activos con franjas activas y cupo disponible. Los borradores permanecen invisibles para participantes.
