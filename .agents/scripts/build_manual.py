from pathlib import Path
import textwrap
import pymupdf as fitz

OUT = Path(".agents/outputs/Manual_de_Usuario_EcoPulse.pdf")
SCREENSHOTS = Path("screenshots")
W, H = 612, 792
M = 48
INK = (0.10, 0.14, 0.12)
MUTED = (0.30, 0.38, 0.34)
GREEN = (0.13, 0.30, 0.23)
PALE = (0.88, 0.93, 0.95)
YELLOW = (0.96, 0.84, 0.36)
LINE = (0.70, 0.75, 0.73)


def wrap(text, width, size):
    chars = max(24, int(width / (size * 0.48)))
    return textwrap.wrap(str(text), width=chars, break_long_words=False, break_on_hyphens=False) or [""]


class Manual:
    def __init__(self):
        self.doc = fitz.open()
        self.page = None
        self.y = 0
        self.page_no = 0
        self.start_page("Portada")

    def start_page(self, section="Manual de usuario"):
        self.page = self.doc.new_page(width=W, height=H)
        self.page_no += 1
        self.y = 48
        if self.page_no > 1:
            self.page.insert_text((M, 28), "EcoPulse · Manual de Usuario", fontname="hebo", fontsize=8, color=GREEN)
            self.page.draw_line((M, 34), (W - M, 34), color=LINE, width=0.5)
        self.page.insert_text((M, H - 23), f"Proyecto de Desarrollo Sostenible · Ingeniería de Sistemas   |   {self.page_no}", fontname="helv", fontsize=7.5, color=MUTED)

    def need(self, height):
        if self.y + height > H - 48:
            self.start_page()

    def title(self, text, subtitle=None):
        self.need(54)
        self.page.insert_text((M, self.y + 20), text, fontname="hebo", fontsize=17, color=GREEN)
        self.y += 30
        if subtitle:
            self.page.insert_textbox((M, self.y, W - M, self.y + 28), subtitle, fontname="helv", fontsize=9.5, color=MUTED)
            self.y += 28
        self.y += 6

    def h2(self, text):
        self.need(30)
        self.page.insert_text((M, self.y + 15), text, fontname="hebo", fontsize=11.5, color=GREEN)
        self.y += 25

    def para(self, text, size=9.2, color=INK, gap=5, bold=False):
        lines = wrap(text, W - 2 * M, size)
        self.need(len(lines) * (size + 3) + gap)
        font = "hebo" if bold else "helv"
        for line in lines:
            self.page.insert_text((M, self.y + size), line, fontname=font, fontsize=size, color=color)
            self.y += size + 3
        self.y += gap

    def bullets(self, items, size=9.0):
        for item in items:
            lines = wrap(item, W - 2 * M - 18, size)
            self.need(len(lines) * (size + 3) + 4)
            self.page.insert_text((M + 2, self.y + size), "•", fontname="helv", fontsize=size, color=GREEN)
            for idx, line in enumerate(lines):
                self.page.insert_text((M + 15, self.y + size), line, fontname="helv", fontsize=size, color=INK)
                self.y += size + 3
            self.y += 2

    def table(self, headers, rows, widths=None, font=7.6):
        if widths is None:
            widths = [(W - 2 * M) / len(headers)] * len(headers)
        x0 = M
        total = sum(widths)
        if abs(total - (W - 2 * M)) > 0.1:
            widths[-1] += (W - 2 * M) - total

        def row_height(values, header=False):
            max_lines = 1
            for value, width in zip(values, widths):
                max_lines = max(max_lines, len(wrap(value, width - 8, font if not header else 7.8)))
            return max(20 if header else 17, max_lines * (font + 2.2) + 7)

        heights = [row_height(headers, True)] + [row_height(row) for row in rows]
        self.need(sum(heights) + 8)
        y0 = self.y
        all_rows = [headers] + rows
        for r, values in enumerate(all_rows):
            height = heights[r]
            x = x0
            for c, value in enumerate(values):
                width = widths[c]
                fill = PALE if r == 0 else (1, 1, 1)
                self.page.draw_rect((x, self.y, x + width, self.y + height), color=LINE, fill=fill, width=0.6)
                lines = wrap(value, width - 8, 7.8 if r == 0 else font)
                for li, line in enumerate(lines):
                    self.page.insert_text((x + 4, self.y + 10 + li * (font + 2.2)), line, fontname="hebo" if r == 0 else "helv", fontsize=7.8 if r == 0 else font, color=INK)
                x += width
            self.y += height
        self.y += 8
        return (x0, y0, W - M, self.y)

    def image(self, filename, caption, max_width=500, max_height=255):
        path = Path(filename)
        if not path.exists():
            self.para(f"Evidencia no disponible: {caption}", size=8.5, color=MUTED)
            return
        pix = fitz.Pixmap(path)
        ratio = min(max_width / pix.width, max_height / pix.height)
        iw, ih = pix.width * ratio, pix.height * ratio
        self.need(ih + 28)
        x = (W - iw) / 2
        self.page.insert_image((x, self.y, x + iw, self.y + ih), filename=str(path))
        self.y += ih + 4
        self.page.insert_textbox((M, self.y, W - M, self.y + 18), caption, fontname="helv", fontsize=7.5, color=MUTED, align=1)
        self.y += 21

    def callout(self, label, text):
        lines = wrap(text, W - 2 * M - 24, 8.5)
        height = len(lines) * 11 + 30
        self.need(height)
        self.page.draw_rect((M, self.y, W - M, self.y + height), color=(0.75, 0.82, 0.77), fill=(0.94, 0.97, 0.93), width=0.7)
        self.page.insert_text((M + 12, self.y + 16), label, fontname="hebo", fontsize=8.5, color=GREEN)
        yy = self.y + 28
        for line in lines:
            self.page.insert_text((M + 12, yy, ), line, fontname="helv", fontsize=8.5, color=INK)
            yy += 11
        self.y += height + 8

    def finish(self):
        self.doc.set_metadata({
            "title": "Manual de Usuario - EcoPulse",
            "author": "Equipo desarrollador EcoPulse",
            "subject": "Proyecto de Desarrollo Sostenible",
            "keywords": "EcoPulse, reciclaje, sostenibilidad, manual de usuario",
        })
        OUT.parent.mkdir(parents=True, exist_ok=True)
        self.doc.save(OUT, garbage=4, deflate=True)
        self.doc.close()


