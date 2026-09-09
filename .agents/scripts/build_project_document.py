from pathlib import Path
from copy import deepcopy
import zipfile
import xml.etree.ElementTree as ET


TEMPLATE = Path("attached_assets/Plantilla_Documentacion_Proyecto_UCC_Ingenieria_Sistemas_1788965642301.docx")
OUT = Path(".agents/outputs/Documentacion_Proyecto_EcoPulse.docx")
ASSETS = {
    "landing": Path("screenshots/ecopulse-landing.jpg"),
    "login": Path("screenshots/ecopulse-login.jpg"),
    "signup": Path("screenshots/ecopulse-signup.jpg"),
}

W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
WP = "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
A = "http://schemas.openxmlformats.org/drawingml/2006/main"
PIC = "http://schemas.openxmlformats.org/drawingml/2006/picture"
REL = "http://schemas.openxmlformats.org/package/2006/relationships"
CT = "http://schemas.openxmlformats.org/package/2006/content-types"

NS = {"w": W, "r": R}
ET.register_namespace("w", W)
ET.register_namespace("r", R)
ET.register_namespace("wp", WP)
ET.register_namespace("a", A)
ET.register_namespace("pic", PIC)


def q(ns, tag):
    return f"{{{ns}}}{tag}"


def text_run(text, bold=False, italic=False, size=None, color=None):
    run = ET.Element(q(W, "r"))
    if bold or italic or size or color:
        props = ET.SubElement(run, q(W, "rPr"))
        if bold:
            ET.SubElement(props, q(W, "b"))
        if italic:
            ET.SubElement(props, q(W, "i"))
        if size:
            ET.SubElement(props, q(W, "sz"), {q(W, "val"): str(size)})
        if color:
            ET.SubElement(props, q(W, "color"), {q(W, "val"): color})
    t = ET.SubElement(run, q(W, "t"))
    if text.startswith(" ") or text.endswith(" ") or "  " in text:
        t.set("{http://www.w3.org/XML/1998/namespace}space", "preserve")
    t.text = text
    return run


def paragraph(text="", style=None, bold=False, italic=False, size=None, color=None,
              align=None, space_after=100, page_break_before=False):
    p = ET.Element(q(W, "p"))
    ppr = ET.SubElement(p, q(W, "pPr"))
    if style:
        ET.SubElement(ppr, q(W, "pStyle"), {q(W, "val"): style})
    if align:
        ET.SubElement(ppr, q(W, "jc"), {q(W, "val"): align})
    spacing = ET.SubElement(ppr, q(W, "spacing"), {
        q(W, "after"): str(space_after),
        q(W, "line"): "276",
        q(W, "lineRule"): "auto",
    })
    if page_break_before:
        ET.SubElement(ppr, q(W, "pageBreakBefore"))
    if text:
        p.append(text_run(text, bold=bold, italic=italic, size=size, color=color))
    return p


def heading(text, level=1, page_break=False):
    return paragraph(text, style="Ttulo1" if level == 1 else None,
                     bold=level != 1, size=26 if level == 1 else 22,
                     color="1F4E3B" if level == 1 else "2F5D50",
                     space_after=130, page_break_before=page_break)


def bullet(text):
    return paragraph(text, style="Listaconvietas", space_after=45)


def numbered(text):
    return paragraph(text, style="Listanumerada", space_after=45)


def cell(text, header=False, width=None):
    tc = ET.Element(q(W, "tc"))
    tcp = ET.SubElement(tc, q(W, "tcPr"))
    if width:
        ET.SubElement(tcp, q(W, "tcW"), {q(W, "w"): str(width), q(W, "type"): "dxa"})
    if header:
        ET.SubElement(tcp, q(W, "shd"), {q(W, "fill"): "D9EAF2", q(W, "val"): "clear"})
    ET.SubElement(tcp, q(W, "vAlign"), {q(W, "val"): "center"})
    p = paragraph(str(text), bold=header, size=17 if header else 16,
                  color="1F1F1F", space_after=15)
    tc.append(p)
    return tc


