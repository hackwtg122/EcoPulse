import type { ReactNode } from "react";
import { Link } from "wouter";
import { ArrowLeft, ArrowRight, BookOpen, CircleHelp, FileText, Mail, ShieldCheck } from "lucide-react";

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

export const publicFooterLinks = [
  { href: "/materials", label: "Materiales y guías" },
  { href: "/faq", label: "Preguntas frecuentes" },
  { href: "/privacy", label: "Privacidad" },
  { href: "/terms", label: "Términos" },
  { href: "/contact", label: "Contacto" },
];

function Brand() {
  return <Link href="/" className="flex items-center gap-2.5 text-[hsl(var(--primary))]" data-testid="link-public-brand"><img src={`${basePath}/logo.svg`} alt="" className="h-8 w-8" /><span className="font-display text-xl">EcoPulse</span></Link>;
}

export function PublicLayout({ children }: { children: ReactNode }) {
  return <div className="flex min-h-[100dvh] flex-col bg-[hsl(var(--background))]">
    <header className="sticky top-0 z-20 border-b border-[hsl(var(--border))] bg-[hsl(var(--background)/.92)] backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-5 py-4 sm:px-8">
        <Brand />
        <nav className="hidden items-center gap-1 md:flex">
          {publicFooterLinks.slice(0, 2).map((link) => <Link key={link.href} href={link.href} className="rounded-full px-3.5 py-2 text-sm font-semibold text-[hsl(var(--primary))] hover:bg-[hsl(var(--muted))]">{link.label}</Link>)}
        </nav>
        <div className="flex items-center gap-2">
          <Link href="/sign-in" className="rounded-full px-4 py-2 text-sm font-semibold text-[hsl(var(--primary))] hover:bg-[hsl(var(--muted))]" data-testid="link-public-signin">Iniciar sesión</Link>
          <Link href="/sign-up" className="inline-flex items-center gap-1.5 rounded-full bg-[hsl(var(--primary))] px-4 py-2.5 text-sm font-semibold text-[hsl(var(--primary-foreground))]" data-testid="link-public-signup">Crear cuenta <ArrowRight size={15} /></Link>
        </div>
      </div>
    </header>
    <main className="mx-auto w-full max-w-6xl flex-1 px-5 py-10 sm:px-8">{children}</main>
    <footer className="border-t border-[hsl(var(--border))] bg-[hsl(var(--card)/.6)]">
      <div className="mx-auto flex max-w-6xl flex-col gap-5 px-5 py-8 sm:px-8">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
          <Brand />
          <p className="text-sm text-[hsl(var(--muted-foreground))]">Información educativa honesta sobre separación de residuos en Montería.</p>
        </div>
        <nav className="flex flex-wrap gap-x-5 gap-y-2 text-sm text-[hsl(var(--muted-foreground))]" aria-label="Enlaces legales">
          {publicFooterLinks.map((link) => <Link key={link.href} href={link.href} className="hover:text-[hsl(var(--primary))]">{link.label}</Link>)}
          <Link href="/" className="hover:text-[hsl(var(--primary))]">Inicio</Link>
        </nav>
         <p className="text-xs text-[hsl(var(--muted-foreground))]">EcoPulse es un proyecto universitario: sus centros y operaciones representan una simulación educativa, no establecimientos físicos.</p>
      </div>
    </footer>
  </div>;
}

function InfoPageShell({ icon, eyebrow, title, intro, children, testId }: { icon: ReactNode; eyebrow: string; title: string; intro: string; children: ReactNode; testId: string }) {
  return <div className="animate-rise" data-testid={testId}>
    <Link href="/" className="inline-flex items-center gap-2 text-sm font-semibold text-[hsl(var(--primary))]" data-testid="link-back-home"><ArrowLeft size={16} /> Volver al inicio</Link>
    <header className="mt-6 flex items-start gap-4">
      <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-[hsl(var(--secondary)/.32)] text-[hsl(var(--primary))]">{icon}</span>
      <div>
        <p className="text-xs font-bold uppercase tracking-[.18em] text-[hsl(var(--accent))]">{eyebrow}</p>
        <h1 className="mt-2 font-display text-4xl leading-none tracking-[-.03em] text-[hsl(var(--primary))] sm:text-5xl">{title}</h1>
        <p className="mt-3 max-w-2xl leading-relaxed text-[hsl(var(--muted-foreground))]">{intro}</p>
      </div>
    </header>
    <div className="mt-8 max-w-3xl space-y-5">{children}</div>
  </div>;
}