m = Manual()

# 1. Cover
m.page.insert_text((M, 98), "ECO", fontname="hebo", fontsize=34, color=GREEN)
m.page.insert_text((M, 134), "PULSE", fontname="hebo", fontsize=34, color=(0.80, 0.38, 0.30))
m.page.draw_rect((M, 153, M + 110, 157), color=YELLOW, fill=YELLOW)
m.page.insert_text((M, 210), "MANUAL DE USUARIO", fontname="hebo", fontsize=22, color=INK)
m.page.insert_text((M, 238), "Software del Proyecto de Desarrollo Sostenible", fontname="helv", fontsize=11, color=MUTED)
m.table(
    ["Campo", "Información"],
    [
        ["Nombre del software", "EcoPulse"],
        ["Proyecto", "Aplicación web de reciclaje inteligente"],
        ["Programa", "Ingeniería de Sistemas"],
        ["Semestre", "10.º"],
        ["Asignatura", "Desarrollo Sostenible"],
        ["Integrantes", "Equipo desarrollador EcoPulse"],
        ["Docente", "Docente de la asignatura"],
        ["Institución", "Universidad Cooperativa de Colombia"],
        ["Versión", "1.0.0"],
        ["Fecha", "09/09/2026"],
    ],
    widths=[165, 351],
    font=8.6,
)
m.y += 35
m.callout("Descripción breve", "EcoPulse conecta identificación de residuos, puntos ecológicos, gamificación y orientación conversacional para convertir el reciclaje diario en acciones sencillas y medibles.")

