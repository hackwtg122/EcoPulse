// EcoPulse — progreso educativo (EcoXP, niveles, insignias, misiones, rachas).
// EcoXP es una métrica de aprendizaje NO canjeable, separada por completo de los
// EcoPuntos del libro contable. Se deriva en el servidor desde eventos reales ya
// almacenados en PostgreSQL (clasificaciones y entregas), sin tablas nuevas y sin
// otorgar crédito por subir imágenes. Un escaneo nunca cuenta como reciclaje.

export type ProgressScan = { category: string; createdAt: Date | string };
export type ProgressDelivery = { status: string; createdAt: Date | string };

export type ProgressBadge = {
  id: string;
  title: string;
  description: string;
  earned: boolean;
  earnedAt: string | null;
};

export type ProgressMission = {
  id: string;
  title: string;
  description: string;
  progress: number;
  target: number;
  completed: boolean;
  xpReward: number;
};

export type ProgressReport = {
  ecoXp: number;
  level: number;
  levelTitle: string;
  nextLevel: number | null;
  nextLevelXp: number | null;
  xpToNextLevel: number | null;
  classificationCount: number;
  distinctCategories: string[];
  deliveryCount: number;
  approvedDeliveryCount: number;
  streakDays: number;
  badges: ProgressBadge[];
  missions: ProgressMission[];
  // Transparencia: las reglas para ganar EcoXP se muestran junto al total.
  rules: string[];
};

const LEVELS = [
  { level: 1, title: "Semilla", threshold: 0 },
  { level: 2, title: "Brote", threshold: 40 },
  { level: 3, title: "Planta", threshold: 80 },
  { level: 4, title: "Árbol", threshold: 120 },
  { level: 5, title: "Bosque", threshold: 180 },
];

export const progressRules = [
  "+10 EcoXP por cada categoría de material que clasifiques (máx. 6).",
  "+20 EcoXP por clasificar 3 categorías distintas.",
  "+30 EcoXP por cubrir las 6 categorías.",
  "+25 EcoXP por iniciar una entrega física.",
  "+25 EcoXP por cada entrega verificada.",
  "Clasificar o escanear nunca otorga EcoPuntos canjeables; eso ocurre solo con entregas físicas verificadas.",
];

function toIso(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.valueOf()) ? new Date(0).toISOString() : date.toISOString();
}

function millis(value: Date | string): number {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.valueOf()) ? 0 : date.valueOf();
}

function dayKey(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.valueOf()) ? "" : date.toISOString().slice(0, 10);
}

function computeStreakDays(daysNewestFirst: string[]): number {
  if (!daysNewestFirst.length) return 0;
  const set = new Set(daysNewestFirst);
  const now = new Date();
  const todayKey = dayKey(now);
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const yesterdayKey = dayKey(yesterday);
  let cursor: Date;
  if (set.has(todayKey)) cursor = new Date(now);
  else if (set.has(yesterdayKey)) cursor = new Date(yesterday);
  else return 0; // La racha se rompe si el último día con actividad no es hoy ni ayer.
  let streak = 0;
  while (set.has(dayKey(cursor))) { streak += 1; cursor.setDate(cursor.getDate() - 1); }
  return streak;
}

