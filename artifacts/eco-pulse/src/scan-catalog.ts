export const manualScanCategories = ["paper", "plastic", "glass", "metal", "organic", "other"] as const;

export type ManualScanCategory = (typeof manualScanCategories)[number];

export const manualScanGuidance: Record<ManualScanCategory, { label: string; container: string; instructions: string }> = {
  paper: {
    label: "Papel y cartón",
    container: "Recipiente blanco",
    instructions: "Entrégalo limpio y seco. El papel o cartón contaminado con comida se considera no aprovechable.",
  },
  plastic: {
    label: "Plástico",
    container: "Recipiente blanco",
    instructions: "Vacía, limpia y seca el envase. Confirma con el prestador local qué tipos de plástico recibe.",
  },
  glass: {
    label: "Vidrio",
    container: "Recipiente blanco",
    instructions: "Vacía y limpia el envase. Manipula los fragmentos con cuidado y consulta su entrega segura local.",
  },
  metal: {
    label: "Metal",
    container: "Recipiente blanco",
    instructions: "Vacía, limpia y seca latas y otros envases metálicos antes de entregarlos.",
  },
  organic: {
    label: "Orgánico aprovechable",
    container: "Recipiente verde",
    instructions: "Separa restos de alimentos y residuos vegetales cuando exista una ruta local de aprovechamiento orgánico.",
  },
  other: {
    label: "No aprovechable u otro",
    container: "Recipiente negro o manejo especial",
    instructions: "Usa negro para residuos no aprovechables. Pilas, electrónicos, medicamentos y residuos peligrosos requieren canales posconsumo o manejo especial.",
  },
};

export function isManualScanCategory(value: unknown): value is ManualScanCategory {
  return typeof value === "string" && (manualScanCategories as readonly string[]).includes(value);
}

// Maps a scan category to the public materials library category ("special" holds non-recoverable and hazardous guidance).
export const materialCategoryByScan: Record<ManualScanCategory, string> = {
  paper: "paper", plastic: "plastic", glass: "glass", metal: "metal", organic: "organic", other: "special",
};

// Reference: Colombia, Resolution 2184 of 2019, national white/green/black source-separation code.
export const colombianSeparationReference = "Resolución 2184 de 2019";
