import assert from "node:assert/strict";
import test from "node:test";
import { presentDeliveryPoint, presentReward } from "./pointPresentation.ts";

test("pilot fixture centers are presented with clean names, addresses and map coordinates", () => {
  const presented = presentDeliveryPoint({
    code: "eval-01",
    name: "Centro académico Villa Caribe",
    address: "Sector Villa Caribe (ubicación ilustrativa)",
  });
  assert.equal(presented.name, "Punto de acopio Villa Caribe");
  assert.equal(presented.address, "Sector Villa Caribe, Montería");
  assert.equal(presented.latitude, 8.7452);
  assert.equal(presented.longitude, -75.8705);
  assert.doesNotMatch(`${presented.name} ${presented.address}`, /acad[eé]mic|ilustrativ|simulaci/i);
});

test("future centers that reuse a pilot code keep their own data and never inherit coordinates", () => {
  const presented = presentDeliveryPoint({
    code: "eval-01",
    name: "Estación de reciclaje Norte",
    address: "Carrera 6 # 53-14, Montería",
  });
  assert.equal(presented.name, "Estación de reciclaje Norte");
  assert.equal(presented.address, "Carrera 6 # 53-14, Montería");
  assert.equal(presented.latitude, null);
  assert.equal(presented.longitude, null);
});

test("stored academic wording is removed even without a reference entry", () => {
  const presented = presentDeliveryPoint({
    code: "center-99",
    name: "Centro académico de prueba",
    address: "Sector Centro (ubicación ilustrativa)",
  });
  assert.equal(presented.name, "Punto de acopio EcoPulse");
  assert.equal(presented.address, "Sector Centro");
});

test("reward descriptions no longer expose academic or simulation wording", () => {
  for (const title of ["Kit digital de reciclaje", "Insignia Huella Verde", "Fondo virtual de naturaleza"]) {
    const reward = presentReward({ title, description: "Simulación académica de recompensa." });
    assert.doesNotMatch(reward.description, /acad[eé]mic|simulaci/i);
  }
});