# 2. Control / introduction / general description
m.start_page("Introducción")
m.title("1. Control del documento")
m.table(["Versión", "Fecha", "Elaborado por", "Revisado por", "Descripción del cambio"], [
    ["1.0.0", "09/09/2026", "Equipo EcoPulse", "Revisión académica", "Primera versión completa del manual de usuario."],
], widths=[55, 80, 120, 110, 151])
m.title("2. Introducción")
m.h2("2.1 Propósito del manual")
m.para("Este manual orienta a las personas que utilizan EcoPulse por primera vez. Explica el acceso, la navegación, el reconocimiento de residuos, la consulta de puntos ecológicos, el sistema de recompensas, el chatbot EcoGuía y las opciones de seguridad.")
m.h2("2.2 Objetivo del software")
m.para("EcoPulse busca facilitar la correcta separación de residuos mediante una experiencia web clara, motivadora y accesible. La plataforma ayuda a identificar materiales, encontrar lugares adecuados para entregarlos y mantener la motivación mediante puntos, niveles, rachas y recompensas.")
m.h2("2.3 Alcance")
m.para("La versión actual permite registrarse e iniciar sesión, consultar el dashboard, cargar imágenes o probar una identificación de residuo, revisar instrucciones de separación, localizar puntos ecológicos, usar geolocalización, acumular puntos, canjear recompensas y conversar con EcoGuía. El reconocimiento visual y el chatbot funcionan en modo demostración local mientras se conectan las APIs de IA.")
m.title("3. Descripción general del sistema")
m.table(["Campo", "Descripción"], [
    ["Nombre del sistema", "EcoPulse"],
    ["Problema que aborda", "Dudas sobre la separación de residuos y dificultad para encontrar puntos de entrega."],
    ["Público objetivo", "Estudiantes, hogares, comunidades y personas interesadas en hábitos sostenibles."],
    ["Funcionalidades principales", "Autenticación, escaneo de residuos, mapa ecológico, puntos, recompensas, chatbot y seguridad."],
    ["Contexto de uso", "Aplicación web responsive para usar desde computador, tablet o celular con conexión a internet."],
], widths=[160, 356])
m.h2("3.1 Usuarios del sistema")
m.table(["Tipo de usuario", "Descripción", "Permisos / funciones"], [
    ["Usuario registrado", "Persona que crea una cuenta en EcoPulse.", "Acceder al dashboard, escanear, sumar puntos, canjear y usar EcoGuía."],
    ["Visitante", "Persona que consulta la página pública.", "Ver la propuesta, registro, inicio de sesión y chatbot público."],
    ["Administrador del servicio", "Responsable de la configuración del proveedor de autenticación.", "Gestionar configuración de Clerk, seguridad y métodos MFA."],
], widths=[115, 180, 221])

# 3. Requirements and access
m.start_page("Acceso al sistema")
m.title("4. Requisitos para utilizar el sistema")
m.h2("4.1 Requisitos de hardware")
m.table(["Recurso", "Requisito mínimo", "Recomendado"], [
    ["Equipo", "Computador, tablet o celular.", "Celular o computador con cámara."],
    ["Memoria", "2 GB disponibles.", "4 GB o más."],
    ["Pantalla", "Resolución aproximada 360 px de ancho.", "1280 × 720 px o superior."],
    ["Conectividad", "Conexión a internet.", "Wi-Fi o datos móviles estables."],
], widths=[150, 183, 183])
m.h2("4.2 Requisitos de software")
m.table(["Software", "Versión", "Observaciones"], [
    ["Navegador web", "Actualizado", "Chrome, Edge, Firefox o Safari."],
    ["JavaScript", "Activado", "Necesario para navegación, chat y formularios."],
    ["Geolocalización", "Permitida opcionalmente", "Se solicita en el módulo de puntos cercanos."],
    ["Correo electrónico", "Válido", "Necesario para crear y verificar la cuenta."],
], widths=[150, 115, 251])
m.title("5. Acceso al sistema")
m.h2("5.1 Dirección o ubicación")
m.para("URL / ubicación: vista previa o dominio publicado de EcoPulse. En desarrollo, se accede desde la URL de vista previa proporcionada por Replit.")
m.h2("5.2 Inicio de sesión")
m.bullets([
    "Abrir EcoPulse y seleccionar “Iniciar sesión”.",
    "Escribir el correo electrónico registrado o elegir “Continue with Google”.",
    "Presionar “Continue” y completar la contraseña cuando el sistema la solicite.",
    "Si la cuenta tiene MFA habilitado en Clerk, completar el segundo factor solicitado.",
    "Verificar que la aplicación redirija al dashboard “Tu pulso”.",
])
m.image(SCREENSHOTS / "ecopulse-login.jpg", "Evidencia 1. Pantalla de inicio de sesión personalizada de EcoPulse.", max_width=410, max_height=210)