function InfoBlock({ title, children }: { title: string; children: ReactNode }) {
  return <section className="rounded-[1.75rem] border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6 sm:p-7">
    <h2 className="font-display text-2xl text-[hsl(var(--primary))]">{title}</h2>
    <div className="mt-3 space-y-2 text-sm leading-relaxed text-[hsl(var(--muted-foreground))]">{children}</div>
  </section>;
}

function DraftNotice({ testId }: { testId: string }) {
  return <div className="rounded-[1.75rem] border border-[hsl(var(--accent)/.45)] bg-[hsl(var(--secondary)/.16)] p-5 sm:p-6" role="note" data-testid={testId}>
    <p className="flex items-center gap-2 font-semibold text-[hsl(var(--primary))]"><FileText size={18} /> Documento en preparación — no vigente como texto legal final</p>
    <p className="mt-2 text-sm leading-relaxed text-[hsl(var(--muted-foreground))]">Falta definir el responsable del tratamiento y el canal oficial de contacto. Este texto describe el estado real de EcoPulse, pero no ha sido revisado por un responsable legal ni constituye un instrumento definitivo.</p>
  </div>;
}

const faqItems: Array<{ q: string; a: string }> = [
  { q: "¿Qué es EcoPulse?", a: "Una plataforma educativa para identificar y preparar la entrega de residuos aprovechables en Montería. Reúne una biblioteca pública de materiales, una guía de separación y un mapa con referencias ilustrativas para practicar dónde entregar." },
  { q: "¿Necesito una cuenta para consultar las guías?", a: "No. La biblioteca de materiales y sus fichas se leen sin registrarte. La cuenta solo es necesaria para registrar clasificaciones, solicitar entregas y ver tu actividad." },
  { q: "¿Un escaneo o una foto me dan EcoPuntos?", a: "No. Una clasificación manual o una sugerencia de imagen no certifican un reciclaje, así que no suman puntos ni kilogramos. Escanear y reciclar son cosas distintas." },
  { q: "¿Cómo se ganan puntos, entonces?", a: "Con entregas recibidas y verificadas por un operador distinto al participante. El saldo y los canjes disponibles se muestran al iniciar sesión." },
  { q: "¿Hay centros de entrega disponibles?", a: "El mapa permite explorar ocho centros educativos. Los horarios con cupo aparecen al iniciar sesión cuando están disponibles para solicitar una entrega." },
  { q: "¿EcoGuía usa inteligencia artificial?", a: "Sí, si está disponible y aceptas enviar tu consulta. Sin consentimiento o conexión, ofrece una guía local claramente diferenciada." },
  { q: "¿Qué hago con residuos peligrosos como pilas o medicamentos?", a: "Revísalos en la categoría «Manejo especial» de la biblioteca: pilas, medicamentos vencidos, lámparas, electrónicos, cortopunzantes, aceite usado y químicos requieren canales posconsumo o autorizados, nunca la basera común." },
  { q: "¿Cómo corrijo o elimino mis datos?", a: "Tu cuenta (nombre, correo, contraseña y 2FA) se gestiona con Clerk. Para solicitudes de rectificación o eliminación de datos operativos, el canal público está en preparación; la política de privacidad describe qué tratamos y qué está pendiente." },
  { q: "¿Tiene algún costo?", a: "El uso educativo y la creación de cuenta no requieren pagos. Las recompensas forman parte de la simulación universitaria." },
];

export function FaqPage() {
  return <InfoPageShell icon={<CircleHelp size={26} />} eyebrow="Antes de empezar" title="Preguntas frecuentes." intro="Respuestas directas sobre lo que EcoPulse hace hoy y lo que todavía está desactivado, sin prometer operaciones que no existen." testId="page-faq">
    {faqItems.map((item) => <InfoBlock key={item.q} title={item.q}><p>{item.a}</p></InfoBlock>)}
    <div className="rounded-[1.75rem] bg-[hsl(var(--primary))] p-6 text-[hsl(var(--primary-foreground))] sm:p-7">
      <h2 className="font-display text-2xl">¿Quieres explorar la biblioteca?</h2>
      <p className="mt-2 text-sm text-[hsl(var(--primary-foreground)/.75)]">Consulta las fichas de materiales sin crear una cuenta.</p>
      <Link href="/materials" className="mt-5 inline-flex items-center gap-2 rounded-full bg-[hsl(var(--secondary))] px-5 py-3 text-sm font-semibold text-[hsl(var(--primary))]" data-testid="link-faq-materials"><BookOpen size={17} /> Ver materiales y guías</Link>
    </div>
  </InfoPageShell>;
}

