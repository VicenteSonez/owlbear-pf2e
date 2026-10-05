// Dibuja y anima los efectos del mapa como items locales (cada cliente los dibuja por su cuenta).
import OBR, { buildEffect, type Effect, type Vector2 } from "@owlbear-rodeo/sdk";
import { DIRS, RANGED_CELLS, ATTACK_FX, defaultColor, fxSksl, fxTiming, hexToVec, type FxKind } from "../fx";
import { OVERLAY_PREFIX } from "../shared";

const FRAME_MS = 33;

interface Running {
  id: string;
  start: number;
  duration: number;
}

const running = new Map<string, Running>();
let timer: number | undefined;
let updating = false;
let seq = 0;

async function frame() {
  if (updating) return;
  updating = true;
  try {
    const now = Date.now();
    const done = [...running.values()].filter((r) => now - r.start >= r.duration);
    const live = [...running.values()].filter((r) => now - r.start < r.duration);
    if (live.length) {
      const progress = new Map(live.map((r) => [r.id, (now - r.start) / r.duration]));
      await OBR.scene.local.updateItems<Effect>(
        live.map((r) => r.id),
        (drafts) => {
          for (const d of drafts) {
            const p = progress.get(d.id) ?? 1;
            d.uniforms = d.uniforms.map((u) => (u.name === "p" ? { name: "p", value: p } : u));
          }
        },
      );
    }
    if (done.length) {
      for (const r of done) running.delete(r.id);
      await OBR.scene.local.deleteItems(done.map((r) => r.id));
    }
  } catch (err) {
    console.error("[PF2e] Error animando efectos", err);
  } finally {
    updating = false;
    if (!running.size && timer !== undefined) {
      window.clearInterval(timer);
      timer = undefined;
    }
  }
}

// Centro y radio (en casillas) del token
async function tokenGeometry(tokenId: string) {
  const [b, dpi] = await Promise.all([OBR.scene.items.getItemBounds([tokenId]), OBR.scene.grid.getDpi()]);
  return { center: b.center, dpi, radius: Math.max(b.width, b.height) / 2 / dpi };
}

async function addEffect(kind: FxKind, center: Vector2, cells: number, dpi: number, r: number, dir: Vector2 = { x: 1, y: 0 }, color?: string) {
  const side = cells * dpi;
  const id = `${OVERLAY_PREFIX}-fx-${Date.now().toString(36)}-${seq++}`;
  const item = buildEffect()
    .id(id)
    .effectType("STANDALONE")
    .width(side)
    .height(side)
    .position({ x: center.x - side / 2, y: center.y - side / 2 })
    .sksl(fxSksl(kind))
    .uniforms([
      { name: "p", value: 0 },
      { name: "cells", value: cells },
      { name: "dir", value: dir },
      { name: "r", value: r },
      { name: "col", value: hexToVec(color ?? defaultColor(kind)) },
    ])
    .layer("ATTACHMENT")
    .locked(true)
    .disableHit(true)
    .build();
  await OBR.scene.local.addItems([item]);
  running.set(id, { id, start: Date.now(), duration: fxTiming(kind) });
  if (timer === undefined) timer = window.setInterval(frame, FRAME_MS);
}

// Efectos sobre el propio token (curación, daño, escudo, magia, rasgos de clase)
export async function playOnToken(kind: FxKind, tokenId: string, color?: string) {
  const g = await tokenGeometry(tokenId);
  const r = Math.max(0.5, g.radius);
  await addEffect(kind, g.center, r * 3.2, g.dpi, r, undefined, color);
}

const isAttack = (kind: FxKind) => ATTACK_FX.some((a) => a.id === kind);
const isRanged = (kind: FxKind) => !!ATTACK_FX.find((a) => a.id === kind)?.ranged;

// Ataque con arma hacia una de las 8 direcciones
export async function playAttack(kind: FxKind, tokenId: string, dirIndex: number, color?: string) {
  const g = await tokenGeometry(tokenId);
  const d = DIRS[((dirIndex % 8) + 8) % 8];
  const len = Math.hypot(d.x, d.y);
  const n = { x: d.x / len, y: d.y / len };
  const r = Math.max(0.5, g.radius);
  if (isRanged(kind)) {
    // Sale desde el borde del token y avanza un tramo antes de desvanecerse
    const dist = r + RANGED_CELLS / 2;
    const center = { x: g.center.x + n.x * dist * g.dpi, y: g.center.y + n.y * dist * g.dpi };
    await addEffect(kind, center, RANGED_CELLS + 1, g.dpi, r, n, color);
    return;
  }
  // Cuerpo a cuerpo: la casilla contigua (en diagonal, la casilla en diagonal)
  const off = r + 0.5;
  const center = { x: g.center.x + d.x * off * g.dpi, y: g.center.y + d.y * off * g.dpi };
  await addEffect(kind, center, 1.7, g.dpi, r, n, color);
}

// Ataque dirigido a otro token (objetivo elegido)
export async function playAttackTo(kind: FxKind, fromId: string, toId: string, color?: string) {
  // Los efectos que no son de ataque se ven sobre el objetivo
  if (!isAttack(kind)) return playOnToken(kind, toId, color);
  const [a, b] = await Promise.all([tokenGeometry(fromId), tokenGeometry(toId)]);
  const dx = (b.center.x - a.center.x) / a.dpi;
  const dy = (b.center.y - a.center.y) / a.dpi;
  const dist = Math.hypot(dx, dy) || 1;
  const n = { x: dx / dist, y: dy / dist };
  const r = Math.max(0.5, a.radius);
  if (isRanged(kind)) {
    // De centro a centro: la zona cubre todo el trayecto
    const cells = Math.max(2, dist) + 1;
    const center = { x: (a.center.x + b.center.x) / 2, y: (a.center.y + b.center.y) / 2 };
    await addEffect(kind, center, cells, a.dpi, r, n, color);
    return;
  }
  // Cuerpo a cuerpo: sobre el borde del objetivo que mira al atacante
  const rb = Math.max(0.5, b.radius);
  const back = Math.max(0, rb - 0.5);
  const center = { x: b.center.x - n.x * back * a.dpi, y: b.center.y - n.y * back * a.dpi };
  await addEffect(kind, center, 1.7, a.dpi, r, n, color);
}

// Al cambiar de escena se pierden los items locales
export function resetFx() {
  running.clear();
}