def table(headers, rows, widths=None, font_size=16):
    tbl = ET.Element(q(W, "tbl"))
    tblpr = ET.SubElement(tbl, q(W, "tblPr"))
    ET.SubElement(tblpr, q(W, "tblStyle"), {q(W, "val"): "Tablaconcuadrcula"})
    ET.SubElement(tblpr, q(W, "tblW"), {q(W, "w"): "0", q(W, "type"): "auto"})
    ET.SubElement(tblpr, q(W, "jc"), {q(W, "val"): "center"})
    ET.SubElement(tblpr, q(W, "tblLayout"), {q(W, "type"): "fixed"})
    grid = ET.SubElement(tbl, q(W, "tblGrid"))
    count = len(headers)
    if not widths:
        widths = [9000 // count] * count
    for width in widths:
        ET.SubElement(grid, q(W, "gridCol"), {q(W, "w"): str(width)})
    tr = ET.SubElement(tbl, q(W, "tr"))
    for value, width in zip(headers, widths):
        tr.append(cell(value, header=True, width=width))
    for row in rows:
        tr = ET.SubElement(tbl, q(W, "tr"))
        values = list(row) + [""] * max(0, count - len(row))
        for value, width in zip(values[:count], widths):
            tr.append(cell(value, width=width))
    return tbl


def caption(text):
    return paragraph(text, italic=True, size=16, color="5B6B63", align="center", space_after=120)


def page_break():
    p = paragraph()
    run = ET.SubElement(p, q(W, "r"))
    ET.SubElement(run, q(W, "br"), {q(W, "type"): "page"})
    return p


def image_paragraph(rel_id, name, width_inches=6.2, height_inches=3.8):
    p = paragraph(align="center", space_after=40)
    run = ET.SubElement(p, q(W, "r"))
    drawing = ET.SubElement(run, q(W, "drawing"))
    inline = ET.SubElement(drawing, q(WP, "inline"), {
        "distT": "0", "distB": "0", "distL": "0", "distR": "0"
    })
    cx = int(width_inches * 914400)
    cy = int(height_inches * 914400)
    ET.SubElement(inline, q(WP, "extent"), {"cx": str(cx), "cy": str(cy)})
    ET.SubElement(inline, q(WP, "docPr"), {"id": str(100 + len(name)), "name": name})
    ET.SubElement(inline, q(WP, "cNvGraphicFramePr"))
    graphic = ET.SubElement(inline, q(A, "graphic"))
    data = ET.SubElement(graphic, q(A, "graphicData"), {
        "uri": "http://schemas.openxmlformats.org/drawingml/2006/picture"
    })
    pic = ET.SubElement(data, q(PIC, "pic"))
    nv = ET.SubElement(pic, q(PIC, "nvPicPr"))
    ET.SubElement(nv, q(PIC, "cNvPr"), {"id": "0", "name": name})
    ET.SubElement(nv, q(PIC, "cNvPicPr"))
    fill = ET.SubElement(pic, q(PIC, "blipFill"))
    ET.SubElement(fill, q(A, "blip"), {q(R, "embed"): rel_id})
    stretch = ET.SubElement(fill, q(A, "stretch"))
    ET.SubElement(stretch, q(A, "fillRect"))
    sppr = ET.SubElement(pic, q(PIC, "spPr"))
    xfrm = ET.SubElement(sppr, q(A, "xfrm"))
    ET.SubElement(xfrm, q(A, "off"), {"x": "0", "y": "0"})
    ET.SubElement(xfrm, q(A, "ext"), {"cx": str(cx), "cy": str(cy)})
    geom = ET.SubElement(sppr, q(A, "prstGeom"), {"prst": "rect"})
    ET.SubElement(geom, q(A, "avLst"))
    return p


def add_section_intro(body, number, title):
    body.append(heading(f"{number}. {title}", 1, page_break=True))


def add_labeled(body, label, value):
    p = paragraph(space_after=65)
    p.append(text_run(label + " ", bold=True, size=20, color="1F4E3B"))
    p.append(text_run(value, size=20))
    body.append(p)


def build_document():
    original = ET.fromstring(zipfile.ZipFile(TEMPLATE).read("word/document.xml"))
    sect_pr = original.find(".//w:sectPr", NS)
    if sect_pr is None:
        raise RuntimeError("No se encontró la configuración de sección de la plantilla")

    root = ET.Element(q(W, "document"))
    body = ET.SubElement(root, q(W, "body"))

    # Portada
    body.append(paragraph("ECO", bold=True, size=54, color="1F4E3B", align="center", space_after=0))
    body.append(paragraph("PULSE", bold=True, size=54, color="E3A928", align="center", space_after=280))
    body.append(paragraph("DOCUMENTACIÓN DEL PROYECTO", bold=True, size=28,
                          color="1F4E3B", align="center", space_after=200))
    body.append(paragraph("Ingeniería de Sistemas – 10.º semestre", size=22,
                          color="5B6B63", align="center", space_after=260))
    body.append(table(
        ["Campo", "Información"],
        [
            ("Título del proyecto", "EcoPulse: plataforma web para reciclaje inteligente"),
            ("Curso / asignatura", "Desarrollo Sostenible / Proyecto"),
            ("Docente", "Docente de la asignatura"),
            ("Integrantes", "Equipo desarrollador EcoPulse"),
            ("Semestre", "10.º semestre"),
            ("Institución", "Universidad Cooperativa de Colombia"),
            ("Fecha", "09/09/2026"),
            ("Versión del documento", "1.0"),
        ],
        [2500, 6500],
    ))
    body.append(paragraph())
    body.append(paragraph(
        "EcoPulse ayuda a identificar residuos, encontrar puntos ecológicos y convertir el reciclaje diario en puntos y recompensas.",
        size=21, color="1F4E3B", align="center", space_after=120
    ))
    body.append(page_break())

    # 1-3
    add_section_intro(body, 1, "Control de versiones")
    body.append(table(
        ["Versión", "Fecha", "Responsable", "Descripción del cambio", "Aprobación"],
        [("1.0", "09/09/2026", "Equipo EcoPulse",
          "Primera versión completa de la documentación del proyecto y su solución web.", "Pendiente de revisión académica")],
        [1000, 1200, 1800, 3600, 1400],
    ))
    body.append(paragraph("Este documento se mantendrá actualizado durante el ciclo de vida del proyecto.", italic=True, size=18, color="5B6B63"))

    add_section_intro(body, 2, "Información general del proyecto")
    add_labeled(body, "Nombre del proyecto:", "EcoPulse")
    add_labeled(body, "Descripción general:", "EcoPulse es una aplicación web de reciclaje inteligente que combina identificación de residuos, orientación sobre separación, localización de puntos ecológicos, gamificación, recompensas y un chatbot educativo llamado EcoGuía. La primera versión prioriza una experiencia usable, clara y accesible desde computador o teléfono.")
    add_labeled(body, "Problema o necesidad:", "Muchas personas desean reciclar, pero no siempre saben cómo clasificar un residuo, dónde entregarlo o cómo mantener el hábito. La falta de orientación inmediata y de información centralizada reduce la separación correcta y dificulta medir la participación.")
    add_labeled(body, "Contexto y población beneficiaria:", "La solución está dirigida a estudiantes, hogares, comunidades educativas y personas interesadas en hábitos sostenibles. El proyecto se contextualiza en entornos urbanos donde existen residuos aprovechables y puntos de entrega, pero la información está dispersa o no es fácil de consultar.")
    body.append(table(
        ["Elemento", "Definición para EcoPulse"],
        [
            ("Propuesta de valor", "Orientar al usuario en el momento de reciclar y motivarlo a repetir la conducta."),
            ("Usuarios principales", "Visitantes, usuarios registrados y administradores del servicio."),
            ("Canales", "Aplicación web responsive y chatbot público/privado."),
            ("Resultado esperado", "Más decisiones correctas de separación y mayor constancia del hábito."),
        ],
        [2500, 6500],
    ))

    add_section_intro(body, 3, "Relación con Desarrollo Sostenible y ODS")
    add_labeled(body, "ODS principal relacionado:", "ODS 12 – Producción y consumo responsables. EcoPulse fomenta la separación en la fuente, el aprovechamiento de materiales y decisiones de consumo más conscientes.")
    add_labeled(body, "ODS secundarios relacionados:", "ODS 11 – Ciudades y comunidades sostenibles, por facilitar la consulta de puntos ecológicos; ODS 13 – Acción por el clima, por apoyar prácticas que reducen residuos enviados a disposición final; ODS 4 – Educación de calidad, por ofrecer orientación ambiental accesible.")
    add_labeled(body, "Problema de sostenibilidad que aborda:", "La disposición incorrecta de residuos y la baja continuidad de los hábitos de reciclaje. EcoPulse conecta conocimiento, ubicación y motivación en un mismo flujo.")
    body.append(table(
        ["Dimensión", "Impacto esperado", "Acción o indicador"],
        [
            ("Social", "Mayor claridad para separar residuos y acceso a orientación.", "Usuarios que completan escaneos y consultan EcoGuía."),
            ("Ambiental", "Más residuos encaminados a aprovechamiento.", "Escaneos confirmados por categoría y registros de entrega."),
            ("Económica", "Menor costo de adopción de la solución y posibilidad de alianzas.", "Costo operativo controlado y recompensas gestionadas."),
        ],
        [1500, 4100, 3400],
    ))

    # 4-7
    add_section_intro(body, 4, "Planteamiento del problema")
    add_labeled(body, "Descripción de la situación problemática:", "Las personas encuentran dificultades para reconocer materiales, separar residuos contaminados o ubicar un lugar adecuado de entrega. Las soluciones existentes suelen estar fragmentadas: una fuente explica la clasificación, otra muestra mapas y otra intenta motivar. La ausencia de una experiencia integrada genera dudas y abandono.")
    add_labeled(body, "Pregunta problema:", "¿Cómo puede una plataforma web integrar orientación, identificación, ubicación y gamificación para facilitar hábitos de reciclaje correctos y sostenibles?")
    body.append(table(
        ["Causas", "Problema central", "Consecuencias"],
        [("Falta de información clara y contextualizada.", "Separación incorrecta y baja continuidad del reciclaje.", "Contaminación de materiales aprovechables, menor recuperación y desmotivación.")],
        [3000, 3000, 3000],
    ))
    body.append(caption("Figura 1. Árbol del problema de EcoPulse — versión 1.0, 09/09/2026."))
    body.append(paragraph("La intervención propuesta actúa sobre las causas mediante educación y guía contextual; sobre el problema mediante una experiencia integrada; y sobre las consecuencias mediante seguimiento, puntos y recompensas.", size=19))

    add_section_intro(body, 5, "Justificación")
    add_labeled(body, "Justificación social:", "La plataforma reduce la incertidumbre de las personas que quieren reciclar y ofrece una guía sencilla para convertir una intención ambiental en una acción concreta.")
    add_labeled(body, "Justificación tecnológica:", "Una aplicación web responsive permite centralizar módulos, proteger el acceso con Clerk, evolucionar la identificación hacia IA real y migrar la persistencia local a servicios de producción sin rehacer la experiencia.")
    add_labeled(body, "Justificación ambiental:", "Al mejorar la clasificación y la localización de puntos de entrega, se favorece el aprovechamiento de materiales y se reduce la probabilidad de que residuos recuperables terminen mezclados.")
    add_labeled(body, "Justificación económica:", "La primera versión utiliza tecnologías web y modos locales para disminuir costos iniciales. El modelo puede crecer mediante alianzas con instituciones, gestores de residuos y programas de incentivos.")
    add_labeled(body, "Aporte de la Ingeniería de Sistemas:", "Diseñar una solución modular, usable y segura; traducir una necesidad social en requerimientos verificables; integrar autenticación, interfaz, estado local y futura API; y definir indicadores para evaluar impacto.")

    add_section_intro(body, 6, "Objetivos")
    add_labeled(body, "Objetivo general:", "Diseñar e implementar una plataforma web llamada EcoPulse que facilite la identificación, separación y entrega de residuos mediante orientación digital, puntos ecológicos, gamificación y comunicación educativa.")
    add_labeled(body, "Objetivos específicos:", "")
    for item in [
        "Analizar las necesidades de usuarios que requieren orientación para separar residuos.",
        "Diseñar una interfaz responsive con rutas públicas y privadas de navegación.",
        "Implementar registro, inicio de sesión, cierre de sesión y sesiones protegidas mediante Clerk.",
        "Desarrollar un flujo de escaneo de residuos con carga de imagen y modo demostración.",
        "Incorporar consulta de puntos ecológicos y uso de geolocalización del navegador.",
        "Implementar puntos, niveles, rachas, recompensas y registro de canjes.",
        "Incluir EcoGuía como chatbot educativo disponible en la landing y en el área privada.",
        "Definir pruebas, indicadores, riesgos y una ruta de evolución hacia APIs de IA y persistencia real.",
    ]:
        body.append(bullet(item))

    add_section_intro(body, 7, "Alcance y limitaciones")
    add_labeled(body, "Alcance del proyecto:", "Incluye landing pública, autenticación, dashboard, escaneo de residuos, mapa de puntos ecológicos, recompensas, seguridad, chatbot EcoGuía, persistencia local de la demo, diseño responsive y documentación técnica y académica.")
    add_labeled(body, "Fuera del alcance:", "No incluye todavía un modelo de visión artificial conectado a producción, inventario real de comercios, pagos, aplicación móvil nativa, panel administrativo completo, notificaciones push ni sincronización multi-dispositivo.")
    add_labeled(body, "Limitaciones técnicas, económicas, legales o de tiempo:", "La identificación y el chatbot operan localmente en esta versión; los datos de puntos y recompensas son de demostración; la activación de MFA depende de la configuración de Clerk; la geolocalización requiere permisos del navegador; y las integraciones externas se dejan preparadas para una fase posterior.")

    # 8-10
    add_section_intro(body, 8, "Stakeholders / partes interesadas")
    body.append(table(
        ["Stakeholder", "Interés", "Influencia", "Necesidad", "Estrategia de gestión"],
        [
            ("Usuarios registrados", "Reciclar con guía y motivación.", "Alta", "Flujo simple, puntos y privacidad.", "Probar tareas clave y recoger retroalimentación."),
            ("Visitantes", "Conocer la propuesta y preguntar a EcoGuía.", "Media", "Acceso público sin fricción.", "Optimizar landing, registro y chatbot."),
            ("Docente / institución", "Evidencia de aprendizaje e impacto.", "Alta", "Documentación, indicadores y trazabilidad.", "Entregar versiones y resultados verificables."),
            ("Gestores de residuos", "Recibir materiales mejor clasificados.", "Media", "Información de puntos y categorías.", "Futuras alianzas y validación de datos."),
            ("Equipo de desarrollo", "Construir y mantener el producto.", "Alta", "Requisitos claros y arquitectura modular.", "Control de versiones, pruebas y revisión."),
            ("Proveedor de autenticación", "Operar cuentas y sesiones.", "Media", "Configuración segura y cumplimiento.", "Usar Clerk sin manejar credenciales manualmente."),
        ],
        [1700, 1900, 1000, 2200, 2200],
    ))

    add_section_intro(body, 9, "Requerimientos del sistema")
    body.append(table(
        ["ID", "Tipo", "Requerimiento", "Prioridad", "Criterio de aceptación"],
        [
            ("RF-01", "Funcional", "El sistema debe mostrar una landing pública con propuesta de valor y acceso a EcoGuía.", "Alta", "La landing carga y el botón abre el chat."),
            ("RF-02", "Funcional", "El usuario debe poder registrarse e iniciar sesión mediante Clerk.", "Alta", "Se muestran las pantallas y Clerk gestiona la sesión."),
            ("RF-03", "Funcional", "El usuario debe acceder a un dashboard protegido.", "Alta", "Una sesión válida permite entrar y una sesión ausente redirige."),
            ("RF-04", "Funcional", "El usuario debe cargar una imagen o ejecutar un escaneo demo.", "Alta", "El sistema muestra categoría, confianza e instrucciones."),
            ("RF-05", "Funcional", "El usuario debe confirmar un escaneo y sumar puntos.", "Alta", "La actividad aparece y el balance se actualiza."),
            ("RF-06", "Funcional", "El sistema debe mostrar puntos ecológicos y permitir solicitar ubicación.", "Media", "Se muestran puntos y se solicita permiso del navegador."),
            ("RF-07", "Funcional", "El usuario debe consultar y canjear recompensas.", "Alta", "El canje descuenta puntos y registra la actividad."),
            ("RF-08", "Funcional", "EcoGuía debe responder preguntas frecuentes sin API externa.", "Media", "El chat responde y conserva conversaciones localmente."),
            ("RF-09", "Seguridad", "La aplicación debe proteger rutas privadas y permitir cerrar sesión.", "Alta", "No se visualiza el área privada sin sesión."),
            ("RNF-01", "Usabilidad", "La interfaz debe ser responsive y legible.", "Alta", "Se adapta a móvil y escritorio sin solapamientos."),
            ("RNF-02", "Mantenibilidad", "La arquitectura debe permitir migrar datos locales a backend.", "Media", "Estado y rutas están separados de la futura API."),
            ("RNF-03", "Privacidad", "No se deben exponer secretos ni credenciales en el cliente.", "Alta", "Las claves se gestionan como secretos del entorno."),
        ],
        [800, 1000, 3700, 900, 2600],
        font_size=15,
    ))

    add_section_intro(body, 10, "Análisis y diseño de la solución")
    add_labeled(body, "Descripción de la solución propuesta:", "EcoPulse organiza el recorrido del usuario en cuatro momentos: entender el propósito en la landing, autenticarse, realizar una acción de reciclaje guiada y recibir una recompensa o recomendación. La aplicación separa la experiencia pública de la privada y concentra la información en un dashboard.")
    add_labeled(body, "Arquitectura del sistema:", "La solución usa una aplicación React + Vite en el frontend, un API server Express preparado para servicios de producción, Clerk para identidad y sesiones, estado local del navegador para la demo y una ruta de evolución hacia PostgreSQL/Drizzle y servicios de IA.")
    body.append(table(
        ["Capa", "Componente", "Responsabilidad"],
        [
            ("Presentación", "React, Vite, CSS responsive", "Landing, autenticación personalizada, dashboard y rutas."),
            ("Identidad", "Clerk", "Registro, login, Google Sign-In, sesiones, logout y MFA configurable."),
            ("Lógica de experiencia", "Estado local del navegador", "Escaneos, puntos, canjes y conversaciones en modo demo."),
            ("Servicios", "Express 5 / API server", "Proxy de Clerk en producción y base para endpoints futuros."),
            ("Persistencia futura", "PostgreSQL + Drizzle", "Usuarios de dominio, escaneos, recompensas y métricas."),
            ("IA futura", "Servicio de visión y chatbot", "Clasificación multimodal y respuestas contextualizadas."),
        ],
        [1600, 2400, 5000],
    ))
    body.append(caption("Figura 2. Arquitectura lógica de EcoPulse — versión 1.0, 09/09/2026."))
    body.append(table(
        ["Usuario / navegador", "EcoPulse web", "Servicios y datos"],
        [
            ("Landing, login y registro", "React + Vite / rutas públicas", "Clerk: identidad y sesión"),
            ("Dashboard y escaneo", "Estado local / reglas demo", "Futuro: API de visión"),
            ("Mapa y recompensas", "Geolocalización / balance", "Futuro: PostgreSQL y gestores"),
            ("EcoGuía", "Chat local con historial", "Futuro: modelo conversacional"),
        ],
        [2700, 3000, 3300],
    ))
    body.append(caption("Diagrama 1. Flujo de arquitectura y evolución tecnológica — versión 1.0, 09/09/2026."))
    body.append(heading("Casos de uso / historias de usuario", 2))
    body.append(table(
        ["ID", "Actor", "Historia de usuario", "Criterio de aceptación"],
        [
            ("HU-01", "Visitante", "Como visitante quiero conocer EcoPulse y hablar con EcoGuía.", "Puedo abrir el chat desde la landing."),
            ("HU-02", "Usuario", "Como usuario quiero escanear un residuo para saber cómo separarlo.", "Obtengo categoría, confianza e instrucciones."),
            ("HU-03", "Usuario", "Como usuario quiero sumar puntos al confirmar una acción.", "El balance y la actividad se actualizan."),
            ("HU-04", "Usuario", "Como usuario quiero encontrar un punto ecológico cercano.", "Veo puntos y puedo usar mi ubicación."),
            ("HU-05", "Usuario", "Como usuario quiero canjear una recompensa.", "El sistema valida saldo y registra el canje."),
            ("Administrador", "Equipo", "Como responsable quiero configurar identidad y seguridad.", "Clerk administra sesión y opciones MFA."),
        ],
        [900, 1400, 3900, 2800],
    ))
    body.append(heading("Modelo de datos / ER", 2))
    body.append(table(
        ["Entidad", "Atributos principales", "Relaciones"],
        [
            ("Usuario", "id, correo, nombre, fecha de registro", "Tiene escaneos, canjes y conversaciones."),
            ("Escaneo", "id, usuario, categoría, confianza, fecha, puntos", "Pertenece a un usuario."),
            ("Punto ecológico", "id, nombre, categoría, latitud, longitud, horario", "Se consulta por cercanía y filtro."),
            ("Recompensa", "id, título, costo, estado", "Puede ser canjeada por un usuario."),
            ("Canje", "id, usuario, recompensa, fecha, puntos", "Registra una transacción de puntos."),
            ("Conversación", "id, usuario o visitante, mensajes, fecha", "Conserva el contexto de EcoGuía."),
        ],
        [1900, 3900, 3200],
    ))
    body.append(caption("Diagrama 2. Modelo de datos conceptual — versión 1.0, 09/09/2026."))
    body.append(heading("Tecnologías seleccionadas y justificación", 2))
    body.append(table(
        ["Tecnología", "Justificación"],
        [
            ("React + TypeScript", "Componentes reutilizables, tipado y buena mantenibilidad."),
            ("Vite", "Desarrollo y compilación rápidos para una aplicación web moderna."),
            ("Express 5", "Base ligera para endpoints, proxy y servicios futuros."),
            ("Clerk", "Autenticación real, sesiones protegidas y proveedores sociales."),
            ("PostgreSQL + Drizzle", "Persistencia relacional preparada para una siguiente fase."),
            ("pnpm workspaces", "Organización del frontend, API y paquetes compartidos."),
        ],
        [2600, 6400],
    ))

    # 11-15
    add_section_intro(body, 11, "Plan de trabajo / actividades")
    body.append(table(
        ["Actividad", "Responsable", "Inicio", "Fin", "Producto / evidencia"],
        [
            ("Levantamiento del problema y alcance", "Equipo EcoPulse", "01/09/2026", "01/09/2026", "Objetivos, alcance y stakeholders"),
            ("Diseño visual y navegación", "Equipo EcoPulse", "02/09/2026", "03/09/2026", "Landing, rutas y componentes"),
            ("Autenticación y rutas protegidas", "Equipo EcoPulse", "03/09/2026", "04/09/2026", "Registro, login y logout"),
            ("Escaneo y gamificación", "Equipo EcoPulse", "04/09/2026", "05/09/2026", "Demo, puntos, rachas y recompensas"),
            ("Mapa y EcoGuía", "Equipo EcoPulse", "05/09/2026", "06/09/2026", "Puntos ecológicos y chatbot"),
            ("API server y configuración", "Equipo EcoPulse", "06/09/2026", "07/09/2026", "Proxy de Clerk y estructura backend"),
            ("Pruebas y documentación", "Equipo EcoPulse", "07/09/2026", "09/09/2026", "Manual, documentación y evidencias"),
        ],
        [2700, 1500, 1100, 1100, 2600],
        font_size=15,
    ))

    add_section_intro(body, 12, "Gestión de riesgos")
    body.append(table(
        ["Riesgo", "Probabilidad", "Impacto", "Nivel", "Mitigación / respuesta"],
        [
            ("La API de IA no esté disponible durante la entrega.", "Media", "Alto", "Alto", "Mantener modo demo local y documentar la ruta de integración."),
            ("Configuración de MFA dependa del panel de Clerk.", "Media", "Medio", "Medio", "Documentar pasos, no implementar un segundo factor inseguro."),
            ("Pérdida de datos por usar almacenamiento local.", "Media", "Medio", "Medio", "Avisar que es demo y migrar a backend persistente."),
            ("Permiso de geolocalización rechazado.", "Media", "Bajo", "Bajo", "Ofrecer puntos de referencia y manejo claro del estado."),
            ("Cambios en proveedores externos.", "Baja", "Medio", "Medio", "Aislar integraciones y revisar documentación."),
            ("Accesibilidad o responsive insuficiente.", "Media", "Medio", "Medio", "Probar móvil/escritorio, contraste y navegación con teclado."),
        ],
        [2600, 1200, 1100, 900, 3200],
        font_size=15,
    ))

    add_section_intro(body, 13, "Seguridad, privacidad y ética")
    add_labeled(body, "Datos que manejará el sistema:", "Correo y datos básicos de cuenta gestionados por Clerk; registros de escaneo, puntos, canjes y conversaciones guardados localmente en la demo; ubicación aproximada solo cuando el usuario concede permiso; y archivos de imagen seleccionados para el escaneo.")
    add_labeled(body, "Controles de seguridad:", "Rutas privadas protegidas por sesión, autenticación delegada a Clerk, secretos fuera del código, cierre de sesión, separación entre frontend y API, validación futura con Zod y no exposición de claves privadas en el navegador.")
    add_labeled(body, "Privacidad y protección de datos:", "Se debe solicitar consentimiento para geolocalización y explicar su finalidad. La futura versión debe definir retención de imágenes y conversaciones, eliminación de datos, minimización, controles de acceso y cumplimiento de la normativa colombiana aplicable.")
    add_labeled(body, "Consideraciones éticas:", "El resultado de una clasificación automática debe presentarse como orientación y no como verdad absoluta. Se debe permitir corregir o reportar resultados, evitar recompensas que incentiven conductas riesgosas y diseñar mensajes inclusivos, claros y no culpabilizantes.")

    add_section_intro(body, 14, "Sostenibilidad de la solución")
    add_labeled(body, "¿Cómo continuará funcionando después de su implementación?:", "La arquitectura modular permite reemplazar el modo demo por servicios persistentes sin alterar el recorrido principal. El proyecto puede mantenerse con un catálogo actualizado de puntos, contenidos educativos revisados y métricas de uso.")
    add_labeled(body, "Mantenimiento y actualización:", "Revisar dependencias, monitorear autenticación, actualizar categorías y puntos ecológicos, probar rutas críticas, revisar accesibilidad y documentar cambios en cada versión.")
    add_labeled(body, "Recursos requeridos:", "Hosting del frontend y API, base de datos, servicio de autenticación, almacenamiento de imágenes si se habilita IA real, responsable de contenidos y apoyo de aliados ambientales.")
    body.append(table(
        ["Indicador de sostenibilidad", "Frecuencia", "Meta inicial"],
        [
            ("Escaneos confirmados", "Mensual", "Crecimiento de usuarios activos y acciones registradas."),
            ("Porcentaje de canjes exitosos", "Mensual", "Mantener una experiencia sin errores críticos."),
            ("Consultas a EcoGuía", "Mensual", "Identificar dudas frecuentes para mejorar contenidos."),
            ("Puntos ecológicos vigentes", "Trimestral", "Revisar y retirar ubicaciones desactualizadas."),
        ],
        [3600, 1800, 3600],
    ))

    add_section_intro(body, 15, "Desarrollo e implementación")
    add_labeled(body, "Metodología de desarrollo utilizada:", "Se aplicó un enfoque iterativo e incremental: definición del problema, prototipo visual, construcción por módulos, integración de autenticación, pruebas de flujo y documentación. Cada módulo se verificó en el contexto de la experiencia completa.")
    add_labeled(body, "Sprint / fases / entregables:", "Fase 1: alcance y diseño. Fase 2: landing y autenticación. Fase 3: dashboard, escaneo y gamificación. Fase 4: mapa, recompensas y EcoGuía. Fase 5: seguridad, pruebas, manual y documentación.")
    add_labeled(body, "Repositorio y control de versiones:", "El proyecto se organiza como workspace pnpm con artifacts separados para EcoPulse web, API server y sandbox de componentes. La documentación debe versionarse junto con el código y registrar cambios relevantes.")
    add_labeled(body, "Plan de despliegue:", "Ejecutar typecheck y build, configurar secretos de Clerk y sesión, iniciar API y web mediante workflows, verificar rutas públicas y privadas, revisar consola del navegador y publicar solo después de validar autenticación y navegación.")

    # 16-18
    add_section_intro(body, 16, "Pruebas y validación")
    body.append(table(
        ["ID", "Caso de prueba", "Entrada", "Resultado esperado", "Resultado obtenido", "Estado"],
        [
            ("CP-01", "Carga de landing", "Abrir ruta pública", "Se muestra propuesta, navegación y chatbot.", "Correcto en revisión visual.", "Aprobado"),
            ("CP-02", "Inicio de sesión", "Correo / proveedor Google", "Clerk muestra autenticación y crea sesión.", "Pantalla verificada; depende de credenciales válidas.", "Aprobado"),
            ("CP-03", "Registro", "Datos de nuevo usuario", "Se puede iniciar creación de cuenta.", "Pantalla verificada.", "Aprobado"),
            ("CP-04", "Protección de ruta", "Entrar sin sesión a área privada", "Se redirige a autenticación.", "Flujo protegido implementado.", "Aprobado"),
            ("CP-05", "Escaneo demo", "Presionar Probar demo", "Se muestra categoría e instrucciones.", "Correcto con modo local.", "Aprobado"),
            ("CP-06", "Confirmar escaneo", "Presionar confirmar", "Se suma actividad y puntos.", "Correcto en persistencia local.", "Aprobado"),
            ("CP-07", "Mapa", "Abrir puntos y ubicación", "Se muestran puntos y se solicita permiso.", "Correcto; depende del navegador.", "Aprobado"),
            ("CP-08", "Canje", "Recompensa con saldo suficiente", "Se descuentan puntos y registra canje.", "Correcto en modo demo.", "Aprobado"),
            ("CP-09", "Chat público", "Presionar Habla con EcoGuía", "Se abre y responde el asistente.", "Correcto y visible en landing.", "Aprobado"),
            ("CP-10", "Build", "Ejecutar compilación", "No hay errores TypeScript/build.", "TypeScript y build verificados.", "Aprobado"),
        ],
        [700, 1500, 1500, 2500, 1900, 900],
        font_size=14,
    ))

    add_section_intro(body, 17, "Resultados")
    add_labeled(body, "Resultados técnicos:", "Se construyó una aplicación React/Vite con rutas públicas y privadas, autenticación Clerk, API server preparado para producción, escaneo demo, mapa, recompensas, chatbot y estilos responsive. La solución compila y los workflows principales arrancan correctamente.")
    add_labeled(body, "Resultados sociales:", "La experiencia reduce la fricción para aprender a separar residuos y hace visible el progreso individual mediante puntos, rachas y recompensas.")
    add_labeled(body, "Resultados ambientales:", "El flujo promueve decisiones de separación más informadas y facilita encontrar lugares de entrega. El impacto cuantitativo deberá medirse con datos reales de uso.")
    add_labeled(body, "Resultados económicos:", "Se obtuvo un prototipo funcional con tecnologías de bajo costo inicial y una arquitectura que permite incorporar alianzas, servicios de IA y persistencia escalable en fases posteriores.")

    add_section_intro(body, 18, "Indicadores del proyecto")
    body.append(table(
        ["Indicador", "Fórmula / forma de medición", "Línea base", "Meta", "Resultado"],
        [
            ("Usuarios registrados", "Conteo de cuentas creadas en Clerk.", "0 al iniciar piloto", "Medir crecimiento mensual.", "Preparado para medición."),
            ("Escaneos confirmados", "Conteo de acciones confirmadas por usuario.", "0 al iniciar piloto", "Aumentar acciones repetidas.", "Disponible en modo local."),
            ("Tasa de canje", "Canjes exitosos / intentos de canje × 100.", "Sin línea base", "≥ 90% sin errores de saldo.", "Validado en demo."),
            ("Consultas a EcoGuía", "Conteo de conversaciones y mensajes.", "0 al iniciar piloto", "Usar dudas para mejorar contenido.", "Disponible localmente."),
            ("Puntos ecológicos consultados", "Puntos vistos o filtrados por usuario.", "Sin línea base", "Aumentar descubrimiento de puntos.", "Catálogo demo operativo."),
            ("Disponibilidad técnica", "Minutos operativos / minutos del periodo × 100.", "No medido", "Definir cuando se publique.", "Pendiente de producción."),
        ],
        [2200, 2800, 1400, 1600, 1600],
        font_size=15,
    ))

    # 19-22
    add_section_intro(body, 19, "Presupuesto")
    body.append(paragraph("Presupuesto estimado para un piloto académico. Los valores son referenciales y pueden variar según proveedores y volumen de uso.", italic=True, size=18, color="5B6B63"))
    body.append(table(
        ["Concepto", "Cantidad", "Costo unitario", "Costo total", "Fuente"],
        [
            ("Diseño y desarrollo académico", "1 proyecto", "$0 (equipo)", "$0", "Trabajo académico"),
            ("Hosting / despliegue inicial", "1 entorno", "$0–$25 USD/mes", "$0–$25 USD/mes", "Plan gratuito o institucional"),
            ("Autenticación Clerk", "1 proyecto", "$0 en piloto", "$0 inicial", "Clerk / plan disponible"),
            ("Base de datos PostgreSQL", "1 instancia", "$0–$25 USD/mes", "$0–$25 USD/mes", "Servicio administrado"),
            ("API de visión / chatbot futuro", "Según consumo", "Variable", "Por estimar", "Proveedor externo"),
            ("Contenido y validación ambiental", "1 alianza", "Por convenio", "Por definir", "Institución / gestor"),
        ],
        [2500, 1300, 1800, 1500, 1900],
        font_size=15,
    ))

    add_section_intro(body, 20, "Conclusiones y recomendaciones")
    add_labeled(body, "Conclusiones:", "EcoPulse demuestra que una experiencia web puede unir educación ambiental, identificación, localización y motivación en un solo producto. La primera versión cumple el flujo principal con autenticación real y modos locales claramente identificados. El diseño modular facilita evolucionar hacia IA, persistencia y alianzas reales.")
    add_labeled(body, "Recomendaciones:", "Conectar un servicio de visión con evaluación de confianza; migrar escaneos, puntos y canjes a una base de datos; validar el catálogo con gestores locales; habilitar MFA desde la configuración de Clerk; realizar pruebas con usuarios; incorporar métricas de impacto y revisar accesibilidad con personas diversas.")

    add_section_intro(body, 21, "Referencias")
    refs = [
        "Universidad Cooperativa de Colombia. Plantilla para la documentación del proyecto de Ingeniería de Sistemas.",
        "Naciones Unidas. Objetivos de Desarrollo Sostenible: ODS 4, 11, 12 y 13.",
        "Clerk. Documentación de autenticación, sesiones, proveedores sociales y MFA.",
        "React. Documentación oficial de componentes y estado.",
        "Vite. Documentación oficial de desarrollo y compilación frontend.",
        "Express. Documentación oficial del framework para Node.js.",
        "OWASP. Application Security Verification Standard (ASVS).",
        "Congreso de Colombia. Ley 1581 de 2012 sobre protección de datos personales.",
    ]
    for ref in refs:
        body.append(bullet(ref))

    add_section_intro(body, 22, "Anexos")
    body.append(paragraph("Anexo A. Evidencias de la interfaz", bold=True, size=22, color="1F4E3B", space_after=80))
    body.append(image_paragraph("rId13", "Landing EcoPulse", 6.1, 3.45))
    body.append(caption("Figura A1. Landing pública de EcoPulse con acceso a EcoGuía."))
    body.append(image_paragraph("rId14", "Login EcoPulse", 5.1, 3.55))
    body.append(caption("Figura A2. Inicio de sesión personalizado con Clerk."))
    body.append(image_paragraph("rId15", "Registro EcoPulse", 5.1, 3.55))
    body.append(caption("Figura A3. Registro de usuario de EcoPulse."))
    body.append(paragraph("Anexo B. Rutas principales", bold=True, size=22, color="1F4E3B", space_after=80))
    body.append(table(
        ["Ruta / módulo", "Propósito"],
        [
            ("/", "Landing pública, propuesta de valor y chatbot EcoGuía."),
            ("/login", "Inicio de sesión."),
            ("/signup", "Registro de cuenta."),
            ("/dashboard", "Resumen de puntos, actividad y progreso."),
            ("/scan", "Carga de imagen y escaneo demo."),
            ("/map", "Puntos ecológicos y geolocalización."),
            ("/rewards", "Recompensas y canjes."),
            ("/security", "Estado de seguridad, sesión y MFA."),
            ("/chat", "Chat privado con EcoGuía."),
        ],
        [2600, 6400],
    ))
    body.append(paragraph("Anexo C. Decisiones y pendientes", bold=True, size=22, color="1F4E3B", space_after=80))
    for item in [
        "El chatbot actual funciona sin API keys mediante respuestas locales.",
        "La identificación de residuos funciona con carga de imagen y modo demo local.",
        "Escaneos, puntos, canjes y conversaciones usan persistencia local del navegador.",
        "La IA real, la base de datos de producción y el catálogo real de puntos quedan como evolución posterior.",
        "MFA/2FA queda preparado mediante Clerk y debe activarse desde su configuración administrativa.",
    ]:
        body.append(bullet(item))
    body.append(page_break())
    body.append(heading("Lista de verificación para entrega", 1))
    body.append(table(
        ["Criterio", "Estado"],
        [
            ("La documentación incluye portada, alcance y descripción del proyecto.", "Sí"),
            ("Se relaciona la solución con ODS y acciones medibles.", "Sí"),
            ("Se identifican stakeholders, requerimientos y criterios de aceptación.", "Sí"),
            ("Se documentan arquitectura, casos de uso y modelo de datos.", "Sí"),
            ("Se incluyen plan de trabajo, riesgos, seguridad y sostenibilidad.", "Sí"),
            ("Se describen pruebas con resultados obtenidos.", "Sí"),
            ("Se incluyen indicadores, presupuesto y referencias.", "Sí"),
            ("Se agregan evidencias visuales y anexos.", "Sí"),
            ("Se identifican claramente las funciones demo y las futuras integraciones.", "Sí"),
        ],
        [7000, 2000],
    ))
    body.append(paragraph("Estado de entrega: documentación completa para revisión académica.", bold=True, size=20, color="1F4E3B", space_after=80))

    # Keep the original page setup, header and footer.
    body.append(deepcopy(sect_pr))
    return root


def update_relationships(xml_bytes):
    rel_root = ET.fromstring(xml_bytes)
    ET.SubElement(rel_root, q(REL, "Relationship"), {
        "Id": "rId13",
        "Type": "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image",
        "Target": "media/ecopulse-landing.jpg",
    })
    ET.SubElement(rel_root, q(REL, "Relationship"), {
        "Id": "rId14",
        "Type": "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image",
        "Target": "media/ecopulse-login.jpg",
    })
    ET.SubElement(rel_root, q(REL, "Relationship"), {
        "Id": "rId15",
        "Type": "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image",
        "Target": "media/ecopulse-signup.jpg",
    })
    return ET.tostring(rel_root, encoding="utf-8", xml_declaration=True)


def update_content_types(xml_bytes):
    root = ET.fromstring(xml_bytes)
    for name in ("ecopulse-landing.jpg", "ecopulse-login.jpg", "ecopulse-signup.jpg"):
        ET.SubElement(root, q(CT, "Override"), {
            "PartName": "/word/media/" + name,
            "ContentType": "image/jpeg",
        })
    return ET.tostring(root, encoding="utf-8", xml_declaration=True)


def main():
    OUT.parent.mkdir(parents=True, exist_ok=True)
    document_xml = ET.tostring(build_document(), encoding="utf-8", xml_declaration=True)
    with zipfile.ZipFile(TEMPLATE, "r") as source, zipfile.ZipFile(OUT, "w", zipfile.ZIP_DEFLATED) as target:
        for info in source.infolist():
            name = info.filename
            if name in ("word/document.xml", "word/_rels/document.xml.rels", "[Content_Types].xml"):
                continue
            target.writestr(info, source.read(name))
        target.writestr("word/document.xml", document_xml)
        target.writestr("word/_rels/document.xml.rels",
                        update_relationships(source.read("word/_rels/document.xml.rels")))
        target.writestr("[Content_Types].xml",
                        update_content_types(source.read("[Content_Types].xml")))
        for key, path in ASSETS.items():
            if not path.exists():
                raise FileNotFoundError(path)
            target.write(path, "word/media/" + path.name)
    print(OUT)


if __name__ == "__main__":
    main()