# Main screen and menu
m.start_page("Interfaz principal")
m.title("6. Pantalla principal")
m.para("La página inicial presenta la propuesta de valor de EcoPulse, los accesos para iniciar sesión o crear cuenta, una descripción del impacto y el acceso flotante al chatbot EcoGuía. Después de autenticarse, el usuario llega al dashboard con sus indicadores y acciones principales.")
m.image(SCREENSHOTS / "ecopulse-landing.jpg", "Evidencia 2. Landing pública de EcoPulse con acceso al chatbot EcoGuía.", max_width=500, max_height=300)
m.table(["N.º", "Elemento", "Descripción"], [
    ["1", "Marca EcoPulse", "Identifica la aplicación y permite volver a la página inicial."],
    ["2", "Iniciar sesión", "Abre el formulario de acceso de Clerk."],
    ["3", "Crear cuenta", "Abre el formulario de registro."],
    ["4", "EcoGuía", "Botón flotante para consultar dudas de reciclaje."],
    ["5", "Acciones principales", "Enlaces para comenzar o entrar con una cuenta existente."],
], widths=[35, 145, 336])
m.title("7. Menú principal")
m.table(["Opción", "Función", "Perfil que puede acceder"], [
    ["Tu pulso", "Dashboard de puntos, racha, nivel y actividad.", "Usuario registrado"],
    ["Escanear", "Cargar una imagen o probar el reconocimiento demo.", "Usuario registrado"],
    ["Puntos cercanos", "Buscar puntos ecológicos, filtrar y pedir indicaciones.", "Usuario registrado"],
    ["Recompensas", "Consultar el catálogo y canjear puntos.", "Usuario registrado"],
    ["Guía Eco", "Conversar con el chatbot de reciclaje.", "Visitante y usuario"],
    ["Seguridad", "Consultar el estado de sesión y MFA.", "Usuario registrado"],
    ["Cerrar sesión", "Finalizar la sesión y volver a la página pública.", "Usuario registrado"],
], widths=[110, 270, 136])

# Functionality 1
m.start_page("Autenticación y seguridad")
m.title("8. Funcionalidad 1: Registro, inicio de sesión y seguridad")
m.para("¿Para qué sirve? Permite crear una cuenta, iniciar sesión de forma segura, cerrar sesión y revisar la protección de la cuenta. La autenticación es gestionada por Clerk.")
m.h2("Procedimiento de registro")
m.bullets([
    "Seleccionar “Crear cuenta” desde la página inicial.",
    "Escribir el correo electrónico y crear una contraseña.",
    "También se puede seleccionar “Continue with Google”.",
    "Completar la verificación solicitada por Clerk.",
    "Al finalizar, EcoPulse redirige al dashboard.",
])
m.image(SCREENSHOTS / "ecopulse-signup.jpg", "Evidencia 3. Pantalla de creación de cuenta.", max_width=400, max_height=240)
m.h2("Verificación en dos pasos, 2FA")
m.para("La pantalla “Seguridad” muestra el estado de MFA. EcoPulse está preparada para que Clerk solicite un segundo factor durante el acceso. La habilitación del autenticador y códigos de recuperación se realiza desde la configuración de Clerk; no se almacenan códigos ni contraseñas dentro de la aplicación.")
m.callout("Resultado esperado", "El usuario puede crear una cuenta, ingresar, consultar su estado de seguridad y cerrar sesión. Cuando MFA esté habilitado en Clerk, el segundo factor se solicitará automáticamente durante el login.")

