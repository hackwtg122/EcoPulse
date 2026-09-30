import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { ClerkProvider, SignIn, useAuth, useClerk, useSignUp, useUser } from "@clerk/react";
import { publishableKeyFromHost } from "@clerk/react/internal";
import { shadcn } from "@clerk/themes";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Link, Redirect, Route, Switch, Router as WouterRouter, useLocation } from "wouter";
import { ErrorBoundary } from "@/components/error-boundary";
import {
  ArrowRight, Award, Bell, Bot, Camera, Check, ChevronRight, CircleHelp, Clock3, Compass, Copy, Gift, Globe2, Leaf, LocateFixed, LockKeyhole, LogOut, MapPin, Menu, MessageCircle, Minus, Navigation, PackageCheck, PanelLeftClose, Plus, Recycle, Search, ShieldCheck, Sparkles, Star, Target, Trash2, Trophy, Upload, UserRound, X, Zap,
} from "lucide-react";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";

const queryClient = new QueryClient();
const clerkKey = publishableKeyFromHost(window.location.hostname, import.meta.env.VITE_CLERK_PUBLISHABLE_KEY);
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;
const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

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

type Scan = { id: string; name: string; category: string; confidence: number; instructions: string; points: number; date: string };
type Reward = { id: string; name: string; description: string; cost: number; category: string; available: boolean };
type ChatMessage = { id: string; role: "user" | "assistant"; content: string; timestamp: string };
type Place = { id: string; name: string; address: string; distance: string; types: string[]; open: boolean };

const places: Place[] = [
  { id: "p1", name: "Punto Verde Centro Montería", address: "Centro, Montería, Córdoba", distance: "0,8 km", types: ["Papel", "Vidrio", "Envases"], open: true },
  { id: "p2", name: "Punto Ecológico Ronda del Sinú", address: "Ronda del Sinú, Montería, Córdoba", distance: "1,4 km", types: ["Papel", "Vidrio", "Textil"], open: true },
  { id: "p3", name: "Estación Recicla La Castellana", address: "La Castellana, Montería, Córdoba", distance: "2,7 km", types: ["Aceite", "Pilas", "Vidrio"], open: false },
  { id: "p4", name: "Punto Verde Zona Norte", address: "Zona Norte, Montería, Córdoba", distance: "3,2 km", types: ["Envases", "Orgánico", "Compost"], open: true },
];
const rewards: Reward[] = [
  { id: "r1", name: "Semillas de temporada", description: "Un sobre de semillas nativas para que tu balcón vuelva a florecer.", cost: 180, category: "Biodiversidad", available: true },
  { id: "r2", name: "Vaso de fibra de bambú", description: "Reutilizable, ligero y listo para acompañar tus mañanas.", cost: 320, category: "Reutiliza", available: true },
  { id: "r3", name: "Kit de compostaje urbano", description: "Todo lo esencial para empezar a transformar tus restos.", cost: 650, category: "Hogar", available: true },
  { id: "r4", name: "Donación: río limpio", description: "Tus puntos financian 1 m² de limpieza en el río.", cost: 400, category: "Impacto", available: true },
];
const seedScans: Scan[] = [
  { id: "s1", name: "Botella de vidrio", category: "Vidrio", confidence: 98, instructions: "Vacía, enjuaga y deposita sin tapa en el contenedor verde.", points: 18, date: "Hoy, 09:42" },
  { id: "s2", name: "Lata de conserva", category: "Envases", confidence: 94, instructions: "Escurre el contenido y deposita la lata en el contenedor amarillo.", points: 12, date: "Ayer, 18:16" },
  { id: "s3", name: "Caja de cartón", category: "Papel", confidence: 96, instructions: "Pliega la caja y retira cualquier resto orgánico antes de reciclarla.", points: 10, date: "Lun, 11:08" },
];
const seedChat: ChatMessage[] = [{ id: "welcome", role: "assistant", content: "Hola, soy tu guía de reciclaje. Pregúntame por una categoría, tus puntos o un punto ecológico cercano.", timestamp: "Ahora" }];

