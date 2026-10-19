import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@clerk/react";
import { MapContainer, Marker, Popup, TileLayer, useMap } from "react-leaflet";
import L, { LatLngBounds } from "leaflet";
import "leaflet/dist/leaflet.css";
// Iconos locales empaquetados por Vite: sin dependencia de CDNs externos.
import markerIconUrl from "leaflet/dist/images/marker-icon.png";
import markerIcon2xUrl from "leaflet/dist/images/marker-icon-2x.png";
import markerShadowUrl from "leaflet/dist/images/marker-shadow.png";
import { ArrowRight, Heart, MapPin, Navigation, Search, FlaskConical, Building2 } from "lucide-react";
import { materialCategoryLabels } from "./materials-catalog";
import type { PilotDeliveryOptions } from "./pilot-api";
import { mapAcademicCenters } from "./map-catalog";
const categoryLabels = materialCategoryLabels as Record<string, string>;

L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2xUrl,
  iconUrl: markerIconUrl,
  shadowUrl: markerShadowUrl,
});

// Icono propio (SVG en data-URI) para los puntos de PRUEBA: identifica de forma
// visual y consistente los registros de evaluación sin depender de imágenes externas.
function testPointIcon(selected: boolean): L.Icon {
  const size = selected ? 42 : 34;
  const stroke = selected ? "#0f766e" : "#166534";
  const fill = selected ? "#facc15" : "#4ade80";
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 42" width="${size}" height="${size}">` +
    `<path d="M16 1C7.7 1 1 7.7 1 16c0 10.5 13.4 23.6 14 24.2.6.6 1.6.6 2.2 0C17.8 39.6 31 26.5 31 16 31 7.7 24.3 1 16 1z" fill="${fill}" stroke="${stroke}" stroke-width="2"/>` +
    `<circle cx="16" cy="16" r="6" fill="${stroke}"/></svg>`;
  return new L.Icon({
    iconUrl: `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`,
    iconRetinaUrl: `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size],
    popupAnchor: [0, -size + 6],
    shadowUrl: "",
    className: "eco-test-marker",
  });
}

export type TestPoint = {
  id: string;
  name: string;
  zone: string;
  lat: number;
  lng: number;
  materials: string[];
  hours: string;
  capacity: number;
  responsible: string;
  isTest: true;
  address?: string;
  slots?: PilotDeliveryOptions["points"][number]["slots"];
};

const defaultCenter = { lat: 8.755, lng: -75.8815 };
const defaultZoom = 13;

type MapControllerProps = {
  selectedId: string | null;
  points: TestPoint[];
  bounds: LatLngBounds | null;
};

function MapController({ selectedId, points, bounds }: MapControllerProps) {
  const map = useMap();
  const prevId = useRef<string | null>(null);

  useEffect(() => {
    if (bounds) {
      map.fitBounds(bounds, { padding: [40, 40] });
      return;
    }
    map.setView(defaultCenter, defaultZoom);
  }, [bounds, map]);

  useEffect(() => {
    if (selectedId && selectedId !== prevId.current) {
      const point = points.find((p) => p.id === selectedId);
      if (point) {
        map.flyTo([point.lat, point.lng], Math.max(map.getZoom(), 15), { duration: 0.8 });
      }
    }
    prevId.current = selectedId;
  }, [selectedId, points, map]);

  return null;
}

export function InteractiveMap({
  points,
  selectedId,
  onSelect,
  query,
  materialFilter,
  onQueryChange,
  onMaterialChange,
  favoriteIds,
  onToggleFavorite,
}: {
  points: TestPoint[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  query: string;
  materialFilter: string;
  onQueryChange: (v: string) => void;
  onMaterialChange: (v: string) => void;
  favoriteIds?: ReadonlySet<string>;
  onToggleFavorite?: (id: string) => void;
}) {
  const filtered = useMemo(() => {
    const q = query.toLocaleLowerCase("es-CO");
    return points.filter((p) => {
      const text = `${p.name} ${p.zone} ${p.responsible}`.toLocaleLowerCase("es-CO");
      const matchesQ = !q || text.includes(q);
      const matchesM = !materialFilter || p.materials.includes(materialFilter);
      return matchesQ && matchesM;
    });
  }, [points, query, materialFilter]);

  const bounds = useMemo(() => {
    if (filtered.length === 0) return null;
    const b = L.latLngBounds([]);
    for (const p of filtered) b.extend([p.lat, p.lng]);
    return b;
  }, [filtered]);

  const materialOptions = useMemo(() => [...new Set(points.flatMap((p) => p.materials))].sort(), [points]);

  return (
    <div className="grid gap-5 lg:grid-cols-[.9fr_1.1fr]">
      <section className="order-2 rounded-[2rem] border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 sm:p-5 lg:order-1">
        <div className="relative">
          <Search className="absolute left-4 top-3.5 text-[hsl(var(--muted-foreground))]" size={18} aria-hidden />
          <input
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder="Buscar por zona, centro o responsable"
            className="w-full rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--background))] py-3 pl-11 pr-4 outline-none focus:ring-2 focus:ring-[hsl(var(--ring)/.4)]"
          />
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2 overflow-x-auto pb-1">
          <button
            type="button"
            onClick={() => onMaterialChange("")}
            aria-pressed={!materialFilter}
            className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold ${!materialFilter ? "bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]" : "border border-[hsl(var(--border))] text-[hsl(var(--primary))]"}`}
          >
            Todos
          </button>
          {materialOptions.map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => onMaterialChange(m)}
              aria-pressed={materialFilter === m}
              className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold ${materialFilter === m ? "bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]" : "border border-[hsl(var(--border))] text-[hsl(var(--primary))]"}`}
            >
              {categoryLabels[m] ?? m}
            </button>
          ))}
        </div>
        <p className="mt-2 text-xs text-[hsl(var(--muted-foreground))]">
          {filtered.length} de {points.length} centros
        </p>
        <div className="mt-3 space-y-2 max-h-[60vh] overflow-auto pr-1">
          {filtered.map((p) => {
            const open = selectedId === p.id;
            return (
              <article
                key={p.id}
                className={`rounded-2xl border p-3 sm:p-4 ${open ? "border-[hsl(var(--primary))] bg-[hsl(var(--muted)/.4)]" : "border-[hsl(var(--border))]"}`}
                onClick={() => onSelect(open ? null : p.id)}
              >
                <div className="flex gap-2 sm:gap-3">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[hsl(var(--muted))] text-[hsl(var(--primary))] sm:h-10 sm:w-10">
                    <MapPin size={18} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <h3 className="text-sm font-semibold leading-snug sm:text-base">{p.name}</h3>
                    <p className="mt-0.5 text-xs text-[hsl(var(--muted-foreground))] sm:text-sm">
                      Zona: {p.zone} · {p.lat.toFixed(3)}, {p.lng.toFixed(3)}
                    </p>
                    <p className="mt-1 text-[11px] text-[hsl(var(--muted-foreground))] sm:text-xs">
                       {p.address ? `${p.address} · ` : ""}{p.slots ? `${p.slots.length} horarios con cupo` : p.hours} · {p.slots ? `${p.capacity} cupos` : `Cupo ilustrativo: ${p.capacity}`} · Resp.: {p.responsible}
                    </p>
                     <div className="mt-2 flex flex-wrap items-center gap-2">
                       {p.slots && onToggleFavorite && <button type="button" aria-label={favoriteIds?.has(p.id) ? `Quitar ${p.name} de favoritos` : `Agregar ${p.name} a favoritos`} aria-pressed={favoriteIds?.has(p.id) ?? false} onClick={event => { event.stopPropagation(); onToggleFavorite(p.id); }} className="inline-flex items-center gap-1 text-xs font-semibold text-[hsl(var(--primary))]"><Heart size={16} fill={favoriteIds?.has(p.id) ? "currentColor" : "none"} /> Favorito</button>}
                       <button
                        type="button"
                        className="inline-flex items-center gap-1 text-xs font-semibold text-[hsl(var(--primary))] sm:text-sm"
                        aria-pressed={open}
                      >
                         {open ? "Cerrar ficha" : "Ver ficha"}
                        <ArrowRight size={15} className={`transition ${open ? "rotate-90" : ""}`} />
                      </button>
                      <a
                        className="inline-flex items-center gap-1 text-xs font-semibold text-[hsl(var(--primary))] sm:text-sm"
                        href={`https://www.openstreetmap.org/?mlat=${p.lat}&mlon=${p.lng}#map=15/${p.lat}/${p.lng}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <Navigation size={15} /> OSM
                      </a>
                    </div>
                    {open && (
                      <div className="mt-3 space-y-2 rounded-2xl bg-[hsl(var(--muted)/.5)] p-3 text-xs sm:text-sm">
                        <div>
                          <p className="text-[10px] font-bold uppercase tracking-[.14em] text-[hsl(var(--muted-foreground))] sm:text-xs">
                             Materiales
                          </p>
                          <ul className="mt-2 flex flex-wrap gap-1.5 sm:gap-2">
                            {p.materials.map((m) => (
                              <li key={m} className="rounded-full bg-[hsl(var(--card))] px-2.5 py-0.5 text-[11px] font-semibold text-[hsl(var(--primary))] sm:px-3 sm:py-1 sm:text-xs">
                                {categoryLabels[m] ?? m}
                              </li>
                            ))}
                          </ul>
                        </div>
                         <div className="border-t border-[hsl(var(--border))] pt-2 text-xs">
                           <p className="font-semibold">Horarios y cupos disponibles</p>
                           {p.slots?.map(slot => <p key={slot.id}>{new Date(slot.startsAt).toLocaleString("es-CO", { dateStyle: "medium", timeStyle: "short" })} · {slot.remainingCapacity} cupos</p>)}
                           {p.slots === undefined && <p>Agenda ilustrativa: {p.hours}. Reservas aún no disponibles.</p>}
                           {p.slots && p.slots.length === 0 && <p>Por ahora no hay cupos futuros.</p>}
                           {p.slots && p.slots.length > 0 && <a href={`/deliveries?point=${encodeURIComponent(p.id)}&slot=${encodeURIComponent(p.slots[0].id)}`} className="mt-2 inline-block font-semibold text-[hsl(var(--primary))] underline">Solicitar entrega en este centro</a>}
                         </div>
                      </div>
                    )}
                  </div>
                </div>
              </article>
            );
          })}
          {!filtered.length && (
            <div className="rounded-2xl border border-dashed border-[hsl(var(--border))] px-4 py-8 text-center text-xs text-[hsl(var(--muted-foreground))] sm:text-sm">
               Ningún centro coincide con los filtros.
            </div>
          )}
        </div>
      </section>

      <section className="relative order-1 min-h-[320px] overflow-hidden rounded-[2rem] border border-[hsl(var(--border))] bg-[hsl(158_25%_28%)] lg:order-2 sm:min-h-[420px]">
        <MapContainer
          center={[defaultCenter.lat, defaultCenter.lng]}
          zoom={defaultZoom}
          scrollWheelZoom
          className="absolute inset-0 h-full w-full"
          style={{ height: "100%", width: "100%" }}
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          {filtered.map((p) => (
            <Marker
              key={p.id}
              position={[p.lat, p.lng]}
              icon={testPointIcon(selectedId === p.id)}
              eventHandlers={{
                click: () => onSelect(selectedId === p.id ? null : p.id),
              }}
            >
              <Popup>
                <div className="max-w-[240px] space-y-2 text-sm">
                   <p className="font-semibold">{p.name}</p>
                  <p className="text-xs text-[hsl(var(--muted-foreground))]">Zona: {p.zone}</p>
                   <p className="text-xs">Materiales: {p.materials.map((m) => categoryLabels[m] ?? m).join(", ")}</p>
                  <p className="text-xs text-[hsl(var(--muted-foreground))]">
                     {p.slots?.length ?? 0} horarios disponibles · {p.capacity} cupos de referencia
                  </p>
                  <p className="text-[11px] text-[hsl(var(--muted-foreground))]">
                     {p.slots?.length ? <a href={`/deliveries?point=${encodeURIComponent(p.id)}`}>Solicitar entrega</a> : <span>Reservas no disponibles</span>}
                  </p>
                </div>
              </Popup>
            </Marker>
          ))}
          <MapController selectedId={selectedId} points={points} bounds={bounds} />
        </MapContainer>
        <div className="pointer-events-none absolute left-2 top-2 right-2 max-w-[90vw] rounded-2xl bg-[hsl(var(--card)/.96)] p-2 shadow-lg backdrop-blur sm:left-4 sm:top-4 sm:right-auto sm:p-4">
          <span className="flex items-center gap-2 text-xs font-bold text-[hsl(var(--primary))] sm:text-sm">
             <MapPin size={16} /> Centros de reciclaje · Montería
          </span>
          <p className="mt-0.5 text-[10px] leading-snug text-[hsl(var(--muted-foreground))] sm:mt-1 sm:text-xs">
             Explora los centros y consulta sus horarios disponibles.
          </p>
        </div>
      </section>
    </div>
  );
}