# Functionality 2
m.start_page("Reconocimiento de residuos")
m.title("9. Funcionalidad 2: Identificación de residuos")
m.para("¿Para qué sirve? Orienta al usuario sobre la categoría y el destino correcto de un residuo a partir de una imagen o de una identificación de demostración.")
m.h2("Procedimiento")
m.bullets([
    "Entrar al menú “Escanear”.",
    "Seleccionar “Elegir imagen” y cargar una imagen JPG o PNG, o presionar “Probar demo”.",
    "Revisar el residuo identificado, la categoría y el porcentaje de confianza.",
    "Leer la instrucción de separación mostrada.",
    "Presionar “Confirmar y sumar puntos” para registrar la acción.",
])
m.callout("Resultado esperado", "Se muestra una lectura como “Vaso de cartón”, categoría Papel, nivel de confianza e instrucciones. Al confirmar, el registro aparece en la actividad y los puntos se agregan al balance.")
m.para("Nota: la primera versión incluye un modo demo local. La conexión con un modelo de visión artificial se agregará posteriormente mediante un endpoint seguro.")

# Functionality 3
m.start_page("Puntos ecológicos")
m.title("10. Funcionalidad 3: Mapa y geolocalización")
m.para("¿Para qué sirve? Permite ubicar lugares cercanos donde se reciben diferentes materiales y consultar sus horarios, distancia y tipos aceptados.")
m.h2("Procedimiento")
m.bullets([
    "Entrar a “Puntos cercanos”.",
    "Presionar “Usar mi ubicación” y aceptar el permiso del navegador, si se desea.",
    "Buscar por nombre o zona en el campo de búsqueda.",
    "Seleccionar un filtro como Papel, Vidrio, Envases o Textil.",
    "Elegir un punto de la lista o del mapa y presionar “Cómo llegar”.",
])
m.callout("Resultado esperado", "La lista se filtra con los puntos compatibles y el mapa muestra sus ubicaciones. El botón “Cómo llegar” abre una búsqueda de la dirección en Google Maps.")

# Functionality 4
m.start_page("Puntos y recompensas")
m.title("11. Funcionalidad 4: Gamificación y recompensas")
m.para("¿Para qué sirve? Convierte las acciones de reciclaje en puntos, niveles y recompensas para mantener la motivación del usuario.")
m.h2("Procedimiento")
m.bullets([
    "Confirmar un escaneo para sumar puntos.",
    "Consultar el balance y la racha desde “Tu pulso”.",
    "Entrar a “Recompensas” para revisar el catálogo.",
    "Filtrar por Biodiversidad, Reutiliza, Hogar o Impacto.",
    "Seleccionar “Canjear”, revisar la confirmación y presionar “Confirmar canje”.",
])
m.callout("Resultado esperado", "El saldo se descuenta según el costo de la recompensa y el producto cambia a estado “Canjeado”. Los datos de la demo se conservan en el navegador.")
m.h2("Indicadores visibles en el dashboard")
m.table(["Indicador", "Qué representa", "Interpretación"], [
    ["Puntos", "Saldo disponible para canjes.", "A mayor saldo, mayor capacidad de canjear."],
    ["Racha", "Días consecutivos con actividad.", "Ayuda a mantener el hábito."],
    ["Nivel", "Progreso acumulado del usuario.", "Indica avance dentro de la experiencia."],
    ["Kg encaminados", "Estimación de residuos separados.", "Mide el impacto ambiental aproximado."],
], widths=[115, 210, 191])

# Functionality 5
m.start_page("Chatbot")
m.title("12. Funcionalidad 5: Chatbot EcoGuía")
m.para("¿Para qué sirve? Responde dudas comunes sobre separación de residuos, puntos ecológicos y sistema de puntos. Está diseñado para ser accesible desde la landing y desde el menú privado.")
m.h2("Procedimiento")
m.bullets([
    "Presionar el botón flotante “Habla con EcoGuía” en la página inicial, o entrar a “Guía Eco” después del login.",
    "Elegir una pregunta rápida, por ejemplo “¿Dónde va el vidrio?” o “¿Cómo gano puntos?”.",
    "Escribir una duda en el campo “Escribe tu duda…” si se necesita una respuesta diferente.",
    "Presionar el botón de envío.",
    "Leer la respuesta y continuar la conversación.",
])
m.callout("Resultado esperado", "EcoGuía agrega la pregunta y una respuesta contextual al historial. El botón “Limpiar chat” permite reiniciar la conversación.")
m.para("Nota: el chatbot actual funciona sin API keys mediante respuestas locales. Más adelante se conectará a un modelo de IA desde el servidor para responder con mayor contexto.")

