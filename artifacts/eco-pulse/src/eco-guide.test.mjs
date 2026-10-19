import test from "node:test";
import assert from "node:assert/strict";
import { guideAnswer } from "./eco-guide.ts";

test("EcoGuía does not invent centers or availability", () => {
  assert.match(guideAnswer("Busca un punto cerca", { centerStatus: "ready", centerCount: 0, balance: 0 }), /mapa/);
  assert.match(guideAnswer("Busca un punto cerca", { centerStatus: "error", centerCount: null, balance: 0 }), /No pude confirmar/);
  assert.match(guideAnswer("Busca un punto cerca"), /Inicia sesión/);
  assert.match(guideAnswer("Busca un punto cerca", { centerStatus: "ready", centerCount: 2, balance: 0 }), /2 centros activos/);
});

test("EcoGuía uses authoritative balance and never awards scan points", () => {
  assert.match(guideAnswer("¿Cómo gano puntos?", { centerStatus: "ready", centerCount: 0, balance: 0 }), /0 puntos/);
  assert.match(guideAnswer("¿Cómo gano puntos?", { centerStatus: "ready", centerCount: 0, balance: 0 }), /no otorgan puntos/);
  assert.doesNotMatch(guideAnswer("¿Cómo gano puntos?"), /saldo registrado es 0/);
});

test("EcoGuía reuses the manual classification guidance", () => {
  const glass = guideAnswer("¿Dónde va el vidrio?");
  assert.match(glass, /Vidrio: Vacía y limpia/);
  assert.match(glass, /prestador local/);
  assert.doesNotMatch(glass, /contenedor verde/);
});

test("EcoGuía reports only the authenticated account snapshot", () => {
  const context = { centerStatus: "ready", centerCount: 0, balance: 0, scanCount: 1, deliveryCount: 2 };
  assert.match(guideAnswer("Mi actividad", context), /1 escaneo y 2 solicitudes/);
  assert.match(guideAnswer("Mi actividad", context), /no acredita recepción ni genera puntos/);
  assert.match(guideAnswer("Mi actividad"), /Inicia sesión/);
});
