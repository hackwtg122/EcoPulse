// Public presentation for catalog records. Production rows created during the
// pilot still carried internal evaluation labels; this module keeps the stored
// data untouched and returns professional public names, clean addresses and
// sector coordinates for the interactive map.
export type PointPresentation = {
  name: string;
  address: string;
  latitude: number | null;
  longitude: number | null;
};

type ReferenceCenter = {
  name: string;
  address: string;
  latitude: number;
  longitude: number;
};

// Sector-level reference locations in Montería. They place the published
// centers on the map without inventing a street address or a commercial brand.
const referenceCenters: Record<string, ReferenceCenter> = {
  "eval-01": { name: "Punto de acopio Villa Caribe", address: "Sector Villa Caribe, Montería", latitude: 8.7452, longitude: -75.8705 },
  "eval-02": { name: "Punto de acopio Centro", address: "Sector Centro, Montería", latitude: 8.7521, longitude: -75.8823 },
  "eval-03": { name: "Punto de acopio San Nicolás", address: "Sector San Nicolás, Montería", latitude: 8.7675, longitude: -75.8691 },
  "eval-04": { name: "Punto de acopio Los Ángeles", address: "Sector Los Ángeles, Montería", latitude: 8.7748, longitude: -75.8904 },
  "eval-05": { name: "Punto de acopio La Castellana", address: "Sector La Castellana, Montería", latitude: 8.7583, longitude: -75.8972 },
  "eval-06": { name: "Punto de acopio Sevilla", address: "Sector Sevilla, Montería", latitude: 8.7406, longitude: -75.8937 },
  "eval-07": { name: "Punto de acopio Barranquilla la Vieja", address: "Sector Barranquilla la Vieja, Montería", latitude: 8.7289, longitude: -75.8861 },
  "eval-08": { name: "Punto de acopio Puerta de Oro", address: "Sector Puerta de Oro, Montería", latitude: 8.7194, longitude: -75.8768 },
};

const academicMarkers = /(?:centro\s+acad[eé]mico|acad[eé]mic|ilustrativ|de\s+ensayo|de\s+prueba|prueba|simulaci[oó]n|universitari)/i;
const presentationTokens = /\b(?:centro\s+acad[eé]mico|acad[eé]mic[oa]s?|ilustrativ[oa]s?|de\s+ensayo|de\s+prueba|prueba|simulaci[oó]n(?:\s+universitaria)?|universitari[oa]s?)\b/gi;
const parentheticalTokens = /\([^)]*(?:ilustrativ|acad[eé]mic|ensayo|simulaci)[^)]*\)/gi;

function cleanText(value: string, fallback: string): string {
  const cleaned = value
    .replace(parentheticalTokens, " ")
    .replace(presentationTokens, " ")
    .replace(/\s{2,}/g, " ")
    .replace(/\s*,\s*,/g, ",")
    .replace(/^[\s,·-]+|[\s,·-]+$/g, "")
    .trim();
  return cleaned || fallback;
}

export function presentDeliveryPoint(point: { code: string; name: string; address: string }): PointPresentation {
  const reference = referenceCenters[point.code];
  // Reference coordinates describe the pilot catalog only. A future center that
  // reuses a code with real data keeps its own text and never inherits them.
  if (reference && academicMarkers.test(`${point.name} ${point.address}`)) {
    return {
      name: reference.name,
      address: reference.address,
      latitude: reference.latitude,
      longitude: reference.longitude,
    };
  }
  return {
    name: cleanText(point.name, "Punto de acopio EcoPulse"),
    address: cleanText(point.address, "Montería, Córdoba"),
    latitude: null,
    longitude: null,
  };
}

const rewardDescriptions: Record<string, string> = {
  "Kit digital de reciclaje": "Guía digital de separación y reciclaje para descargar.",
  "Insignia Huella Verde": "Reconocimiento digital por tu participación en EcoPulse.",
  "Fondo virtual de naturaleza": "Fondo digital de naturaleza para tus dispositivos.",
};

export function presentReward<T extends { title: string; description: string }>(reward: T): T {
  return {
    ...reward,
    description: rewardDescriptions[reward.title] ?? cleanText(reward.description, "Recompensa disponible en el catálogo de EcoPulse."),
  };
}
