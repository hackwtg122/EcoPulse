import { manualScanGuidance } from "./scan-catalog.ts";

export type GuideContext = {
  centerStatus: "signed_out" | "loading" | "ready" | "error";
  centerCount: number | null;
  balance: number | null;
  scanCount?: number | null;
  deliveryCount?: number | null;
};

const publicContext: GuideContext = { centerStatus: "signed_out", centerCount: null, balance: null };

export function guideAnswer(input: string, context: GuideContext = publicContext): string {
  const query = input.trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  if (!query || query.length > 500) return "Escribe una duda breve sobre separación, centros o puntos.";
  if (/centro|cerca|donde entregar|lugar de entrega|punto (de|cercano|ecologico|verde)/.test(query)) {
    if (context.centerStatus === "signed_out") return "Inicia sesión y consulta Puntos cercanos. Allí se muestran únicamente centros activos registrados en EcoPulse.";
    if (context.centerStatus === "loading") return "Estoy consultando los centros activos. Abre Puntos cercanos para ver los datos actualizados.";
    if (context.centerStatus === "error") return "No pude confirmar los centros disponibles. Intenta actualizar Puntos cercanos antes de planear una entrega.";
    if (context.centerCount === 0) return "Consulta el mapa para explorar los centros educativos. Las solicitudes solo estarán disponibles cuando haya horarios con cupo.";
    return `EcoPulse registra ${context.centerCount} centro${context.centerCount === 1 ? "" : "s"} activo${context.centerCount === 1 ? "" : "s"}. Consulta Puntos cercanos para comprobar dirección y disponibilidad antes de ir.`;
  }
  if (/saldo|ganar puntos|gano puntos|canje|recompensa/.test(query)) {
    const balance = context.balance === null ? "Consulta tu saldo en el dashboard después de iniciar sesión." :
      `Tu saldo registrado es ${context.balance.toLocaleString("es-CO")} puntos.`;
    return `${balance} Un escaneo o una solicitud de entrega no otorgan puntos. Los EcoPuntos se calculan tras la verificación de una entrega. Consulta Recompensas para conocer el catálogo y la disponibilidad de canjes. EcoXP refleja aprendizaje, no puntos.`;
  }
  if (/mis escaneos|mis entregas|mi actividad|mi historial/.test(query)) {
    if (context.scanCount == null || context.deliveryCount == null) return "Inicia sesión y consulta tu dashboard para ver tus escaneos y solicitudes registrados.";
    return `Tu cuenta registra ${context.scanCount} escaneo${context.scanCount === 1 ? "" : "s"} y ${context.deliveryCount} solicitud${context.deliveryCount === 1 ? "" : "es"} de entrega. Consulta el dashboard para ver fechas y estados. Una solicitud no acredita recepción ni genera puntos.`;
  }
  const categories = [
    { terms: /papel|carton/, key: "paper" },
    { terms: /plastico|botella/, key: "plastic" },
    { terms: /vidrio/, key: "glass" },
    { terms: /metal|lata/, key: "metal" },
    { terms: /organico|compost/, key: "organic" },
    { terms: /no aprovechable|mezclado|contaminado/, key: "other" },
  ] as const;
  const match = categories.find(category => category.terms.test(query));
  if (match) {
    const guidance = manualScanGuidance[match.key];
    return `${guidance.label}: ${guidance.instructions}\n\n• Consulta las condiciones del prestador local antes de entregar el material.\n• Para la ficha completa, ve a Materiales y busca este material.\n• Para ver dónde entregarlo, consulta Puntos cercanos cuando exista un centro publicado.`;
  }
  return "Esta guía local ofrece orientación básica sobre papel, plástico, vidrio, metal, orgánicos, centros y saldo. Para otras dudas consulta Materiales, el mapa o EcoScan; no asumiré que un centro acepta residuos peligrosos.";
}
