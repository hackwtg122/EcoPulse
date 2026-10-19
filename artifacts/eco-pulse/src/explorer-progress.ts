// EcoPulse — «Explorador» de fichas de material.
// Este rastreo vive SOLO en el navegador (localStorage) y es cosmético: cuenta
// cuántas fichas de material has abierto. No forma parte del EcoXP autoritativo del
// servidor ni otorga EcoPuntos. Se etiqueta explícitamente como local porque no
// sobrevive a otro dispositivo ni a borrar el almacenamiento del navegador.

const STORAGE_KEY = "ep-materials-explored:v1";

function readStore(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((id): id is string => typeof id === "string");
  } catch {
    return [];
  }
}

function writeStore(ids: string[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ids.slice(-200)));
  } catch {
    // Almacenamiento no disponible; el explorador simplemente no persiste.
  }
}

export function recordMaterialView(id: string): string[] {
  if (!id) return readStore();
  const current = readStore();
  if (!current.includes(id)) {
    const next = [...current, id];
    writeStore(next);
    return next;
  }
  return current;
}

export function readMaterialViews(): string[] {
  return readStore();
}

export const explorerBadges = [
  { id: "explorer-1", title: "Curioso", description: "Abre la ficha de 1 material.", target: 1 },
  { id: "explorer-5", title: "Explorador", description: "Abre la ficha de 5 materiales distintos.", target: 5 },
  { id: "explorer-10", title: "Bibliófilo", description: "Abre la ficha de 10 materiales distintos.", target: 10 },
];