export function PublishedCentersMap({ points }: { points: PilotDeliveryOptions["points"] }) {
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("es-CO");
    return points.filter(point => !needle || `${point.name} ${point.address} ${point.municipality}`.toLocaleLowerCase("es-CO").includes(needle));
  }, [points, query]);

  return <div className="grid gap-5 lg:grid-cols-[.9fr_1.1fr]">
    <section className="order-2 rounded-[2rem] border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 sm:p-5 lg:order-1" aria-label="Centros publicados">
      <label className="block text-sm font-semibold" htmlFor="published-center-search">Buscar centro o dirección</label>
      <input id="published-center-search" value={query} onChange={event => setQuery(event.target.value)} className="mt-2 w-full rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--background))] p-3" placeholder="Nombre, dirección o municipio" />
      <p className="mt-3 text-sm text-[hsl(var(--muted-foreground))]">{filtered.length} de {points.length} centros publicados</p>
      <div className="mt-4 max-h-[60vh] space-y-3 overflow-auto">
        {filtered.map(point => {
          const open = selectedId === point.id;
          return <article key={point.id} className={`rounded-2xl border p-4 transition ${open ? "border-[hsl(var(--primary))] bg-[hsl(var(--muted)/.4)]" : "border-[hsl(var(--border))]"}`}>
            <div className="flex gap-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[hsl(var(--secondary)/.32)] text-[hsl(var(--primary))]"><Building2 size={18} /></span>
              <div className="min-w-0 flex-1">
                <h2 className="font-semibold">{point.name}</h2>
                <p className="mt-1 text-sm">{point.address}, {point.municipality}</p>
                <p className="mt-2 text-xs text-[hsl(var(--muted-foreground))]">{point.appointmentRequired ? `${point.slots.length} horarios con cupo publicados` : "Consulta disponibilidad antes de acudir"}</p>
                <div className="mt-2 flex flex-wrap gap-3 text-sm">
                  <button type="button" onClick={() => setSelectedId(open ? null : point.id)} aria-pressed={open} className="inline-flex items-center gap-1 font-semibold text-[hsl(var(--primary))]">{open ? "Cerrar ficha" : "Ver ficha"}<ArrowRight size={14} className={`transition ${open ? "rotate-90" : ""}`} /></button>
                  <a className="inline-flex items-center gap-1 font-semibold text-[hsl(var(--primary))] underline" href={`https://www.openstreetmap.org/search?query=${encodeURIComponent(`${point.address}, ${point.municipality}, Colombia`)}`} target="_blank" rel="noopener noreferrer">Buscar dirección en OpenStreetMap</a>
                </div>
                {open && <div className="mt-3 space-y-2 rounded-2xl bg-[hsl(var(--muted)/.5)] p-3 text-xs sm:text-sm">
                  {point.slots.length > 0 && <div>
                    <p className="text-[10px] font-bold uppercase tracking-[.14em] text-[hsl(var(--muted-foreground))] sm:text-xs">Horarios con cupo</p>
                    <ul className="mt-2 space-y-1">{point.slots.map(slot => <li key={slot.id}>{new Date(slot.startsAt).toLocaleString("es-CO", { dateStyle: "medium", timeStyle: "short" })} → {new Date(slot.endsAt).toLocaleTimeString("es-CO", { timeStyle: "short" })} · {slot.remainingCapacity} cupos</li>)}</ul>
                  </div>}
                  <p className="border-t border-[hsl(var(--border))] pt-2 text-[11px] text-[hsl(var(--muted-foreground))]">Centro publicado desde el catálogo administrativo de EcoPulse. Confirma la dirección con el operador antes de desplazarte.</p>
                </div>}
              </div>
            </div>
          </article>;
        })}
        {points.length === 0 && <div role="status" className="rounded-2xl border border-dashed border-[hsl(var(--border))] px-4 py-8 text-center text-sm text-[hsl(var(--muted-foreground))]">
          <p className="font-semibold text-[hsl(var(--primary))]">Aún no hay centros publicados.</p>
          <p className="mt-1">Los borradores del catálogo no aparecen aquí hasta que un administrador registre evidencia verificable y active la publicación. Activa el «Modo evaluación» para explorar el mapa con los puntos de prueba.</p>
        </div>}
        {points.length > 0 && filtered.length === 0 && <p className="rounded-2xl border border-dashed p-4 text-sm">Ningún centro coincide con la búsqueda.</p>}
      </div>
    </section>
    <section className="relative order-1 min-h-[320px] overflow-hidden rounded-[2rem] border border-[hsl(var(--border))] bg-[hsl(158_25%_28%)] sm:min-h-[420px] lg:order-2" aria-label="Mapa de Montería">
      <MapContainer center={[defaultCenter.lat, defaultCenter.lng]} zoom={defaultZoom} scrollWheelZoom className="absolute inset-0 h-full w-full" style={{ height: "100%", width: "100%" }}>
        <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
      </MapContainer>
      <div className="pointer-events-none absolute left-2 right-2 top-2 rounded-2xl bg-[hsl(var(--card)/.96)] p-3 text-xs shadow-lg sm:left-4 sm:right-auto sm:top-4 sm:max-w-xs">
        <strong>Montería, Córdoba</strong><p className="mt-1">Los centros publicados aparecen en la lista con su dirección y enlace a OpenStreetMap. No se colocan marcadores aproximados sin coordenadas verificadas.</p>
      </div>
    </section>
  </div>;
}

