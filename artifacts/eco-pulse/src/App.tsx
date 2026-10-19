import { createContext, lazy, Suspense, useCallback, useContext, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { ClerkProvider, SignIn, useAuth, useClerk, useSignUp, useUser } from "@clerk/react";
import { shadcn } from "@clerk/themes";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Link, Redirect, Route, Switch, Router as WouterRouter, useLocation } from "wouter";
import { ErrorBoundary } from "@/components/error-boundary";
import {
  AlertTriangle, ArrowRight, Bell, BookOpen, Bot, Camera, Check, CircleHelp, Clock3, Compass, Gift, Leaf, LockKeyhole, LogOut, MapPin, Menu, MessageCircle, Navigation, PackageCheck, Pencil, Recycle, Search, ShieldCheck, Sparkles, Target, Trophy, UserRound, X, Zap,
} from "lucide-react";
import { Toaster } from "@/components/ui/toaster";
import { createPilotScan, isCurrentPilotResponse, loadEvaluationPoints, loadPilotDashboardData, loadPilotProgress, loadPilotDeliveryOptions, loadPilotPublicPoints, PilotApiError, retryWaitSuffix, type EvaluationPoint, type PilotDashboardData, type PilotDeliveryOptions, type PilotProgress } from "@/pilot-api";
import { colombianSeparationReference, manualScanCategories, manualScanGuidance, materialCategoryByScan, type ManualScanCategory } from "@/scan-catalog";
const DeliveryPanel = lazy(() => import("@/delivery-panel").then(module => ({ default: module.DeliveryPanel })));
const VerifierQueue = lazy(() => import("@/delivery-panel").then(module => ({ default: module.VerifierQueue })));
const CatalogAdminPanel = lazy(() => import("@/catalog-admin-panel").then(module => ({ default: module.CatalogAdminPanel })));
const RewardsPanel = lazy(() => import("@/rewards-panel").then(module => ({ default: module.RewardsPanel })));
const RewardsAdminPanel = lazy(() => import("@/rewards-panel").then(module => ({ default: module.RewardsAdminPanel })));
const AiScanPanel = lazy(() => import("@/ai-scan-panel").then(module => ({ default: module.AiScanPanel })));
const ProgressPanel = lazy(() => import("@/progress-panel").then(module => ({ default: module.ProgressPanel })));
import { guideAnswer } from "@/eco-guide";
import { MaterialFicha, MaterialsLibrary } from "@/materials-page";
import { findMaterialById } from "@/materials-catalog";
import { MapExperience } from "./interactive-map";
import { askGuide, createGuideRequestGate, guideQuotaMessages, GuideApiError, loadGuideCapabilities, type GuideTurn } from "./guide-api";
import { ContactPage, FaqPage, PrivacyPage, PublicLayout, TermsPage, publicFooterLinks } from "@/public-pages";
import { TooltipProvider } from "@/components/ui/tooltip";

const queryClient = new QueryClient();
const clerkKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY?.trim();
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL?.trim() || undefined;
const pilotApiUrl = import.meta.env.VITE_PILOT_API_URL?.trim() || "http://127.0.0.1:5001";
const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

type PilotLoadState = {
  accountId: string | null;
  status: "idle" | "loading" | "ready" | "error";
  data: PilotDashboardData | null;
  message: string;
};

const emptyPilotState: PilotLoadState = { accountId: null, status: "idle", data: null, message: "" };
const PilotDashboardContext = createContext<{ state: PilotLoadState; retry: () => void }>({ state: emptyPilotState, retry: () => undefined });

function stripBase(path: string) {
  return basePath && path.startsWith(basePath) ? path.slice(basePath.length) || "/" : path;
}

const clerkAppearance = {
  theme: shadcn,
  cssLayerName: "clerk",
  options: {
    logoPlacement: "inside" as const,
    logoLinkUrl: basePath || "/",
    logoImageUrl: `${window.location.origin}${basePath}/logo.svg`,
    showOptionalFields: true,
  },
  variables: {
    colorPrimary: "#214c3b",
    colorForeground: "#17352a",
    colorMutedForeground: "#687d72",
    colorDanger: "#b9584f",
    colorBackground: "#fbf8f0",
    colorInput: "#fffdf8",
    colorInputForeground: "#17352a",
    colorNeutral: "#d8d8c9",
    fontFamily: "DM Sans",
    borderRadius: "1rem",
  },
  elements: {
    rootBox: "w-full flex justify-center",
    cardBox: "bg-[#fbf8f0] rounded-[2rem] w-[440px] max-w-full overflow-hidden",
    card: "!shadow-none !border-0 !bg-transparent !rounded-none",
    footer: "!shadow-none !border-0 !bg-transparent !rounded-none",
    headerTitle: "font-display text-[#214c3b]",
    headerSubtitle: "text-[#687d72]",
    socialButtonsBlockButtonText: "text-[#214c3b]",
    formFieldLabel: "text-[#214c3b]",
    footerActionLink: "text-[#214c3b]",
    footerActionText: "text-[#687d72]",
    dividerText: "text-[#687d72]",
    formButtonPrimary: "bg-[#214c3b] hover:bg-[#17352a]",
    formFieldInput: "bg-[#fffdf8] text-[#17352a] border-[#d8d8c9]",
    main: "bg-transparent",
  },
};

type ClerkProfile = {
  fullName?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  username?: string | null;
  primaryEmailAddress?: { emailAddress?: string | null } | null;
  unsafeMetadata?: { firstName?: string | null; lastName?: string | null } | null;
};

function getDisplayName(user: ClerkProfile | null | undefined) {
  const fullName = user?.fullName?.trim();
  if (fullName) return fullName;
  const firstName = user?.firstName?.trim();
  const lastName = user?.lastName?.trim();
  if (firstName && lastName) return `${firstName} ${lastName}`;
  if (firstName) return firstName;
  if (user?.username?.trim()) return user.username.trim();
  const metadataName = [user?.unsafeMetadata?.firstName, user?.unsafeMetadata?.lastName].filter((value): value is string => Boolean(value?.trim())).join(" ");
  if (metadataName) return metadataName;
  const emailName = user?.primaryEmailAddress?.emailAddress?.split("@")[0]?.trim();
  return emailName || "Tu nombre";
}

function getUserEmail(user: ClerkProfile | null | undefined) {
  return user?.primaryEmailAddress?.emailAddress?.trim() || "Correo no disponible";
}

type ChatMessage = { id: string; role: "user" | "assistant"; content: string; timestamp: string };

const seedChat: ChatMessage[] = [{ id: "welcome", role: "assistant", content: "Hola, soy tu guía de reciclaje. Pregúntame por una categoría, tus puntos o un punto ecológico cercano.", timestamp: "Ahora" }];

const landingFaq = [
  { q: "¿Un escaneo me da EcoPuntos?", a: "No. Clasificar un residuo no concede EcoPuntos. Se obtienen únicamente tras verificar una entrega según las reglas vigentes." },
  { q: "¿Ya puedo solicitar una entrega?", a: "Inicia sesión y revisa los horarios disponibles en Mis entregas. Si no hay cupos, podrás explorar los centros en el mapa." },
  { q: "¿EcoGuía utiliza inteligencia artificial?", a: "Sí, cuando la IA está disponible y das tu consentimiento. Si no, ofrece orientación local claramente identificada." },
  { q: "¿Consultar las guías tiene costo?", a: "No. La biblioteca de materiales y las fichas se leen sin crear cuenta y sin costo. La cuenta solo se necesita para registrar tu actividad." },
];