export function PrivacyPage() {
  return <InfoPageShell icon={<ShieldCheck size={26} />} eyebrow="Tus datos" title="Política de privacidad." intro="Este aviso describe, de forma honesta, qué datos trata EcoPulse hoy y qué mecanismos todavía están en preparación. No sustituye una política revisada por un responsable legal." testId="page-privacy">
    <DraftNotice testId="privacy-draft-notice" />
    <InfoBlock title="Responsable del tratamiento">
      <p>El equipo responsable del proyecto EcoPulse en Montería. La razón social, el correo de contacto y el canal formal de solicitudes están pendientes de facilitar; se publicarán aquí cuando existan. Hasta entonces no afirmamos una entidad legal concreta.</p>
    </InfoBlock>
    <InfoBlock title="Datos que tratamos">
      <p><strong className="text-[hsl(var(--primary))]">Identificación de cuenta:</strong> nombre y correo electrónico, gestionados por Clerk como proveedor de autenticación.</p>
      <p><strong className="text-[hsl(var(--primary))]">Registros operativos:</strong> clasificaciones, solicitudes de entrega, eventos de verificación, movimientos y canjes, almacenados en PostgreSQL para tu cuenta.</p>
      <p><strong className="text-[hsl(var(--primary))]">Conversación con EcoGuía:</strong> permanece en memoria mientras la pantalla está abierta. Con tu consentimiento, se envían la pregunta y hasta seis mensajes anteriores al proveedor de IA mediante el servidor. El servidor consulta solo el contexto autorizado de tu cuenta.</p>
      <p><strong className="text-[hsl(var(--primary))]">Fotografías:</strong> se procesan para sugerir una clasificación solo si seleccionas una imagen, aceptas su envío y la IA está disponible. El escaneo confirmado se almacena sin guardar la fotografía.</p>
      <p><strong className="text-[hsl(var(--primary))]">Ubicación GPS:</strong> EcoPulse no solicita ni almacena tu ubicación.</p>
    </InfoBlock>
    <InfoBlock title="Para qué usamos tus datos">
      <p>Operar tu cuenta y mostrar tu actividad registrada, permitir la verificación de entregas por parte de operadores autorizados, y responder consultas educativas. No usamos tus datos para publicidad ni para venderlos.</p>
    </InfoBlock>
    <InfoBlock title="Con quién se comparten">
      <p>Con proveedores técnicos necesarios: Clerk para autenticación. El mapa base se carga como contenido de OpenStreetMap, que puede recibir la dirección IP de tu navegador al mostrarse. No compartimos tu actividad privada entre cuentas ni con terceros ajenos a la operación.</p>
    </InfoBlock>
    <InfoBlock title="Conservación">
      <p>Los registros asociados a tu cuenta se conservan mientras la cuenta exista. Si eliminas tu cuenta con Clerk, los datos operativos asociados requieren una solicitud de supresión por el canal formal, aún en preparación.</p>
    </InfoBlock>
    <InfoBlock title="Tus derechos">
      <p>De acuerdo con la Ley 1581 de 2012 puedes conocer, actualizar, rectificar y solicitar la supresión de tus datos. El canal público para presentar solicitudes está en preparación; mientras se habilita, puedes actualizar tu nombre y correo desde tu cuenta y gestionar el segundo factor desde la sección Seguridad.</p>
      <p className="text-xs">No prometemos eliminación completa hasta que exista un mecanismo implementado y verificable.</p>
    </InfoBlock>
    <InfoBlock title="Seguridad">
      <p>Las sesiones las administra Clerk; puedes activar verificación en dos pasos con aplicación autenticadora desde la sección Seguridad. La API de EcoPulse autoriza por rol en el servidor, no solo ocultando pantallas.</p>
    </InfoBlock>
    <InfoBlock title="Menores de edad">
      <p>EcoPulse es de carácter educativo y no está dirigido a menores de 18 años sin acompañamiento de una persona adulta responsable.</p>
    </InfoBlock>
    <p className="text-xs text-[hsl(var(--muted-foreground))]">Última revisión: 17 de octubre de 2026. Este documento se actualizará publicando una nueva fecha.</p>
  </InfoPageShell>;
}