function useStored<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(() => { try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : initial; } catch { return initial; } });
  useEffect(() => { localStorage.setItem(key, JSON.stringify(value)); }, [key, value]);
  return [value, setValue] as const;
}
function IconLogo({ small = false }: { small?: boolean }) { return <img src={`${basePath}/logo.svg`} alt="EcoPulse" className={small ? "h-8 w-8" : "h-11 w-11"} />; }
function Button({ children, className = "", variant = "primary", ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "soft" | "ghost" | "outline" }) {
  const styles = { primary: "bg-[hsl(var(--secondary))] text-[hsl(var(--secondary-foreground))] hover:-translate-y-0.5", soft: "bg-[hsl(var(--muted))] text-[hsl(var(--foreground))] hover:bg-[hsl(var(--secondary))]", ghost: "text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))]", outline: "border border-[hsl(var(--border))] bg-transparent hover:bg-[hsl(var(--muted))]" };
  return <button {...props} className={`inline-flex items-center justify-center gap-2 rounded-full px-4 py-2.5 text-sm font-semibold transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-50 ${styles[variant]} ${className}`} />;
}
function Badge({ children, tone = "green" }: { children: ReactNode; tone?: "green" | "yellow" | "coral" }) {
  const toneClass = { green: "bg-[hsl(158_42%_30%/.1)] text-[hsl(var(--primary))]", yellow: "bg-[hsl(43_84%_67%/.24)] text-[hsl(158_30%_19%)]", coral: "bg-[hsl(13_58%_65%/.17)] text-[hsl(13_55%_38%)]" };
  return <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-[.12em] ${toneClass[tone]}`}>{children}</span>;
}

function PublicHeader() {
  return <header className="absolute inset-x-0 top-0 z-10 flex items-center justify-between px-5 py-5 sm:px-10">
    <Link href="/" className="flex items-center gap-2.5 text-[hsl(var(--sidebar))]" data-testid="link-brand"><IconLogo small /><span className="font-display text-2xl">EcoPulse</span></Link>
    <nav className="flex items-center gap-2"><Link href="/sign-in" className="rounded-full px-4 py-2 text-sm font-semibold text-[hsl(var(--primary))] hover:bg-[hsl(var(--muted))]" data-testid="link-sign-in">Iniciar sesión</Link><Link href="/sign-up" className="rounded-full bg-[hsl(var(--primary))] px-4 py-2.5 text-sm font-semibold text-[hsl(var(--primary-foreground))]" data-testid="link-sign-up">Crear cuenta <ArrowRight size={15} /></Link></nav>
  </header>;
}
function Landing() {
  return <main className="min-h-[100dvh] overflow-hidden bg-[hsl(var(--background))]">
    <PublicHeader />
    <section className="relative mx-auto grid min-h-[730px] max-w-7xl items-center gap-10 px-5 pb-16 pt-32 sm:px-10 lg:grid-cols-[1.05fr_.95fr] lg:pt-24">
      <div className="relative z-[1] max-w-2xl animate-rise"><Badge tone="yellow"><Sparkles size={13} /> Tu impacto, en movimiento</Badge><h1 className="mt-6 font-display text-6xl leading-[.95] tracking-[-.045em] text-[hsl(var(--primary))] sm:text-8xl">Pequeños gestos.<br /><em className="text-[hsl(var(--accent))]">Gran pulso.</em></h1><p className="mt-7 max-w-lg text-lg leading-relaxed text-[hsl(var(--muted-foreground))]">EcoPulse convierte lo que separas cada día en una historia que puedes ver, celebrar y compartir.</p><div className="mt-9 flex flex-wrap gap-3"><Link href="/sign-up" className="inline-flex items-center gap-2 rounded-full bg-[hsl(var(--primary))] px-6 py-3.5 font-semibold text-[hsl(var(--primary-foreground))] transition hover:-translate-y-1" data-testid="link-landing-start">Empieza tu pulso <ArrowRight size={17} /></Link><Link href="/sign-in" className="inline-flex items-center gap-2 rounded-full border border-[hsl(var(--border))] px-6 py-3.5 font-semibold text-[hsl(var(--primary))]" data-testid="link-landing-login">Ya tengo cuenta</Link></div><div className="mt-12 flex items-center gap-8 text-sm text-[hsl(var(--muted-foreground))]"><span><strong className="text-2xl text-[hsl(var(--primary))]">4.8k</strong><br />personas activas</span><span className="h-10 w-px bg-[hsl(var(--border))]" /><span><strong className="text-2xl text-[hsl(var(--primary))]">28 t</strong><br />desviadas del vertedero</span></div></div>
      <div className="relative flex min-h-[420px] items-center justify-center animate-rise [animation-delay:.12s]"><div className="absolute h-[390px] w-[390px] rounded-full bg-[hsl(var(--secondary)/.26)] blur-3xl" /><div className="relative h-[340px] w-[280px] rotate-[-7deg] rounded-[48%_52%_44%_56%] bg-[hsl(var(--primary))] p-7 shadow-[18px_25px_0_hsl(158_25%_23%/.14)]"><div className="absolute -right-12 top-10 h-28 w-28 rounded-full border-[18px] border-[hsl(var(--accent))] bg-[hsl(var(--background))]" /><div className="flex h-full flex-col justify-between rounded-[40%_45%_36%_50%] border border-[hsl(var(--primary-foreground)/.2)] p-6"><div className="flex justify-between text-[hsl(var(--primary-foreground)/.7)]"><Leaf size={26} /><span className="text-xs font-bold uppercase tracking-widest">EP / 01</span></div><div><p className="text-sm text-[hsl(var(--primary-foreground)/.7)]">Tu racha viva</p><p className="font-display text-7xl text-[hsl(var(--secondary))]">12</p><p className="text-sm font-semibold text-[hsl(var(--primary-foreground))]">días haciendo espacio</p></div><div className="flex items-center justify-between text-xs text-[hsl(var(--primary-foreground)/.75)]"><span>♢ 1.240 pts</span><span>+8.2 kg</span></div></div></div><div className="absolute bottom-4 left-0 rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card)/.9)] p-4 shadow-xl backdrop-blur sm:left-8"><div className="flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-xl bg-[hsl(var(--accent)/.18)] text-[hsl(var(--accent))]"><Recycle size={21} /></span><div><p className="text-xs text-[hsl(var(--muted-foreground))]">Último gesto</p><p className="font-semibold">Lata de conserva <span className="text-[hsl(var(--primary))]">+12</span></p></div></div></div></div>
    </section>
    <section className="border-y border-[hsl(var(--border))] bg-[hsl(var(--card)/.65)] px-5 py-10 sm:px-10"><div className="mx-auto flex max-w-7xl flex-col justify-between gap-5 sm:flex-row sm:items-center"><p className="font-display text-3xl text-[hsl(var(--primary))]">Una brújula para lo cotidiano.</p><p className="max-w-md text-sm leading-relaxed text-[hsl(var(--muted-foreground))]">Identifica. Separa. Repite. La claridad que necesitas, justo cuando tienes una cosa en la mano.</p></div></section>
    <section className="mx-auto grid max-w-7xl gap-5 px-5 py-20 sm:px-10 md:grid-cols-3"><Feature icon={<Camera />} number="01" title="Mira y aprende" text="Apunta a un residuo y descubre su ruta correcta en segundos." /><Feature icon={<Target />} number="02" title="Hazlo visible" text="Cada gesto suma a una racha tangible, sin culpas ni hojas de cálculo." /><Feature icon={<MapPin />} number="03" title="Encuentra tu lugar" text="Los puntos ecológicos cercanos convierten la intención en movimiento." /></section>
    <footer className="mx-auto flex max-w-7xl flex-col gap-4 border-t border-[hsl(var(--border))] px-5 py-8 text-sm text-[hsl(var(--muted-foreground))] sm:flex-row sm:items-center sm:justify-between sm:px-10"><span className="font-display text-xl text-[hsl(var(--primary))]">EcoPulse</span><span>Hecho para que volver a intentarlo se sienta bien.</span></footer>
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

function PrivateShell({ children, userName = "Tu nombre", userEmail = "Correo no disponible", onLogout = () => undefined }: { children: ReactNode; userName?: string; userEmail?: string; onLogout?: () => void }) {
  const [location, setLocation] = useLocation(); const [mobile, setMobile] = useState(false);
  const nav = [{ href: "/dashboard", label: "Tu pulso", icon: Leaf }, { href: "/scan", label: "Escanear", icon: Camera }, { href: "/map", label: "Puntos cercanos", icon: MapPin }, { href: "/rewards", label: "Recompensas", icon: Gift }, { href: "/chat", label: "Guía Eco", icon: MessageCircle }];
   return <div className="min-h-[100dvh] bg-[hsl(var(--background))]"><aside className={`fixed inset-y-0 left-0 z-30 flex w-72 flex-col bg-[hsl(var(--sidebar))] p-6 text-[hsl(var(--sidebar-foreground))] transition-transform md:translate-x-0 ${mobile ? "translate-x-0" : "-translate-x-full"}`}><div className="flex items-center justify-between"><Link href="/dashboard" className="flex items-center gap-2.5" data-testid="link-sidebar-brand"><IconLogo small /><span className="font-display text-2xl">EcoPulse</span></Link><button onClick={() => setMobile(false)} className="md:hidden" data-testid="button-close-menu"><X size={20} /></button></div><div className="mt-12 rounded-2xl bg-[hsl(var(--sidebar-accent))] p-4"><div className="flex items-center gap-3"><div className="grid h-10 w-10 place-items-center rounded-full bg-[hsl(var(--secondary))] font-bold text-[hsl(var(--primary))]">{userName.slice(0, 1)}</div><div className="min-w-0"><p className="truncate font-semibold">{userName}</p><p className="truncate text-xs text-[hsl(var(--sidebar-foreground)/.58)]">{userEmail}</p></div></div></div><nav className="mt-8 space-y-1">{nav.map(({ href, label, icon: I }) => <Link key={href} href={href} onClick={() => setMobile(false)} className={`flex items-center gap-3 rounded-2xl px-4 py-3 text-sm font-semibold transition ${location === href ? "bg-[hsl(var(--sidebar-primary))] text-[hsl(var(--sidebar-primary-foreground))]" : "text-[hsl(var(--sidebar-foreground)/.68)] hover:bg-[hsl(var(--sidebar-accent))] hover:text-[hsl(var(--sidebar-foreground))]"}`} data-testid={`link-nav-${label.toLowerCase().replaceAll(" ","-")}`}><I size={18} />{label}</Link>)}</nav><div className="mt-auto space-y-1"><Link href="/security" className="flex items-center gap-3 rounded-2xl px-4 py-3 text-sm font-semibold text-[hsl(var(--sidebar-foreground)/.68)] hover:bg-[hsl(var(--sidebar-accent))]" data-testid="link-nav-seguridad"><ShieldCheck size={18} />Seguridad</Link><button onClick={onLogout} className="flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-sm font-semibold text-[hsl(var(--sidebar-foreground)/.68)] hover:bg-[hsl(var(--sidebar-accent))]" data-testid="button-logout"><LogOut size={18} />Cerrar sesión</button></div></aside><div className="md:pl-72"><header className="sticky top-0 z-20 flex h-20 items-center justify-between border-b border-[hsl(var(--border)/.7)] bg-[hsl(var(--background)/.86)] px-5 backdrop-blur sm:px-10"><button onClick={() => setMobile(true)} className="rounded-full p-2 md:hidden" data-testid="button-open-menu"><Menu size={22} /></button><div className="hidden text-sm text-[hsl(var(--muted-foreground))] md:block">{location === "/dashboard" ? "Martes, 18 de junio" : "Tu espacio EcoPulse"}</div><div className="ml-auto flex items-center gap-3"><button className="relative rounded-full p-2 text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]" data-testid="button-notifications"><Bell size={19} /><i className="absolute right-1 top-1 h-2 w-2 rounded-full bg-[hsl(var(--accent))]" /></button><div className="hidden h-8 w-px bg-[hsl(var(--border))] sm:block" /><div className="hidden text-right sm:block"><p className="text-sm font-semibold">{userName}</p><p className="text-xs text-[hsl(var(--muted-foreground))]">{userEmail}</p></div><div className="grid h-9 w-9 place-items-center rounded-full bg-[hsl(var(--primary))] text-sm font-bold text-[hsl(var(--primary-foreground))]">{userName.slice(0, 1)}</div></div></header><main className="mx-auto max-w-7xl px-5 py-8 sm:px-10">{children}</main></div>{mobile && <button className="fixed inset-0 z-20 bg-[hsl(var(--sidebar)/.35)] md:hidden" onClick={() => setMobile(false)} aria-label="Cerrar menú" data-testid="button-overlay-menu" />}</div>;
}
function PageTitle({ eyebrow, title, copy, action }: { eyebrow: string; title: string; copy: string; action?: ReactNode }) { return <div className="mb-8 flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><p className="text-xs font-bold uppercase tracking-[.18em] text-[hsl(var(--accent))]">{eyebrow}</p><h1 className="mt-2 font-display text-5xl leading-none tracking-[-.03em] text-[hsl(var(--primary))]">{title}</h1><p className="mt-3 max-w-xl text-[hsl(var(--muted-foreground))]">{copy}</p></div>{action}</div>; }
function Dashboard() {
  const [scans] = useStored<Scan[]>("ep-scans", seedScans); const points = 1240 + scans.reduce((a, s) => a + s.points, 0) - 40; const categories = useMemo(() => scans.reduce<Record<string, number>>((a, s) => ({ ...a, [s.category]: (a[s.category] || 0) + 1 }), {}), [scans]);
   const { user } = useUser(); const userName = getDisplayName(user); const userEmail = getUserEmail(user);
   return <div className="animate-rise"><PageTitle eyebrow="Tu pulso · martes" title={`Hola, ${userName}.`} copy={`Cada cosa que separas deja un poco más de espacio para lo que importa. ${userEmail}`} action={<Link href="/scan" className="inline-flex items-center gap-2 rounded-full bg-[hsl(var(--primary))] px-5 py-3 font-semibold text-[hsl(var(--primary-foreground))]" data-testid="link-dashboard-scan"><Camera size={17} /> Escanear residuo</Link>} /><div className="grid gap-5 lg:grid-cols-[1.35fr_.65fr]"><section className="relative overflow-hidden rounded-[2rem] bg-[hsl(var(--primary))] p-7 text-[hsl(var(--primary-foreground))] sm:p-9"><div className="absolute -right-10 -top-16 h-52 w-52 rounded-full border-[28px] border-[hsl(var(--secondary)/.3)]" /><div className="relative flex flex-col justify-between gap-12 sm:flex-row"><div><p className="text-sm text-[hsl(var(--primary-foreground)/.68)]">Tu balance de esta semana</p><p className="mt-2 font-display text-6xl text-[hsl(var(--secondary))]">8,2 <span className="text-3xl">kg</span></p><p className="mt-1 text-sm text-[hsl(var(--primary-foreground)/.68)]">de residuos bien encaminados</p></div><div className="flex items-end gap-2 pb-1">{[42,58,51,74,62,88,68].map((h, i) => <div key={i} className="flex flex-col items-center gap-2"><span className={`w-3 rounded-full ${i === 6 ? "bg-[hsl(var(--secondary))]" : "bg-[hsl(var(--primary-foreground)/.2)]"}`} style={{ height: h }} /><small className="text-[10px] text-[hsl(var(--primary-foreground)/.55)]">{["L","M","X","J","V","S","D"][i]}</small></div>)}</div></div><div className="relative mt-8 flex items-center gap-2 text-sm text-[hsl(var(--primary-foreground)/.75)]"><Zap size={15} className="text-[hsl(var(--secondary))]" /> Vas un 18% por encima de tu ritmo habitual</div></section><section className="rounded-[2rem] border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-7"><div className="flex items-center justify-between"><span className="grid h-11 w-11 place-items-center rounded-2xl bg-[hsl(var(--secondary)/.32)] text-[hsl(var(--primary))]"><Trophy size={21} /></span><Badge tone="yellow">Nivel 3</Badge></div><p className="mt-7 text-sm text-[hsl(var(--muted-foreground))]">Saldo disponible</p><p className="font-display text-5xl text-[hsl(var(--primary))]">{points.toLocaleString("es-ES")} <span className="text-xl">pts</span></p><div className="mt-5 h-2 overflow-hidden rounded-full bg-[hsl(var(--muted))]"><div className="h-full w-[68%] rounded-full bg-[hsl(var(--secondary))]" /></div><p className="mt-2 text-xs text-[hsl(var(--muted-foreground))]">360 pts hasta Guardián del barrio</p><Link href="/rewards" className="mt-6 flex items-center justify-between rounded-xl bg-[hsl(var(--muted))] px-4 py-3 text-sm font-semibold hover:bg-[hsl(var(--secondary)/.5)]" data-testid="link-dashboard-rewards">Ver recompensas <ChevronRight size={16} /></Link></section></div><div className="mt-5 grid gap-5 md:grid-cols-[.8fr_1.2fr]"><section className="rounded-[2rem] border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-7"><div className="flex items-center justify-between"><h2 className="font-display text-2xl text-[hsl(var(--primary))]">Tu racha</h2><span className="text-[hsl(var(--accent))]"><Star fill="currentColor" size={22} /></span></div><p className="mt-5 font-display text-6xl text-[hsl(var(--primary))]">12 <span className="text-lg">días</span></p><p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">Tu mejor racha: 19 días</p><div className="mt-6 grid grid-cols-7 gap-2">{["L","M","X","J","V","S","D"].map((d, i) => <div key={d} className="text-center"><div className={`mx-auto mb-2 grid h-7 w-7 place-items-center rounded-full ${i < 5 ? "bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]" : "border border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))]"}`}>{i < 5 && <Check size={13} />}</div><span className="text-[10px] text-[hsl(var(--muted-foreground))]">{d}</span></div>)}</div></section><section className="rounded-[2rem] border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-7"><div className="flex items-center justify-between"><h2 className="font-display text-2xl text-[hsl(var(--primary))]">Actividad reciente</h2><Link href="/scan" className="text-sm font-semibold text-[hsl(var(--primary))]" data-testid="link-view-scans">Ver todo</Link></div><div className="mt-5 divide-y divide-[hsl(var(--border))]">{scans.slice(0, 3).map((s) => <div key={s.id} className="flex items-center gap-3 py-3.5" data-testid={`row-scan-${s.id}`}><span className="grid h-10 w-10 place-items-center rounded-xl bg-[hsl(var(--muted))] text-[hsl(var(--primary))]"><Recycle size={18} /></span><div className="min-w-0 flex-1"><p className="font-semibold">{s.name}</p><p className="text-xs text-[hsl(var(--muted-foreground))]">{s.category} · {s.date}</p></div><span className="font-semibold text-[hsl(var(--primary))]">+{s.points} pts</span></div>)}</div></section></div><div className="mt-5 flex flex-wrap items-center justify-between gap-4 rounded-3xl border border-[hsl(var(--border))] bg-[hsl(var(--secondary)/.17)] px-6 py-5"><div className="flex items-center gap-3"><span className="grid h-11 w-11 place-items-center rounded-2xl bg-[hsl(var(--secondary))] text-[hsl(var(--primary))]"><Leaf size={21} /></span><p><strong>Tu mezcla esta semana</strong><br /><span className="text-sm text-[hsl(var(--muted-foreground))]">{Object.entries(categories).map(([key, value]) => `${value} ${key.toLowerCase()}`).join(" · ")}</span></p></div><Link href="/chat" className="text-sm font-bold text-[hsl(var(--primary))]" data-testid="link-ask-guide">Preguntar a EcoGuía <ArrowRight size={15} className="ml-1 inline" /></Link></div></div>;
}

function ScanPage() {
  const [scans, setScans] = useStored<Scan[]>("ep-scans", seedScans); const [result, setResult] = useState<Scan | null>(null); const [image, setImage] = useState<string | null>(null); const [confirmed, setConfirmed] = useState(false);
  const demo = () => { setConfirmed(false); setResult({ id: `s${Date.now()}`, name: "Vaso de cartón", category: "Papel", confidence: 92, instructions: "Retira la tapa y cualquier resto líquido. Si está limpio y seco, va al contenedor azul.", points: 14, date: "Ahora" }); };
  const confirm = () => { if (result && !confirmed) { setScans([result, ...scans]); setConfirmed(true); } };
  return <div className="animate-rise"><PageTitle eyebrow="Reconocimiento amable" title="¿Qué tienes en la mano?" copy="Una foto basta para encontrar la ruta correcta. También puedes probar una identificación de ejemplo." /><div className="grid gap-5 lg:grid-cols-[1fr_.9fr]"><section className="leaf-pattern rounded-[2rem] border border-dashed border-[hsl(var(--primary)/.35)] bg-[hsl(var(--secondary)/.12)] p-6 sm:p-10"><div className="flex min-h-[360px] flex-col items-center justify-center text-center">{image ? <img src={image} alt="Residuo seleccionado" className="max-h-64 rounded-3xl object-contain shadow-lg" /> : <div className="grid h-20 w-20 place-items-center rounded-[28px] bg-[hsl(var(--card))] text-[hsl(var(--primary))] shadow-sm"><Upload size={29} /></div>}<h2 className="mt-6 font-display text-3xl text-[hsl(var(--primary))]">Suelta una imagen aquí</h2><p className="mt-2 max-w-sm text-sm text-[hsl(var(--muted-foreground))]">JPG o PNG, hasta 10 MB. La imagen se procesa en tu dispositivo.</p><div className="mt-6 flex flex-wrap justify-center gap-3"><label className="inline-flex cursor-pointer items-center gap-2 rounded-full bg-[hsl(var(--primary))] px-5 py-3 text-sm font-semibold text-[hsl(var(--primary-foreground))]" data-testid="label-upload"><Upload size={16} /> Elegir imagen<input type="file" accept="image/*" className="hidden" onChange={(e) => { const file = e.target.files?.[0]; if (file) setImage(URL.createObjectURL(file)); }} data-testid="input-scan-image" /></label><Button variant="outline" onClick={demo} data-testid="button-demo-scan"><Sparkles size={16} /> Probar demo</Button></div></div></section><section className="rounded-[2rem] border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6 sm:p-8">{result ? <div className="animate-rise"><div className="flex items-center justify-between"><Badge>{result.category}</Badge><span className="flex items-center gap-1 text-sm font-semibold text-[hsl(var(--primary))]"><Check size={15} /> {result.confidence}% confianza</span></div><h2 className="mt-7 font-display text-4xl text-[hsl(var(--primary))]">{result.name}</h2><div className="mt-7 rounded-2xl bg-[hsl(var(--muted))] p-5"><p className="text-xs font-bold uppercase tracking-[.15em] text-[hsl(var(--muted-foreground))]">Su siguiente paso</p><p className="mt-2 leading-relaxed">{result.instructions}</p></div><div className="mt-7 flex items-center justify-between border-t border-[hsl(var(--border))] pt-5"><span className="text-sm text-[hsl(var(--muted-foreground))]">Al confirmar</span><strong className="text-lg text-[hsl(var(--primary))]">+{result.points} pts</strong></div><Button onClick={confirm} disabled={confirmed} className="mt-5 w-full" data-testid="button-confirm-scan">{confirmed ? <><Check size={17} /> Sumado a tu pulso</> : "Confirmar y sumar puntos"}</Button></div> : <div className="flex min-h-[360px] flex-col justify-center"><div className="grid h-14 w-14 place-items-center rounded-2xl bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]"><Recycle size={24} /></div><h2 className="mt-6 font-display text-3xl text-[hsl(var(--primary))]">Tu lectura aparecerá aquí</h2><p className="mt-2 leading-relaxed text-[hsl(var(--muted-foreground))]">Prueba el modo demo para ver cómo una duda se convierte en una acción clara.</p><div className="mt-7 flex gap-2 text-xs text-[hsl(var(--muted-foreground))]"><span className="rounded-full bg-[hsl(var(--muted))] px-3 py-2">Vidrio</span><span className="rounded-full bg-[hsl(var(--muted))] px-3 py-2">Papel</span><span className="rounded-full bg-[hsl(var(--muted))] px-3 py-2">Envases</span></div></div>}</section></div><section className="mt-5 rounded-[2rem] border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6"><div className="flex items-center justify-between"><h2 className="font-display text-2xl text-[hsl(var(--primary))]">Tus últimos gestos</h2><span className="text-xs text-[hsl(var(--muted-foreground))]">{scans.length} registrados</span></div><div className="mt-4 flex flex-wrap gap-3">{scans.map(s => <div key={s.id} className="flex items-center gap-3 rounded-2xl bg-[hsl(var(--muted)/.65)] px-4 py-3" data-testid={`card-history-${s.id}`}><Recycle size={16} className="text-[hsl(var(--primary))]" /><span className="text-sm font-semibold">{s.name}</span><span className="text-xs text-[hsl(var(--primary))]">+{s.points}</span></div>)}</div></section></div>;
}

function LegacyMapPage() {
  const [query, setQuery] = useState(""); const [filter, setFilter] = useState("Todos"); const [located, setLocated] = useState(false); const [selected, setSelected] = useState<Place | null>(null); const types = ["Todos", "Papel", "Vidrio", "Envases", "Textil"];
  const filtered = places.filter(p => p.name.toLowerCase().includes(query.toLowerCase()) && (filter === "Todos" || p.types.includes(filter)));
   return <div className="animate-rise"><PageTitle eyebrow="Cerca de ti" title="Dale un lugar a cada cosa." copy="Encuentra el punto que recibe lo que tienes, con la tranquilidad de llegar a sitio. Zona de referencia: Montería, Córdoba." action={<Button variant="soft" onClick={() => { if (navigator.geolocation) navigator.geolocation.getCurrentPosition(() => setLocated(true), () => setLocated(true)); else setLocated(true); }} data-testid="button-locate"><LocateFixed size={16} /> {located ? "Zona detectada" : "Usar mi ubicación"}</Button>} /><div className="grid gap-5 lg:grid-cols-[.8fr_1.2fr]"><section className="order-2 rounded-[2rem] border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 lg:order-1"><div className="relative"><Search className="absolute left-4 top-3.5 text-[hsl(var(--muted-foreground))]" size={18} /><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Buscar por nombre o zona" className="w-full rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--background))] py-3 pl-11 pr-4 outline-none focus:ring-2 focus:ring-[hsl(var(--ring)/.4)]" data-testid="input-map-search" /></div><div className="mt-4 flex gap-2 overflow-auto pb-1">{types.map(t => <button key={t} onClick={() => setFilter(t)} className={`whitespace-nowrap rounded-full px-3.5 py-2 text-xs font-bold transition ${filter === t ? "bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]" : "bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]"}`} data-testid={`button-filter-${t.toLowerCase()}`}>{t}</button>)}</div><div className="mt-5 space-y-3">{filtered.map(p => <button key={p.id} onClick={() => setSelected(p)} className={`w-full rounded-2xl border p-4 text-left transition hover:-translate-y-0.5 hover:shadow-md ${selected?.id === p.id ? "border-[hsl(var(--primary))] bg-[hsl(var(--secondary)/.13)]" : "border-[hsl(var(--border))]"}`} data-testid={`card-place-${p.id}`}><div className="flex gap-3"><span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[hsl(var(--muted))] text-[hsl(var(--primary))]"><MapPin size={18} /></span><div className="min-w-0 flex-1"><div className="flex justify-between gap-2"><p className="font-semibold">{p.name}</p><span className="whitespace-nowrap text-xs font-bold text-[hsl(var(--primary))]">{p.distance}</span></div><p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">{p.address}</p><div className="mt-3 flex flex-wrap gap-1.5">{p.types.map(t => <span key={t} className="rounded-md bg-[hsl(var(--muted))] px-2 py-1 text-[10px] font-semibold">{t}</span>)}<span className={`ml-auto text-[10px] font-bold ${p.open ? "text-[hsl(var(--primary))]" : "text-[hsl(var(--muted-foreground))]"}`}>{p.open ? "Abierto ahora" : "Cierra hoy"}</span></div></div></div></button>)}{!filtered.length && <div className="py-12 text-center text-sm text-[hsl(var(--muted-foreground))]">No encontramos puntos con esos filtros.</div>}</div></section><section className="relative order-1 min-h-[550px] overflow-hidden rounded-[2rem] bg-[hsl(158_25%_28%)] lg:order-2"><div className="absolute inset-0 opacity-30 leaf-pattern" /><div className="absolute inset-8 rounded-[46%_54%_50%_45%] border border-[hsl(var(--secondary)/.32)]" /><div className="absolute left-[28%] top-[26%] h-36 w-48 rounded-[50%] bg-[hsl(158_35%_35%/.7)] blur-sm" /><div className="absolute bottom-[18%] right-[15%] h-44 w-60 rounded-[50%] bg-[hsl(13_58%_65%/.2)] blur-2xl" />{places.map((p, i) => <button key={p.id} onClick={() => setSelected(p)} className={`absolute grid h-11 w-11 place-items-center rounded-full border-4 border-[hsl(158_25%_28%)] shadow-lg transition hover:scale-110 ${selected?.id === p.id ? "bg-[hsl(var(--secondary))] text-[hsl(var(--primary))]" : "bg-[hsl(var(--card))] text-[hsl(var(--primary))]"}`} style={{ left: `${18 + (i * 21) % 65}%`, top: `${22 + (i * 17) % 56}%` }} data-testid={`button-map-pin-${p.id}`}><MapPin size={19} fill="currentColor" /></button>)}<div className="absolute bottom-5 left-5 right-5 flex items-center justify-between rounded-2xl bg-[hsl(var(--card)/.92)] p-4 backdrop-blur"><span className="flex items-center gap-2 text-sm font-semibold text-[hsl(var(--primary))]"><Compass size={18} /> {located ? "Mostrando puntos cerca de ti" : "Montería, Córdoba"}</span><span className="text-xs text-[hsl(var(--muted-foreground))]">{filtered.length} resultados</span></div>{selected && <div className="absolute left-5 right-5 top-5 rounded-2xl bg-[hsl(var(--card)/.95)] p-4 shadow-xl backdrop-blur"><div className="flex items-start justify-between"><div><Badge>{selected.open ? "Abierto" : "Cerrado"}</Badge><h3 className="mt-2 font-display text-2xl text-[hsl(var(--primary))]">{selected.name}</h3><p className="text-xs text-[hsl(var(--muted-foreground))]">{selected.address}</p></div><button onClick={() => setSelected(null)} data-testid="button-close-place"><X size={18} /></button></div><Button className="mt-4 w-full" onClick={() => window.open(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(selected.address)}`, "_blank")} data-testid="button-directions"><Navigation size={15} /> Cómo llegar</Button></div>}</section></div></div>;
}

