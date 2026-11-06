# Preparar destinos y los tres premios digitales existentes

Estas acciones pertenecen al administrador y se realizan desde la interfaz. No requieren SQL ni otra cuenta verificadora. No deben completarse con autorizaciones, inventario o entregas inexistentes.

## Premios digitales — Administración → Gestión recompensas

1. En cada premio heredado no operativo, pulsar **Preparar para edición**. Se conserva el identificador y una copia inmutable del registro anterior. La recuperación no se permite para premios operativos ni con canjes o reposiciones.
2. Revisar descripción y precio en EcoPuntos con **Editar** y guardar. Conservar el título correspondiente al archivo:

   | Premio | Archivo real |
   | --- | --- |
   | Kit digital de reciclaje | `ecopulse-guia.pdf` |
   | Insignia Huella Verde | `ecopulse-insignia.svg` |
   | Fondo virtual de naturaleza | `ecopulse-naturaleza.svg` |

3. Pulsar **Documentar y publicar**. El archivo correspondiente se selecciona desde el registro del servidor. Puede revisarse y descargarse como administrador desde Configuración general.
4. Introducir los **cupos de canje digital autorizados** y confirmar la autorización. No son existencias físicas; las cantidades heredadas no se reutilizan automáticamente.
5. El servidor comprueba título, tipo, archivo y SHA-256 y guarda su referencia HTTPS, cupo, administrador y fecha. No hace falta escribir una URL o código técnico. Una publicación reintentada no repone unidades consumidas.

Tras un canje, en **Cumplimiento de canjes**, pulsar **Habilitar descarga** y **Confirmar descarga digital**. El archivo viene vinculado al premio publicado: no puede sustituirse por otro ni por un comprobante físico. El participante descarga desde su propio historial una vez cumplido el canje. Los historiales previos se conservan.

## Destinos — Administración → Centros

1. Usar un borrador legítimo o crear uno con los datos reales del operador. Un centro heredado activo sin evidencia no es un destino autorizado; no se publica automáticamente.
2. En **Completar datos, ubicación y materiales**, revisar dirección y ubicación y guardar únicamente materiales realmente aceptados.
3. Pulsar **Validar y publicar centro** e introducir la URL HTTPS de su autorización real. La publicación se revierte si faltan materiales activos aceptados.
4. Si exige cita, crear o editar una franja futura y su capacidad confirmada. Para revisar un horario activo, desactivarlo primero; no se permite alterar reservas vigentes. Los horarios vencidos o sin validación no ofrecen disponibilidad.
5. **Validar y publicar horario** solo se habilita cuando el centro ya está validado. El servidor también comprueba este requisito y mantiene las restricciones de cupo/solapamiento.

El panel muestra por centro si falta autorización, material o disponibilidad. Un destino sin cita no exige una franja, pero sí autorización y materiales confirmados. El texto validado de nombre/dirección se conserva sin sustituirlo por referencias de ubicación heredadas.

## Configuración general → Activar plataforma

La acción vuelve a consultar los recursos actuales. Los flags heredados no hacen que un módulo sin recursos figure operativo. El panel se actualiza al regresar a la ventana o después de cambiar recursos; tras activar vuelve a leer el estado real, no solo el resultado almacenado del reintento. No crea ni publica centros/premios automáticamente.

## Prueba real aún necesaria

Se requieren sesiones autorizadas de administrador y de un participante distinto, un destino confirmado y una entrega física real. El participante solicita; el administrador recibe y verifica materiales/peso reales, nunca su propia entrega; la acreditación debe ocurrir una sola vez. Después se prueba el canje, cumplimiento y descarga del archivo propio, recargas, reintentos, concurrencia y denegación a otra cuenta. Las pruebas unitarias, los metadatos públicos de archivos y las consultas SQL preparadas no sustituyen esa aceptación.