export function TermsPage() {
  return <InfoPageShell icon={<FileText size={26} />} eyebrow="Uso responsable" title="Términos de uso." intro="Reglas básicas y alcance real del servicio. Este texto es informativo y está pendiente de revisión jurídica; no constituye un contrato final." testId="page-terms">
    <InfoBlock title="Objeto del servicio">
      <p>EcoPulse ofrece información educativa sobre separación de residuos, una biblioteca de materiales y herramientas de registro. No sustituye la asesoría ni las condiciones del prestador de aseo o del centro de entrega.</p>
    </InfoBlock>
    <InfoBlock title="Sin garantías operativas">
      <p>No garantizamos la disponibilidad de centros, horarios, premios ni resultados ambientales. Mientras la operación física esté desactivada, no existen puntos, canjes ni recompensas activas, y ninguna pantalla los simula.</p>
    </InfoBlock>
    <InfoBlock title="Uso adecuado">
      <p>No suplantes identidades, no intentes acceder a cuentas ajenas y no entregues residuos peligrosos por canales no autorizados. Las fichas de manejo especial señalan la vía responsable para cada caso.</p>
    </InfoBlock>
    <InfoBlock title="Contenidos y terceros">
      <p>El catálogo editorial es propio de EcoPulse. El mapa base utiliza datos de OpenStreetMap, © colaboradores de OpenStreetMap, bajo su licencia abierta.</p>
    </InfoBlock>
    <InfoBlock title="Cambios">
      <p>Estos términos pueden actualizarse publicando una nueva fecha de revisión en esta página. No afirmamos condiciones que no estén escritas aquí.</p>
    </InfoBlock>
    <InfoBlock title="Contacto">
      <p>El canal público de contacto está en preparación. Mientras se habilita, revisa la página de Contacto para conocer los temas que atenderemos.</p>
    </InfoBlock>
    <p className="text-xs text-[hsl(var(--muted-foreground))]">Última revisión: 17 de octubre de 2026.</p>
  </InfoPageShell>;
}

export function ContactPage() {
  return <InfoPageShell icon={<Mail size={26} />} eyebrow="Hablemos" title="Contacto." intro="Queremos publicar un canal real, no uno inventado. Aquí explicamos qué temas atenderemos y qué información falta por definir." testId="page-contact">
    <div className="rounded-[1.75rem] border border-[hsl(var(--accent)/.45)] bg-[hsl(var(--card))] p-6 sm:p-7" role="note">
      <h2 className="font-display text-2xl text-[hsl(var(--primary))]">Canal pendiente de facilitar</h2>
      <p className="mt-2 text-sm leading-relaxed text-[hsl(var(--muted-foreground))]">Aún no existe un correo, teléfono o formulario público de contacto verificado. Preferimos indicarlo antes que publicar un dato falso. Cuando el equipo responsable lo defina, aparecerá en esta página.</p>
      <p className="mt-3 text-xs text-[hsl(var(--muted-foreground))]">Información requerida para completar esta página: correo institucional, responsable y horario de atención.</p>
    </div>
    <InfoBlock title="Temas que atenderemos">
      <ul className="list-disc space-y-2 pl-5">
        <li>Privacidad y datos personales: acceso, rectificación o supresión de información.</li>
        <li>Alianzas: centros, gestores o asociaciones de recicladores que quieran ser verificados.</li>
        <li>Calidad del directorio: reportar dirección, horario o material incorrecto de un centro publicado.</li>
        <li>Soporte de cuenta: acceso, verificación en dos pasos y errores de la aplicación.</li>
      </ul>
    </InfoBlock>
    <InfoBlock title="Mientras tanto">
      <p>Puedes crear tu cuenta y usar las herramientas disponibles. La verificación en dos pasos se activa desde la sección Seguridad una vez inicies sesión.</p>
      <div className="mt-4 flex flex-wrap gap-3">
        <Link href="/sign-up" className="inline-flex items-center gap-2 rounded-full bg-[hsl(var(--primary))] px-5 py-3 text-sm font-semibold text-[hsl(var(--primary-foreground))]" data-testid="link-contact-signup">Crear cuenta <ArrowRight size={16} /></Link>
        <Link href="/materials" className="inline-flex items-center gap-2 rounded-full border border-[hsl(var(--border))] px-5 py-3 text-sm font-semibold text-[hsl(var(--primary))]"><BookOpen size={16} /> Ver materiales</Link>
      </div>
    </InfoBlock>
  </InfoPageShell>;
}