// The catalog, not the illustrative coordinate list, determines which points
// are selectable and which slots have capacity.
export function MapExperience({ publishedPoints, evaluationPoints, initialMaterial = "", apiUrl = "" }: {
  publishedPoints: PilotDeliveryOptions["points"];
  evaluationPoints: TestPoint[];
  initialMaterial?: string;
  apiUrl?: string;
}) {
  const { getToken, userId } = useAuth();
  const [query, setQuery] = useState("");
  const [materialFilter, setMaterialFilter] = useState(initialMaterial);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [favorites, setFavorites] = useState<Set<string> | null>(null);
  const [favoriteError, setFavoriteError] = useState("");
  const [favoriteBusy, setFavoriteBusy] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    setFavorites(null); setFavoriteError("");
    if (!userId || !apiUrl) return () => controller.abort();
    void (async () => {
      try {
        const token = await getToken();
        if (!token) return;
        const response = await fetch(`${apiUrl}/api/pilot/favorites`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: controller.signal });
        if (!response.ok) return;
        const body: unknown = await response.json();
        if (!controller.signal.aborted && body && typeof body === "object" && !Array.isArray(body) &&
          (body as { enabled?: unknown }).enabled === true && Array.isArray((body as { ids?: unknown }).ids)) {
          setFavorites(new Set((body as { ids: unknown[] }).ids.filter((id): id is string => typeof id === "string")));
        }
      } catch { /* The map remains available without favorites. */ }
    })();
    return () => controller.abort();
  }, [apiUrl, getToken, userId]);
  const toggleFavorite = async (id: string) => {
    if (!favorites || favoriteBusy) return;
    setFavoriteBusy(true); setFavoriteError("");
    try {
      const token = await getToken();
      if (!token) throw new Error("missing_session");
      const alreadySaved = favorites.has(id);
      const response = await fetch(`${apiUrl}/api/pilot/favorites/${encodeURIComponent(id)}`, {
        method: alreadySaved ? "DELETE" : "POST", headers: { Authorization: `Bearer ${token}`, ...(!alreadySaved ? { "Content-Type": "application/json" } : {}) },
        ...(!alreadySaved ? { body: "{}" } : {}), cache: "no-store",
      });
      if (!response.ok) throw new Error("favorite_failed");
      setFavorites(current => { const next = new Set(current); if (alreadySaved) next.delete(id); else next.add(id); return next; });
    } catch { setFavoriteError("No se pudo actualizar el favorito. Inténtalo de nuevo."); }
    finally { setFavoriteBusy(false); }
  };
  const coordinates = useMemo(() => new Map(evaluationPoints.map(point => [point.id, point])), [evaluationPoints]);
  const mapped = useMemo(() => mapAcademicCenters(publishedPoints, evaluationPoints), [publishedPoints, evaluationPoints]);
  const withoutCoordinates = useMemo(() => publishedPoints.filter(point => !coordinates.has(point.code)), [publishedPoints, coordinates]);

  return <div className="space-y-4">
    {initialMaterial && <p role="status" className="rounded-2xl border p-3 text-sm" data-testid="map-material-notice">Material desde tu escaneo: {categoryLabels[initialMaterial] ?? initialMaterial}. Confirma los materiales aceptados al solicitar.</p>}
    {favoriteError && <p role="alert" className="rounded-xl border p-3 text-sm">{favoriteError}</p>}
    {mapped.length > 0 && <InteractiveMap points={mapped} selectedId={selectedId} onSelect={setSelectedId} query={query} materialFilter={materialFilter} onQueryChange={setQuery} onMaterialChange={setMaterialFilter} favoriteIds={favorites ?? undefined} onToggleFavorite={favorites ? id => { void toggleFavorite(id); } : undefined} />}
    {withoutCoordinates.length > 0 && <PublishedCentersMap points={withoutCoordinates} />}
    {publishedPoints.length === 0 && <p role="status" className="rounded-2xl border p-4 text-sm">Puedes explorar los centros. Todavía no hay horarios disponibles para solicitar una entrega.</p>}
  </div>;
}
