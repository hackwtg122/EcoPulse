import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { ArrowRight, Award, BookOpen, CheckCircle2, CircleHelp, Compass, Gift, Leaf, MapPin, Recycle, ScanLine, ShieldCheck, Sprout, Target, Users } from "lucide-react";
import natureImage from "./assets/reward-nature-premium.svg";
import badgeImage from "./assets/reward-badge-premium.svg";
import kitImage from "./assets/reward-kit-premium.svg";
import "./public-landing.css";
import { readPublicImpact, type PublicImpact, type PreviewReward } from "./public-impact-data";

const url = (import.meta.env.VITE_PILOT_API_URL?.trim() || "http://127.0.0.1:5001").replace(/\/$/, "");
const rewardImages: Record<string, string> = {
  "nature-v1": natureImage, "badge-v1": badgeImage, "guide-v1": kitImage,
};

function useImpact() {
  const [impact, setImpact] = useState<PublicImpact | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  useEffect(() => {
    const controller = new AbortController();
    const refresh = async () => {
      if (document.hidden || controller.signal.aborted) return;
      try {
        const response = await fetch(url + "/api/public/impact", {
          headers: { Accept: "application/json" }, cache: "no-store", signal: controller.signal,
        });
        if (!response.ok) throw Error("public_api_unavailable");
        const result = readPublicImpact(await response.json());
        if (!controller.signal.aborted) { setImpact(result); setState("ready"); }
      } catch {
        if (!controller.signal.aborted) setState(old => old === "ready" ? old : "error");
      }
    };
    void refresh();
    const interval = window.setInterval(() => { void refresh(); }, 90_000);
    const onFocus = () => { if (!document.hidden) void refresh(); };
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      controller.abort(); window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, []);
  return { impact, state };
}

function AnimatedCount({ value }: { value: number | null }) {
  const element = useRef<HTMLSpanElement>(null);
  const [count, setCount] = useState(0);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!element.current || typeof IntersectionObserver === "undefined") { setVisible(true); return; }
    const watcher = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { setVisible(true); watcher.disconnect(); }
    }, { threshold: 0.1 });
    watcher.observe(element.current);
    return () => watcher.disconnect();
  }, []);
  useEffect(() => {
    if (value == null || !visible) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || value === 0) { setCount(value); return; }
    let frame = 0;
    const start = performance.now();
    const step = (now: number) => {
      const progress = Math.min(1, (now - start) / 1100);
      setCount(Math.round(value * (1 - Math.pow(1 - progress, 3))));
      if (progress < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [value, visible]);
  return <span ref={element} className="tabular-nums" aria-label={value == null ? "Cifra no disponible" : String(value)}>{value == null ? "—" : new Intl.NumberFormat("es-CO").format(count)}</span>;
}

function PulseOrb() {
  return <div className="ep-pulse-stage" aria-label="EcoPulse, energía para aprender y reciclar">
    <div className="ep-pulse-halo" aria-hidden="true" />
    <div className="ep-pulse-orbit" aria-hidden="true" />
    <div className="ep-pulse-orb">
      <div className="ep-pulse-orb-inner">
        <div className="ep-pulse-orb-top"><Leaf size={29}/><span>EP / 01</span></div>
        <div className="ep-pulse-orb-title"><span>Tu pulso</span><strong>Pulso</strong><small>Progreso que se construye</small></div>
        <div className="ep-pulse-wave" aria-hidden="true"><svg viewBox="0 0 300 48" fill="none" preserveAspectRatio="none"><path d="M1 26 H106 L117 15 L128 34 L145 2 L157 44 L173 26 H298" stroke="#F4D578" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"/></svg></div>
        <p>Aprende <span aria-hidden="true">·</span> Participa <span aria-hidden="true">·</span> Crece</p>
      </div>
    </div>
    <div className="ep-orbit-chip ep-orbit-chip-one"><Recycle size={21}/></div>
    <div className="ep-orbit-chip ep-orbit-chip-two"><Sprout size={25}/></div>
    <div className="ep-orbit-chip ep-orbit-chip-three"><Leaf size={21}/></div>
    <div className="ep-orbit-coin" aria-hidden="true"><Leaf size={32}/></div>
    <div className="ep-pulse-caption"><span className="ep-pulse-caption-icon"><Recycle size={22}/></span><span><small>Cada gesto</small><strong>Suma a tu aprendizaje</strong></span></div>
  </div>;
}

const stories = [
  { initials: "VM", name: "Valentina", focus: "Separación de residuos", copy: "Aprendí a separar mejor el vidrio y el cartón. Ahora sé qué revisar antes de reciclar.", icon: Recycle, gradient: "mint" },
  { initials: "DR", name: "Daniel", focus: "Retos ecológicos", copy: "Los retos convierten temas ambientales en preguntas divertidas y fáciles de recordar.", icon: Target, gradient: "gold" },
  { initials: "CP", name: "Camila", focus: "Aprendizaje diario", copy: "Me gusta tener guías, centros y consejos en un mismo lugar para descubrir nuevos hábitos.", icon: Leaf, gradient: "coral" },
] as const;

function StoriesSection() {
  return <section className="ep-public-section ep-stories-section" aria-labelledby="ep-stories-title">
    <div className="ep-section-heading">
      <div><p className="ep-eyebrow"><Users size={15}/> Inspiración colectiva</p><h2 id="ep-stories-title">Historias que inspiran.</h2><p>Imagina lo que puedes aprender y compartir con EcoPulse.</p></div>
      <span className="ep-story-disclaimer"><CircleHelp size={15}/> Relatos ilustrativos</span>
    </div>
    <div className="ep-story-list" aria-label="Ejemplos ficticios de experiencias educativas">
      {stories.map((story, index) => {
        const Icon = story.icon;
        return <article className="ep-story-card" key={story.initials}>
          <div className={"ep-story-art ep-story-art-" + story.gradient}>
            <div className="ep-story-art-sun" /><div className="ep-story-art-hill"/><div className="ep-story-art-leaf"><Icon size={39}/></div>
            <span className="ep-story-art-tag"><Icon size={14}/>{story.focus}</span>
          </div>
          <div className="ep-story-content"><div className="ep-story-person"><span className={"ep-story-avatar ep-story-avatar-" + index}>{story.initials}</span><div><strong>{story.name}</strong><small>Personaje ficticio</small></div></div>
            <blockquote>“{story.copy}”</blockquote>
          </div>
        </article>;
      })}
    </div>
    <p className="ep-stories-footnote">Las historias y personajes de esta sección son ejemplos creativos; no son opiniones ni experiencias verificadas de usuarios.</p>
  </section>;
}

function ImpactStats({ impact, state }: { impact: PublicImpact | null; state: "loading" | "ready" | "error" }) {
  const metrics = [
    { label: "Zonas publicadas", value: impact?.centers ?? null, icon: MapPin, note: "en el catálogo" },
    { label: "Retos ecológicos", value: impact?.challenges ?? null, icon: Target, note: "activos" },
    { label: "Premios disponibles", value: impact?.rewards ?? null, icon: Gift, note: "digitales" },
    { label: "Entregas verificadas", value: impact?.verifiedDeliveries ?? null, icon: CheckCircle2, note: "registradas" },
  ];
  return <section className="ep-stats-wrap" aria-label="Indicadores reales y actualizados de EcoPulse">
    <div className="ep-stats-heading"><p className="ep-eyebrow"><ShieldCheck size={15}/> Cifras del sistema</p><p>{state === "ready" ? "Datos actuales de EcoPulse" : state === "loading" ? "Consultando indicadores..." : "Indicadores temporalmente no disponibles"}</p></div>
    <div className="ep-public-stats">{metrics.map(metric => {
      const Icon = metric.icon;
      return <div className="ep-stat-card" key={metric.label}>
        <div className="ep-stat-icon"><Icon size={23}/></div><strong><AnimatedCount value={metric.value}/></strong>
        <span>{metric.label}</span><small>{metric.note}</small>
      </div>;
    })}</div>
    <p className="ep-stat-note">Las cifras se obtienen de registros del sistema. Las zonas publicadas pueden requerir coordinación de una dirección física antes de acudir.</p>
  </section>;
}

function PreviewRewards({ rewards }: { rewards: PreviewReward[] | null }) {
  return <section className="ep-preview-rewards" aria-labelledby="ep-rewards-title">
    <div className="ep-section-heading"><div><p className="ep-eyebrow"><Gift size={15}/> Beneficios EcoPulse</p><h2 id="ep-rewards-title">Recompensas con propósito.</h2><p>Conoce los premios digitales disponibles.</p></div></div>
    {rewards == null ? <p className="ep-public-empty">Consultando premios publicados...</p> :
      rewards.length ? <div className="ep-preview-reward-grid">
        {rewards.map(reward => <article className="ep-preview-reward" key={reward.id}>
          <div className="ep-preview-reward-image">{rewardImages[reward.kind] ? <img loading="lazy" src={rewardImages[reward.kind]} alt={"Ilustración promocional de " + reward.title}/> : <Gift size={34}/>}</div>
          <div className="ep-preview-reward-body"><h3>{reward.title}</h3><span>{reward.cost} EcoPuntos</span></div>
        </article>)}
      </div> : <p className="ep-public-empty">Aún no hay recompensas digitales con cupos disponibles.</p>}
    <Link className="ep-inline-link" href="/sign-up">Participar y ganar EcoPuntos <ArrowRight size={16}/></Link>
  </section>;
}

export function PublicEcoPulseExperience() {
  const { impact, state } = useImpact();
  return <>
    <section className="ep-public-hero" aria-labelledby="ep-hero-title">
      <div className="ep-hero-copy">
        <p className="ep-eyebrow"><Sprout size={17}/> Sostenibilidad en acción</p>
        <h1 id="ep-hero-title">Una comunidad que <span>aprende, actúa</span> y genera <em>impacto real.</em></h1>
        <p className="ep-hero-subtitle">Descubre guías, retos, centros y recompensas para construir hábitos más sostenibles.</p>
        <div className="ep-hero-actions"><Link href="/explore" className="ep-primary-cta" data-testid="link-explore-without-account"><Compass size={21}/> Explorar EcoPulse <ArrowRight size={21}/></Link><Link href="/materials" className="ep-secondary-cta" data-testid="link-landing-materials"><BookOpen size={18}/> Materiales y guías</Link></div>
        <p className="ep-hero-trust"><CheckCircle2 size={17}/> Explora las herramientas públicas sin iniciar sesión.</p>
      </div>
      <PulseOrb/>
    </section>
    <ImpactStats impact={impact} state={state}/>
    <StoriesSection/>
    <section className="ep-public-section ep-steps-section" aria-labelledby="ep-how-title">
      <div className="ep-section-heading"><div><p className="ep-eyebrow"><Sprout size={15}/> Una experiencia sencilla</p><h2 id="ep-how-title">Así funciona EcoPulse.</h2><p>Empieza aprendiendo; cuando quieras guardar tu progreso, crea una cuenta.</p></div></div>
      <div className="ep-step-grid">
        <article className="ep-step"><span><BookOpen size={27}/></span><small>01</small><h3>Explora</h3><p>Consulta materiales y descubre cómo separar tus residuos.</p></article>
        <article className="ep-step"><span><ScanLine size={27}/></span><small>02</small><h3>Participa</h3><p>Con una cuenta, resuelve retos y registra tu actividad.</p></article>
        <article className="ep-step"><span><Award size={27}/></span><small>03</small><h3>Avanza</h3><p>Gana EcoPuntos según las reglas y canjea premios disponibles.</p></article>
      </div>
    </section>
    <div className="ep-public-section ep-discovery-grid">
      <section className="ep-discovery-center" aria-labelledby="ep-centers-title"><p className="ep-eyebrow"><MapPin size={15}/> Zonas EcoPulse</p><h2 id="ep-centers-title">Encuentra puntos en Montería.</h2><p>Consulta las zonas publicadas y comprueba sus condiciones antes de desplazarte.</p><div className="ep-location-preview"><div className="ep-location-pins" aria-hidden="true"><span><MapPin size={20}/></span><span><MapPin size={20}/></span><span><MapPin size={20}/></span></div><strong><AnimatedCount value={impact?.centers ?? null}/></strong><small>zonas publicadas</small></div><Link href="/explore#centros" className="ep-primary-cta">Explorar centros <ArrowRight size={18}/></Link></section>
      <PreviewRewards rewards={state === "ready" && impact ? impact.featuredRewards : null}/>
    </div>
    <section className="ep-final-cta"><div><p className="ep-eyebrow">Un futuro más sostenible</p><h2>Empieza con un pequeño gesto. <em>Hazlo crecer.</em></h2><p>Recorre EcoPulse sin crear una cuenta y descubre lo que puedes hacer hoy.</p></div><Link href="/explore" className="ep-final-link">Explorar gratis <ArrowRight size={19}/></Link></section>
  </>;
}

export function PublicExplorePage() {
  const { impact, state } = useImpact();
  return <div className="ep-explore-page">
    <div className="ep-explore-heading"><p className="ep-eyebrow"><Compass size={17}/> Área pública de EcoPulse</p><h1>Explora a tu ritmo.</h1><p>Accede a información sobre materiales, zonas y premios digitales sin registrarte.</p>
      <div className="ep-hero-actions"><Link href="/materials" className="ep-primary-cta"><BookOpen size={18}/> Ver materiales <ArrowRight size={18}/></Link><Link href="/faq" className="ep-secondary-cta"><CircleHelp size={18}/> Preguntas frecuentes</Link></div></div>
    <ImpactStats impact={impact} state={state}/>
    <section className="ep-public-section" id="centros" aria-labelledby="ep-explore-centers">
      <div className="ep-section-heading"><div><p className="ep-eyebrow"><MapPin size={15}/> Directorio público</p><h2 id="ep-explore-centers">Puntos y zonas publicados.</h2><p>Las ubicaciones son referencias del sistema. Confirma la recepción, dirección y horario antes de desplazarte.</p></div></div>
      {state === "error" ? <p className="ep-public-empty">No fue posible consultar los puntos en este momento.</p> : state === "loading" ? <p className="ep-public-empty">Cargando puntos publicados...</p> :
        impact?.points.length ? <div className="ep-public-center-grid">{impact.points.map(point => <article className="ep-public-center-card" key={point.id}><span><MapPin size={23}/></span><h3>{point.name}</h3><p>{point.municipality}</p><a href={"https://www.openstreetmap.org/?mlat=" + point.latitude + "&mlon=" + point.longitude + "#map=15/" + point.latitude + "/" + point.longitude} target="_blank" rel="noopener noreferrer">Ver ubicación de referencia <ArrowRight size={15}/></a></article>)}</div> :
        <p className="ep-public-empty">No hay puntos publicados con coordenadas disponibles.</p>}
    </section>
    <PreviewRewards rewards={state === "ready" && impact ? impact.featuredRewards : null}/>
    <div className="ep-final-cta"><div><h2>¿Quieres guardar tu progreso?</h2><p>Crea una cuenta para participar en retos, solicitar entregas y canjear premios.</p></div><Link href="/sign-up" className="ep-final-link">Crear cuenta <ArrowRight size={17}/></Link></div>
  </div>;
}
