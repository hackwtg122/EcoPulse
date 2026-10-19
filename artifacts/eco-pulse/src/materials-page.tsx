import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { useAuth } from "@clerk/react";
import {
  AlertTriangle, ArrowLeft, ArrowRight, BookOpen, Check, Leaf, MapPin, MessageCircle, Recycle, Search, X,
} from "lucide-react";
import {
  findMaterialById, materialCategoryLabels, materialCategories, materialSheets, searchMaterials,
  type MaterialCategory,
} from "@/materials-catalog";
import { recordMaterialView } from "@/explorer-progress";

const categoryTone: Record<MaterialCategory, string> = {
  paper: "bg-[hsl(43_84%_67%/.28)] text-[hsl(158_30%_19%)]",
  plastic: "bg-[hsl(158_42%_30%/.12)] text-[hsl(var(--primary))]",
  glass: "bg-[hsl(199_60%_45%/.16)] text-[hsl(199_70%_28%)]",
  metal: "bg-[hsl(220_18%_45%/.16)] text-[hsl(220_25%_30%)]",
  organic: "bg-[hsl(96_45%_42%/.18)] text-[hsl(120_40%_26%)]",
  special: "bg-[hsl(13_58%_65%/.2)] text-[hsl(13_55%_38%)]",
};

