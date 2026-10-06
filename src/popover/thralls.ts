// Siervos del nigromante: tokens del mapa que se vinculan a la hoja al lanzar Create Thrall.
// Se pueden elegir de la selección del mapa o crear en el acto junto al nigromante.
import OBR, { buildShape } from "@owlbear-rodeo/sdk";
import { findTokenFor, inOwlbear } from "../obr";
import { store } from "../storage";
import { newId } from "../shared";
import type { ClassState } from "../classes";

// Tokens seleccionados (o los últimos, porque abrir la extensión borra la selección)
export async function selectedTokens(): Promise<string[]> {
  if (!inOwlbear) return [];
  let ids = (await OBR.player.getSelection()) ?? [];
  const last = store.lastSelection();
  if (!ids.length && last && Date.now() - last.t < 120_000) ids = last.ids;
  return ids;
}

// Crea siervos (círculos con nombre; la marca de siervo la dibuja el script de fondo) en las casillas junto al token del nigromante
export async function createThrallTokens(charId: string, count: number, color: string, from = 0): Promise<string[]> {
  if (!inOwlbear || !(await OBR.scene.isReady())) return [];
  const dpi = await OBR.scene.grid.getDpi();
  const caster = await findTokenFor(charId);
  let center = { x: dpi / 2, y: dpi / 2 };
  if (caster) {
    const b = await OBR.scene.items.getItemBounds([caster.id]);
    center = b.center;
  } else {
    const [w, h] = await Promise.all([OBR.viewport.getWidth(), OBR.viewport.getHeight()]);
    center = await OBR.viewport.inverseTransformPoint({ x: w / 2, y: h / 2 });
  }
  const items = Array.from({ length: count }, (_, i) => {
    const n = from + i + 1;
    return buildShape()
      .id(`thrall-${newId()}`)
      .shapeType("CIRCLE")
      .width(dpi * 0.85)
      .height(dpi * 0.85)
      .position({ x: center.x + dpi * (i + 1), y: center.y + dpi })
      .fillColor(color)
      .fillOpacity(0.55)
      .strokeColor("#1b1030")
      .strokeWidth(dpi * 0.04)
      .layer("CHARACTER")
      .name(`Siervo ${n}`)
      .build();
  });
  await OBR.scene.items.addItems(items);
  return items.map((i) => i.id);
}

// Agrega siervos a la hoja sin pasar del máximo (los más nuevos reemplazan a los viejos)
export function withThralls(k: ClassState, ids: string[], max: number): ClassState {
  const keep = (k.thralls ?? []).filter((t) => !ids.includes(t.tok));
  const next = [...keep, ...ids.map((tok) => ({ tok }))].slice(-max);
  return { ...k, thralls: next.length ? next : undefined };
}