# Registration / query / reports / indicators
m.start_page("Registro y consultas")
m.title("13. Registro de información")
m.para("En esta versión, el registro principal ocurre al confirmar un escaneo o al canjear una recompensa. La aplicación conserva estos datos localmente para la demostración.")
m.table(["Campo", "Descripción", "Tipo de dato", "Obligatorio"], [
    ["Imagen", "Archivo del residuo seleccionado.", "Archivo JPG/PNG", "No; existe modo demo"],
    ["Residuo", "Nombre identificado.", "Texto", "Sí al confirmar"],
    ["Categoría", "Papel, vidrio, envases u otra.", "Texto", "Sí al confirmar"],
    ["Puntos", "Valor otorgado por la acción.", "Número", "Sí, automático"],
    ["Recompensa", "Producto o aporte seleccionado.", "Texto", "Sí al canjear"],
], widths=[100, 190, 110, 116])
m.para("Flujo general: entrar al módulo → seleccionar una acción → revisar el resultado → confirmar → verificar el mensaje y el balance actualizado.")
m.title("14. Consulta de información")
m.bullets([
    "Abrir “Tu pulso” para consultar puntos, racha y actividad.",
    "Abrir “Escanear” para ver los últimos gestos registrados.",
    "Abrir “Puntos cercanos” para consultar lugares y filtros.",
    "Abrir “Recompensas” para revisar saldo y canjes.",
    "Abrir “Guía Eco” para consultar información mediante conversación.",
])
m.para("Resultado esperado: la información seleccionada aparece actualizada en la pantalla correspondiente, sin necesidad de recargar la aplicación.")
m.title("15. Generación de reportes")
m.para("La versión actual no exporta un archivo independiente de reportes. El dashboard funciona como reporte visual del progreso, con indicadores de puntos, racha, nivel, actividad y residuos encaminados. Una futura versión puede añadir exportación PDF o CSV.")

# Indicators / alerts / profile
m.start_page("Indicadores y soporte")
m.title("16. Panel de indicadores")
m.table(["Indicador", "Qué representa", "Cómo se interpreta"], [
    ["Saldo de puntos", "Puntos acumulados y disponibles.", "Permite saber qué recompensas se pueden canjear."],
    ["Racha activa", "Continuidad del hábito sostenible.", "Una racha mayor indica constancia."],
    ["Actividad reciente", "Últimos residuos confirmados.", "Permite revisar acciones registradas."],
    ["Balance semanal", "Residuos encaminados durante la semana.", "Ayuda a comparar el ritmo personal."],
], widths=[125, 205, 186])
m.title("17. Alertas y notificaciones")
m.table(["Alerta / mensaje", "Cuándo aparece", "Qué significa", "Acción"], [
    ["“Sumado a tu pulso”", "Después de confirmar un escaneo.", "La acción fue registrada.", "Continuar o revisar el dashboard."],
    ["“Canjeado”", "Después de confirmar recompensa.", "Los puntos fueron descontados.", "Conservar la confirmación."],
    ["“Zona detectada”", "Después de usar ubicación.", "Se obtuvo la ubicación del navegador.", "Consultar los puntos cercanos."],
    ["“Pendiente de configurar”", "En Seguridad sin MFA activo.", "El segundo factor aún no está habilitado.", "Configurar MFA en Clerk cuando esté disponible."],
], widths=[120, 125, 160, 111])
m.title("18. Perfil del usuario")
m.para("La cuenta y la sesión se gestionan mediante Clerk. El usuario puede consultar su correo desde “Seguridad”, utilizar los controles de autenticación disponibles en la pantalla de login y cerrar la sesión desde el menú lateral.")
m.title("19. Cerrar sesión")
m.bullets([
    "Seleccionar “Cerrar sesión” en el menú lateral.",
    "Esperar a que Clerk finalice la sesión.",
    "Verificar que la aplicación regrese a la página pública.",
])
m.title("20. Mensajes del sistema")
m.table(["Mensaje", "Significado", "Acción recomendada"], [
    ["“Continue” deshabilitado", "Faltan datos obligatorios.", "Completar correo o contraseña."],
    ["“Faltan puntos”", "El saldo es menor al costo.", "Realizar más acciones o elegir otra recompensa."],
    ["“No encontramos puntos”", "Los filtros no devolvieron resultados.", "Cambiar búsqueda o filtro."],
    ["“Lista para ayudarte”", "EcoGuía está disponible.", "Escribir una pregunta o elegir una sugerencia."],
], widths=[150, 205, 161])