function CategoryTag({ category }: { category: MaterialCategory }) {
  return <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-[.12em] ${categoryTone[category]}`}>{materialCategoryLabels[category]}</span>;
}

function MaterialCard({ id }: { id: string }) {
  const material = findMaterialById(id);
  if (!material) return null;
  return <Link href={`/materials/${material.id}`} className="group flex flex-col rounded-[1.75rem] border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6 transition hover:-translate-y-1 hover:shadow-xl" data-testid={`material-card-${material.id}`}>
    <div className="flex items-start justify-between gap-3">
      <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-[hsl(var(--secondary)/.32)] text-[hsl(var(--primary))]">{material.category === "special" ? <AlertTriangle size={20} /> : <Recycle size={20} />}</span>
      {material.category === "special" && <span className="rounded-full bg-[hsl(13_58%_65%/.18)] px-2.5 py-1 text-[10px] font-bold uppercase tracking-[.12em] text-[hsl(13_55%_38%)]">Especial</span>}
    </div>
    <h3 className="mt-5 font-display text-2xl leading-tight text-[hsl(var(--primary))]">{material.name}</h3>
    <p className="mt-2 flex-1 text-sm leading-relaxed text-[hsl(var(--muted-foreground))]">{material.summary}</p>
    <div className="mt-4 flex items-center justify-between"><CategoryTag category={material.category} /><span className="inline-flex items-center gap-1 text-sm font-semibold text-[hsl(var(--primary))]">Ver ficha <ArrowRight size={15} /></span></div>
  </Link>;
}

export function MaterialsLibrary({ initialQuery = "", initialCategory = "all" }: { initialQuery?: string; initialCategory?: string }) {
  const normalizeCategory = (value: string): MaterialCategory | "all" => (materialCategories as readonly string[]).includes(value) ? (value as MaterialCategory) : "all";
  const [query, setQuery] = useState(initialQuery);
  const [category, setCategory] = useState<MaterialCategory | "all">(normalizeCategory(initialCategory));
  const results = useMemo(() => searchMaterials(query, category), [query, category]);
  const chips: Array<{ key: MaterialCategory | "all"; label: string }> = [{ key: "all", label: "Todos" }, ...materialCategories.map((key) => ({ key, label: materialCategoryLabels[key] }))];

  useEffect(() => {
    if (initialQuery) setQuery(initialQuery);
    setCategory(normalizeCategory(initialCategory));
  }, [initialQuery, initialCategory]);

  return <div className="animate-rise">
    <header className="max-w-3xl">
      <p className="text-xs font-bold uppercase tracking-[.18em] text-[hsl(var(--accent))]">Biblioteca abierta</p>
      <h1 className="mt-2 font-display text-4xl leading-none tracking-[-.03em] text-[hsl(var(--primary))] sm:text-5xl">Materiales y guías.</h1>
      <p className="mt-3 text-[hsl(var(--muted-foreground))]">Busca con el nombre cotidiano —«botella de gaseosa», «icopor», «lata», «pilas»— y consulta cómo preparar cada residuo antes de entregarlo. Información de orientación general; confirma siempre con el prestador local.</p>
    </header>

    <div className="mt-7">
      <label htmlFor="material-search" className="sr-only">Buscar material</label>
      <div className="relative max-w-2xl">
        <Search className="absolute left-4 top-3.5 text-[hsl(var(--muted-foreground))]" size={19} />
        <input id="material-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Busca: botella, cartón, icopor, pilas…" className="w-full rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] py-3.5 pl-12 pr-4 outline-none focus:ring-2 focus:ring-[hsl(var(--ring)/.4)]" data-testid="input-material-search" />
      </div>
      <div className="mt-4 flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Filtrar por categoría">
        {chips.map((chip) => <button key={chip.key} type="button" onClick={() => setCategory(chip.key)} role="tab" aria-selected={category === chip.key} className={`whitespace-nowrap rounded-full px-4 py-2 text-sm font-semibold transition ${category === chip.key ? "bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]" : "border border-[hsl(var(--border))] text-[hsl(var(--primary))] hover:bg-[hsl(var(--muted))]"}`} data-testid={`filter-material-${chip.key}`}>{chip.label}</button>)}
      </div>
    </div>

    <p className="mt-5 text-sm text-[hsl(var(--muted-foreground))]" aria-live="polite" data-testid="material-result-count">{results.length} {results.length === 1 ? "material" : "materiales"}{query ? ` para «${query}»` : ""}.</p>

    {results.length > 0
      ? <div className="mt-5 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">{results.map((material) => <MaterialCard key={material.id} id={material.id} />)}</div>
      : <div className="mt-5 rounded-[1.75rem] border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-10 text-center" data-testid="empty-material-results">
        <BookOpen className="mx-auto text-[hsl(var(--accent))]" size={32} />
        <h2 className="mt-4 font-display text-2xl text-[hsl(var(--primary))]">No encontramos ese material.</h2>
        <p className="mx-auto mt-2 max-w-md text-sm text-[hsl(var(--muted-foreground))]">Prueba con otro término («botella», «cartón», «vidrio») o revisa todas las categorías. Si es un residuo especial, revisa la categoría «Manejo especial».</p>
        <button type="button" onClick={() => { setQuery(""); setCategory("all"); }} className="mt-5 rounded-full bg-[hsl(var(--primary))] px-5 py-3 text-sm font-semibold text-[hsl(var(--primary-foreground))]" data-testid="button-clear-material-search">Ver todos los materiales</button>
      </div>}
  </div>;
}

export function MaterialFicha({ id }: { id: string }) {
  const material = findMaterialById(id);
  const { isSignedIn } = useAuth();
  useEffect(() => {
    if (material) recordMaterialView(material.id);
  }, [material]);
  if (!material) return <div className="animate-rise">
    <Link href="/materials" className="inline-flex items-center gap-2 text-sm font-semibold text-[hsl(var(--primary))]" data-testid="link-back-materials"><ArrowLeft size={16} /> Biblioteca de materiales</Link>
    <div className="mt-6 rounded-[1.75rem] border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-10 text-center">
      <h1 className="font-display text-3xl text-[hsl(var(--primary))]">No encontramos esa ficha.</h1>
      <p className="mt-2 text-sm text-[hsl(var(--muted-foreground))]">El material solicitado no existe en la biblioteca pública.</p>
    </div>
  </div>;

  const related = materialSheets.filter((item) => item.category === material.category && item.id !== material.id).slice(0, 3);
  const signedOutNote = "Inicia sesión para consultar el directorio de centros publicados y tus opciones de entrega.";

  return <div className="animate-rise">
    <Link href="/materials" className="inline-flex items-center gap-2 text-sm font-semibold text-[hsl(var(--primary))]" data-testid="link-back-materials"><ArrowLeft size={16} /> Biblioteca de materiales</Link>

    <header className="mt-6 max-w-3xl">
      <div className="flex flex-wrap items-center gap-3"><CategoryTag category={material.category} />{material.category === "special" && <span className="inline-flex items-center gap-1 rounded-full bg-[hsl(13_58%_65%/.18)] px-2.5 py-1 text-[11px] font-bold uppercase tracking-[.12em] text-[hsl(13_55%_38%)]"><AlertTriangle size={13} /> Manejo especial</span>}</div>
      <h1 className="mt-4 font-display text-4xl leading-tight tracking-[-.03em] text-[hsl(var(--primary))] sm:text-5xl" data-testid="material-ficha-title">{material.name}</h1>
      <p className="mt-3 leading-relaxed text-[hsl(var(--muted-foreground))]">{material.summary}</p>
      <p className="mt-3 text-sm text-[hsl(var(--muted-foreground))]">También lo encuentras como: {material.synonyms.join(", ")}.</p>
    </header>

    {material.special && <div className="mt-7 flex gap-3 rounded-[1.5rem] border border-[hsl(13_58%_65%/.4)] bg-[hsl(13_58%_65%/.08)] p-5" role="note" data-testid="material-special-warning"><AlertTriangle className="mt-0.5 shrink-0 text-[hsl(13_55%_38%)]" size={20} /><div><p className="font-semibold text-[hsl(13_55%_38%)]">Manejo especial requerido</p><p className="mt-1 text-sm leading-relaxed text-[hsl(13_55%_32%)]">{material.special}</p></div></div>}

    <div className="mt-7 grid gap-5 md:grid-cols-3">
      <section className="rounded-[1.75rem] border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6" data-testid="material-section-yes">
        <div className="flex items-center gap-2 text-[hsl(var(--primary))]"><span className="grid h-8 w-8 place-items-center rounded-xl bg-[hsl(158_42%_30%/.12)]"><Check size={17} /></span><h2 className="font-display text-2xl">Sí</h2></div>
        <ul className="mt-4 space-y-3 text-sm leading-relaxed">{material.yes.map((item) => <li key={item} className="flex gap-2"><Check size={16} className="mt-0.5 shrink-0 text-[hsl(var(--primary))]" />{item}</li>)}</ul>
      </section>
      <section className="rounded-[1.75rem] border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6" data-testid="material-section-no">
        <div className="flex items-center gap-2 text-[hsl(13_55%_38%)]"><span className="grid h-8 w-8 place-items-center rounded-xl bg-[hsl(13_58%_65%/.16)]"><X size={17} /></span><h2 className="font-display text-2xl">No</h2></div>
        <ul className="mt-4 space-y-3 text-sm leading-relaxed">{material.no.map((item) => <li key={item} className="flex gap-2"><X size={16} className="mt-0.5 shrink-0 text-[hsl(13_55%_38%)]" />{item}</li>)}</ul>
      </section>
      <section className="rounded-[1.75rem] border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6" data-testid="material-section-before">
        <div className="flex items-center gap-2 text-[hsl(var(--primary))]"><span className="grid h-8 w-8 place-items-center rounded-xl bg-[hsl(var(--secondary)/.4)]"><Leaf size={17} /></span><h2 className="font-display text-2xl">Antes de entregar</h2></div>
        <ol className="mt-4 space-y-3 text-sm leading-relaxed">{material.before.map((item, index) => <li key={item} className="flex gap-2"><span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-[hsl(var(--muted))] text-[11px] font-bold text-[hsl(var(--primary))]">{index + 1}</span>{item}</li>)}</ol>
      </section>
    </div>

    <section className="mt-5 rounded-[1.75rem] border border-[hsl(var(--border))] bg-[hsl(var(--muted)/.5)] p-6 text-sm" data-testid="material-source">
      <p className="font-semibold text-[hsl(var(--primary))]">Fuente y fecha de revisión</p>
      <p className="mt-2 leading-relaxed text-[hsl(var(--muted-foreground))]">{material.source}</p>
      <p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">Última revisión editorial: {material.reviewedAt}. Esta ficha no confirma que un centro cercano reciba el material.</p>
    </section>

    <section className="mt-5 rounded-[1.75rem] bg-[hsl(var(--primary))] p-6 text-[hsl(var(--primary-foreground))] sm:p-8" data-testid="material-actions">
      <h2 className="font-display text-3xl">¿Y ahora qué hago con esto?</h2>
      <p className="mt-2 max-w-xl leading-relaxed text-[hsl(var(--primary-foreground)/.75)]">{isSignedIn ? "Consulta el directorio de centros publicados o pregunta a EcoGuía por este material." : signedOutNote}</p>
      <div className="mt-6 flex flex-wrap gap-3">
        {isSignedIn
          ? <Link href={`/map?material=${material.id}`} className="inline-flex items-center gap-2 rounded-full bg-[hsl(var(--secondary))] px-5 py-3 text-sm font-semibold text-[hsl(var(--primary))] transition hover:-translate-y-0.5" data-testid="link-material-map"><MapPin size={17} /> Buscar dónde entregarlo</Link>
          : <Link href="/sign-in" className="inline-flex items-center gap-2 rounded-full bg-[hsl(var(--secondary))] px-5 py-3 text-sm font-semibold text-[hsl(var(--primary))]" data-testid="link-material-signin-map"><MapPin size={17} /> Iniciar sesión para ver centros</Link>}
        {isSignedIn
          ? <Link href="/chat" className="inline-flex items-center gap-2 rounded-full border border-[hsl(var(--primary-foreground)/.35)] px-5 py-3 text-sm font-semibold text-[hsl(var(--primary-foreground))]" data-testid="link-material-chat"><MessageCircle size={17} /> Preguntar a EcoGuía</Link>
          : <Link href="/sign-in" className="inline-flex items-center gap-2 rounded-full border border-[hsl(var(--primary-foreground)/.35)] px-5 py-3 text-sm font-semibold text-[hsl(var(--primary-foreground))]" data-testid="link-material-signin-chat"><MessageCircle size={17} /> Iniciar sesión para preguntar</Link>}
      </div>
    </section>

    {related.length > 0 && <section className="mt-8">
      <h2 className="font-display text-2xl text-[hsl(var(--primary))]">Otros materiales de {materialCategoryLabels[material.category].toLowerCase()}</h2>
      <div className="mt-4 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">{related.map((item) => <MaterialCard key={item.id} id={item.id} />)}</div>
    </section>}
  </div>;
}