function useStored<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(() => { try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : initial; } catch { return initial; } });
  useEffect(() => { localStorage.setItem(key, JSON.stringify(value)); }, [key, value]);
  return [value, setValue] as const;
}
function IconLogo({ small = false }: { small?: boolean }) { return <img src={`${basePath}/logo.svg`} alt="EcoPulse" className={small ? "h-8 w-8" : "h-11 w-11"} />; }
function Button({ children, className = "", variant = "primary", ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "soft" | "ghost" | "outline" }) {
  const styles = { primary: "bg-[hsl(var(--secondary))] text-[hsl(var(--secondary-foreground))] hover:-translate-y-0.5", soft: "bg-[hsl(var(--muted))] text-[hsl(var(--foreground))] hover:bg-[hsl(var(--secondary))]", ghost: "text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))]", outline: "border border-[hsl(var(--border))] bg-transparent hover:bg-[hsl(var(--muted))]" };
  return <button {...props} className={`inline-flex items-center justify-center gap-2 rounded-full px-4 py-2.5 text-sm font-semibold transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-50 ${styles[variant]} ${className}`}>{children}</button>;
}
function Badge({ children, tone = "green" }: { children: ReactNode; tone?: "green" | "yellow" | "coral" }) {
  const toneClass = { green: "bg-[hsl(158_42%_30%/.1)] text-[hsl(var(--primary))]", yellow: "bg-[hsl(43_84%_67%/.24)] text-[hsl(158_30%_19%)]", coral: "bg-[hsl(13_58%_65%/.17)] text-[hsl(13_55%_38%)]" };
  return <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-[.12em] ${toneClass[tone]}`}>{children}</span>;
}

function PublicHeader() {
  return <header className="absolute inset-x-0 top-0 z-10 flex items-center justify-between px-5 py-5 sm:px-10">
    <Link href="/" className="flex items-center gap-2.5 text-[hsl(var(--sidebar))]" data-testid="link-brand"><IconLogo small /><span className="font-display text-2xl">EcoPulse</span></Link>
    <nav className="flex items-center gap-2"><Link href="/materials" className="hidden rounded-full px-4 py-2 text-sm font-semibold text-[hsl(var(--primary))] hover:bg-[hsl(var(--muted))] sm:inline-flex" data-testid="link-materials">Materiales</Link><Link href="/faq" className="hidden rounded-full px-4 py-2 text-sm font-semibold text-[hsl(var(--primary))] hover:bg-[hsl(var(--muted))] md:inline-flex" data-testid="link-faq">Preguntas</Link><Link href="/sign-in" className="rounded-full px-4 py-2 text-sm font-semibold text-[hsl(var(--primary))] hover:bg-[hsl(var(--muted))]" data-testid="link-sign-in">Iniciar sesión</Link><Link href="/sign-up" className="rounded-full bg-[hsl(var(--primary))] px-4 py-2.5 text-sm font-semibold text-[hsl(var(--primary-foreground))]" data-testid="link-sign-up">Crear cuenta <ArrowRight size={15} /></Link></nav>
  </header>;
}
function Landing() {
  return <main className="min-h-[100dvh] overflow-hidden bg-[hsl(var(--background))]">
    <PublicHeader />
    <section className="relative mx-auto grid min-h-[730px] max-w-7xl items-center gap-10 px-5 pb-16 pt-32 sm:px-10 lg:grid-cols-[1.05fr_.95fr] lg:pt-24">
      <div className="relative z-[1] max-w-2xl animate-rise"><Badge tone="yellow"><Sparkles size={13} /> Tu impacto, en movimiento</Badge><h1 className="mt-6 font-display text-6xl leading-[.95] tracking-[-.045em] text-[hsl(var(--primary))] sm:text-7xl lg:text-8xl">Pequeños gestos.<br /><em className="text-[hsl(var(--accent))]">Gran pulso.</em></h1><p className="mt-7 max-w-lg text-lg leading-relaxed text-[hsl(var(--muted-foreground))]">EcoPulse convierte lo que separas cada día en una historia que puedes ver, celebrar y compartir.</p><div className="mt-9 flex flex-wrap gap-3"><Link href="/sign-up" className="inline-flex items-center gap-2 rounded-full bg-[hsl(var(--primary))] px-6 py-3.5 font-semibold text-[hsl(var(--primary-foreground))] transition hover:-translate-y-1" data-testid="link-landing-start">Empieza tu pulso <ArrowRight size={17} /></Link><Link href="/sign-in" className="inline-flex items-center gap-2 rounded-full border border-[hsl(var(--border))] px-6 py-3.5 font-semibold text-[hsl(var(--primary))]" data-testid="link-landing-login">Ya tengo cuenta</Link><Link href="/materials" className="inline-flex items-center gap-2 rounded-full border border-[hsl(var(--border))] px-6 py-3.5 font-semibold text-[hsl(var(--primary))]" data-testid="link-landing-materials"><BookOpen size={17} /> Materiales y guías</Link></div><div className="mt-12 flex items-center gap-8 text-sm text-[hsl(var(--muted-foreground))]"><span><strong className="text-2xl text-[hsl(var(--primary))]">Real</strong><br />aprendizaje con fuentes y guías</span><span className="h-10 w-px bg-[hsl(var(--border))]" /><span><strong className="text-2xl text-[hsl(var(--primary))]">Honesto</strong><br />sin premios ni convenios que no existan</span></div></div>
      <div className="relative flex min-h-[420px] items-center justify-center animate-rise [animation-delay:.12s]"><div className="absolute h-[390px] w-[390px] rounded-full bg-[hsl(var(--secondary)/.26)] blur-3xl" /><div className="relative h-[340px] w-[280px] rotate-[-7deg] rounded-[48%_52%_44%_56%] bg-[hsl(var(--primary))] p-7 shadow-[18px_25px_0_hsl(158_25%_23%/.14)]"><div className="absolute -right-12 top-10 h-28 w-28 rounded-full border-[18px] border-[hsl(var(--accent))] bg-[hsl(var(--background))]" /><div className="flex h-full flex-col justify-between rounded-[40%_45%_36%_50%] border border-[hsl(var(--primary-foreground)/.2)] p-6"><div className="flex justify-between text-[hsl(var(--primary-foreground)/.7)]"><Leaf size={26} /><span className="text-xs font-bold uppercase tracking-widest">EP / 01</span></div><div><p className="text-sm text-[hsl(var(--primary-foreground)/.7)]">Tu pulso</p><p className="font-display text-5xl text-[hsl(var(--secondary))]">Pulso</p><p className="text-sm font-semibold text-[hsl(var(--primary-foreground))]">Progreso real</p></div><div className="flex items-center justify-between text-xs text-[hsl(var(--primary-foreground)/.75)]"><span>EcoXP por escaneo</span><span>Referencias educativas</span></div></div></div><div className="absolute bottom-4 left-0 rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card)/.9)] p-4 shadow-xl backdrop-blur sm:left-8"><div className="flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-xl bg-[hsl(var(--accent)/.18)] text-[hsl(var(--accent))]"><Recycle size={21} /></span><div><p className="text-xs text-[hsl(var(--muted-foreground))]">Cada gesto</p><p className="font-semibold">Suma a tu aprendizaje</p></div></div></div></div>
    </section>
    <section className="border-y border-[hsl(var(--border))] bg-[hsl(var(--card)/.65)] px-5 py-10 sm:px-10"><div className="mx-auto flex max-w-7xl flex-col justify-between gap-5 sm:flex-row sm:items-center"><p className="font-display text-3xl text-[hsl(var(--primary))]">Una brújula para lo cotidiano.</p><p className="max-w-md text-sm leading-relaxed text-[hsl(var(--muted-foreground))]">Identifica. Separa. Repite. La claridad que necesitas, justo cuando tienes una cosa en la mano.</p></div></section>
    <section className="mx-auto max-w-7xl px-5 py-20 sm:px-10"><div className="max-w-2xl"><p className="text-xs font-bold uppercase tracking-[.18em] text-[hsl(var(--accent))]">Cómo funciona</p><h2 className="mt-3 font-display text-4xl leading-none tracking-[-.03em] text-[hsl(var(--primary))] sm:text-5xl">Tres gestos, todos verificables.</h2><p className="mt-3 text-[hsl(var(--muted-foreground))]">Sin pasos decorativos: cada botón hace lo que dice o explica por qué todavía no puede hacerlo.</p></div><div className="mt-10 grid gap-5 md:grid-cols-3"><Feature icon={<Camera />} number="01" title="Registra lo que separas" text="Clasifica el material y recibe la guía de separación al instante." /><Feature icon={<Target />} number="02" title="Hazlo visible" text="Prepara tu material y aprende los pasos de una entrega responsable, con lo que exige cada lugar." /><Feature icon={<MapPin />} number="03" title="Encuentra tu lugar" text="Explora un mapa con referencias ilustrativas y aprende a ubicar dónde entregar." /></div></section>
    <section className="border-y border-[hsl(var(--border))] bg-[hsl(var(--card)/.55)] px-5 py-20 sm:px-10"><div className="mx-auto grid max-w-7xl gap-10 lg:grid-cols-[1fr_1fr] lg:items-center"><div><p className="text-xs font-bold uppercase tracking-[.18em] text-[hsl(var(--accent))]">Biblioteca abierta</p><h2 className="mt-3 font-display text-4xl leading-none tracking-[-.03em] text-[hsl(var(--primary))] sm:text-5xl">Materiales y guías, sin registro.</h2><p className="mt-3 max-w-lg leading-relaxed text-[hsl(var(--muted-foreground))]">Busca con el nombre cotidiano y consulta qué entregar, cómo prepararlo y qué requiere manejo especial: pilas, medicamentos, lámparas, cortopunzantes y más.</p><Link href="/materials" className="mt-6 inline-flex items-center gap-2 rounded-full bg-[hsl(var(--primary))] px-6 py-3.5 font-semibold text-[hsl(var(--primary-foreground))] transition hover:-translate-y-1" data-testid="link-landing-library">Explorar la biblioteca <ArrowRight size={17} /></Link></div><div className="rounded-[2rem] border border-[hsl(var(--border))] bg-[hsl(var(--background))] p-6 sm:p-7"><p className="text-sm font-semibold text-[hsl(var(--primary))]">Prueba una búsqueda</p><div className="mt-4 flex flex-wrap gap-2">{["botella de gaseosa", "cartón", "icopor", "lata", "pilas", "medicamentos"].map((term) => <Link key={term} href={`/materials?q=${encodeURIComponent(term)}`} className="rounded-full border border-[hsl(var(--border))] px-4 py-2 text-sm font-semibold text-[hsl(var(--primary))] transition hover:bg-[hsl(var(--muted))]" data-testid={`link-landing-term-${term.split(" ")[0]}`}>{term}</Link>)}</div><p className="mt-5 text-xs leading-relaxed text-[hsl(var(--muted-foreground))]">Cada ficha indica fuente, fecha de revisión y precauciones. No afirma que un centro cercano reciba el material.</p></div></div></section>
    <section className="mx-auto max-w-7xl px-5 py-20 sm:px-10"><div className="grid gap-6 rounded-[2rem] bg-[hsl(var(--primary))] p-8 text-[hsl(var(--primary-foreground))] sm:p-10 lg:grid-cols-[1.1fr_.9fr] lg:items-center"><div><p className="text-xs font-bold uppercase tracking-[.18em] text-[hsl(var(--secondary))]">Qué puedes hacer hoy</p><h2 className="mt-3 font-display text-4xl leading-none tracking-[-.03em]">Montería, Córdoba.</h2><p className="mt-4 max-w-xl leading-relaxed text-[hsl(var(--primary-foreground)/.75)]">EcoPulse funciona al completo como plataforma educativa: biblioteca de materiales, guías de separación y un mapa con 8 referencias ilustrativas para practicar. No publicamos direcciones, horarios ni convenios que no existan.</p></div><ul className="space-y-3 text-sm"><li className="flex items-start gap-3 rounded-2xl bg-[hsl(var(--primary-foreground)/.08)] p-4"><BookOpen size={18} className="mt-0.5 shrink-0 text-[hsl(var(--secondary))]" />Biblioteca y fichas gratuitas para cualquier visitante.</li><li className="flex items-start gap-3 rounded-2xl bg-[hsl(var(--primary-foreground)/.08)] p-4"><MapPin size={18} className="mt-0.5 shrink-0 text-[hsl(var(--secondary))]" />Mapa con 8 referencias ilustrativas de Montería para practicar la búsqueda.</li><li className="flex items-start gap-3 rounded-2xl bg-[hsl(var(--primary-foreground)/.08)] p-4"><Trophy size={18} className="mt-0.5 shrink-0 text-[hsl(var(--secondary))]" />Tu progreso (EcoXP, insignias y racha) se calcula desde tus escaneos reales.</li></ul></div></section>
    <section className="border-y border-[hsl(var(--border))] bg-[hsl(var(--card)/.55)] px-5 py-20 sm:px-10"><div className="mx-auto max-w-4xl"><p className="text-xs font-bold uppercase tracking-[.18em] text-[hsl(var(--accent))]">Dudas comunes</p><h2 className="mt-3 font-display text-4xl leading-none tracking-[-.03em] text-[hsl(var(--primary))] sm:text-5xl">Preguntas frecuentes.</h2><div className="mt-8 space-y-3">{landingFaq.map((item) => <details key={item.q} className="group rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--background))] p-5"><summary className="flex cursor-pointer items-center justify-between gap-4 font-semibold text-[hsl(var(--primary))]">{item.q}<CircleHelp size={18} className="shrink-0 text-[hsl(var(--accent))]" /></summary><p className="mt-3 text-sm leading-relaxed text-[hsl(var(--muted-foreground))]">{item.a}</p></details>)}</div><Link href="/faq" className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-[hsl(var(--primary))]" data-testid="link-landing-faq">Ver todas las preguntas <ArrowRight size={15} /></Link></div></section>
    <footer className="mx-auto max-w-7xl px-5 py-12 sm:px-10"><div className="flex flex-col justify-between gap-8 border-t border-[hsl(var(--border))] pt-10 sm:flex-row"><div className="max-w-xs"><span className="font-display text-2xl text-[hsl(var(--primary))]">EcoPulse</span><p className="mt-3 text-sm leading-relaxed text-[hsl(var(--muted-foreground))]">Hecho para que volver a intentarlo se sienta bien. Información educativa honesta, sin promesas imposibles.</p></div><div className="grid grid-cols-2 gap-8 text-sm"><div><p className="font-semibold text-[hsl(var(--primary))]">Explorar</p><nav className="mt-3 flex flex-col gap-2 text-[hsl(var(--muted-foreground))]">{publicFooterLinks.map((link) => <Link key={link.href} href={link.href} className="hover:text-[hsl(var(--primary))]">{link.label}</Link>)}</nav></div><div><p className="font-semibold text-[hsl(var(--primary))]">Tu cuenta</p><nav className="mt-3 flex flex-col gap-2 text-[hsl(var(--muted-foreground))]"><Link href="/sign-in" className="hover:text-[hsl(var(--primary))]">Iniciar sesión</Link><Link href="/sign-up" className="hover:text-[hsl(var(--primary))]">Crear cuenta</Link><Link href="/privacy" className="hover:text-[hsl(var(--primary))]">Privacidad</Link><Link href="/terms" className="hover:text-[hsl(var(--primary))]">Términos</Link></nav></div></div></div></footer>
     <LandingChat />
  </main>;
}
function Feature({ icon, number, title, text }: { icon: ReactNode; number: string; title: string; text: string }) { return <article className="group rounded-3xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-7 transition hover:-translate-y-1 hover:shadow-xl"><div className="flex items-start justify-between"><span className="grid h-12 w-12 place-items-center rounded-2xl bg-[hsl(var(--secondary)/.35)] text-[hsl(var(--primary))]">{icon}</span><span className="font-mono text-xs text-[hsl(var(--muted-foreground))]">{number}</span></div><h3 className="mt-9 font-display text-3xl text-[hsl(var(--primary))]">{title}</h3><p className="mt-2 leading-relaxed text-[hsl(var(--muted-foreground))]">{text}</p></article>; }

function LandingChat() {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>(seedChat);
  const send = (content = input) => {
    if (!content.trim()) return;
    const now = "Ahora";
    setMessages((current) => [
      ...current,
      { id: `landing-u-${Date.now()}`, role: "user", content: content.trim(), timestamp: now },
      { id: `landing-a-${Date.now() + 1}`, role: "assistant", content: answer(content), timestamp: now },
    ]);
    setInput("");
  };

  return <div className="fixed bottom-5 right-5 z-40">
    {open && <div className="mb-3 w-[min(360px,calc(100vw-2.5rem))] overflow-hidden rounded-[1.75rem] border border-[hsl(var(--border))] bg-[hsl(var(--card))] shadow-2xl animate-rise" data-testid="landing-chat-panel">
      <div className="flex items-center gap-3 bg-[hsl(var(--primary))] p-4 text-[hsl(var(--primary-foreground))]">
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-[hsl(var(--secondary))] text-[hsl(var(--primary))]"><Bot size={20} /></span>
        <div className="min-w-0 flex-1"><p className="font-semibold">EcoGuía</p><p className="text-xs text-[hsl(var(--primary-foreground)/.7)]">Tu ayuda rápida para reciclar mejor</p></div>
        <button onClick={() => setOpen(false)} className="rounded-full p-1 hover:bg-[hsl(var(--primary-foreground)/.12)]" aria-label="Cerrar EcoGuía" data-testid="button-close-landing-chat"><X size={17} /></button>
      </div>
      <div className="flex max-h-72 min-h-48 flex-col gap-3 overflow-y-auto p-4">
        {messages.map((message) => <div key={message.id} className={`max-w-[88%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${message.role === "user" ? "ml-auto rounded-tr-sm bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]" : "rounded-tl-sm bg-[hsl(var(--muted))]"}`} data-testid={`landing-chat-message-${message.id}`}>{message.content}</div>)}
      </div>
      <div className="border-t border-[hsl(var(--border))] p-3">
        <div className="mb-2 flex gap-1.5 overflow-x-auto">
          {["¿Dónde va el vidrio?", "¿Cómo gano puntos?"].map((question) => <button key={question} onClick={() => send(question)} className="whitespace-nowrap rounded-full bg-[hsl(var(--muted))] px-2.5 py-1.5 text-[11px] font-semibold text-[hsl(var(--primary))]" data-testid={`button-landing-chat-${question.slice(0, 4)}`}>{question}</button>)}
        </div>
        <form onSubmit={(event) => { event.preventDefault(); send(); }} className="flex gap-2">
          <input value={input} onChange={(event) => setInput(event.target.value)} placeholder="Escribe tu duda..." className="min-w-0 flex-1 rounded-full bg-[hsl(var(--muted))] px-3.5 py-2.5 text-sm outline-none focus:ring-2 focus:ring-[hsl(var(--ring)/.35)]" data-testid="input-landing-chat" />
          <button type="submit" className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]" aria-label="Enviar mensaje" data-testid="button-send-landing-chat"><ArrowRight size={16} /></button>
        </form>
      </div>
    </div>}
    {!open && <button onClick={() => setOpen(true)} className="group flex items-center gap-2 rounded-full bg-[hsl(var(--primary))] px-4 py-3 text-sm font-bold text-[hsl(var(--primary-foreground))] shadow-xl transition hover:-translate-y-1" data-testid="button-open-landing-chat"><span className="grid h-8 w-8 place-items-center rounded-full bg-[hsl(var(--secondary))] text-[hsl(var(--primary))]"><Bot size={17} /></span>Habla con EcoGuía</button>}
  </div>;
}

function PrivateShell({ children, userName = "Tu nombre", userEmail = "Correo no disponible", onLogout = () => undefined, role }: { children: ReactNode; userName?: string; userEmail?: string; onLogout?: () => void; role?: string }) {
  const [location, setLocation] = useLocation(); const [mobile, setMobile] = useState(false); const [showNotifications, setShowNotifications] = useState(false); const { state: pilotState } = useContext(PilotDashboardContext); const [seenStamp, setSeenStamp] = useState(0);
  useEffect(() => {
    if (!pilotState.accountId) { setSeenStamp(0); return; }
    try { const stored = Number(localStorage.getItem(`ep-activity-seen:${pilotState.accountId}`) || "0"); setSeenStamp(Number.isFinite(stored) ? stored : 0); } catch { setSeenStamp(0); }
  }, [pilotState.accountId]);
  const latestActivity = pilotState.data ? [...pilotState.data.scans, ...pilotState.data.deliveries, ...pilotState.data.redemptions].reduce((max, item) => Math.max(max, Date.parse(item.createdAt) || 0), 0) : 0;
  const hasNewActivity = latestActivity > seenStamp;
  const toggleNotifications = () => setShowNotifications(value => {
    if (!value) {
      const stamp = Date.now(); setSeenStamp(stamp);
      if (pilotState.accountId) { try { localStorage.setItem(`ep-activity-seen:${pilotState.accountId}`, String(stamp)); } catch { /* almacenamiento no disponible */ } }
    }
    return !value;
  });
  const nav = [{ href: "/dashboard", label: "Tu pulso", icon: Leaf }, { href: "/progress", label: "Mi progreso", icon: Trophy }, { href: "/scan", label: "Escanear", icon: Camera }, { href: "/materials", label: "Materiales", icon: BookOpen }, { href: "/map", label: "Puntos cercanos", icon: MapPin }, { href: "/deliveries", label: "Mis entregas", icon: PackageCheck }, { href: "/rewards", label: "Recompensas", icon: Gift }, { href: "/chat", label: "Guía Eco", icon: MessageCircle }, { href: "/profile", label: "Mi perfil", icon: UserRound }, ...(role === "admin" || role === "verifier" ? [{ href: "/admin", label: "Administración", icon: ShieldCheck }] : []), ...(role === "admin" ? [{ href: "/admin/centers", label: "Centros", icon: MapPin }, { href: "/admin/rewards", label: "Gestión recompensas", icon: Gift }] : [])];
   return <div className="min-h-[100dvh] bg-[hsl(var(--background))]"><aside className={`fixed inset-y-0 left-0 z-30 flex w-72 flex-col bg-[hsl(var(--sidebar))] p-6 text-[hsl(var(--sidebar-foreground))] transition-transform md:translate-x-0 ${mobile ? "translate-x-0" : "-translate-x-full"}`}><div className="flex items-center justify-between"><Link href="/dashboard" className="flex items-center gap-2.5" data-testid="link-sidebar-brand"><IconLogo small /><span className="font-display text-2xl">EcoPulse</span></Link><button onClick={() => setMobile(false)} className="md:hidden" data-testid="button-close-menu"><X size={20} /></button></div><div className="mt-12 rounded-2xl bg-[hsl(var(--sidebar-accent))] p-4"><div className="flex items-center gap-3"><div className="grid h-10 w-10 place-items-center rounded-full bg-[hsl(var(--secondary))] font-bold text-[hsl(var(--primary))]">{userName.slice(0, 1)}</div><div className="min-w-0"><p className="truncate font-semibold">{userName}</p><p className="truncate text-xs text-[hsl(var(--sidebar-foreground)/.58)]">{userEmail}</p></div></div></div><nav className="mt-8 space-y-1">{nav.map(({ href, label, icon: I }) => <Link key={href} href={href} onClick={() => setMobile(false)} className={`flex items-center gap-3 rounded-2xl px-4 py-3 text-sm font-semibold transition ${location === href ? "bg-[hsl(var(--sidebar-primary))] text-[hsl(var(--sidebar-primary-foreground))]" : "text-[hsl(var(--sidebar-foreground)/.68)] hover:bg-[hsl(var(--sidebar-accent))] hover:text-[hsl(var(--sidebar-foreground))]"}`} data-testid={`link-nav-${label.toLowerCase().replaceAll(" ","-")}`}><I size={18} />{label}</Link>)}</nav><div className="mt-auto space-y-1"><Link href="/security" className="flex items-center gap-3 rounded-2xl px-4 py-3 text-sm font-semibold text-[hsl(var(--sidebar-foreground)/.68)] hover:bg-[hsl(var(--sidebar-accent))]" data-testid="link-nav-seguridad"><ShieldCheck size={18} />Seguridad</Link><Link href="/profile" onClick={() => setMobile(false)} className="flex items-center gap-3 rounded-2xl px-4 py-3 text-sm font-semibold text-[hsl(var(--sidebar-foreground)/.68)] hover:bg-[hsl(var(--sidebar-accent))]" data-testid="link-nav-perfil"><UserRound size={18} />Mi perfil</Link><button onClick={onLogout} className="flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-sm font-semibold text-[hsl(var(--sidebar-foreground)/.68)] hover:bg-[hsl(var(--sidebar-accent))]" data-testid="button-logout"><LogOut size={18} />Cerrar sesión</button></div></aside><div className="md:pl-72"><header className="sticky top-0 z-20 flex h-20 items-center justify-between border-b border-[hsl(var(--border)/.7)] bg-[hsl(var(--background)/.86)] px-5 backdrop-blur sm:px-10"><button onClick={() => setMobile(true)} className="rounded-full p-2 md:hidden" data-testid="button-open-menu"><Menu size={22} /></button><div className="hidden text-sm text-[hsl(var(--muted-foreground))] md:block">{location === "/dashboard" ? "Datos protegidos" : "Tu espacio EcoPulse"}</div><div className="ml-auto flex items-center gap-3"><div className="relative"><button onClick={toggleNotifications} className="relative rounded-full p-2 text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]" aria-label="Actividad reciente" data-testid="button-notifications"><Bell size={19} />{hasNewActivity && <i className="absolute right-1 top-1 h-2 w-2 rounded-full bg-[hsl(var(--accent))]" aria-hidden="true" />}</button>{showNotifications && <NotificationsPanel state={pilotState} onClose={toggleNotifications} />}</div><div className="hidden h-8 w-px bg-[hsl(var(--border))] sm:block" /><div className="hidden text-right sm:block"><p className="text-sm font-semibold">{userName}</p><p className="text-xs text-[hsl(var(--muted-foreground))]">{userEmail}</p></div><div className="grid h-9 w-9 place-items-center rounded-full bg-[hsl(var(--primary))] text-sm font-bold text-[hsl(var(--primary-foreground))]">{userName.slice(0, 1)}</div><button type="button" onClick={onLogout} className="rounded-full border border-[hsl(var(--border))] p-2 text-[hsl(var(--primary))] hover:bg-[hsl(var(--muted))]" aria-label="Cerrar sesión" title="Cerrar sesión" data-testid="button-logout-header"><LogOut size={18} /></button></div></header><main className="mx-auto max-w-7xl px-5 py-8 sm:px-10">{children}</main><footer className="mx-auto max-w-7xl px-5 pb-6 text-center text-xs text-[hsl(var(--muted-foreground))] sm:px-10" role="note">EcoPulse es una simulación universitaria; sus centros y operaciones no representan establecimientos físicos.</footer></div>{mobile && <button className="fixed inset-0 z-20 bg-[hsl(var(--sidebar)/.35)] md:hidden" onClick={() => setMobile(false)} aria-label="Cerrar menú" data-testid="button-overlay-menu" />}</div>;
}
function PageTitle({ eyebrow, title, copy, action }: { eyebrow: string; title: string; copy: string; action?: ReactNode }) { return <div className="mb-8 flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><p className="text-xs font-bold uppercase tracking-[.18em] text-[hsl(var(--accent))]">{eyebrow}</p><h1 className="mt-2 font-display text-5xl leading-none tracking-[-.03em] text-[hsl(var(--primary))]">{title}</h1><p className="mt-3 max-w-xl text-[hsl(var(--muted-foreground))]">{copy}</p></div>{action}</div>; }
function formatPilotDate(value: string) { const date = new Date(value); return Number.isNaN(date.valueOf()) ? "Fecha no disponible" : new Intl.DateTimeFormat("es-CO", { dateStyle: "medium", timeStyle: "short" }).format(date); }
const categoryLabels: Record<string, string> = { paper: "Papel", plastic: "Plástico", glass: "Vidrio", metal: "Metal", organic: "Orgánico", other: "Otro" };
const deliveryStatusLabels: Record<string, string> = { pending: "Pendiente", scheduled: "Programada", received: "Recibida, por verificar", approved: "Verificada", rejected: "Rechazada", cancelled: "Cancelada" };
function Dashboard() {
  const { user } = useUser(); const userName = getDisplayName(user); const userEmail = getUserEmail(user);
  const { state, retry } = useContext(PilotDashboardContext);
  const { getToken } = useAuth();
  const [progress, setProgress] = useState<PilotProgress | null>(null);
  const [progressStatus, setProgressStatus] = useState<"loading" | "ready" | "error">("loading");
  useEffect(() => {
    if (state.status !== "ready") { setProgress(null); return; }
    const controller = new AbortController();
    setProgressStatus("loading");
    void (async () => {
      try {
        const token = await getToken();
        if (!token) throw new Error("missing_session_token");
        const result = await loadPilotProgress(pilotApiUrl, token, controller.signal);
        if (!controller.signal.aborted) { setProgress(result); setProgressStatus("ready"); }
      } catch { if (!controller.signal.aborted) setProgressStatus("error"); }
    })();
    return () => controller.abort();
  }, [getToken, state.status, state.data]);
  const action = <div className="flex flex-wrap gap-2"><Button variant="outline" onClick={retry} disabled={state.status === "loading"} data-testid="button-refresh-dashboard"><Clock3 size={16} /> Actualizar</Button><Link href="/scan" className="inline-flex items-center gap-2 rounded-full bg-[hsl(var(--primary))] px-5 py-3 font-semibold text-[hsl(var(--primary-foreground))]" data-testid="link-dashboard-scan"><Camera size={17} /> Escanear residuo</Link></div>;
  if (state.status === "error") return <div className="animate-rise"><PageTitle eyebrow="Datos protegidos" title={`Hola, ${userName}.`} copy={userEmail} action={action} /><section className="rounded-[2rem] border border-[hsl(var(--accent)/.45)] bg-[hsl(var(--card))] p-8 text-center" role="alert" data-testid="dashboard-error"><CircleHelp className="mx-auto text-[hsl(var(--accent))]" size={34} /><h2 className="mt-4 font-display text-3xl text-[hsl(var(--primary))]">No pudimos cargar tu información</h2><p className="mx-auto mt-2 max-w-lg text-[hsl(var(--muted-foreground))]">{state.message}</p><Button onClick={retry} className="mt-5" data-testid="button-retry-dashboard">Intentar de nuevo</Button></section></div>;
  if (state.status !== "ready" || !state.data) return <div className="animate-rise" aria-busy="true"><PageTitle eyebrow="Datos protegidos" title={`Hola, ${userName}.`} copy="Estamos consultando tu información verificada." action={action} /><div className="grid gap-5 lg:grid-cols-[1.35fr_.65fr]">{["Entregas", "Saldo"].map((label) => <section key={label} className="h-64 animate-pulse rounded-[2rem] bg-[hsl(var(--muted))] p-7"><span className="text-sm text-[hsl(var(--muted-foreground))]">Cargando {label.toLowerCase()}…</span></section>)}</div></div>;

  const { balance, scans, deliveries, redemptions } = state.data;
  const verifiedDeliveries = deliveries.filter((delivery) => delivery.status === "approved").length;
  const pendingDeliveries = deliveries.filter((delivery) => delivery.status === "pending" || delivery.status === "scheduled" || delivery.status === "received").length;
  const categorySummary = Object.entries(scans.reduce<Record<string, number>>((summary, scan) => ({ ...summary, [scan.category]: (summary[scan.category] || 0) + 1 }), {}));
  const recentActivity = [
    ...scans.map((scan) => ({ id: `scan-${scan.id}`, date: scan.createdAt, text: `Escaneaste ${categoryLabels[scan.category] || scan.category}`, icon: Recycle })),
    ...deliveries.map((delivery) => ({ id: `delivery-${delivery.id}`, date: delivery.createdAt, text: `Entrega ${deliveryStatusLabels[delivery.status] || delivery.status}`, icon: PackageCheck })),
    ...redemptions.map((redemption) => ({ id: `redemption-${redemption.id}`, date: redemption.createdAt, text: `Canjeaste por ${redemption.cost.toLocaleString("es-CO")} pts`, icon: Gift })),
  ].sort((a, b) => Date.parse(b.date) - Date.parse(a.date)).slice(0, 6);
  const earnedBadges = progress ? progress.badges.filter((badge) => badge.earned).length : 0;
  return <div className="animate-rise" data-testid="dashboard-real-data"><PageTitle eyebrow="Tu pulso" title={`Hola, ${userName}.`} copy={`Bienvenido de vuelta a EcoPulse · ${userEmail}`} action={action} />
    <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
      <section className="rounded-[2rem] border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6"><span className="grid h-11 w-11 place-items-center rounded-2xl bg-[hsl(var(--secondary)/.32)] text-[hsl(var(--primary))]"><Trophy size={20} /></span><p className="mt-4 text-sm text-[hsl(var(--muted-foreground))]">EcoPuntos</p><p className="font-display text-4xl text-[hsl(var(--primary))]" data-testid="verified-balance">{balance.toLocaleString("es-CO")}</p><p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">Saldo verificado en PostgreSQL</p></section>
      <section className="rounded-[2rem] border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6"><span className="grid h-11 w-11 place-items-center rounded-2xl bg-[hsl(var(--secondary)/.32)] text-[hsl(var(--primary))]"><Zap size={20} /></span><p className="mt-4 text-sm text-[hsl(var(--muted-foreground))]">EcoXP</p>{progress ? <p className="font-display text-4xl text-[hsl(var(--primary))]" data-testid="dashboard-eco-xp">{progress.ecoXp.toLocaleString("es-CO")}</p> : <p className="font-display text-4xl text-[hsl(var(--muted-foreground))]">{progressStatus === "error" ? "—" : "…"}</p>}<p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">{progress ? `Nivel ${progress.level}: ${progress.levelTitle}` : progressStatus === "error" ? "No disponible por ahora" : "Calculando tu nivel…"}</p></section>
      <section className="rounded-[2rem] border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6"><span className="grid h-11 w-11 place-items-center rounded-2xl bg-[hsl(var(--secondary)/.32)] text-[hsl(var(--primary))]"><Target size={20} /></span><p className="mt-4 text-sm text-[hsl(var(--muted-foreground))]">Escaneos</p><p className="font-display text-4xl text-[hsl(var(--primary))]" data-testid="dashboard-scans-count">{scans.length}</p><p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">Clasificaciones registradas</p></section>
      <section className="rounded-[2rem] border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6"><span className="grid h-11 w-11 place-items-center rounded-2xl bg-[hsl(var(--secondary)/.32)] text-[hsl(var(--primary))]"><PackageCheck size={20} /></span><p className="mt-4 text-sm text-[hsl(var(--muted-foreground))]">Entregas verificadas</p><p className="font-display text-4xl text-[hsl(var(--primary))]" data-testid="verified-deliveries-count">{verifiedDeliveries}</p><p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">{pendingDeliveries ? `${pendingDeliveries} en curso · ` : ""}Validadas por verificadores</p></section>
    </div>
    <div className="mt-5 grid gap-5 lg:grid-cols-2">
      <section className="rounded-[2rem] border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-7" data-testid="dashboard-level-card"><div className="flex items-center justify-between"><h2 className="font-display text-2xl text-[hsl(var(--primary))]">Tu nivel</h2>{progress && <Badge>Nivel {progress.level}</Badge>}</div>{progress ? <><p className="mt-3 font-semibold">{progress.levelTitle}</p>{progress.nextLevelXp != null ? <><div className="mt-4 h-3 overflow-hidden rounded-full bg-[hsl(var(--muted))]"><div className="h-full rounded-full bg-[hsl(var(--primary))] transition-all" style={{ width: `${Math.min(100, Math.round((progress.ecoXp / progress.nextLevelXp) * 100))}%` }} /></div><p className="mt-2 text-sm text-[hsl(var(--muted-foreground))]">{progress.ecoXp.toLocaleString("es-CO")} / {progress.nextLevelXp.toLocaleString("es-CO")} XP hacia el siguiente nivel</p></> : <p className="mt-2 text-sm text-[hsl(var(--muted-foreground))]">Has alcanzado el nivel más alto disponible.</p>}<div className="mt-4 flex flex-wrap gap-3 text-sm"><span className="rounded-full bg-[hsl(var(--muted))] px-3 py-1">Racha: {progress.streakDays} día{progress.streakDays === 1 ? "" : "s"}</span><span className="rounded-full bg-[hsl(var(--muted))] px-3 py-1">Insignias: {earnedBadges} de {progress.badges.length}</span></div><Link href="/progress" className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-[hsl(var(--primary))] underline">Ver progreso completo<ArrowRight size={14} /></Link></> : progressStatus === "loading" ? <p className="mt-3 text-sm text-[hsl(var(--muted-foreground))]" role="status">Consultando tu progreso…</p> : <p className="mt-3 text-sm text-[hsl(var(--muted-foreground))]">El progreso no está disponible en este momento.</p>}</section>
      <section className="rounded-[2rem] border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-7" data-testid="dashboard-missions-card"><div className="flex items-center justify-between"><h2 className="font-display text-2xl text-[hsl(var(--primary))]">Misiones</h2><Target size={20} className="text-[hsl(var(--primary))]" /></div>{progress && progress.missions.length > 0 ? <div className="mt-4 space-y-3">{progress.missions.slice(0, 3).map((mission) => { const percent = Math.min(100, Math.round((mission.progress / mission.target) * 100)); return <div key={mission.id} className="rounded-2xl bg-[hsl(var(--muted)/.5)] p-4" data-testid={`dashboard-mission-${mission.id}`}><div className="flex items-center justify-between gap-2 text-sm"><span className="font-semibold">{mission.title}</span><span className={mission.completed ? "font-bold text-emerald-700" : "text-[hsl(var(--muted-foreground))]"}>{mission.completed ? "Completada" : `${mission.progress}/${mission.target}`}</span></div><div className="mt-2 h-2 overflow-hidden rounded-full bg-[hsl(var(--border))]"><div className={`h-full rounded-full ${mission.completed ? "bg-emerald-500" : "bg-[hsl(var(--primary))]"}`} style={{ width: `${percent}%` }} /></div></div>; })}</div> : <p className="mt-4 text-sm text-[hsl(var(--muted-foreground))]">{progressStatus === "loading" ? "Cargando misiones…" : "No hay misiones activas ahora."}</p>}<Link href="/progress" className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-[hsl(var(--primary))] underline">Ver todas las misiones<ArrowRight size={14} /></Link></section>
    </div>
    <div className="mt-5 grid gap-5 lg:grid-cols-[1.35fr_.65fr]">
      <section className="rounded-[2rem] border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-7" data-testid="dashboard-activity"><div className="flex items-center justify-between"><h2 className="font-display text-2xl text-[hsl(var(--primary))]">Actividad reciente</h2><Clock3 size={19} className="text-[hsl(var(--primary))]" /></div><div className="mt-4 divide-y divide-[hsl(var(--border))]">{recentActivity.map((item) => <div key={item.id} className="flex items-center gap-3 py-3 text-sm"><span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[hsl(var(--muted))] text-[hsl(var(--primary))]"><item.icon size={16} /></span><span className="min-w-0 flex-1">{item.text}</span><span className="shrink-0 text-xs text-[hsl(var(--muted-foreground))]">{formatPilotDate(item.date)}</span></div>)}{!recentActivity.length && <p className="py-8 text-center text-sm text-[hsl(var(--muted-foreground))]" data-testid="dashboard-empty-activity">Cuando escanees, entregues o canjees verás tu actividad aquí.</p>}</div></section>
      <section className="rounded-[2rem] border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-7" data-testid="dashboard-quick-links"><h2 className="font-display text-2xl text-[hsl(var(--primary))]">Accesos rápidos</h2><div className="mt-4 grid gap-2">{[{ href: "/scan", label: "Escanear residuo", icon: Camera }, { href: "/map", label: "Ver puntos cercanos", icon: MapPin }, { href: "/deliveries", label: "Mis entregas", icon: PackageCheck }, { href: "/rewards", label: "Recompensas", icon: Gift }, { href: "/chat", label: "Guía Eco", icon: MessageCircle }, { href: "/materials", label: "Biblioteca de materiales", icon: BookOpen }].map(({ href, label, icon: Icon }) => <Link key={href} href={href} className="flex min-h-11 items-center gap-3 rounded-2xl border border-[hsl(var(--border))] px-4 py-2.5 text-sm font-semibold transition hover:border-[hsl(var(--primary))] hover:bg-[hsl(var(--muted)/.4)]"><Icon size={17} className="text-[hsl(var(--primary))]" />{label}</Link>)}</div></section>
    </div>
    <div className="mt-5 grid gap-5 lg:grid-cols-2">
      <section className="rounded-[2rem] bg-[hsl(var(--primary))] p-7 text-[hsl(var(--primary-foreground))]"><div className="flex items-center justify-between"><h2 className="font-display text-2xl">Tu impacto</h2><Leaf size={20} className="text-[hsl(var(--secondary))]" /></div><div className="mt-4 grid grid-cols-3 gap-3 text-center"><div className="rounded-2xl bg-[hsl(var(--primary-foreground)/.12)] p-3"><p className="font-display text-3xl text-[hsl(var(--secondary))]">{scans.length}</p><p className="mt-1 text-xs opacity-80">Escaneos</p></div><div className="rounded-2xl bg-[hsl(var(--primary-foreground)/.12)] p-3"><p className="font-display text-3xl text-[hsl(var(--secondary))]">{deliveries.length}</p><p className="mt-1 text-xs opacity-80">Entregas</p></div><div className="rounded-2xl bg-[hsl(var(--primary-foreground)/.12)] p-3"><p className="font-display text-3xl text-[hsl(var(--secondary))]">{redemptions.length}</p><p className="mt-1 text-xs opacity-80">Canjes</p></div></div><p className="mt-4 text-sm text-[hsl(var(--primary-foreground)/.75)]">{categorySummary.length ? `Materiales clasificados: ${categorySummary.map(([key, value]) => `${value} ${categoryLabels[key] || key}`).join(" · ")}` : "Escanea tu primer residuo para iniciar tu impacto."}</p></section>
      <section className="rounded-[2rem] border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-7"><div className="flex items-center justify-between"><h2 className="font-display text-2xl text-[hsl(var(--primary))]">Recompensas</h2><Gift size={20} className="text-[hsl(var(--primary))]" /></div>{redemptions.length > 0 ? <div className="mt-4 space-y-2">{redemptions.slice(0, 3).map((redemption) => <div key={redemption.id} className="flex items-center justify-between rounded-2xl bg-[hsl(var(--muted)/.65)] px-4 py-3 text-sm" data-testid={`row-redemption-${redemption.id}`}><span>Canje confirmado · {formatPilotDate(redemption.createdAt)}</span><span className="font-semibold text-[hsl(var(--primary))]">-{redemption.cost.toLocaleString("es-CO")} pts</span></div>)}</div> : <p className="mt-4 text-sm text-[hsl(var(--muted-foreground))]" data-testid="empty-redemptions">Aún no tienes canjes. Explora el catálogo de recompensas cuando tengas saldo.</p>}<Link href="/rewards" className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-[hsl(var(--primary))] underline">Ver recompensas<ArrowRight size={14} /></Link></section>
    </div>
  </div>;
}

function DeliveriesPage() {
  const { state, retry } = useContext(PilotDashboardContext);
  const deliveries = state.data?.deliveries ?? [];
  const role = state.data?.role ?? "";
  return <div className="animate-rise">
    <PageTitle eyebrow="Ciclo de reciclaje" title="Mis entregas" copy="Registra solicitudes de entrega física y consulta su estado. La recepción y verificación ocurren en un centro autorizado; sin verificación física no hay puntos." action={<div className="flex flex-wrap gap-2"><Link href="/map" className="inline-flex items-center gap-2 rounded-full border border-[hsl(var(--border))] px-5 py-3 font-semibold text-[hsl(var(--primary))]" data-testid="link-deliveries-map"><MapPin size={16} /> Ver puntos en el mapa</Link><Link href="/rewards" className="inline-flex items-center gap-2 rounded-full bg-[hsl(var(--primary))] px-5 py-3 font-semibold text-[hsl(var(--primary-foreground))]" data-testid="link-deliveries-rewards"><Gift size={16} /> Ver recompensas</Link></div>} />
    {!state.data && state.status === "loading" && <p role="status" className="rounded-2xl bg-[hsl(var(--muted))] p-5">Cargando entregas…</p>}
    {state.status === "error" && <div role="alert" className="rounded-2xl border border-[hsl(var(--border))] p-4">No se pudo cargar la información de entregas. <button type="button" onClick={retry} className="underline">Reintentar</button></div>}
    {state.data && <Suspense fallback={<p role="status">Cargando panel de entregas…</p>}><DeliveryPanel deliveries={deliveries} role={role} onRefresh={retry} showVerifierQueue={false} /></Suspense>}
  </div>;
}

function AdminHomePage() {
  const { state, retry } = useContext(PilotDashboardContext);
  const role = state.data?.role ?? "";
  const authorized = role === "admin" || role === "verifier";
  if (!authorized) return <div className="animate-rise"><PageTitle eyebrow="Acceso restringido" title="Administración" copy="Esta sección requiere una cuenta con rol de administrador o verificador verificado en EcoPulse." /><p className="rounded-[2rem] border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6 text-sm" role="alert" data-testid="admin-restricted">No tienes permisos para ver el panel de administración.</p></div>;
  return <div className="animate-rise">
    <PageTitle eyebrow="Operación" title="Administración" copy="Recepción y verificación física de entregas, catálogo de centros y gestión de recompensas. Toda decisión debe respaldar un acto físico real." />
    {role === "admin" && <div className="grid gap-4 sm:grid-cols-2"><Link href="/admin/centers" className="flex items-center gap-3 rounded-[2rem] border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6 font-semibold transition hover:border-[hsl(var(--primary))]" data-testid="link-admin-centers"><MapPin size={20} className="text-[hsl(var(--primary))]" />Catálogo de centros</Link><Link href="/admin/rewards" className="flex items-center gap-3 rounded-[2rem] border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6 font-semibold transition hover:border-[hsl(var(--primary))]" data-testid="link-admin-rewards"><Gift size={20} className="text-[hsl(var(--primary))]" />Gestión de recompensas</Link></div>}
    <div className="mt-5"><Suspense fallback={<p role="status">Cargando cola de verificación…</p>}><VerifierQueue role={role} onRefresh={retry} /></Suspense></div>
  </div>;
}

function ScanPage() {
  const [manualCategory, setManualCategory] = useState<ManualScanCategory>("paper");
  const [manualStatus, setManualStatus] = useState<"idle" | "submitting" | "success" | "error">("idle");
  const [manualMessage, setManualMessage] = useState("");
  const manualIdempotencyKey = useRef<string | null>(null);
  const manualSubmitInFlight = useRef(false);
  const manualController = useRef<AbortController | null>(null);
  const { getToken } = useAuth();
  const { state, retry } = useContext(PilotDashboardContext);
  const realScans = state.data?.scans ?? [];
  const guidance = manualScanGuidance[manualCategory];

  useEffect(() => () => {
    manualController.current?.abort();
  }, []);

  const chooseManualCategory = (value: ManualScanCategory) => {
    setManualCategory(value);
    setManualStatus("idle");
    setManualMessage("");
    manualIdempotencyKey.current = null;
  };
  const submitManualScan = async (event: FormEvent) => {
    event.preventDefault();
    if (manualSubmitInFlight.current) return;
    manualSubmitInFlight.current = true;
    setManualStatus("submitting");
    setManualMessage("");
    const controller = new AbortController();
    manualController.current = controller;
    try {
      const token = await getToken();
      if (!token) throw new PilotApiError(401, "missing_session_token");
      const operationKey = manualIdempotencyKey.current ?? `scan_${crypto.randomUUID()}`;
      manualIdempotencyKey.current = operationKey;
      await createPilotScan(pilotApiUrl, token, manualCategory, operationKey, controller.signal);
      manualIdempotencyKey.current = null;
      setManualStatus("success");
      setManualMessage(`${guidance.label} quedó registrado como clasificación manual, sin puntos ni entrega física.`);
      retry();
    } catch (error) {
      if (controller.signal.aborted) return;
      const status = error instanceof PilotApiError ? error.status : 0;
      setManualStatus("error");
      setManualMessage(status === 401 ? "Tu sesión venció. Vuelve a iniciar sesión." : status === 400 ? "La categoría o la clave de operación no son válidas." : status === 429 ? "Alcanzaste el límite temporal de registros. Espera un minuto e inténtalo de nuevo." : "No pudimos guardar el registro. Puedes reintentar sin crear duplicados.");
    } finally {
      manualSubmitInFlight.current = false;
      if (manualController.current === controller) manualController.current = null;
    }
  };

  return <div className="animate-rise">
    <PageTitle eyebrow="Registro responsable" title="Clasifica antes de entregar." copy="Registra manualmente el tipo de residuo. Este registro orienta la separación, no certifica una entrega ni genera puntos." />
    <div className="grid gap-5 lg:grid-cols-[.9fr_1.1fr]">
      <form onSubmit={submitManualScan} className="rounded-[2rem] border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6 sm:p-8" data-testid="form-manual-scan">
        <div className="flex items-center justify-between gap-3"><div><Badge>Registro real</Badge><h2 className="mt-4 font-display text-3xl text-[hsl(var(--primary))]">Clasificación manual</h2></div><span className="grid h-12 w-12 place-items-center rounded-2xl bg-[hsl(var(--secondary)/.3)] text-[hsl(var(--primary))]"><Recycle size={23} /></span></div>
        <label className="mt-7 block text-sm font-semibold text-[hsl(var(--primary))]" htmlFor="manual-scan-category">Categoría del residuo</label>
        <select id="manual-scan-category" value={manualCategory} onChange={(event) => chooseManualCategory(event.target.value as ManualScanCategory)} className="mt-2 w-full rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-4 py-3 outline-none focus:ring-2 focus:ring-[hsl(var(--ring)/.4)]" data-testid="select-manual-category">
          {manualScanCategories.map((category) => <option key={category} value={category}>{manualScanGuidance[category].label}</option>)}
        </select>
        <div className="mt-5 rounded-2xl bg-[hsl(var(--muted)/.7)] p-5" data-testid="manual-guidance"><p className="text-xs font-bold uppercase tracking-[.15em] text-[hsl(var(--muted-foreground))]">{guidance.container}</p><p className="mt-2 text-sm leading-relaxed">{guidance.instructions}</p><p className="mt-3 text-xs text-[hsl(var(--muted-foreground))]">Guía basada en {colombianSeparationReference}. Confirma condiciones con tu prestador local.</p></div>
        <div className="mt-5 rounded-2xl border border-[hsl(var(--border))] p-5" data-testid="scan-next-steps">
          <p className="text-sm font-semibold text-[hsl(var(--primary))]">Continúa el recorrido</p>
          <p className="mt-1 text-xs leading-relaxed text-[hsl(var(--muted-foreground))]">Revisa la ficha completa del material o busca un centro publicado. Si todavía no hay centros activos, verás un estado vacío honesto, no uno inventado.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Link href={`/materials?category=${materialCategoryByScan[manualCategory]}`} className="inline-flex items-center gap-2 rounded-full bg-[hsl(var(--primary))] px-4 py-2.5 text-sm font-semibold text-[hsl(var(--primary-foreground))]" data-testid="link-scan-guide"><BookOpen size={16} /> Consultar guía</Link>
            <Link href={`/map?material=${manualCategory}`} className="inline-flex items-center gap-2 rounded-full border border-[hsl(var(--border))] px-4 py-2.5 text-sm font-semibold text-[hsl(var(--primary))]" data-testid="link-scan-map"><MapPin size={16} /> Buscar dónde entregarlo</Link>
            <Link href="/chat" className="inline-flex items-center gap-2 rounded-full border border-[hsl(var(--border))] px-4 py-2.5 text-sm font-semibold text-[hsl(var(--primary))]" data-testid="link-scan-chat"><MessageCircle size={16} /> Preguntar a EcoGuía</Link>
          </div>
        </div>
        <div className="mt-5 rounded-2xl border border-[hsl(var(--accent)/.35)] p-4 text-sm"><strong>Antes de confirmar:</strong> se guardarán categoría, origen manual y fecha. No se enviará ninguna fotografía.</div>
        {manualStatus === "success" && <p className="mt-4 rounded-2xl bg-emerald-50 p-4 text-sm text-emerald-800" role="status" data-testid="manual-scan-success">{manualMessage}</p>}
        {manualStatus === "error" && <p className="mt-4 rounded-2xl bg-red-50 p-4 text-sm text-red-800" role="alert" data-testid="manual-scan-error">{manualMessage}</p>}
        <Button type="submit" disabled={manualStatus === "submitting"} className="mt-5 w-full" data-testid="button-submit-manual-scan">{manualStatus === "submitting" ? "Guardando…" : manualStatus === "error" ? "Reintentar registro" : "Confirmar y registrar"}</Button>
      </form>

      <section className="rounded-[2rem] border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6 sm:p-8" data-testid="real-scan-history"><div className="flex flex-wrap items-center justify-between gap-3"><div><Badge>PostgreSQL</Badge><h2 className="mt-4 font-display text-3xl text-[hsl(var(--primary))]">Historial real</h2></div><Button type="button" variant="outline" onClick={retry} disabled={state.status === "loading"} data-testid="button-retry-scans"><Clock3 size={16} /> Actualizar</Button></div>
        {state.status === "loading" && <p className="mt-6 animate-pulse rounded-2xl bg-[hsl(var(--muted))] p-5 text-sm" aria-busy="true">Cargando registros protegidos…</p>}
        {state.status === "error" && <div className="mt-6 rounded-2xl bg-red-50 p-5 text-sm text-red-800" role="alert"><p>No pudimos consultar el historial.</p><Button type="button" variant="outline" onClick={retry} className="mt-3" data-testid="button-retry-scan-history">Intentar de nuevo</Button></div>}
        {state.status === "ready" && <div className="mt-5 divide-y divide-[hsl(var(--border))]">{realScans.map((scan) => <article key={scan.id} className="flex items-center gap-3 py-4" data-testid={`real-scan-${scan.id}`}><span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[hsl(var(--muted))] text-[hsl(var(--primary))]"><Recycle size={18} /></span><div className="min-w-0 flex-1"><p className="font-semibold">{categoryLabels[scan.category] || scan.category}</p><p className="text-xs text-[hsl(var(--muted-foreground))]">{formatPilotDate(scan.createdAt)} · Origen manual</p></div><span className="text-xs font-semibold text-[hsl(var(--muted-foreground))]">Sin puntos</span></article>)}{!realScans.length && <p className="py-12 text-center text-sm text-[hsl(var(--muted-foreground))]" data-testid="empty-real-scan-history">Aún no tienes clasificaciones manuales persistentes.</p>}</div>}
      </section>
    </div>

    {clerkKey && <Suspense fallback={<p role="status">Cargando módulo de escaneo…</p>}><AiScanPanel apiUrl={pilotApiUrl} onCategory={chooseManualCategory} onSaved={retry} /></Suspense>}
  </div>;
}

function MapPage({ initialMaterial = "" }: { initialMaterial?: string }) {
  const { getToken, userId } = useAuth();
  const [points, setPoints] = useState<PilotDeliveryOptions["points"]>([]);
  const [evaluationPoints, setEvaluationPoints] = useState<EvaluationPoint[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setStatus("loading");
    setPoints([]);
    setEvaluationPoints([]);
    void (async () => {
      try {
        const token = await getToken();
        if (!token || !userId) throw new Error("missing_session_token");
        // The same PostgreSQL catalog drives the map and the delivery form.
        const [options, evaluation] = await Promise.all([
          loadPilotDeliveryOptions(pilotApiUrl, token, controller.signal),
          loadEvaluationPoints(pilotApiUrl, token, controller.signal).catch(() => [] as EvaluationPoint[]),
        ]);
        if (!controller.signal.aborted) { setPoints(options.points); setEvaluationPoints(evaluation); setStatus("ready"); }
      } catch {
        if (!controller.signal.aborted) setStatus("error");
      }
    })();
    return () => controller.abort();
  }, [getToken, userId, retry]);

  return <div className="animate-rise">
    <PageTitle eyebrow="Mapa" title="Centros de reciclaje" copy="Encuentra materiales, horarios y cupos disponibles para tu entrega." action={<Link href="/deliveries" className="inline-flex items-center gap-2 rounded-full bg-[hsl(var(--primary))] px-5 py-3 font-semibold text-[hsl(var(--primary-foreground))]" data-testid="link-map-deliveries"><PackageCheck size={16} /> Solicitar entrega</Link>} />
    {status === "loading" && <p role="status" className="mb-4">Consultando el mapa…</p>}
    {status === "error" && <div role="alert" className="mb-4 rounded-2xl border p-4">No pudimos cargar el mapa. <button type="button" onClick={() => setRetry(value => value + 1)} className="underline">Reintentar</button></div>}
    {status === "ready" && <MapExperience apiUrl={pilotApiUrl} publishedPoints={points} evaluationPoints={evaluationPoints} initialMaterial={initialMaterial} />}
  </div>;
}
function RewardsPage() {
  return <Suspense fallback={<p role="status">Cargando recompensas…</p>}><RewardsPanel apiUrl={pilotApiUrl} /></Suspense>;
}
function RewardsAdminPage() {
  const { state } = useContext(PilotDashboardContext);
  return <Suspense fallback={<p role="status">Cargando gestión de recompensas…</p>}><RewardsAdminPanel apiUrl={pilotApiUrl} role={state.data?.role ?? ""} /></Suspense>;
}


const answer = (text: string) => guideAnswer(text);

function ProfilePage() {
  const { user, isLoaded } = useUser();
  const { state } = useContext(PilotDashboardContext);
  const [editing, setEditing] = useState(false);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "success" | "error">("idle");
  const [saveMessage, setSaveMessage] = useState("");
  if (!isLoaded) return <div className="animate-rise" aria-busy="true"><PageTitle eyebrow="Tu cuenta" title="Mi perfil." copy="Cargando datos de tu cuenta…" /><div className="h-64 animate-pulse rounded-[2rem] bg-[hsl(var(--muted))]" /></div>;
  if (!user) return <div className="animate-rise"><PageTitle eyebrow="Tu cuenta" title="Mi perfil." copy="No se pudo cargar la información de tu cuenta." /></div>;
  const created = user.createdAt ? new Date(user.createdAt) : null;
  const startEdit = () => { setFirstName(user.firstName ?? ""); setLastName(user.lastName ?? ""); setSaveStatus("idle"); setSaveMessage(""); setEditing(true); };
  const saveProfile = async (event: FormEvent) => {
    event.preventDefault();
    if (saveStatus === "saving") return;
    if (!firstName.trim() || !lastName.trim()) { setSaveStatus("error"); setSaveMessage("Escribe tu nombre y tus apellidos."); return; }
    setSaveStatus("saving"); setSaveMessage("");
    try {
      await user.update({ firstName: firstName.trim(), lastName: lastName.trim() });
      await user.reload();
      setSaveStatus("success"); setSaveMessage("Nombre actualizado en tu cuenta Clerk. Se conserva al recargar y en tus otros dispositivos.");
      setEditing(false);
    } catch (err) {
      const clerkError = err as { longMessage?: string; message?: string; errors?: Array<{ longMessage?: string; message?: string }> };
      setSaveStatus("error");
      setSaveMessage(clerkError.longMessage || clerkError.errors?.[0]?.longMessage || clerkError.errors?.[0]?.message || clerkError.message || "Clerk no pudo guardar los cambios. Inténtalo de nuevo.");
    }
  };
  const inputClass = "mt-2 w-full rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-[hsl(var(--ring)/.3)]";
  return <div className="animate-rise">
    <PageTitle eyebrow="Tu cuenta" title="Mi perfil." copy="Información real de tu cuenta Clerk y tu actividad EcoPulse." />
    <div className="grid gap-5 lg:grid-cols-[1.2fr_.8fr]">
      <section className="rounded-[2rem] border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-7 sm:p-9">
        <div className="flex items-center gap-5">
          <div className="grid h-20 w-20 shrink-0 place-items-center rounded-full bg-[hsl(var(--primary))] text-3xl font-bold text-[hsl(var(--primary-foreground))]">{getDisplayName(user).slice(0, 1)}</div>
          <div className="min-w-0 flex-1">
            <h2 className="font-display text-3xl text-[hsl(var(--primary))]">{getDisplayName(user)}</h2>
            <p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">{getUserEmail(user)}</p>
            {user.username && <p className="mt-0.5 text-xs text-[hsl(var(--muted-foreground))]">@{user.username}</p>}
          </div>
          {!editing && <Button variant="outline" onClick={startEdit} data-testid="button-edit-profile"><Pencil size={15} /> Editar nombre</Button>}
        </div>
        {editing && <form onSubmit={saveProfile} className="mt-6 rounded-2xl border border-[hsl(var(--border))] p-5" data-testid="form-edit-profile">
          <p className="text-sm font-semibold text-[hsl(var(--primary))]">Editar nombre visible</p>
          <p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">Se guarda en tu cuenta segura de Clerk, no en un borrador local. El correo y la contraseña se gestionan desde Clerk.</p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <label className="block text-sm font-semibold text-[hsl(var(--primary))]">Nombre<input value={firstName} onChange={event => setFirstName(event.target.value)} autoComplete="given-name" className={inputClass} placeholder="Tu nombre" data-testid="input-profile-first-name" /></label>
            <label className="block text-sm font-semibold text-[hsl(var(--primary))]">Apellidos<input value={lastName} onChange={event => setLastName(event.target.value)} autoComplete="family-name" className={inputClass} placeholder="Tus apellidos" data-testid="input-profile-last-name" /></label>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button type="submit" disabled={saveStatus === "saving"} data-testid="button-save-profile">{saveStatus === "saving" ? "Guardando…" : "Guardar cambios"}</Button>
            <Button type="button" variant="ghost" onClick={() => { setEditing(false); setSaveStatus("idle"); setSaveMessage(""); }} disabled={saveStatus === "saving"} data-testid="button-cancel-profile">Cancelar</Button>
          </div>
        </form>}
        {saveMessage && <p className={`mt-4 rounded-2xl p-4 text-sm ${saveStatus === "error" ? "bg-[hsl(13_58%_65%/.15)] text-[hsl(13_55%_38%)]" : "bg-[hsl(var(--secondary)/.22)] text-[hsl(var(--primary))]"}`} role={saveStatus === "error" ? "alert" : "status"} data-testid="profile-save-status">{saveMessage}</p>}
        <dl className="mt-8 space-y-4 border-t border-[hsl(var(--border))] pt-6 text-sm">
          <div className="flex items-center justify-between"><dt className="text-[hsl(var(--muted-foreground))]">Nombre completo</dt><dd className="font-semibold">{user.fullName || "—"}</dd></div>
          <div className="flex items-center justify-between"><dt className="text-[hsl(var(--muted-foreground))]">Correo principal</dt><dd className="font-semibold">{user.primaryEmailAddress?.emailAddress || "—"}</dd></div>
          <div className="flex items-center justify-between"><dt className="text-[hsl(var(--muted-foreground))]">Nombre de usuario</dt><dd className="font-semibold">{user.username || "Sin asignar"}</dd></div>
          <div className="flex items-center justify-between"><dt className="text-[hsl(var(--muted-foreground))]">Email verificado</dt><dd>{user.hasVerifiedEmailAddress ? <Check size={17} className="text-[hsl(var(--primary))]" /> : <span className="text-[hsl(var(--muted-foreground))]">Pendiente</span>}</dd></div>
          <div className="flex items-center justify-between"><dt className="text-[hsl(var(--muted-foreground))]">Cuenta creada</dt><dd className="font-semibold">{created ? new Intl.DateTimeFormat("es-CO", { dateStyle: "long" }).format(created) : "—"}</dd></div>
          <div className="flex items-center justify-between"><dt className="text-[hsl(var(--muted-foreground))]">Proveedor de acceso</dt><dd className="font-semibold">Clerk</dd></div>
        </dl>
      </section>
      <section className="rounded-[2rem] bg-[hsl(var(--primary))] p-7 text-[hsl(var(--primary-foreground))]">
        <UserRound size={26} className="text-[hsl(var(--secondary))]" />
        <h2 className="mt-8 font-display text-3xl">Tu actividad</h2>
        <p className="mt-3 leading-relaxed text-[hsl(var(--primary-foreground)/.72)]">Resumen de tu cuenta en PostgreSQL.</p>
        <div className="mt-8 space-y-4 border-t border-[hsl(var(--primary-foreground)/.16)] pt-5 text-sm">
          <div className="flex items-center justify-between"><span>Rol</span><span className="font-semibold">{state.data?.role || "—"}</span></div>
          <div className="flex items-center justify-between"><span>Escaneos registrados</span><span className="font-semibold">{state.data?.scans.length ?? "—"}</span></div>
          <div className="flex items-center justify-between"><span>Solicitudes de entrega</span><span className="font-semibold">{state.data?.deliveries.length ?? "—"}</span></div>
          <div className="flex items-center justify-between"><span>Canjes</span><span className="font-semibold">{state.data?.redemptions.length ?? "—"}</span></div>
          <div className="flex items-center justify-between"><span>Saldo</span><span className="font-semibold">{state.data ? `${state.data.balance.toLocaleString("es-CO")} pts` : "—"}</span></div>
        </div>
        <p className="mt-6 text-xs text-[hsl(var(--primary-foreground)/.5)]">Puedes editar tu nombre desde esta página; el correo y la contraseña se gestionan con Clerk. Los datos se actualizan al recargar o en otra sesión.</p>
      </section>
    </div>
  </div>;
}

function NotificationsPanel({ state, onClose }: { state: PilotLoadState; onClose: () => void }) {
  const deliveryStatusLabels: Record<string, string> = { pending: "Pendiente", scheduled: "Programada", received: "Recibida", approved: "Verificada", rejected: "Rechazada", cancelled: "Cancelada" };
  const items: Array<{ icon: ReactNode; text: string; sortKey: string }> = [];
  if (state.data) {
    for (const scan of state.data.scans.slice(0, 3)) items.push({ icon: <Recycle size={15} />, text: `Escaneo: ${categoryLabels[scan.category] || scan.category}`, sortKey: scan.createdAt });
    for (const delivery of state.data.deliveries.slice(0, 3)) items.push({ icon: <PackageCheck size={15} />, text: `Entrega: ${deliveryStatusLabels[delivery.status] || delivery.status}`, sortKey: delivery.createdAt });
    for (const redemption of state.data.redemptions.slice(0, 2)) items.push({ icon: <Gift size={15} />, text: `Canje: ${redemption.cost} pts`, sortKey: redemption.createdAt });
  }
  const recent = items.sort((a, b) => b.sortKey.localeCompare(a.sortKey)).slice(0, 8);
  return <div className="absolute right-0 top-full z-50 mt-2 w-80 max-w-[calc(100vw-2rem)] rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 shadow-2xl" role="dialog" aria-label="Actividad reciente" data-testid="notifications-panel">
    <div className="flex items-center justify-between"><h3 className="font-semibold text-[hsl(var(--primary))]">Actividad reciente</h3><button onClick={onClose} aria-label="Cerrar notificaciones" data-testid="button-close-notifications"><X size={16} /></button></div>
    {recent.length === 0 ? <p className="mt-4 text-sm text-[hsl(var(--muted-foreground))]">No hay actividad registrada.</p> :
      <ul className="mt-3 max-h-64 space-y-2 overflow-y-auto">{recent.map((item, index) => <li key={index} className="flex items-start gap-3 rounded-xl bg-[hsl(var(--muted))]/50 p-3 text-sm"><span className="mt-0.5 text-[hsl(var(--primary))]">{item.icon}</span><div className="min-w-0"><p className="font-medium">{item.text}</p><p className="text-xs text-[hsl(var(--muted-foreground))]">{formatPilotDate(item.sortKey)}</p></div></li>)}</ul>}
    <p className="mt-3 text-center text-xs text-[hsl(var(--muted-foreground))]">Datos desde PostgreSQL</p>
  </div>;
}
function SecurityPage() {
  const { user, isLoaded } = useUser();
  const [totp, setTotp] = useState<{ secret?: string; uri?: string } | null>(null);
  const [code, setCode] = useState("");
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const mfa = Boolean(user?.twoFactorEnabled);

  const getErrorMessage = (err: unknown) => {
    const clerkError = err as { longMessage?: string; message?: string; errors?: Array<{ longMessage?: string; message?: string }> };
    return clerkError.longMessage || clerkError.errors?.[0]?.longMessage || clerkError.errors?.[0]?.message || clerkError.message || "Clerk no pudo completar esta acción.";
  };

  const startTotp = async () => {
    if (!user) return;
    setLoading(true); setError(""); setNotice("");
    try {
      const resource = await user.createTOTP();
      setTotp(resource);
      setNotice("Abre tu aplicación autenticadora, agrega EcoPulse con la clave secreta y escribe el código de seis dígitos.");
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const verifyTotp = async (event: FormEvent) => {
    event.preventDefault();
    if (!user || !code.trim()) return;
    setLoading(true); setError(""); setNotice("");
    try {
      await user.verifyTOTP({ code: code.trim() });
      await user.reload();
      setTotp(null); setCode(""); setNotice("2FA quedó activo para tu cuenta.");
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const disableTotp = async () => {
    if (!user || !window.confirm("¿Quieres desactivar el autenticador de esta cuenta?")) return;
    setLoading(true); setError(""); setNotice("");
    try {
      await user.disableTOTP();
      await user.reload();
      setBackupCodes([]); setNotice("El autenticador se desactivó.");
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const generateBackupCodes = async () => {
    if (!user) return;
    setLoading(true); setError(""); setNotice("");
    try {
      const resource = await user.createBackupCode();
      setBackupCodes(resource.codes);
      setNotice("Guarda estos códigos en un lugar seguro. Generar otros reemplazará los anteriores.");
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  return <div className="animate-rise">
    <PageTitle eyebrow="Tu cuenta, en calma" title="Seguridad clara." copy="Revisa el estado real de tu autenticación de Clerk y protege tu cuenta con una aplicación autenticadora." />
    <div className="grid gap-5 lg:grid-cols-[1.2fr_.8fr]">
      <section className="rounded-[2rem] border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-7 sm:p-9">
        <div className="flex items-start gap-4"><span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-[hsl(var(--secondary)/.3)] text-[hsl(var(--primary))]"><ShieldCheck size={27} /></span><div><h2 className="font-display text-3xl text-[hsl(var(--primary))]">Verificación en dos pasos</h2><p className="mt-2 leading-relaxed text-[hsl(var(--muted-foreground))]">Clerk indica si tu cuenta tiene TOTP activo y permite verificarlo desde aquí.</p></div></div>
        <div className="mt-8 flex items-center justify-between rounded-2xl border border-[hsl(var(--border))] p-5"><div><div className="flex items-center gap-2"><span className={`h-2.5 w-2.5 rounded-full ${mfa ? "bg-[hsl(var(--primary))]" : "bg-[hsl(var(--accent))]"}`} /><strong>{mfa ? "Activa" : "Pendiente de configurar"}</strong></div><p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">{mfa ? "Tu cuenta está protegida con autenticador y Clerk exigirá el segundo factor cuando corresponda." : "Aún no hay un segundo factor activo en esta cuenta."}</p></div><Button variant={mfa ? "soft" : "primary"} onClick={mfa ? disableTotp : startTotp} disabled={!isLoaded || loading} data-testid="button-configure-mfa">{loading ? "Procesando..." : mfa ? "Desactivar" : "Configurar autenticador"}</Button></div>
        {totp && <form onSubmit={verifyTotp} className="mt-5 rounded-2xl bg-[hsl(var(--secondary)/.18)] p-5"><p className="text-sm font-semibold text-[hsl(var(--primary))]">Confirma tu aplicación autenticadora</p><p className="mt-2 text-xs leading-relaxed text-[hsl(var(--muted-foreground))]">Copia esta clave en Google Authenticator, Microsoft Authenticator, 1Password u otra aplicación compatible:</p><code className="mt-3 block break-all rounded-xl bg-[hsl(var(--card))] p-3 text-xs text-[hsl(var(--primary))]">{totp.secret || totp.uri || "Clave generada por Clerk"}</code><div className="mt-4 flex gap-2"><input value={code} onChange={event => setCode(event.target.value)} inputMode="numeric" autoComplete="one-time-code" placeholder="Código de 6 dígitos" className="min-w-0 flex-1 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-[hsl(var(--ring)/.3)]" data-testid="input-mfa-code" /><Button type="submit" disabled={loading || !code.trim()} data-testid="button-verify-mfa">Verificar</Button></div></form>}
        {mfa && <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[hsl(var(--border))] p-4"><div><p className="text-sm font-semibold text-[hsl(var(--primary))]">Códigos de respaldo</p><p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">Úsalos si pierdes acceso a tu aplicación autenticadora.</p></div><Button variant="outline" onClick={generateBackupCodes} disabled={loading} data-testid="button-generate-backup-codes">Generar códigos</Button></div>}
        {backupCodes.length > 0 && <div className="mt-4 grid grid-cols-2 gap-2 rounded-2xl bg-[hsl(var(--muted))] p-4 sm:grid-cols-3">{backupCodes.map(backupCode => <code key={backupCode} className="rounded-lg bg-[hsl(var(--card))] px-2 py-2 text-center text-xs font-semibold">{backupCode}</code>)}</div>}
        {notice && <div className="mt-4 flex gap-3 rounded-2xl bg-[hsl(var(--secondary)/.2)] p-4 text-sm text-[hsl(var(--primary))]" data-testid="status-mfa-notice"><LockKeyhole size={18} className="shrink-0" /><p>{notice}</p><button className="ml-auto" onClick={() => setNotice("")} data-testid="button-dismiss-mfa"><X size={16} /></button></div>}
        {error && <div className="mt-4 flex gap-3 rounded-2xl bg-[hsl(13_58%_65%/.15)] p-4 text-sm text-[hsl(13_55%_38%)]" role="alert" data-testid="status-mfa-error"><X size={18} className="shrink-0" /><p>{error}</p></div>}
      </section>
      <section className="rounded-[2rem] bg-[hsl(var(--primary))] p-7 text-[hsl(var(--primary-foreground))]"><LockKeyhole size={26} className="text-[hsl(var(--secondary))]" /><h2 className="mt-8 font-display text-3xl">Estado de tu cuenta</h2><p className="mt-3 leading-relaxed text-[hsl(var(--primary-foreground)/.72)]">Estos indicadores vienen directamente de tu sesión de Clerk.</p><div className="mt-8 space-y-4 border-t border-[hsl(var(--primary-foreground)/.16)] pt-5 text-sm"><div className="flex items-center justify-between"><span>Email verificado</span>{user?.hasVerifiedEmailAddress ? <Check size={17} className="text-[hsl(var(--secondary))]" /> : <span className="text-[hsl(var(--primary-foreground)/.62)]">Pendiente</span>}</div><div className="flex items-center justify-between"><span>Autenticador TOTP</span><span className={user?.totpEnabled ? "text-[hsl(var(--secondary))]" : "text-[hsl(var(--primary-foreground)/.62)]"}>{user?.totpEnabled ? "Activo" : "Inactivo"}</span></div><div className="flex items-center justify-between"><span>Códigos de respaldo</span><span className={user?.backupCodeEnabled ? "text-[hsl(var(--secondary))]" : "text-[hsl(var(--primary-foreground)/.62)]"}>{user?.backupCodeEnabled ? "Activos" : "No generados"}</span></div><div className="flex items-center justify-between gap-4"><span>Cuenta</span><span className="truncate text-right text-[hsl(var(--primary-foreground)/.62)]">{user?.primaryEmailAddress?.emailAddress || "Cuenta EcoPulse"}</span></div></div></section>
    </div>
  </div>;
}

function ChatPage() {
  const { getToken, userId } = useAuth();
  const [messages, setMessages] = useState<Array<ChatMessage & { source?: "ai" | "rules" }>>(seedChat);
  const [input, setInput] = useState("");
  const [consent, setConsent] = useState(false);
  const [aiEnabled, setAiEnabled] = useState(false);
  const [pending, setPending] = useState(false);
  const [guideError, setGuideError] = useState("");
  const activeRequest = useRef<AbortController | null>(null);
  const requestGate = useRef(createGuideRequestGate());
  const [retry, setRetry] = useState<{ question: string; history: GuideTurn[] } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    setAiEnabled(false);
    if (!userId) return () => controller.abort();
    void (async () => {
      try {
        const token = await getToken();
        if (!token) throw new Error("missing_session_token");
        const enabled = await loadGuideCapabilities(pilotApiUrl, token, controller.signal);
        if (!controller.signal.aborted) setAiEnabled(enabled);
      } catch {
        if (!controller.signal.aborted) setGuideError("No se pudo verificar la disponibilidad de EcoGuía. Revisa tu sesión o intenta recargar la página.");
      }
    })();
    return () => { controller.abort(); activeRequest.current?.abort(); };
  }, [getToken, userId]);
  const quick = ["¿Dónde va el vidrio?", "¿Cómo gano puntos?", "Busca un punto cerca", "Mi actividad"];
  const send = async (content = input, previous?: { question: string; history: GuideTurn[] }) => {
    const question = previous?.question ?? content.trim().slice(0, 500);
    if (!question || !requestGate.current.enter()) return;
    if (!consent || !aiEnabled) {
      setGuideError(aiEnabled ? "Autoriza el envío a OpenRouter para conversar con EcoGuía." : "EcoGuía remota no está disponible. Verifica la configuración del servidor o inténtalo más tarde.");
      requestGate.current.leave();
      return;
    }
    const now = new Date().toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" });
    const history = previous?.history ?? messages.filter(turn => turn.id !== "welcome" && (turn.role === "user" || turn.source === "ai"))
      .slice(-6).map(turn => ({ role: turn.role, content: turn.content }));
    if (!previous) {
      setMessages(current => [...current, { id: `u-${crypto.randomUUID()}`, role: "user", content: question, timestamp: now }]);
      setInput("");
    }
    setRetry(null);
    setGuideError("");
    setPending(true);
    const request = new AbortController(); activeRequest.current = request;
    try {
      const token = await getToken();
      if (request.signal.aborted) return;
      if (!token) throw new GuideApiError(401, "missing_session_token");
      const answer = await askGuide(pilotApiUrl, token, question, history, request.signal);
      if (!request.signal.aborted) setMessages(current => [...current, { id: `a-${crypto.randomUUID()}`, role: "assistant", content: answer, timestamp: now, source: "ai" }]);
    } catch (cause) {
      if (!request.signal.aborted) {
        setRetry({ question, history });
        if (cause instanceof GuideApiError && cause.status === 429) {
          const base = guideQuotaMessages[cause.code] ?? "EcoGuía alcanzó su límite temporal.";
          setGuideError(`${base}${retryWaitSuffix(cause.retryAfterSeconds)}`);
        } else if (cause instanceof GuideApiError && cause.status === 401) {
          setGuideError("Tu sesión expiró. Inicia sesión de nuevo y reintenta.");
        } else if (cause instanceof GuideApiError && cause.code === "ai_provider_unconfigured") {
          setGuideError("EcoGuía no tiene un modelo gratuito de OpenRouter configurado en el servidor.");
        } else {
          setGuideError("EcoGuía no pudo obtener una respuesta de la IA remota. Reintenta más tarde.");
        }
      }
    } finally {
      if (activeRequest.current === request) activeRequest.current = null;
      requestGate.current.leave();
      setPending(false);
    }
  };
  return <div className="animate-rise">
    <PageTitle eyebrow="Siempre a mano" title="EcoGuía" copy="Conversa sobre separación de materiales, centros, entregas y tu progreso." />
    <div className="mx-auto max-w-3xl overflow-hidden rounded-[2rem] border border-[hsl(var(--border))] bg-[hsl(var(--card))]">
      <div className="flex items-center gap-3 border-b border-[hsl(var(--border))] p-5"><span className="grid h-11 w-11 place-items-center rounded-2xl bg-[hsl(var(--primary))] text-[hsl(var(--secondary))]"><Bot size={22} /></span><div><p className="font-semibold">EcoGuía</p><p className="text-xs text-[hsl(var(--primary))]">{aiEnabled ? "IA remota disponible con tu permiso" : "IA remota no disponible"}</p></div><button onClick={() => { activeRequest.current?.abort(); setMessages(seedChat); setRetry(null); setPending(false); setGuideError(""); }} className="ml-auto text-xs font-semibold text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--primary))]" data-testid="button-clear-chat">Limpiar chat</button></div>
      <label className="mx-5 mt-4 flex items-start gap-2 text-xs text-[hsl(var(--muted-foreground))]"><input type="checkbox" checked={consent} onChange={event => setConsent(event.target.checked)} disabled={!aiEnabled || pending} data-testid="guide-consent" />Permito enviar mis preguntas, hasta seis mensajes anteriores y un resumen de mi cuenta (EcoPuntos, materiales, centros, horarios y entregas) a OpenRouter. Sin permiso, no se enviará nada.</label>
      {guideError && <div role="alert" className="mx-5 mt-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">{guideError}{retry && <button type="button" disabled={pending} onClick={() => void send(retry.question, retry)} className="ml-3 font-semibold underline disabled:opacity-50" data-testid="button-retry-guide">Reintentar</button>}</div>}
      <div className="flex min-h-[390px] flex-col gap-4 p-5 sm:p-7" aria-live="polite">{messages.map(m => <div key={m.id} className={`flex max-w-[88%] gap-2 ${m.role === "user" ? "ml-auto flex-row-reverse" : ""}`} data-testid={`message-${m.id}`}><span className={`grid h-8 w-8 shrink-0 place-items-center rounded-xl ${m.role === "user" ? "bg-[hsl(var(--secondary))] text-[hsl(var(--primary))]" : "bg-[hsl(var(--muted))] text-[hsl(var(--primary))]"}`}>{m.role === "user" ? <UserRound size={15} /> : <Bot size={15} />}</span><div className={`rounded-2xl px-4 py-3 text-sm leading-relaxed ${m.role === "user" ? "rounded-tr-sm bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]" : "rounded-tl-sm bg-[hsl(var(--muted))]"}`}><p className="whitespace-pre-line">{m.content}</p><small className="mt-1 block text-[10px] opacity-60">{m.timestamp}{m.role === "assistant" && m.id !== "welcome" ? ` · ${m.source === "ai" ? "Respuesta IA" : "Guía local"}` : ""}</small></div></div>)}{pending && <p role="status" className="text-sm text-[hsl(var(--muted-foreground))]" data-testid="guide-typing">EcoGuía está escribiendo…</p>}</div>
      <div className="border-t border-[hsl(var(--border))] p-4"><div className="mb-3 flex gap-2 overflow-auto">{quick.map(q => <button key={q} disabled={pending} onClick={() => void send(q)} className="whitespace-nowrap rounded-full border border-[hsl(var(--border))] px-3 py-2 text-xs font-semibold text-[hsl(var(--primary))] hover:bg-[hsl(var(--muted))] disabled:opacity-50" data-testid={`button-quick-${q.slice(0,5)}`}>{q}</button>)}</div><form onSubmit={e => { e.preventDefault(); void send(); }} className="flex items-center gap-2"><input value={input} onChange={e => setInput(e.target.value)} maxLength={500} aria-label="Escribe tu duda para EcoGuía" placeholder="Escribe tu duda..." className="min-w-0 flex-1 rounded-full bg-[hsl(var(--muted))] px-5 py-3 text-sm outline-none focus:ring-2 focus:ring-[hsl(var(--ring)/.35)]" data-testid="input-chat-message" /><Button type="submit" disabled={pending || !input.trim()} aria-label="Enviar pregunta" className="h-11 w-11 shrink-0 rounded-full p-0" data-testid="button-send-chat"><ArrowRight size={18} /></Button></form></div>
    </div>
  </div>;
}
function AuthPages() {
  return <div className="grid min-h-[100dvh] place-items-center bg-[hsl(var(--background))] p-5"><div className="absolute left-6 top-6"><Link href="/" className="flex items-center gap-2 text-[hsl(var(--primary))]" data-testid="link-auth-brand"><IconLogo small /><span className="font-display text-xl">EcoPulse</span></Link></div><div className="rounded-[2rem] border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-3 shadow-xl"><SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} appearance={clerkAppearance} /></div></div>;
}
function AuthSignup() {
  const { signUp, fetchStatus } = useSignUp();
  const [, setLocation] = useLocation();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [pendingVerification, setPendingVerification] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const isReady = fetchStatus !== "fetching";

  const getErrorMessage = (err: unknown) => {
    const clerkError = err as { longMessage?: string; message?: string; errors?: Array<{ longMessage?: string; message?: string }> };
    return clerkError.longMessage || clerkError.errors?.[0]?.longMessage || clerkError.errors?.[0]?.message || clerkError.message || "No pudimos completar el registro. Revisa los datos e inténtalo de nuevo.";
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!isReady || loading) return;
    setError("");
    if (!firstName.trim() || !lastName.trim() || !email.trim() || !password) {
      setError("Completa nombre, apellidos, correo y contraseña.");
      return;
    }
    setLoading(true);
    try {
      const { error: passwordError } = await signUp.password({
        emailAddress: email.trim(),
        password,
        unsafeMetadata: { firstName: firstName.trim(), lastName: lastName.trim() },
      });
      if (passwordError) {
        setError(getErrorMessage(passwordError));
        return;
      }
      const { error: verificationError } = await signUp.verifications.sendEmailCode();
      if (verificationError) {
        setError(getErrorMessage(verificationError));
        return;
      }
      setPendingVerification(true);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const verify = async (event: FormEvent) => {
    event.preventDefault();
    if (!isReady || loading) return;
    setError("");
    setLoading(true);
    try {
      const { error: verificationError } = await signUp.verifications.verifyEmailCode({ code: code.trim() });
      if (verificationError) {
        setError(getErrorMessage(verificationError));
      } else if (signUp.status === "complete") {
        const { error: finalizeError } = await signUp.finalize();
        if (finalizeError) {
          setError(getErrorMessage(finalizeError));
          return;
        }
        setLocation("/dashboard");
      } else {
        setError("El registro todavía no está completo. Revisa el código enviado a tu correo.");
      }
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const inputClass = "w-full rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-4 py-3 text-sm text-[hsl(var(--foreground))] outline-none transition focus:border-[hsl(var(--primary))] focus:ring-2 focus:ring-[hsl(var(--ring)/.25)]";
  return <div className="grid min-h-[100dvh] place-items-center bg-[hsl(var(--background))] p-5">
    <div className="absolute left-6 top-6"><Link href="/" className="flex items-center gap-2 text-[hsl(var(--primary))]" data-testid="link-auth-signup-brand"><IconLogo small /><span className="font-display text-xl">EcoPulse</span></Link></div>
    <div className="w-full max-w-md rounded-[2rem] border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-7 shadow-xl sm:p-9">
      <div className="text-center"><div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-[hsl(var(--secondary))]"><IconLogo /></div><h1 className="mt-5 font-display text-3xl text-[hsl(var(--primary))]">{pendingVerification ? "Verifica tu correo" : "Crea tu cuenta"}</h1><p className="mt-2 text-sm text-[hsl(var(--muted-foreground))]">{pendingVerification ? `Escribe el código que enviamos a ${email}.` : "Regístrate con tu nombre, correo y contraseña para personalizar EcoPulse."}</p></div>
      {pendingVerification ? <form onSubmit={verify} className="mt-7 space-y-4">
        <label className="block text-sm font-semibold text-[hsl(var(--primary))]">Código de verificación<input value={code} onChange={event => setCode(event.target.value)} inputMode="numeric" autoComplete="one-time-code" className={`${inputClass} mt-2`} placeholder="123456" data-testid="input-signup-code" /></label>
        {error && <p className="rounded-xl bg-[hsl(13_58%_65%/.15)] px-3 py-2 text-sm text-[hsl(13_55%_38%)]" role="alert">{error}</p>}
        <Button type="submit" className="w-full" disabled={!isReady || loading || !code.trim()} data-testid="button-verify-signup">{loading ? "Verificando..." : "Verificar y entrar"}</Button>
        <button type="button" onClick={() => { setPendingVerification(false); setError(""); }} className="w-full text-sm font-semibold text-[hsl(var(--primary))]" data-testid="button-back-signup">Volver a editar mis datos</button>
      </form> : <form onSubmit={submit} className="mt-7 space-y-4">
        <div className="grid gap-4 sm:grid-cols-2"><label className="block text-sm font-semibold text-[hsl(var(--primary))]">Nombre<input value={firstName} onChange={event => setFirstName(event.target.value)} autoComplete="given-name" className={`${inputClass} mt-2`} placeholder="Tu nombre" data-testid="input-signup-first-name" /></label><label className="block text-sm font-semibold text-[hsl(var(--primary))]">Apellidos<input value={lastName} onChange={event => setLastName(event.target.value)} autoComplete="family-name" className={`${inputClass} mt-2`} placeholder="Tus apellidos" data-testid="input-signup-last-name" /></label></div>
        <label className="block text-sm font-semibold text-[hsl(var(--primary))]">Correo electrónico<input type="email" value={email} onChange={event => setEmail(event.target.value)} autoComplete="email" className={`${inputClass} mt-2`} placeholder="tu-correo@ejemplo.com" data-testid="input-signup-email" /></label>
        <label className="block text-sm font-semibold text-[hsl(var(--primary))]">Contraseña<input type="password" value={password} onChange={event => setPassword(event.target.value)} autoComplete="new-password" className={`${inputClass} mt-2`} placeholder="Crea una contraseña segura" data-testid="input-signup-password" /></label>
        {error && <p className="rounded-xl bg-[hsl(13_58%_65%/.15)] px-3 py-2 text-sm text-[hsl(13_55%_38%)]" role="alert">{error}</p>}
        <Button type="submit" className="w-full" disabled={!isReady || loading} data-testid="button-submit-signup">{loading ? "Creando cuenta..." : "Crear cuenta"}</Button>
        <p className="text-center text-xs leading-relaxed text-[hsl(var(--muted-foreground))]">Tu nombre y correo quedan asociados a tu cuenta segura de EcoPulse.</p>
      </form>}
      <p className="mt-6 text-center text-sm text-[hsl(var(--muted-foreground))]">¿Ya tienes una cuenta? <Link href="/sign-in" className="font-semibold text-[hsl(var(--primary))]" data-testid="link-signin-from-signup">Inicia sesión</Link></p>
    </div>
  </div>;
}

function AuthenticatedRouter() {
  const { isSignedIn, isLoaded, getToken } = useAuth(); const [path, setLocation] = useLocation(); const { signOut } = useClerk(); const { user } = useUser();
  const [pilotState, setPilotState] = useState<PilotLoadState>(emptyPilotState);
  const [reloadKey, setReloadKey] = useState(0);
  const requestId = useRef(0);
  const retryPilotData = useCallback(() => setReloadKey((value) => value + 1), []);
  useEffect(() => {
    const activeRequest = ++requestId.current;
    const accountId = user?.id ?? null;
    if (!isLoaded || !isSignedIn || !accountId) {
      setPilotState(emptyPilotState);
      return;
    }
    const controller = new AbortController();
    setPilotState({ accountId, status: "loading", data: null, message: "" });
    void (async () => {
      try {
        const token = await getToken();
        if (!token) throw new Error("missing_session_token");
        const data = await loadPilotDashboardData(pilotApiUrl, token, controller.signal);
        if (data.accountId !== accountId) throw new PilotApiError(403, "account_mismatch");
        if (isCurrentPilotResponse(requestId.current, activeRequest, accountId, data.accountId) && !controller.signal.aborted) {
          setPilotState({ accountId, status: "ready", data, message: "" });
        }
      } catch (error) {
        if (requestId.current === activeRequest && !controller.signal.aborted) {
          console.error("No se pudo validar la sesión con la API de EcoPulse.");
          const status = error instanceof PilotApiError ? error.status : 0;
          const message = status === 401
            ? "Tu sesión venció. Vuelve a iniciar sesión."
            : status === 403
              ? "Esta cuenta no tiene permiso para consultar esos datos."
              : "No pudimos cargar tus datos. Revisa que la API esté disponible e inténtalo de nuevo.";
          setPilotState({ accountId, status: "error", data: null, message });
        }
      }
    })();
    return () => controller.abort();
  }, [getToken, isLoaded, isSignedIn, reloadKey, user?.id]);
  if (!isLoaded) return <div className="grid min-h-[100dvh] place-items-center bg-[hsl(var(--background))]"><div className="h-12 w-12 animate-pulse rounded-2xl bg-[hsl(var(--secondary))]" /></div>;
  const cleanPath = path.split("?")[0] || "/";
  const queryParams = new URLSearchParams(window.location.search);
  if (cleanPath.startsWith("/sign-in")) return <Switch><Route path="/sign-in/*?" component={AuthPages} /><Route component={AuthPages} /></Switch>;
  if (cleanPath.startsWith("/sign-up")) return <Switch><Route path="/sign-up/*?" component={AuthSignup} /><Route component={AuthSignup} /></Switch>;
  if (cleanPath === "/" && isSignedIn) return <Redirect to="/dashboard" />;
  const publicRoutes = ["/materials", "/faq", "/privacy", "/terms", "/contact"];
  const isPublicRoute = publicRoutes.some((route) => cleanPath === route || cleanPath.startsWith(`${route}/`));
  if (!isSignedIn && cleanPath !== "/" && !isPublicRoute) return <Redirect to="/" />;
  if (!isSignedIn) return <Switch>
    <Route path="/" component={Landing} />
    <Route path="/materials/:id">{(params) => <PublicLayout><MaterialFicha id={params.id} /></PublicLayout>}</Route>
    <Route path="/materials">{() => <PublicLayout><MaterialsLibrary initialQuery={queryParams.get("q") ?? ""} initialCategory={queryParams.get("category") ?? "all"} /></PublicLayout>}</Route>
    <Route path="/faq">{() => <PublicLayout><FaqPage /></PublicLayout>}</Route>
    <Route path="/privacy">{() => <PublicLayout><PrivacyPage /></PublicLayout>}</Route>
    <Route path="/terms">{() => <PublicLayout><TermsPage /></PublicLayout>}</Route>
    <Route path="/contact">{() => <PublicLayout><ContactPage /></PublicLayout>}</Route>
    <Route component={NotFound} />
  </Switch>;
   const userName = getDisplayName(user); const userEmail = getUserEmail(user);
   const logout = () => {
     ++requestId.current;
     setPilotState(emptyPilotState);
     queryClient.clear();
     try {
       localStorage.removeItem(`ep-guide-v2:${user?.id}`);
       localStorage.removeItem(`ep-activity-seen:${user?.id}`);
       sessionStorage.removeItem(`ecopulse:pending-delivery-operation-v2:${user?.id}`);
       sessionStorage.removeItem("ecopulse:pending-delivery-operation-v2");
     } catch { /* Browser storage may be unavailable. */ }
     void signOut({ redirectUrl: window.location.origin + `${basePath}/sign-in` });
   };
   const visiblePilotState = pilotState.accountId === user?.id ? pilotState : { ...emptyPilotState, accountId: user?.id ?? null, status: "loading" as const };
   return <PilotDashboardContext.Provider value={{ state: visiblePilotState, retry: retryPilotData }}><span className="sr-only" data-testid="pilot-api-status" aria-live="polite">{visiblePilotState.status === "ready" ? "API conectada" : visiblePilotState.status === "error" ? "API no disponible" : "Conectando API"}</span><PrivateShell userName={userName} userEmail={userEmail} onLogout={logout} role={visiblePilotState.data?.role}><Switch><Route path="/dashboard" component={Dashboard} /><Route path="/deliveries" component={DeliveriesPage} /><Route path="/progress">{() => <Suspense fallback={<p role="status">Cargando tu progreso…</p>}><ProgressPanel apiUrl={pilotApiUrl} /></Suspense>}</Route><Route path="/scan" component={ScanPage} /><Route path="/map">{() => <MapPage initialMaterial={queryParams.get("material") ?? ""} />}</Route><Route path="/admin/rewards" component={RewardsAdminPage} /><Route path="/admin/centers">{() => <Suspense fallback={<p role="status">Cargando centros…</p>}><CatalogAdminPanel role={visiblePilotState.data?.role} /></Suspense>}</Route><Route path="/admin" component={AdminHomePage} /><Route path="/rewards" component={RewardsPage} /><Route path="/security" component={SecurityPage} /><Route path="/profile" component={ProfilePage} /><Route path="/chat">{() => <ChatPage key={user?.id ?? "unknown"} />}</Route><Route path="/materials/:id">{(params) => <MaterialFicha id={params.id} />}</Route><Route path="/materials">{() => <MaterialsLibrary initialQuery={queryParams.get("q") ?? ""} initialCategory={queryParams.get("category") ?? "all"} />}</Route><Route path="/faq" component={FaqPage} /><Route path="/privacy" component={PrivacyPage} /><Route path="/terms" component={TermsPage} /><Route path="/contact" component={ContactPage} /><Route component={NotFound} /></Switch></PrivateShell></PilotDashboardContext.Provider>;
}
function LocalAuthFallback() { const [path] = useLocation(); return <div className="grid min-h-[100dvh] place-items-center bg-[hsl(var(--background))] p-6"><div className="max-w-xl rounded-[2rem] border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-8" data-testid="clerk-required"><div className="flex items-center gap-3"><IconLogo small /><span className="font-display text-2xl text-[hsl(var(--primary))]">EcoPulse</span></div><h1 className="mt-6 font-display text-4xl text-[hsl(var(--primary))]">Configuración requerida</h1><p className="mt-4 leading-relaxed text-[hsl(var(--muted-foreground))]">La autenticación no está configurada en este despliegue. EcoPulse solo opera con sesiones reales de Clerk; no se muestra una experiencia simulada.</p><div className="mt-6 rounded-2xl bg-[hsl(var(--muted))] p-5 text-sm" data-testid="clerk-missing-requirement"><p className="font-semibold text-[hsl(var(--primary))]">Requisito exacto</p><p className="mt-2">Define <code className="rounded bg-[hsl(var(--card))] px-1.5 py-0.5">VITE_CLERK_PUBLISHABLE_KEY</code> en el frontend y, en el servidor, <code className="rounded bg-[hsl(var(--card))] px-1.5 py-0.5">CLERK_SECRET_KEY</code>, <code className="rounded bg-[hsl(var(--card))] px-1.5 py-0.5">CLERK_PUBLISHABLE_KEY</code>, <code className="rounded bg-[hsl(var(--card))] px-1.5 py-0.5">DATABASE_URL</code> y <code className="rounded bg-[hsl(var(--card))] px-1.5 py-0.5">PILOT_ALLOWED_ORIGINS</code>. Consulta <code className="rounded bg-[hsl(var(--card))] px-1.5 py-0.5">.env.example</code>.</p></div>{path !== "/" && <p className="mt-4 text-sm text-[hsl(var(--muted-foreground))]">Ruta solicitada: <code>{path}</code></p>}</div></div>; }
function NotFound() { return <div className="grid min-h-[100dvh] place-items-center bg-[hsl(var(--background))] p-6 text-center"><div><p className="font-mono text-sm text-[hsl(var(--accent))]">404</p><h1 className="mt-2 font-display text-5xl text-[hsl(var(--primary))]">Este camino aún no existe.</h1><Link href="/" className="mt-6 inline-flex rounded-full bg-[hsl(var(--primary))] px-5 py-3 font-semibold text-[hsl(var(--primary-foreground))]" data-testid="link-not-found-home">Volver al inicio</Link></div></div>; }
function App() { return <QueryClientProvider client={queryClient}><TooltipProvider>{clerkKey ? <ClerkProvider publishableKey={clerkKey} proxyUrl={clerkProxyUrl} appearance={clerkAppearance} signInUrl={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} localization={{ signIn: { start: { title: "Bienvenido de nuevo", subtitle: "Continúa tu pulso sostenible" } }, signUp: { start: { title: "Crea tu cuenta", subtitle: "Empieza a transformar tus hábitos" } } }} routerPush={(to) => { window.history.pushState({}, "", to); window.dispatchEvent(new PopStateEvent("popstate")); }} routerReplace={(to) => { window.history.replaceState({}, "", to); window.dispatchEvent(new PopStateEvent("popstate")); }}><WouterRouter base={basePath}><ErrorBoundary><AuthenticatedRouter /></ErrorBoundary></WouterRouter></ClerkProvider> : <WouterRouter base={basePath}><ErrorBoundary><LocalAuthFallback /></ErrorBoundary></WouterRouter>}<Toaster /></TooltipProvider></QueryClientProvider>; }
export default App;