// Replay cronológico de eventos reales para derivar progreso y fechas de logro.
export function computeProgress(scans: ProgressScan[], deliveries: ProgressDelivery[]): ProgressReport {
  type Event = { at: number; kind: "scan" | "delivery"; category?: string; status?: string };
  const events: Event[] = [
    ...scans.map((scan) => ({ at: millis(scan.createdAt), kind: "scan" as const, category: scan.category })),
    ...deliveries.map((delivery) => ({ at: millis(delivery.createdAt), kind: "delivery" as const, status: delivery.status })),
  ].sort((a, b) => a.at - b.at);

  const distinct = new Set<string>();
  const scanDays: string[] = [];
  let classificationCount = 0;
  let deliveryCount = 0;
  let approvedDeliveryCount = 0;
  let xpFromCategories = 0;
  const milestoneDates = { firstScan: null as string | null, three: null as string | null, six: null as string | null, firstDelivery: null as string | null, verified: null as string | null };
  const daySet = new Set<string>();

  for (const event of events) {
    if (event.kind === "scan") {
      classificationCount += 1;
      const key = dayKey(new Date(event.at));
      if (key && !daySet.has(key)) { daySet.add(key); scanDays.push(key); }
      if (event.category && !distinct.has(event.category)) {
        distinct.add(event.category);
        xpFromCategories += 10;
        if (distinct.size === 3) milestoneDates.three = toIso(new Date(event.at));
        if (distinct.size === 6) milestoneDates.six = toIso(new Date(event.at));
      }
      if (!milestoneDates.firstScan) milestoneDates.firstScan = toIso(new Date(event.at));
    } else {
      deliveryCount += 1;
      if (!milestoneDates.firstDelivery) milestoneDates.firstDelivery = toIso(new Date(event.at));
      if (event.status === "approved") {
        approvedDeliveryCount += 1;
        if (!milestoneDates.verified) milestoneDates.verified = toIso(new Date(event.at));
      }
    }
  }

  const distinctCategories = [...distinct];
  const milestoneXp = (distinctCategories.length >= 3 ? 20 : 0) + (distinctCategories.length >= 6 ? 30 : 0);
  const deliveryXp = (deliveryCount >= 1 ? 25 : 0) + approvedDeliveryCount * 25;
  const ecoXp = xpFromCategories + milestoneXp + deliveryXp;

  const levelInfo = [...LEVELS].reverse().find((entry) => ecoXp >= entry.threshold) ?? LEVELS[0];
  const nextLevelInfo = LEVELS.find((entry) => entry.threshold > ecoXp) ?? null;
  const streakDays = computeStreakDays([...daySet].sort((a, b) => b.localeCompare(a)));

  const badges: ProgressBadge[] = [
    { id: "first-step", title: "Primer paso", description: "Registraste tu primera clasificación manual.", earned: classificationCount >= 1, earnedAt: milestoneDates.firstScan },
    { id: "curious", title: "Clasificador curioso", description: "Clasificaste 3 categorías de material distintas.", earned: distinctCategories.length >= 3, earnedAt: milestoneDates.three },
    { id: "complete", title: "Separador completo", description: "Clasificaste las 6 categorías de material.", earned: distinctCategories.length >= 6, earnedAt: milestoneDates.six },
    { id: "delivery-started", title: "Entrega iniciada", description: "Solicitaste una entrega física real.", earned: deliveryCount >= 1, earnedAt: milestoneDates.firstDelivery },
    { id: "delivery-verified", title: "Entrega verificada", description: "Una entrega tuya fue verificada por un operador autorizado.", earned: approvedDeliveryCount >= 1, earnedAt: milestoneDates.verified },
    { id: "streak-3", title: "Racha de 3 días", description: "Clasificaste durante 3 días consecutivos.", earned: streakDays >= 3, earnedAt: streakDays >= 3 ? toIso(new Date()) : null },
  ];

  const missions: ProgressMission[] = [
    { id: "first-classification", title: "Primer paso", description: "Registra tu primera clasificación manual.", progress: Math.min(classificationCount, 1), target: 1, completed: classificationCount >= 1, xpReward: 10 },
    { id: "three-categories", title: "Explora materiales", description: "Clasifica 3 categorías de material distintas.", progress: Math.min(distinctCategories.length, 3), target: 3, completed: distinctCategories.length >= 3, xpReward: 20 },
    { id: "all-categories", title: "Separación completa", description: "Clasifica las 6 categorías de material.", progress: Math.min(distinctCategories.length, 6), target: 6, completed: distinctCategories.length >= 6, xpReward: 30 },
    { id: "first-delivery", title: "Entrega iniciada", description: "Solicita una entrega física en un centro publicado.", progress: Math.min(deliveryCount, 1), target: 1, completed: deliveryCount >= 1, xpReward: 25 },
    { id: "verified-delivery", title: "Entrega verificada", description: "Obtén una entrega verificada por un operador autorizado.", progress: Math.min(approvedDeliveryCount, 1), target: 1, completed: approvedDeliveryCount >= 1, xpReward: 25 },
  ];

  return {
    ecoXp,
    level: levelInfo.level,
    levelTitle: levelInfo.title,
    nextLevel: nextLevelInfo?.level ?? null,
    nextLevelXp: nextLevelInfo?.threshold ?? null,
    xpToNextLevel: nextLevelInfo ? nextLevelInfo.threshold - ecoXp : null,
    classificationCount,
    distinctCategories,
    deliveryCount,
    approvedDeliveryCount,
    streakDays,
    badges,
    missions,
    rules: progressRules,
  };
}
