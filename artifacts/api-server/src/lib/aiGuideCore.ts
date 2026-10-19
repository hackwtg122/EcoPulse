export class AiGuideError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string) {
    super(code);
    this.status = status;
    this.code = code;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export type GuideRole = "user" | "assistant";
export type GuideTurn = { role: GuideRole; content: string };
export type GuideRequest = { question: string; history: GuideTurn[]; materialContext: string };

export type GuideUserContext = {
  balance: number;
  scanCount: number;
  deliveryCount: number;
  activeCenters: number;
  pointsPolicyEnabled: boolean;
  academic?: boolean;
};

const questionLimit = 500;
const historyLimit = 6;
const turnLimit = 300;
const materialContextLimit = 1_500;

function cleanTurn(value: unknown): GuideTurn | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (Object.keys(row).length !== 2) return null;
  if (row.role !== "user" && row.role !== "assistant") return null;
  if (typeof row.content !== "string") return null;
  const content = row.content.trim().replace(/\s+/g, " ").slice(0, turnLimit);
  if (!content) return null;
  return { role: row.role, content };
}

export function parseGuideRequest(value: unknown): GuideRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new AiGuideError(400, "invalid_guide_request");
  const row = value as Record<string, unknown>;
  const allowed = new Set(["question", "history", "materialContext"]);
  if (Object.keys(row).some((key) => !allowed.has(key))) throw new AiGuideError(400, "unexpected_fields");
  if (typeof row.question !== "string") throw new AiGuideError(400, "invalid_guide_question");
  const question = row.question.trim().replace(/\s+/g, " ");
  if (!question || question.length > questionLimit) throw new AiGuideError(400, "invalid_guide_question");
  const history: GuideTurn[] = [];
  if (row.history !== undefined) {
    if (!Array.isArray(row.history) || row.history.length > historyLimit) throw new AiGuideError(400, "invalid_guide_history");
    for (const item of row.history) {
      const turn = cleanTurn(item);
      if (!turn) throw new AiGuideError(400, "invalid_guide_history");
      history.push(turn);
    }
  }
  let materialContext = "";
  if (row.materialContext !== undefined) {
    if (typeof row.materialContext !== "string") throw new AiGuideError(400, "invalid_guide_context");
    materialContext = row.materialContext.trim().replace(/\s+/g, " ").slice(0, materialContextLimit);
  }
  return { question, history, materialContext };
}

export function guideSystemPrompt(context: GuideUserContext): string {
  return [
    "Eres EcoGuía, el asistente educativo de EcoPulse, una app de separación y entrega responsable de residuos en Colombia.",
    "Responde en español sencillo, en menos de 120 palabras, y solo con la información autorizada de abajo.",
    "Reglas estrictas:",
    "- No inventes centros de reciclaje, horarios, direcciones, convenios, recompensas, pesos ni montos.",
    context.academic
      ? "- Esta es una simulación universitaria. Los centros y operaciones académicos no representan establecimientos ni entregas físicas reales. EcoXP no se canjea; los EcoPuntos solo proceden de entregas académicas verificadas por un operador distinto cuando la política está activa. Escanear no da EcoPuntos."
      : "- EcoXP es progreso educativo y no se puede canjear. EcoPuntos son el saldo canjeable y solo provienen de entregas verificadas cuando la política de puntos está activa; clasificar o escanear no da EcoPuntos.",
    "- No certifiques que un material sea reciclable en un centro específico; da orientación general de separación (código colombiano blanco/verde/negro, Resolución 2184 de 2019).",
    "- Si la pregunta requiere datos de un centro o gestión administrativa, sugiere consultar el mapa o contactar al equipo desde la app.",
    `Datos autorizados de esta cuenta: EcoPuntos disponibles: ${context.balance}. Clasificaciones registradas: ${context.scanCount}. Entregas registradas: ${context.deliveryCount}. Centros activos publicados: ${context.activeCenters}. Política de EcoPuntos por entrega verificada: ${context.pointsPolicyEnabled ? "activa" : "inactiva en este entorno"}.`,
  ].join("\n");
}

export type AiGuideResult = { answer: string; source: "ai" };
