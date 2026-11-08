export type PreviewPoint = { id: string; name: string; municipality: string; latitude: number; longitude: number };
export type PreviewReward = { id: string; title: string; cost: number; kind: string };
export type PublicImpact = {
  centers: number; challenges: number; verifiedDeliveries: number; rewards: number;
  points: PreviewPoint[]; featuredRewards: PreviewReward[];
};

export function readPublicImpact(value: unknown): PublicImpact {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw Error("invalid_impact");
  const v = value as Record<string, unknown>;
  for (const key of ["centers", "challenges", "verifiedDeliveries", "rewards"]) {
    if (typeof v[key] !== "number" || !Number.isSafeInteger(v[key]) || (v[key] as number) < 0) throw Error("invalid_impact_number");
  }
  if (!Array.isArray(v.points) || !Array.isArray(v.featuredRewards)) throw Error("invalid_impact_list");
  const points = v.points.map(raw => {
    if (!raw || typeof raw !== "object") throw Error("invalid_impact_center");
    const p = raw as Record<string, unknown>;
    if (typeof p.id !== "string" || typeof p.name !== "string" || typeof p.municipality !== "string" ||
      typeof p.latitude !== "number" || !Number.isFinite(p.latitude) || Math.abs(p.latitude) > 90 ||
      typeof p.longitude !== "number" || !Number.isFinite(p.longitude) || Math.abs(p.longitude) > 180) throw Error("invalid_impact_center");
    return { id: p.id, name: p.name, municipality: p.municipality, latitude: p.latitude, longitude: p.longitude };
  });
  const featuredRewards = v.featuredRewards.map(raw => {
    if (!raw || typeof raw !== "object") throw Error("invalid_impact_reward");
    const p = raw as Record<string, unknown>;
    if (typeof p.id !== "string" || typeof p.title !== "string" || typeof p.kind !== "string" ||
      typeof p.cost !== "number" || !Number.isSafeInteger(p.cost) || p.cost < 1) throw Error("invalid_impact_reward");
    return { id: p.id, title: p.title, cost: p.cost as number, kind: p.kind };
  });
  return {
    centers: v.centers as number, challenges: v.challenges as number,
    verifiedDeliveries: v.verifiedDeliveries as number, rewards: v.rewards as number,
    points, featuredRewards,
  };
}