function MapPage() {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("Todos");
  const [located, setLocated] = useState(false);
  const [selected, setSelected] = useState<Place | null>(null);
  const types = ["Todos", "Papel", "Vidrio", "Envases", "Textil"];
  const filtered = places.filter(p => p.name.toLowerCase().includes(query.toLowerCase()) && (filter === "Todos" || p.types.includes(filter)));
  const mapUrl = "https://www.openstreetmap.org/export/embed.html?bbox=-75.928%2C8.705%2C-75.835%2C8.805&layer=mapnik&marker=8.7575%2C-75.8814";

  return <div className="animate-rise">
    <PageTitle eyebrow="Cerca de ti" title="Dale un lugar a cada cosa." copy="Explora el mapa en vivo de Montería y encuentra el punto que recibe lo que tienes." action={<Button variant="soft" onClick={() => { if (navigator.geolocation) navigator.geolocation.getCurrentPosition(() => setLocated(true), () => setLocated(true)); else setLocated(true); }} data-testid="button-locate"><LocateFixed size={16} /> {located ? "Zona detectada" : "Usar mi ubicación"}</Button>} />
    <div className="grid gap-5 lg:grid-cols-[.8fr_1.2fr]">
      <section className="order-2 rounded-[2rem] border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 lg:order-1">
        <div className="relative"><Search className="absolute left-4 top-3.5 text-[hsl(var(--muted-foreground))]" size={18} /><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Buscar por nombre o zona" className="w-full rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--background))] py-3 pl-11 pr-4 outline-none focus:ring-2 focus:ring-[hsl(var(--ring)/.4)]" data-testid="input-map-search" /></div>
        <div className="mt-4 flex gap-2 overflow-auto pb-1">{types.map(t => <button key={t} onClick={() => setFilter(t)} className={`whitespace-nowrap rounded-full px-3.5 py-2 text-xs font-bold transition ${filter === t ? "bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]" : "bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]"}`} data-testid={`button-filter-${t.toLowerCase()}`}>{t}</button>)}</div>
        <div className="mt-5 space-y-3">{filtered.map(p => <button key={p.id} onClick={() => setSelected(p)} className={`w-full rounded-2xl border p-4 text-left transition hover:-translate-y-0.5 hover:shadow-md ${selected?.id === p.id ? "border-[hsl(var(--primary))] bg-[hsl(var(--secondary)/.13)]" : "border-[hsl(var(--border))]"}`} data-testid={`card-place-${p.id}`}><div className="flex gap-3"><span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[hsl(var(--muted))] text-[hsl(var(--primary))]"><MapPin size={18} /></span><div className="min-w-0 flex-1"><div className="flex justify-between gap-2"><p className="font-semibold">{p.name}</p><span className="whitespace-nowrap text-xs font-bold text-[hsl(var(--primary))]">{p.distance}</span></div><p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">{p.address}</p><div className="mt-3 flex flex-wrap gap-1.5">{p.types.map(t => <span key={t} className="rounded-md bg-[hsl(var(--muted))] px-2 py-1 text-[10px] font-semibold">{t}</span>)}<span className={`ml-auto text-[10px] font-bold ${p.open ? "text-[hsl(var(--primary))]" : "text-[hsl(var(--muted-foreground))]"}`}>{p.open ? "Abierto ahora" : "Cierra hoy"}</span></div></div></div></button>)}{!filtered.length && <div className="py-12 text-center text-sm text-[hsl(var(--muted-foreground))]">No encontramos puntos con esos filtros.</div>}</div>
      </section>
      <section className="relative order-1 min-h-[550px] overflow-hidden rounded-[2rem] border border-[hsl(var(--border))] bg-[hsl(158_25%_28%)] lg:order-2">
        <iframe title="Mapa en vivo de Montería, Córdoba" src={mapUrl} className="absolute inset-0 h-full w-full border-0" loading="lazy" data-testid="iframe-live-map" />
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-[hsl(158_25%_18%/.65)] via-transparent to-[hsl(158_25%_18%/.12)]" />
        <div className="absolute left-5 top-5 rounded-2xl bg-[hsl(var(--card)/.94)] p-4 shadow-lg backdrop-blur">
          <span className="flex items-center gap-2 text-sm font-bold text-[hsl(var(--primary))]"><Compass size={18} /> Montería, Córdoba</span>
          <p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">Mapa en vivo · OpenStreetMap</p>
          <a href="https://www.openstreetmap.org/?mlat=8.7575&mlon=-75.8814#map=13/8.7575/-75.8814" target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-xs font-bold text-[hsl(var(--primary))]" data-testid="link-open-live-map">Abrir mapa completo <ArrowRight size={13} /></a>
        </div>
        <div className="absolute bottom-5 left-5 right-5 flex items-center justify-between rounded-2xl bg-[hsl(var(--card)/.94)] p-4 shadow-lg backdrop-blur"><span className="flex items-center gap-2 text-sm font-semibold text-[hsl(var(--primary))]"><MapPin size={17} /> {located ? "Mostrando puntos cerca de ti" : "Centro de Montería"}</span><span className="text-xs text-[hsl(var(--muted-foreground))]">{filtered.length} resultados</span></div>
        {selected && <div className="absolute left-5 right-5 top-32 rounded-2xl bg-[hsl(var(--card)/.96)] p-4 shadow-xl backdrop-blur"><div className="flex items-start justify-between"><div><Badge>{selected.open ? "Abierto" : "Cerrado"}</Badge><h3 className="mt-2 font-display text-2xl text-[hsl(var(--primary))]">{selected.name}</h3><p className="text-xs text-[hsl(var(--muted-foreground))]">{selected.address}</p></div><button onClick={() => setSelected(null)} data-testid="button-close-place"><X size={18} /></button></div><Button className="mt-4 w-full" onClick={() => window.open(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(selected.address)}`, "_blank")} data-testid="button-directions"><Navigation size={15} /> Cómo llegar</Button></div>}
      </section>
    </div>
  </div>;
}

function RewardsPage() {
  const [balance, setBalance] = useStored("ep-balance", 1240); const [redeemed, setRedeemed] = useStored<string[]>("ep-redeemed", []); const [selected, setSelected] = useState<Reward | null>(null); const [category, setCategory] = useState("Todo");
  const cats = ["Todo", "Biodiversidad", "Reutiliza", "Hogar", "Impacto"]; const visible = rewards.filter(r => category === "Todo" || r.category === category);
  return <div className="animate-rise"><PageTitle eyebrow="Un poco para ti" title="Premios con raíz." copy="Canjea tus puntos por cosas que siguen haciendo bien, incluso después de llegar a tus manos." action={<div className="rounded-full bg-[hsl(var(--primary))] px-5 py-3 text-sm font-bold text-[hsl(var(--primary-foreground))]"><span className="text-[hsl(var(--secondary))]">{balance.toLocaleString("es-ES")}</span> pts disponibles</div>} /><div className="mb-6 flex gap-2 overflow-auto">{cats.map(c => <button key={c} onClick={() => setCategory(c)} className={`rounded-full px-4 py-2 text-xs font-bold ${category === c ? "bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]" : "bg-[hsl(var(--muted))]"}`} data-testid={`button-reward-filter-${c}`}>{c}</button>)}</div><div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">{visible.map((r, i) => { const done = redeemed.includes(r.id); return <article key={r.id} className="group overflow-hidden rounded-[2rem] border border-[hsl(var(--border))] bg-[hsl(var(--card))] transition hover:-translate-y-1 hover:shadow-xl" data-testid={`card-reward-${r.id}`}><div className={`relative grid h-48 place-items-center ${["bg-[hsl(43_84%_67%/.4)]","bg-[hsl(13_58%_65%/.25)]","bg-[hsl(158_42%_30%/.17)]","bg-[hsl(79_38%_48%/.22)]"][i]}`}><div className="grid h-24 w-24 rotate-3 place-items-center rounded-[35%] bg-[hsl(var(--card)/.7)] text-[hsl(var(--primary))] shadow-sm transition group-hover:rotate-[-5deg]"><Gift size={39} strokeWidth={1.5} /></div><Badge tone={i % 2 ? "coral" : "yellow"}>{r.category}</Badge></div><div className="p-5"><h3 className="font-display text-2xl text-[hsl(var(--primary))]">{r.name}</h3><p className="mt-2 min-h-12 text-sm leading-relaxed text-[hsl(var(--muted-foreground))]">{r.description}</p><div className="mt-5 flex items-center justify-between"><span className="font-semibold text-[hsl(var(--primary))]">{r.cost} pts</span><Button variant={done ? "soft" : "primary"} onClick={() => setSelected(r)} disabled={done || balance < r.cost} className="px-3.5 py-2 text-xs" data-testid={`button-redeem-${r.id}`}>{done ? <><Check size={14} /> Canjeado</> : balance < r.cost ? "Faltan puntos" : "Canjear"}</Button></div></div></article>; })}</div>{selected && <div className="fixed inset-0 z-50 grid place-items-center bg-[hsl(var(--sidebar)/.45)] p-5 backdrop-blur-sm"><div className="w-full max-w-md rounded-[2rem] bg-[hsl(var(--card))] p-7 shadow-2xl animate-rise"><div className="flex items-start justify-between"><div><Badge tone="yellow">Confirmar canje</Badge><h2 className="mt-4 font-display text-3xl text-[hsl(var(--primary))]">{selected.name}</h2></div><button onClick={() => setSelected(null)} data-testid="button-close-reward-dialog"><X /></button></div><p className="mt-4 leading-relaxed text-[hsl(var(--muted-foreground))]">Se descontarán <strong className="text-[hsl(var(--foreground))]">{selected.cost} puntos</strong> de tu saldo. Tu elección empieza a tener impacto ahora.</p><div className="mt-7 flex gap-3"><Button variant="outline" onClick={() => setSelected(null)} className="flex-1" data-testid="button-cancel-reward">Ahora no</Button><Button onClick={() => { setBalance(balance - selected.cost); setRedeemed([...redeemed, selected.id]); setSelected(null); }} className="flex-1" data-testid="button-confirm-reward">Confirmar canje</Button></div></div></div>}</div>;
}

function LegacySecurityPage() {
  const { user } = useUser(); const [notice, setNotice] = useState(false); const mfa = Boolean((user as any)?.twoFactorEnabled);
  return <div className="animate-rise"><PageTitle eyebrow="Tu cuenta, en calma" title="Seguridad clara." copy="Tus datos y tu identidad merecen la misma atención que el planeta." /><div className="grid gap-5 lg:grid-cols-[1.2fr_.8fr]"><section className="rounded-[2rem] border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-7 sm:p-9"><div className="flex items-start gap-4"><span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-[hsl(var(--secondary)/.3)] text-[hsl(var(--primary))]"><ShieldCheck size={27} /></span><div><h2 className="font-display text-3xl text-[hsl(var(--primary))]">Verificación en dos pasos</h2><p className="mt-2 leading-relaxed text-[hsl(var(--muted-foreground))]">Añade una capa extra para que solo tú puedas entrar a EcoPulse.</p></div></div><div className="mt-8 flex items-center justify-between rounded-2xl border border-[hsl(var(--border))] p-5"><div><div className="flex items-center gap-2"><span className={`h-2.5 w-2.5 rounded-full ${mfa ? "bg-[hsl(var(--primary))]" : "bg-[hsl(var(--accent))]"}`} /><strong>{mfa ? "Activa" : "Pendiente de configurar"}</strong></div><p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">{mfa ? "Tu cuenta está protegida con MFA de Clerk." : "Puedes activarla desde la configuración segura de Clerk."}</p></div><Button variant={mfa ? "soft" : "primary"} onClick={() => setNotice(true)} data-testid="button-configure-mfa">{mfa ? "Gestionar" : "Configurar"}</Button></div>{notice && <div className="mt-4 flex gap-3 rounded-2xl bg-[hsl(var(--secondary)/.2)] p-4 text-sm text-[hsl(var(--primary))]" data-testid="status-mfa-notice"><LockKeyhole size={18} className="shrink-0" /><p>La verificación se gestiona desde Clerk. Cuando MFA esté habilitado en tu instancia, se exigirá automáticamente durante el inicio de sesión.</p><button className="ml-auto" onClick={() => setNotice(false)} data-testid="button-dismiss-mfa"><X size={16} /></button></div>}</section><section className="rounded-[2rem] bg-[hsl(var(--primary))] p-7 text-[hsl(var(--primary-foreground))]"><LockKeyhole size={26} className="text-[hsl(var(--secondary))]" /><h2 className="mt-8 font-display text-3xl">Tu sesión está protegida</h2><p className="mt-3 leading-relaxed text-[hsl(var(--primary-foreground)/.72)]">EcoPulse usa Clerk para proteger el acceso, verificar tu email y cuidar cada sesión.</p><div className="mt-8 space-y-4 border-t border-[hsl(var(--primary-foreground)/.16)] pt-5 text-sm"><div className="flex items-center justify-between"><span>Email verificado</span><Check size={17} className="text-[hsl(var(--secondary))]" /></div><div className="flex items-center justify-between"><span>Sesión segura</span><Check size={17} className="text-[hsl(var(--secondary))]" /></div><div className="flex items-center justify-between"><span>Cuenta</span><span className="truncate pl-4 text-[hsl(var(--primary-foreground)/.62)]">{user?.primaryEmailAddress?.emailAddress || "Cuenta EcoPulse"}</span></div></div></section></div></div>;
}

const answer = (text: string) => { const t = text.toLowerCase(); if (t.includes("vidrio")) return "El vidrio va al contenedor verde. Vacía el envase, enjuágalo si hace falta y quita tapas o corchos: cada material tiene su propio camino."; if (t.includes("punto") || t.includes("cerca")) return "Puedes encontrar el punto más cercano en Puntos cercanos. Activa tu ubicación para ordenar la lista o busca por barrio."; if (t.includes("puntos") || t.includes("saldo")) return "Tu saldo crece al confirmar un escaneo. En Recompensas puedes transformarlo en semillas, objetos reutilizables o impacto directo."; if (t.includes("orgánico") || t.includes("compost")) return "Los restos de fruta, verdura, café y hojas pueden ir al compost. Evita mezclar envases, líquidos o carne si tu punto no los acepta."; return "Buena pregunta. Como regla rápida: vacía, limpia y separa por material. Si aún dudas, dime el residuo concreto y buscamos su mejor ruta."; };
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
  const [messages, setMessages] = useStored<ChatMessage[]>("ep-chat", seedChat); const [input, setInput] = useState(""); const quick = ["¿Dónde va el vidrio?", "¿Cómo gano puntos?", "Busca un punto cerca"];
  const send = (content = input) => { if (!content.trim()) return; const now = new Date().toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" }); setMessages([...messages, { id: `u${Date.now()}`, role: "user", content, timestamp: now }, { id: `a${Date.now() + 1}`, role: "assistant", content: answer(content), timestamp: now }]); setInput(""); };
  return <div className="animate-rise"><PageTitle eyebrow="Siempre a mano" title="Habla con EcoGuía." copy="Una respuesta clara para ese momento de duda frente al contenedor." /><div className="mx-auto max-w-3xl overflow-hidden rounded-[2rem] border border-[hsl(var(--border))] bg-[hsl(var(--card))]"><div className="flex items-center gap-3 border-b border-[hsl(var(--border))] p-5"><span className="grid h-11 w-11 place-items-center rounded-2xl bg-[hsl(var(--primary))] text-[hsl(var(--secondary))]"><Bot size={22} /></span><div><p className="font-semibold">EcoGuía</p><p className="flex items-center gap-1 text-xs text-[hsl(var(--primary))]"><span className="h-1.5 w-1.5 rounded-full bg-[hsl(var(--primary))]" /> Lista para ayudarte</p></div><button onClick={() => setMessages(seedChat)} className="ml-auto text-xs font-semibold text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--primary))]" data-testid="button-clear-chat">Limpiar chat</button></div><div className="flex min-h-[390px] flex-col gap-4 p-5 sm:p-7">{messages.map(m => <div key={m.id} className={`flex max-w-[88%] gap-2 ${m.role === "user" ? "ml-auto flex-row-reverse" : ""}`} data-testid={`message-${m.id}`}><span className={`grid h-8 w-8 shrink-0 place-items-center rounded-xl ${m.role === "user" ? "bg-[hsl(var(--secondary))] text-[hsl(var(--primary))]" : "bg-[hsl(var(--muted))] text-[hsl(var(--primary))]"}`}>{m.role === "user" ? <UserRound size={15} /> : <Bot size={15} />}</span><div className={`rounded-2xl px-4 py-3 text-sm leading-relaxed ${m.role === "user" ? "rounded-tr-sm bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]" : "rounded-tl-sm bg-[hsl(var(--muted))]"}`}><p>{m.content}</p><small className="mt-1 block text-[10px] opacity-60">{m.timestamp}</small></div></div>)}</div><div className="border-t border-[hsl(var(--border))] p-4"><div className="mb-3 flex gap-2 overflow-auto">{quick.map(q => <button key={q} onClick={() => send(q)} className="whitespace-nowrap rounded-full border border-[hsl(var(--border))] px-3 py-2 text-xs font-semibold text-[hsl(var(--primary))] hover:bg-[hsl(var(--muted))]" data-testid={`button-quick-${q.slice(0,5)}`}>{q}</button>)}</div><form onSubmit={e => { e.preventDefault(); send(); }} className="flex items-center gap-2"><input value={input} onChange={e => setInput(e.target.value)} placeholder="Escribe tu duda..." className="min-w-0 flex-1 rounded-full bg-[hsl(var(--muted))] px-5 py-3 text-sm outline-none focus:ring-2 focus:ring-[hsl(var(--ring)/.35)]" data-testid="input-chat-message" /><Button type="submit" className="h-11 w-11 shrink-0 rounded-full p-0" data-testid="button-send-chat"><ArrowRight size={18} /></Button></form></div></div></div>;
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
  const { isSignedIn, isLoaded } = useAuth(); const [path, setLocation] = useLocation(); const { signOut } = useClerk(); const { user } = useUser();
  if (!isLoaded) return <div className="grid min-h-[100dvh] place-items-center bg-[hsl(var(--background))]"><div className="h-12 w-12 animate-pulse rounded-2xl bg-[hsl(var(--secondary))]" /></div>;
  if (path.startsWith("/sign-in")) return <Switch><Route path="/sign-in/*?" component={AuthPages} /><Route component={AuthPages} /></Switch>;
  if (path.startsWith("/sign-up")) return <Switch><Route path="/sign-up/*?" component={AuthSignup} /><Route component={AuthSignup} /></Switch>;
  if (path === "/" && isSignedIn) return <Redirect to="/dashboard" />; if (!isSignedIn && path !== "/") return <Redirect to="/" />;
  if (!isSignedIn) return <Landing />;
   const userName = getDisplayName(user); const userEmail = getUserEmail(user); const logout = () => signOut({ redirectUrl: basePath || "/" });
   return <PrivateShell userName={userName} userEmail={userEmail} onLogout={logout}><Switch><Route path="/dashboard" component={Dashboard} /><Route path="/scan" component={ScanPage} /><Route path="/map" component={MapPage} /><Route path="/rewards" component={RewardsPage} /><Route path="/security" component={SecurityPage} /><Route path="/chat" component={ChatPage} /><Route component={NotFound} /></Switch></PrivateShell>;
}
function LocalAuthFallback() { const [path, setLocation] = useLocation(); if (path.startsWith("/sign-in") || path.startsWith("/sign-up")) return <Landing />; if (path === "/") return <Landing />; return <PrivateShell userName="Tu nombre" userEmail="Correo no disponible" onLogout={() => setLocation("/")}><Switch><Route path="/dashboard" component={Dashboard} /><Route path="/scan" component={ScanPage} /><Route path="/map" component={MapPage} /><Route path="/rewards" component={RewardsPage} /><Route path="/security" component={SecurityPage} /><Route path="/chat" component={ChatPage} /><Route component={NotFound} /></Switch></PrivateShell>; }
function NotFound() { return <div className="grid min-h-[100dvh] place-items-center bg-[hsl(var(--background))] p-6 text-center"><div><p className="font-mono text-sm text-[hsl(var(--accent))]">404</p><h1 className="mt-2 font-display text-5xl text-[hsl(var(--primary))]">Este camino aún no existe.</h1><Link href="/" className="mt-6 inline-flex rounded-full bg-[hsl(var(--primary))] px-5 py-3 font-semibold text-[hsl(var(--primary-foreground))]" data-testid="link-not-found-home">Volver al inicio</Link></div></div>; }
function App() { return <QueryClientProvider client={queryClient}><TooltipProvider>{clerkKey ? <ClerkProvider publishableKey={clerkKey} proxyUrl={clerkProxyUrl} appearance={clerkAppearance} signInUrl={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} localization={{ signIn: { start: { title: "Bienvenido de nuevo", subtitle: "Continúa tu pulso sostenible" } }, signUp: { start: { title: "Crea tu cuenta", subtitle: "Empieza a transformar tus hábitos" } } }} routerPush={(to) => { window.history.pushState({}, "", to); window.dispatchEvent(new PopStateEvent("popstate")); }} routerReplace={(to) => { window.history.replaceState({}, "", to); window.dispatchEvent(new PopStateEvent("popstate")); }}><WouterRouter base={basePath}><ErrorBoundary><AuthenticatedRouter /></ErrorBoundary></WouterRouter></ClerkProvider> : <WouterRouter base={basePath}><ErrorBoundary><LocalAuthFallback /></ErrorBoundary></WouterRouter>}<Toaster /></TooltipProvider></QueryClientProvider>; }
export default App;