# Troubleshooting / FAQ / security
m.start_page("Solución de problemas")
m.title("21. Solución de problemas")
m.table(["Problema", "Posible causa", "Solución"], [
    ["No abre el login", "Conexión o navegador desactualizado.", "Recargar, revisar conexión y usar navegador actualizado."],
    ["No llega el correo de verificación", "Correo en spam o demora del proveedor.", "Revisar spam y solicitar reenvío desde Clerk."],
    ["No funciona ubicación", "Permiso bloqueado.", "Permitir ubicación en el navegador o usar la lista demo."],
    ["No aparece una recompensa", "Filtro activo o saldo insuficiente.", "Seleccionar “Todo” y revisar el balance."],
    ["No responde EcoGuía", "Campo vacío o sesión de carga.", "Escribir una pregunta concreta y enviarla nuevamente."],
    ["No se suma el escaneo", "No se confirmó la lectura.", "Presionar “Confirmar y sumar puntos” una sola vez."],
], widths=[145, 185, 186])
m.title("22. Preguntas frecuentes (FAQ)")
m.h2("¿Cómo ingreso al sistema?")
m.para("Selecciona “Iniciar sesión”, escribe tu correo y contraseña o usa Google. Si MFA está activo, completa el segundo factor.")
m.h2("¿Cómo registro información?")
m.para("Entra a “Escanear”, carga una imagen o prueba el demo, revisa el resultado y confirma la acción.")
m.h2("¿Cómo consulto los datos?")
m.para("Usa “Tu pulso” para indicadores, “Escanear” para actividad, “Puntos cercanos” para ubicaciones y “Recompensas” para canjes.")
m.h2("¿Cómo genero un reporte?")
m.para("La versión actual ofrece un reporte visual en el dashboard; todavía no exporta un archivo PDF o CSV.")
m.h2("¿Cómo cambio mi contraseña?")
m.para("Usa las opciones de recuperación o gestión de cuenta disponibles en la pantalla de inicio de sesión de Clerk.")
m.h2("¿Cómo cierro sesión?")
m.para("Selecciona “Cerrar sesión” en el menú lateral de la zona privada.")
m.title("23. Seguridad y buenas prácticas")
m.bullets([
    "No compartir la contraseña ni códigos de verificación.",
    "Cerrar sesión al finalizar en equipos compartidos.",
    "Utilizar información correcta y autorizada.",
    "No modificar ni compartir datos de otras personas.",
    "Reportar errores o comportamientos inesperados.",
    "Completar MFA cuando el administrador de Clerk lo habilite.",
])

