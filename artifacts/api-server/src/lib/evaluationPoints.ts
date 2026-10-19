// Evaluation-only test points served by the real API. These are NOT real
// establishments: coordinates are approximate zones of Montería used solely
// for internal evaluation of the recycling cycle. They never accept public
// physical deliveries and are never mixed with published centers (which come
// from PostgreSQL). No database writes and no persistence: static catalog.

export type EvaluationTestPoint = {
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
};

const points: readonly EvaluationTestPoint[] = Object.freeze([
  { id: "eval-01", name: "Punto PRUEBA Villa Caribe", zone: "Villa Caribe", lat: 8.7452, lng: -75.8705, materials: ["plastic", "metal", "paper"], hours: "Lun–Vie 08:00–17:00", capacity: 40, responsible: "Operador de prueba A", isTest: true },
  { id: "eval-02", name: "Punto PRUEBA Centro", zone: "Centro", lat: 8.7521, lng: -75.8823, materials: ["glass", "paper"], hours: "Lun–Sáb 09:00–16:00", capacity: 30, responsible: "Operador de prueba B", isTest: true },
  { id: "eval-03", name: "Punto PRUEBA San Nicolás", zone: "San Nicolás", lat: 8.7675, lng: -75.8691, materials: ["plastic", "organic"], hours: "Mar–Sáb 08:00–14:00", capacity: 25, responsible: "Operador de prueba C", isTest: true },
  { id: "eval-04", name: "Punto PRUEBA Los Angeles", zone: "Los Ángeles", lat: 8.7748, lng: -75.8904, materials: ["metal", "glass"], hours: "Lun–Vie 07:30–15:30", capacity: 35, responsible: "Operador de prueba D", isTest: true },
  { id: "eval-05", name: "Punto PRUEBA La Castellana", zone: "La Castellana", lat: 8.7583, lng: -75.8972, materials: ["paper", "cardboard"], hours: "Lun–Vie 08:00–18:00", capacity: 20, responsible: "Operador de prueba E", isTest: true },
  { id: "eval-06", name: "Punto PRUEBA Sevilla", zone: "Sevilla", lat: 8.7406, lng: -75.8937, materials: ["plastic", "metal", "glass"], hours: "Lun–Sáb 09:00–17:00", capacity: 45, responsible: "Operador de prueba F", isTest: true },
  { id: "eval-07", name: "Punto PRUEBA Barranquilla la Vieja", zone: "Barranquilla la Vieja", lat: 8.7289, lng: -75.8861, materials: ["organic", "other"], hours: "Mar–Dom 08:00–13:00", capacity: 15, responsible: "Operador de prueba G", isTest: true },
  { id: "eval-08", name: "Punto PRUEBA Puerta de Oro", zone: "Puerta de Oro", lat: 8.7194, lng: -75.8768, materials: ["paper", "plastic"], hours: "Lun–Vie 10:00–18:00", capacity: 30, responsible: "Operador de prueba H", isTest: true },
].map((point) => Object.freeze({ ...point, materials: Object.freeze([...point.materials]) } as EvaluationTestPoint)));

export function listEvaluationTestPoints(): readonly EvaluationTestPoint[] {
  return points;
}
