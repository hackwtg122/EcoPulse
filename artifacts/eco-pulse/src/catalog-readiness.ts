export function centerRequirements(point: { id: string; active: boolean; appointmentRequired: boolean; operationallyValidated?: boolean },
  slots: Array<{ pointId: string; active: boolean; operationallyValidated?: boolean; startsAt: string; remainingCapacity: number }>,
  materials: Array<{ pointId: string; code: string }>, now = Date.now()) {
  const missing: string[] = [];
  if (!point.active || point.operationallyValidated !== true) missing.push("Validar y publicar la autorización real del centro.");
  if (!materials.some(item => item.pointId === point.id && ["paper", "plastic", "glass", "metal", "organic", "other"].includes(item.code))) missing.push("Guardar los materiales que el centro realmente acepta.");
  if (point.appointmentRequired && !slots.some(slot => slot.pointId === point.id && slot.active && slot.operationallyValidated === true &&
    new Date(slot.startsAt).valueOf() > now && slot.remainingCapacity > 0)) missing.push("Crear o editar un horario futuro, confirmar su cupo y validarlo después de publicar el centro.");
  return missing;
}
