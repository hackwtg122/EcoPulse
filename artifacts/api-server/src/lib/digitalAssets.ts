import type { Pool } from "pg";
import { uuidPattern } from "./pilotPolicy.ts";
import { digitalAssetForFulfillment } from "./rewardService.ts";

function createGuidePdf(): Buffer {
  const lines = ["EcoPulse - Guia practica de separacion", "Separa los materiales limpios y secos.", "Papel y carton: evita residuos de comida y humedad.", "Plastico: vacia y enjuaga los envases cuando sea posible.", "Vidrio: evita mezclarlo con otros residuos cortantes.", "Metal: separa latas limpias y sin contenido.", "Organicos: mantenlos separados de los reciclables secos.", "Consulta la gestion local para residuos especiales."];
  const stream = `BT /F1 14 Tf 60 770 Td 22 TL ${lines.map(line => `(${line}) Tj T*`).join(" ")} ET`;
  const objects = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>", "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>", `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${offsets.length}\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, "ascii");
}

// The previews in the public frontend are not the delivered files.
const assets: Record<string, { filename: string; contentType: string; content: string | Buffer }> = {
  "guide-v1": { filename: "ecopulse-guia.pdf", contentType: "application/pdf", content: createGuidePdf() },
  "nature-v1": { filename: "ecopulse-naturaleza.svg", contentType: "image/svg+xml", content: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 675"><rect width="1200" height="675" fill="#d5eee4"/><circle cx="920" cy="155" r="80" fill="#f3d780"/><path d="M0 500 260 230 520 475 760 300 1200 520v155H0" fill="#438a6e"/><path d="M0 570 320 420 620 590 930 390 1200 550v125H0" fill="#205f48"/><text x="60" y="625" fill="white" font-family="sans-serif" font-size="42">EcoPulse</text></svg>' },
  "badge-v1": { filename: "ecopulse-insignia.svg", contentType: "image/svg+xml", content: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 600"><rect width="600" height="600" fill="#e4f3e8"/><circle cx="300" cy="280" r="210" fill="#fff" stroke="#205f48" stroke-width="14"/><path d="M300 390C180 325 195 180 355 145c5 95-20 165-100 205M305 355c35-80 110-105 145-65-22 65-72 90-145 85" fill="#438a6e"/><text x="300" y="540" text-anchor="middle" fill="#205f48" font-family="sans-serif" font-size="38">EcoPulse</text></svg>' },
};

export function registeredDigitalAsset(key: string) {
  return Object.hasOwn(assets, key) ? assets[key] : null;
}

export function digitalAssetCatalog() {
  const titles: Record<string, string> = { "guide-v1": "Guía práctica de reciclaje", "nature-v1": "Fondo digital de naturaleza", "badge-v1": "Insignia Huella Verde" };
  return Object.entries(assets).map(([key, asset]) => ({ key, title: titles[key], filename: asset.filename,
    contentType: asset.contentType, bytes: Buffer.byteLength(asset.content), fulfillmentReference: "digital:ecopulse/" + key }));
}

export async function ownedDigitalAsset(pool: Pool, userId: string, redemptionId: string) {
  if (!userId || !uuidPattern.test(redemptionId)) return null;
  const result = await pool.query<{ fulfillment_status: string; fulfillment_reference: string | null }>(
    "SELECT fulfillment_status, fulfillment_reference FROM redemptions WHERE id=$1 AND user_id=$2", [redemptionId, userId],
  );
  const row = result.rows[0];
  const key = row && digitalAssetForFulfillment(row.fulfillment_status, row.fulfillment_reference);
  return key ? registeredDigitalAsset(key) : null;
}