# Sustainability / evidence / contact
m.start_page("Sostenibilidad y evidencias")
m.title("24. Aporte al desarrollo sostenible")
m.h2("¿Qué problema ambiental ayuda a solucionar?")
m.para("Reduce la confusión al separar residuos y promueve que materiales aprovechables no terminen mezclados con residuos ordinarios o en rellenos sanitarios.")
m.h2("¿Cómo contribuye el sistema al desarrollo sostenible?")
m.para("Facilita decisiones responsables, conecta a las personas con puntos de entrega y refuerza la repetición del hábito mediante retroalimentación y recompensas.")
m.h2("¿Qué indicador ambiental permite controlar?")
m.para("Permite observar residuos registrados, categorías separadas, estimación de kilogramos encaminados y continuidad de las acciones.")
m.h2("¿Qué ODS apoya?")
m.para("Principalmente ODS 11, Ciudades y comunidades sostenibles; ODS 12, Producción y consumo responsables; y ODS 13, Acción por el clima.")
m.h2("¿Qué beneficio ambiental genera?")
m.para("Favorece el aprovechamiento de materiales, disminuye la mezcla de residuos y fortalece la cultura de separación en la fuente.")
m.h2("¿Qué beneficio social y/o económico genera?")
m.para("Ofrece educación ambiental accesible, conecta comunidades con iniciativas locales y puede estimular economías circulares y cadenas de reciclaje.")
m.title("25. Evidencias del funcionamiento")
m.table(["Evidencia", "Funcionalidad", "Descripción"], [
    ["Captura 1", "Landing", "Página pública con propuesta de valor, acceso a cuenta y botón visible de EcoGuía."],
    ["Captura 2", "Inicio de sesión", "Formulario Clerk personalizado con correo, Google y acceso a registro."],
    ["Captura 3", "Registro", "Formulario para crear cuenta con correo, contraseña y Google."],
    ["Captura 4", "Chatbot", "EcoGuía está disponible desde el botón flotante de la landing y desde el menú privado."],
], widths=[80, 145, 291])
m.image(SCREENSHOTS / "ecopulse-landing.jpg", "Evidencia 4. La landing muestra el acceso flotante “Habla con EcoGuía”.", max_width=450, max_height=250)
m.title("26. Contacto y soporte")
m.table(["Campo", "Información"], [
    ["Responsable del sistema", "Equipo desarrollador EcoPulse"],
    ["Equipo desarrollador", "Proyecto académico de Ingeniería de Sistemas"],
    ["Correo", "Definido por el equipo académico para la entrega."],
    ["Teléfono / medio", "Soporte mediante el canal de la asignatura o del proyecto."],
    ["Versión del sistema", "1.0.0"],
    ["Fecha de actualización", "09/09/2026"],
    ["Horario de soporte", "Según disponibilidad del equipo del proyecto."],
], widths=[175, 341])

# Conclusions, annexes, checklist
m.start_page("Cierre")
m.title("27. Conclusiones")
m.bullets([
    "EcoPulse integra orientación, ubicación y gamificación en una sola experiencia para facilitar hábitos de reciclaje.",
    "La autenticación real, el chatbot local, el escaneo demo, el mapa y las recompensas permiten demostrar el flujo completo del producto.",
    "La arquitectura queda preparada para conectar IA de visión, chatbot con modelo externo, persistencia en base de datos y activación completa de MFA.",
])
m.title("28. Anexos")
m.bullets([
    "Capturas de la landing, inicio de sesión y registro.",
    "Descripción de las rutas principales de navegación.",
    "Matriz de funcionalidades y mensajes del sistema.",
    "Evidencias de verificación de compilación y funcionamiento visual.",
    "Consideraciones para la siguiente versión con APIs de IA.",
])
m.title("Lista de verificación para entrega")
m.table(["Criterio", "Estado"], [
    ["El manual tiene portada e información del proyecto.", "Sí"],
    ["Se explica claramente el objetivo y alcance.", "Sí"],
    ["Se identifican usuarios y requisitos.", "Sí"],
    ["Se documenta el acceso al sistema.", "Sí"],
    ["Cada funcionalidad tiene pasos claros.", "Sí"],
    ["Las principales funcionalidades tienen capturas.", "Sí, con evidencias disponibles"],
    ["Se explican reportes e indicadores.", "Sí; se aclara que el reporte es visual"],
    ["Se documentan mensajes y solución de problemas.", "Sí"],
    ["Se explica el aporte al desarrollo sostenible.", "Sí"],
    ["El documento fue revisado ortográfica y visualmente.", "Sí"],
], widths=[390, 126])
m.callout("Estado de entrega", "Manual completado para EcoPulse. Las funciones descritas como demo local están identificadas para evitar confundirlas con una integración externa ya configurada.")
m.finish()
print(OUT)