import type { PilotDeliveryOptions } from "./pilot-api.ts";

type Point = PilotDeliveryOptions["points"][number];
type Illustration = { id: string; name: string; lat: number; lng: number; materials: string[]; hours: string; capacity: number; responsible: string; isTest: true; zone: string };

/** Illustrations give coordinates, but only the DB catalog grants a reservation. */
export function mapAcademicCenters<T extends Illustration>(catalog: Point[], illustrations: T[]): Array<T & { slots?: Point["slots"]; address?: string }> {
  const byCode = new Map(catalog.map(point => [point.code, point]));
  return illustrations.map(location => {
    const point = byCode.get(location.id);
    return point ? {
      ...location, id: point.id, name: point.name, address: point.address, materials: point.materials ?? location.materials,
      slots: point.slots, capacity: point.slots.reduce((total, slot) => total + slot.remainingCapacity, 0),
    } : location;
  });
}
