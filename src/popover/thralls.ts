// Siervos del nigromante: tokens del mapa que se vinculan a la hoja al lanzar Create Thrall.
// Se pueden elegir de la selección del mapa o crear en el acto junto al nigromante.
import OBR, { buildShape } from "@owlbear-rodeo/sdk";
import { findTokenFor, inOwlbear, npcToToken } from "../obr";
import { store } from "../storage";
import { META_TOKEN, newId, type TokenData } from "../shared";
import { THRALL_LIMIT, type ClassState } from "../classes";

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

// Agrega siervos a la hoja. No hay máximo de siervos activos: solo un límite técnico (los más
// nuevos reemplazan a los viejos si se pasa)
export function withThralls(k: ClassState, ids: string[]): ClassState {
  const keep = (k.thralls ?? []).filter((t) => !ids.includes(t.tok));
  const next = [...keep, ...ids.map((tok) => ({ tok }))].slice(-THRALL_LIMIT);
  return { ...k, thralls: next.length ? next : undefined };
}

// Los siervos tienen 1 PG y siempre son muertos vivientes. Su CA es la CD de conjuros del
// nigromante y sus salvaciones, esa CD − 10 (el GM las puede cambiar en su ficha).
export async function markThralls(ids: string[], dc: number, level: number) {
  if (!inOwlbear || !ids.length) return;
  try {
    const items = await OBR.scene.items.getItems(ids);
    await OBR.scene.items.updateItems(
      items.map((i) => i.id),
      (drafts) => {
        for (const d of drafts) {
          const cur = d.metadata[META_TOKEN] as TokenData | undefined;
          if (cur?.kind === "pc") continue;
          if (cur?.kind === "npc") {
            d.metadata[META_TOKEN] = { ...cur, undead: true };
            continue;
          }
          const save = dc - 10;
          d.metadata[META_TOKEN] = npcToToken({
            name: d.name || "Siervo",
            hp: 1,
            maxHp: 1,
            temp: 0,
            baseAc: dc,
            acAdj: 0,
            cond: {},
            hidden: false,
            level,
            saves: { fortitude: save, reflex: save, will: save },
            attacks: [],
            spells: [],
            undead: true,
          });
        }
      },
    );
  } catch (err) {
    // Un jugador no puede modificar tokens ajenos: el siervo queda vinculado igual
    console.warn("[PF2e] No se pudieron poner los PG del siervo", err);
  }
}
