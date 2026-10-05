import OBR, { buildImage, buildShape, buildText, type Item } from "@owlbear-rodeo/sdk";
import { autoLinkCandidate, linkToken, npcToToken, publishPlayer, roomId, tokenData, whenReady } from "../obr";
import { store } from "../storage";
import { extrasStore } from "../extras";
import { watchForUpdates } from "../autoUpdate";
import { live, needsSheetSync, pcColor, randomColor, seedState, syncSheet } from "../live";
import { combatStore, npcKey, pcKey, type Combat } from "../combat";
import { playAttack, playAttackTo, playOnToken, resetFx } from "./fx";
import type { FxKind, RollFx } from "../fx";
import type { PcState } from "../live";
import { DEATH_DYING, activeConditionIcons, effectiveAc, effectiveMaxHp } from "../rules";
import {
  CHANNEL_FX,
  CHANNEL_ROLL,
  ID,
  META_TOKEN,
  OVERLAY_PREFIX,
  TOAST_KEY,
  TOAST_POPOVER,
  hpColor,
  npcState,
  visibleEntry,
  type RollEntry,
  type TokenData,
} from "../shared";

const pageUrl = (path: string) => new URL(path, window.location.href).href;
const icon = (name: string) => pageUrl(`icons/${name}.svg`);
const embedUrl = pageUrl("token.html");

let role: "GM" | "PLAYER" = "PLAYER";
let meId = "";
let meName = "";

// Crea (o actualiza tras reimportar) el estado en la sala de la hoja activa de este jugador,
// aunque nunca abra la extensión.
async function ensureActiveState() {
  await live.start();
  const c = store.activeCharacter(roomId());
  if (!c) return;
  const s = live.get(c.id);
  if (!s) {
    await live.write(seedState(c, { id: meId, name: meName }, store.legacyVitals(c.id) ?? undefined));
  } else if (s.owner === meId && (needsSheetSync(s, c) || s.ownerName !== meName)) {
    await live.write({ ...syncSheet(s, c), ownerName: meName });
  }
}

async function setupContextMenus() {
  await OBR.contextMenu.create({
    id: `${ID}/link`,
    icons: [
      {
        icon: icon("link"),
        label: "Vincular a mi hoja PF2e",
        filter: {
          max: 1,
          every: [
            { key: "layer", value: "CHARACTER" },
            { key: ["metadata", META_TOKEN], value: undefined },
          ],
        },
      },
    ],
    async onClick(context) {
      const c = store.activeCharacter(roomId());
      if (!c) {
        OBR.notification.show("Primero sube tu hoja de Pathbuilder en la extensión PF2e.", "WARNING");
        return;
      }
      await linkToken(context.items[0].id, c, meId);
      await ensureActiveState();
      OBR.notification.show(`${c.name} vinculado al token.`, "SUCCESS");
    },
  });

  // Editor de HP/CA incrustado en el menú contextual
  await OBR.contextMenu.create({
    id: `${ID}/edit-gm`,
    icons: [
      {
        icon: icon("heart"),
        label: "HP / CA",
        filter: { max: 1, roles: ["GM"], every: [{ key: ["metadata", META_TOKEN], value: undefined, operator: "!=" }] },
      },
    ],
    embed: { url: embedUrl, height: 196 },
  });
  await OBR.contextMenu.create({
    id: `${ID}/edit-player`,
    icons: [
      {
        icon: icon("heart"),
        label: "HP / CA",
        // Cada jugador solo edita su propio token
        filter: { max: 1, roles: ["PLAYER"], every: [{ key: ["metadata", META_TOKEN, "ownerId"], value: meId }] },
      },
    ],
    embed: { url: embedUrl, height: 164 },
  });

  // El GM puede ponerle HP/CA a un token sin hoja (enemigos, PNJ)
  await OBR.contextMenu.create({
    id: `${ID}/npc`,
    icons: [
      {
        icon: icon("plus"),
        label: "Añadir HP/CA (PNJ)",
        filter: {
          max: 1,
          roles: ["GM"],
          every: [
            { key: "layer", value: "CHARACTER" },
            { key: ["metadata", META_TOKEN], value: undefined },
          ],
        },
      },
    ],
    async onClick(context) {
      const item = context.items[0];
      const data = npcToToken({ name: item.name, hp: 20, maxHp: 20, temp: 0, baseAc: 15, acAdj: 0, cond: {}, hidden: true, level: 0, attacks: [], spells: [], color: randomColor() });
      await OBR.scene.items.updateItems([item.id], (drafts) => {
        for (const d of drafts) d.metadata[META_TOKEN] = data;
      });
    },
  });
}

// ---------- Tiradas compartidas: registro + tarjetas abajo a la derecha ----------

const toastUrl = pageUrl("toast.html");
const TOAST_WIDTH = 300;
const TOAST_CARD = 76;
const TOAST_GAP = 8;
const TOAST_CLEAR = 22;
const TOAST_PAD = 4;
const TOAST_MAX = 4;
// Distancia al borde inferior: deja libres los controles de zoom/escala de Owlbear
const TOAST_BOTTOM = 70;

let toastOpen = false;
let toastQueue: Promise<void> = Promise.resolve();

const toastHeight = (n: number) =>
  n * TOAST_CARD + (n - 1) * TOAST_GAP + (n > 1 ? TOAST_CLEAR + TOAST_GAP : 0) + TOAST_PAD;

const liveToasts = () => store.toasts().filter((t) => t.until > Date.now());

// Abre, redimensiona o cierra la ventana de tarjetas según las que siguen vigentes.
// Se encola para que dos tiradas seguidas no abran la ventana dos veces.
function syncToasts() {
  toastQueue = toastQueue
    .then(async () => {
      const list = liveToasts();
      if (list.length !== store.toasts().length) store.setToasts(list);
      if (!list.length) {
        if (toastOpen) {
          toastOpen = false;
          await OBR.popover.close(TOAST_POPOVER);
        }
        return;
      }
      const height = toastHeight(list.length);
      if (toastOpen) {
        await OBR.popover.setHeight(TOAST_POPOVER, height);
        return;
      }
      const [width, viewHeight] = await Promise.all([OBR.viewport.getWidth(), OBR.viewport.getHeight()]);
      await OBR.popover.open({
        id: TOAST_POPOVER,
        url: toastUrl,
        width: TOAST_WIDTH,
        height,
        anchorReference: "POSITION",
        anchorPosition: { left: width - 16, top: viewHeight - TOAST_BOTTOM },
        transformOrigin: { horizontal: "RIGHT", vertical: "BOTTOM" },
        hidePaper: true,
        disableClickAway: true,
        marginThreshold: 0,
      });
      toastOpen = true;
    })
    .catch((err) => console.error("[PF2e] Error con las tarjetas de tirada", err));
}

function addToast(entry: RollEntry) {
  const ms = entry.nat ? 11_000 : 8_000;
  const list = [...liveToasts().filter((t) => t.entry.id !== entry.id), { entry, until: Date.now() + ms }];
  store.setToasts(list.slice(-TOAST_MAX));
  syncToasts();
  window.setTimeout(syncToasts, ms + 50);
}

function setupRolls() {
  // Si esta página se recargó con tarjetas abiertas, empieza desde cero
  store.setToasts([]);
  OBR.popover.close(TOAST_POPOVER).catch(() => undefined);
  OBR.broadcast.onMessage(CHANNEL_ROLL, (event) => {
    const entry = visibleEntry(event.data as RollEntry, meId, role);
    if (!entry) return;
    store.pushLog(roomId(), entry);
    addToast(entry);
    playRollFx(entry);
  });
  // Efectos sueltos (ataques de PNJ con tirada secreta, rasgos de clase…)
  OBR.broadcast.onMessage(CHANNEL_FX, (event) => playFxMessage(event.data as RollFx));
  // La ventana de tarjetas escribe aquí al cerrar una tarjeta o limpiar todas
  window.addEventListener("storage", (e) => {
    if (e.key === TOAST_KEY) syncToasts();
  });
}

// ---------- Barras de vida, CA e íconos sobre los tokens (items locales de cada cliente) ----------

interface TokenView {
  hp: number;
  maxHp: number;
  temp: number;
  ac: number;
  acChanged: boolean;
  dead: boolean;
  icons: { icon: string; value?: number }[];
  hiddenNpc: boolean;
  num?: number;
}

// Marcas que los PJ dejan sobre un PNJ: presa, provocado, vulnerabilidad explotada, siervo
function classMarks(tokenId: string): TokenView["icons"] {
  const out: TokenView["icons"] = [];
  for (const s of Object.values(live.all())) {
    const k = s.cls;
    if (!k) continue;
    if (k.prey === tokenId) out.push({ icon: "prey" });
    if (k.taunt === tokenId) out.push({ icon: "taunt" });
    if (k.exploit?.tok === tokenId) out.push({ icon: "exploit" });
    if (k.thralls?.some((t) => t.tok === tokenId)) out.push({ icon: "thrall" });
  }
  return out;
}

function viewFor(item: Item, d: TokenData): TokenView | null {
  if (d.kind === "pc") {
    const s = d.characterId ? live.get(d.characterId) : undefined;
    if (!s) return null;
    // El eidolón muestra los PG de su invocador
    const hpS = (s.pet?.shared && live.get(s.pet.parent)) || s;
    const ac = effectiveAc(s.baseAc, s.acAdj, s.cond, s.shield).ac;
    const icons: TokenView["icons"] = [];
    if (hpS.dying > 0) icons.push({ icon: hpS.dying >= DEATH_DYING ? "dead" : "dying", value: hpS.dying });
    if (hpS.wounded > 0) icons.push({ icon: "wounded", value: hpS.wounded });
    if (s.shield?.raised) icons.push({ icon: "shield", value: s.shield.bonus });
    if (s.cls?.rage) icons.push({ icon: "rage" });
    if (s.cls?.panache) icons.push({ icon: "panache" });
    if (s.cls?.aura) icons.push({ icon: "aura" });
    if (s.cls?.psyche) icons.push({ icon: "psyche", value: s.cls.psyche });
    icons.push(...activeConditionIcons(s.cond).map((c) => ({ icon: c.icon, value: c.value })));
    icons.push(...classMarks(item.id));
    return {
      hp: hpS.hp,
      maxHp: effectiveMaxHp(hpS.maxHp, hpS.level, hpS.cond),
      temp: hpS.temp,
      ac,
      acChanged: ac !== s.baseAc,
      dead: hpS.dying >= DEATH_DYING,
      icons,
      hiddenNpc: false,
    };
  }
  const n = npcState(d);
  const ac = effectiveAc(n.baseAc, n.acAdj, n.cond, n.shield).ac;
  const icons: TokenView["icons"] = [];
  if (n.shield?.raised) icons.push({ icon: "shield", value: n.shield.bonus });
  icons.push(...activeConditionIcons(n.cond).map((c) => ({ icon: c.icon, value: c.value })));
  icons.push(...classMarks(item.id));
  return {
    hp: n.hp,
    maxHp: effectiveMaxHp(n.maxHp, n.level, n.cond),
    temp: n.temp,
    ac,
    acChanged: ac !== n.baseAc,
    dead: false,
    icons,
    hiddenNpc: n.hidden,
    num: n.num,
  };
}

const rendered = new Map<string, { sig: string; ids: string[] }>();
let dpi = 150;
let syncing = false;
let pending: Item[] | null = null;
let lastItems: Item[] = [];

const partId = (tokenId: string, part: string) => `${OVERLAY_PREFIX}-${part}-${tokenId}`;

function shouldShow(item: Item, v: TokenView) {
  if (role === "GM") return true;
  return item.visible && !v.hiddenNpc;
}

async function buildOverlay(item: Item, v: TokenView): Promise<Item[]> {
  const bounds = await OBR.scene.items.getItemBounds([item.id]);
  const w = Math.max(bounds.width * 0.9, dpi * 0.8);
  const h = dpi * 0.17;
  const x = bounds.center.x - w / 2;
  const y = bounds.min.y - h - dpi * 0.06;
  const ratio = v.maxHp > 0 ? Math.max(0, Math.min(1, v.hp / v.maxHp)) : 0;
  const tempRatio = v.maxHp > 0 ? Math.min(1, v.temp / v.maxHp) : 0;
  const common = <T extends ReturnType<typeof buildShape> | ReturnType<typeof buildText> | ReturnType<typeof buildImage>>(b: T) =>
    b
      .attachedTo(item.id)
      .layer("ATTACHMENT")
      .locked(true)
      .disableHit(true)
      .visible(item.visible)
      .disableAttachmentBehavior(["ROTATION", "SCALE", "LOCKED", "COPY"]) as T;

  let z = Date.now();
  const out: Item[] = [
    common(buildShape().id(partId(item.id, "bg")))
      .shapeType("RECTANGLE")
      .width(w)
      .height(h)
      .position({ x, y })
      .fillColor(v.dead ? "#3a0d0d" : "#15171c")
      .fillOpacity(0.85)
      .strokeColor("#000000")
      .strokeWidth(dpi * 0.015)
      .strokeOpacity(0.9)
      .zIndex(z++)
      .build(),
  ];
  if (ratio > 0) {
    out.push(
      common(buildShape().id(partId(item.id, "fill")))
        .shapeType("RECTANGLE")
        .width(w * ratio)
        .height(h)
        .position({ x, y })
        .fillColor(hpColor(v.hp, v.maxHp))
        .fillOpacity(0.95)
        .strokeWidth(0)
        .zIndex(z++)
        .build(),
    );
  }
  if (tempRatio > 0) {
    out.push(
      common(buildShape().id(partId(item.id, "temp")))
        .shapeType("RECTANGLE")
        .width(w * tempRatio)
        .height(h * 0.3)
        .position({ x, y: y + h * 0.7 })
        .fillColor("#4aa3ff")
        .fillOpacity(1)
        .strokeWidth(0)
        .zIndex(z++)
        .build(),
    );
  }
  const hpText = v.dead ? "MUERTO" : `${v.hp}/${v.maxHp}${v.temp ? ` +${v.temp}` : ""}`;
  out.push(
    common(buildText().id(partId(item.id, "text")))
      .textType("PLAIN")
      .plainText(hpText)
      .width(w)
      .height(h)
      .position({ x, y })
      .padding(0)
      .fontSize(h * 0.78)
      .fontWeight(700)
      .fontFamily("Roboto, Arial, sans-serif")
      .textAlign("CENTER")
      .textAlignVertical("MIDDLE")
      .fillColor("#ffffff")
      .strokeColor("#000000")
      .strokeWidth(dpi * 0.012)
      .zIndex(z++)
      .build(),
  );

  // Hexágono con la CA a la izquierda de la barra
  const s = h * 1.9;
  const acCenter = { x: x - s * 0.35, y: y + h / 2 };
  out.push(
    common(buildShape().id(partId(item.id, "ac")))
      .shapeType("HEXAGON")
      .width(s)
      .height(s)
      .position(acCenter)
      .fillColor(v.acChanged ? "#7a3a12" : "#23272f")
      .fillOpacity(0.95)
      .strokeColor("#e8622c")
      .strokeWidth(dpi * 0.02)
      .zIndex(z++)
      .build(),
    common(buildText().id(partId(item.id, "actext")))
      .textType("PLAIN")
      .plainText(String(v.ac))
      .width(s)
      .height(s)
      .position({ x: acCenter.x - s / 2, y: acCenter.y - s / 2 })
      .padding(0)
      .fontSize(s * 0.46)
      .fontWeight(800)
      .fontFamily("Roboto, Arial, sans-serif")
      .textAlign("CENTER")
      .textAlignVertical("MIDDLE")
      .fillColor("#ffffff")
      .strokeColor("#000000")
      .strokeWidth(dpi * 0.01)
      .zIndex(z++)
      .build(),
  );

  // Número del PNJ (Goblin 2) a la derecha de la barra
  if (v.num) {
    const ns = h * 1.6;
    const nc = { x: x + w + ns * 0.4, y: y + h / 2 };
    out.push(
      common(buildShape().id(partId(item.id, "num")))
        .shapeType("CIRCLE")
        .width(ns)
        .height(ns)
        .position(nc)
        .fillColor("#23272f")
        .fillOpacity(0.95)
        .strokeColor("#d4a72c")
        .strokeWidth(dpi * 0.015)
        .zIndex(z++)
        .build(),
      common(buildText().id(partId(item.id, "numtext")))
        .textType("PLAIN")
        .plainText(String(v.num))
        .width(ns)
        .height(ns)
        .position({ x: nc.x - ns / 2, y: nc.y - ns / 2 })
        .padding(0)
        .fontSize(ns * 0.55)
        .fontWeight(800)
        .fontFamily("Roboto, Arial, sans-serif")
        .textAlign("CENTER")
        .textAlignVertical("MIDDLE")
        .fillColor("#ffffff")
        .strokeColor("#000000")
        .strokeWidth(dpi * 0.01)
        .zIndex(z++)
        .build(),
    );
  }

  // Fila de íconos (condiciones, moribundo, escudo alzado) sobre la barra
  if (v.icons.length) {
    // Crecen con el token (criaturas grandes) pero sin pasar de media casilla
    const size = Math.min(dpi * 0.5, Math.max(dpi * 0.3, w * 0.2));
    const gap = size * 0.12;
    const fit = Math.max(1, Math.floor((w + gap) / (size + gap)));
    const shown = v.icons.slice(0, fit);
    const rowW = shown.length * size + (shown.length - 1) * gap;
    const rowY = y - size - dpi * 0.04;
    shown.forEach((ic, i) => {
      const left = bounds.center.x - rowW / 2 + i * (size + gap);
      const center = { x: left + size / 2, y: rowY + size / 2 };
      out.push(
        common(buildShape().id(partId(item.id, `ib${i}`)))
          .shapeType("CIRCLE")
          .width(size)
          .height(size)
          .position(center)
          .fillColor("#15171c")
          .fillOpacity(0.85)
          .strokeColor("#000000")
          .strokeWidth(dpi * 0.01)
          .zIndex(z++)
          .build(),
        common(
          buildImage(
            { url: icon(`cond/${ic.icon}`), mime: "image/svg+xml", width: 64, height: 64 },
            { dpi: (64 * dpi) / (size * 0.78), offset: { x: 32, y: 32 } },
          ).id(partId(item.id, `ii${i}`)),
        )
          .position(center)
          .zIndex(z++)
          .build(),
      );
      if (ic.value) {
        out.push(
          common(buildText().id(partId(item.id, `iv${i}`)))
            .textType("PLAIN")
            .plainText(String(ic.value))
            .width(size * 0.6)
            .height(size * 0.5)
            .position({ x: left + size * 0.55, y: rowY + size * 0.58 })
            .padding(0)
            .fontSize(size * 0.44)
            .fontWeight(900)
            .fontFamily("Roboto, Arial, sans-serif")
            .textAlign("CENTER")
            .textAlignVertical("MIDDLE")
            .fillColor("#ffffff")
            .strokeColor("#000000")
            .strokeWidth(dpi * 0.012)
            .zIndex(z++)
            .build(),
        );
      }
    });
  }
  return out;
}

async function syncOverlays(items: Item[]) {
  detectNpcFx(items);
  lastItems = items;
  if (syncing) {
    pending = items;
    return;
  }
  syncing = true;
  try {
    const wanted = new Map<string, { item: Item; view: TokenView }>();
    for (const item of items) {
      const d = tokenData(item);
      const v = d ? viewFor(item, d) : null;
      if (v && shouldShow(item, v)) wanted.set(item.id, { item, view: v });
    }
    const toDelete: string[] = [];
    const toAdd: Item[] = [];
    for (const [id, r] of [...rendered]) {
      if (!wanted.has(id)) {
        toDelete.push(...r.ids);
        rendered.delete(id);
      }
    }
    for (const [id, { item, view }] of wanted) {
      const sig = JSON.stringify([view, item.scale, item.visible, dpi]);
      const prev = rendered.get(id);
      if (prev?.sig === sig) continue;
      if (prev) toDelete.push(...prev.ids);
      const built = await buildOverlay(item, view);
      toAdd.push(...built);
      rendered.set(id, { sig, ids: built.map((b) => b.id) });
    }
    if (toDelete.length) {
      const existing = new Set((await OBR.scene.local.getItems()).map((i) => i.id));
      const del = toDelete.filter((id) => existing.has(id));
      if (del.length) await OBR.scene.local.deleteItems(del);
    }
    if (toAdd.length) await OBR.scene.local.addItems(toAdd);
    await syncTurnRing();
    await syncTargets(items);
  } catch (err) {
    console.error("[PF2e] Error dibujando barras", err);
  } finally {
    syncing = false;
    if (pending) {
      const next = pending;
      pending = null;
      syncOverlays(next);
    }
  }
}

// ---------- Dianas: cada PJ (y PNJ) marca a su objetivo con su color ----------

const targetsDrawn = new Map<string, { sig: string; ids: string[] }>();

interface TargetMark {
  key: string;
  color: string;
  tokenId: string;
}

function wantedTargets(items: Item[]): TargetMark[] {
  const out: TargetMark[] = [];
  const visible = (id: string) => {
    const it = items.find((i) => i.id === id);
    return !!it && (it.visible || role === "GM");
  };
  for (const s of Object.values(live.all())) {
    if (s.target && visible(s.target)) out.push({ key: `pc-${s.id}`, color: pcColor(s), tokenId: s.target });
  }
  for (const item of items) {
    const d = tokenData(item);
    if (d?.kind !== "npc" || !d.target?.startsWith("pc:")) continue;
    if (!item.visible && role !== "GM") continue;
    const tok = pcToken(d.target.slice(3));
    if (tok && visible(tok.id)) out.push({ key: `npc-${item.id}`, color: d.color ?? "#ff3030", tokenId: tok.id });
  }
  return out;
}

async function syncTargets(items: Item[]) {
  const wanted = wantedTargets(items);
  // Varias dianas sobre el mismo token se dibujan una dentro de otra
  const perToken = new Map<string, number>();
  const toDelete: string[] = [];
  const toAdd: Item[] = [];
  const keys = new Set(wanted.map((t) => t.key));
  for (const [k, r] of [...targetsDrawn]) {
    if (!keys.has(k)) {
      toDelete.push(...r.ids);
      targetsDrawn.delete(k);
    }
  }
  for (const t of wanted) {
    const item = items.find((i) => i.id === t.tokenId);
    if (!item) continue;
    const slot = perToken.get(t.tokenId) ?? 0;
    perToken.set(t.tokenId, slot + 1);
    const sig = JSON.stringify([t.tokenId, t.color, slot, item.scale, item.visible, dpi]);
    const prev = targetsDrawn.get(t.key);
    if (prev?.sig === sig) continue;
    if (prev) toDelete.push(...prev.ids);
    const b = await OBR.scene.items.getItemBounds([item.id]);
    const base = Math.max(b.width, b.height) * (0.62 + slot * 0.14);
    const ring = (part: string, size: number, width: number, fill = false) =>
      buildShape()
        .id(`${OVERLAY_PREFIX}-tgt-${t.key}-${part}`)
        .shapeType("CIRCLE")
        .width(size)
        .height(size)
        .position(b.center)
        .fillColor(t.color)
        .fillOpacity(fill ? 0.85 : 0)
        .strokeColor(t.color)
        .strokeOpacity(0.9)
        .strokeWidth(width)
        .attachedTo(item.id)
        .layer("ATTACHMENT")
        .locked(true)
        .disableHit(true)
        .visible(item.visible)
        .disableAttachmentBehavior(["ROTATION", "SCALE", "LOCKED", "COPY"])
        .zIndex(2 + slot)
        .build();
    const built = slot
      ? [ring("a", base, dpi * 0.035)]
      : [ring("a", base, dpi * 0.035), ring("b", base * 0.62, dpi * 0.03), ring("c", base * 0.16, 0, true)];
    toAdd.push(...built);
    targetsDrawn.set(t.key, { sig, ids: built.map((x) => x.id) });
  }
  if (toDelete.length) {
    const existing = new Set((await OBR.scene.local.getItems()).map((i) => i.id));
    const del = toDelete.filter((id) => existing.has(id));
    if (del.length) await OBR.scene.local.deleteItems(del);
  }
  if (toAdd.length) await OBR.scene.local.addItems(toAdd);
}

// ---------- Turno actual: anillo dorado en su token y aviso a su jugador ----------

const RING_ID = `${OVERLAY_PREFIX}-turnring`;
let ringSig: string | null = null;
let lastCurrent: string | null | undefined;

function turnTokenId(c: Combat): string | null {
  if (!c.active || !c.current) return null;
  for (const s of Object.values(live.all())) {
    if (c.current === pcKey(s.id)) return lastItems.find((i) => tokenData(i)?.characterId === s.id)?.id ?? null;
  }
  const npc = c.npcs.find((n) => c.current === npcKey(n.id));
  if (!npc?.tokenId || (npc.hidden && role !== "GM")) return null;
  return npc.tokenId;
}

async function syncTurnRing() {
  const id = turnTokenId(combatStore.get());
  const item = id ? lastItems.find((i) => i.id === id) : undefined;
  const show = !!item && (item.visible || role === "GM");
  const sig = show ? JSON.stringify([item.id, item.scale, item.visible, dpi]) : null;
  if (sig === ringSig) return;
  ringSig = sig;
  const old = await OBR.scene.local.getItems([RING_ID]);
  if (old.length) await OBR.scene.local.deleteItems([RING_ID]);
  if (!show || !item) return;
  const b = await OBR.scene.items.getItemBounds([item.id]);
  const size = Math.max(b.width, b.height) * 1.12;
  await OBR.scene.local.addItems([
    buildShape()
      .id(RING_ID)
      .shapeType("CIRCLE")
      .width(size)
      .height(size)
      .position(b.center)
      .fillOpacity(0)
      .strokeColor("#ffc94a")
      .strokeOpacity(0.95)
      .strokeWidth(dpi * 0.06)
      .attachedTo(item.id)
      .layer("ATTACHMENT")
      .locked(true)
      .disableHit(true)
      .visible(item.visible)
      .disableAttachmentBehavior(["ROTATION", "SCALE", "LOCKED", "COPY"])
      .zIndex(1)
      .build(),
  ]);
}

function onCombatChange(c: Combat) {
  if (lastItems.length) syncTurnRing().catch((err) => console.error("[PF2e] Error dibujando el turno", err));
  const first = lastCurrent === undefined;
  if (c.current === lastCurrent) return;
  lastCurrent = c.current;
  if (first || !c.active || !c.current) return;
  // Aviso al dueño del PJ que empieza su turno
  for (const s of Object.values(live.all())) {
    if (c.current === pcKey(s.id) && s.owner === meId) OBR.notification.show(`¡Es tu turno, ${s.name}!`, "SUCCESS");
  }
}

// ---------- Efectos visuales: se deducen de los cambios de estado, así todos ven lo mismo ----------

const visibleToMe = (item: Item | undefined) => !!item && (item.visible || role === "GM");
const pcToken = (charId: string) => lastItems.find((i) => tokenData(i)?.characterId === charId);

function fx(kind: FxKind, item: Item | undefined) {
  if (!visibleToMe(item)) return;
  playOnToken(kind, item!.id).catch((err) => console.error("[PF2e] Error con un efecto", err));
}

// "pc:<id>" (PJ o mascota) o el id de un token
function resolveToken(ref: string | undefined): Item | undefined {
  if (!ref) return undefined;
  if (ref.startsWith("pc:")) return pcToken(ref.slice(3));
  if (ref.startsWith("npc:")) return lastItems.find((i) => i.id === ref.slice(4));
  return lastItems.find((i) => i.id === ref);
}

function playFxMessage(f: RollFx, fallbackFrom?: string) {
  const from = resolveToken(f.from ?? fallbackFrom);
  if (!visibleToMe(from)) return;
  const to = resolveToken(f.to);
  let play: Promise<void>;
  if (to && visibleToMe(to) && to.id !== from!.id) play = playAttackTo(f.kind, from!.id, to.id, f.color);
  else if (f.dir !== undefined) play = playAttack(f.kind, from!.id, f.dir, f.color);
  else play = playOnToken(f.kind, from!.id, f.color);
  play.catch((err) => console.error("[PF2e] Error con un efecto", err));
}

// Ataques y conjuros: el efecto viaja con la tirada
function playRollFx(entry: RollEntry) {
  if (!entry.fx) return;
  if (!entry.fx.from && !entry.charId) return;
  playFxMessage(entry.fx, entry.charId ? `pc:${entry.charId}` : undefined);
}

interface VitalSnap {
  hp: number;
  temp: number;
  dying: number;
  shield: number;
}
let prevPc: Map<string, VitalSnap> | null = null;
let prevNpc: Map<string, VitalSnap> | null = null;

// Compara con lo anterior y lanza curación, daño, escudo golpeado o estrellas al caer moribundo
function vitalsFx(prev: VitalSnap | undefined, next: VitalSnap, item: Item | undefined) {
  if (!prev) return;
  if (next.shield < prev.shield) fx("shield", item);
  if (next.hp + next.temp < prev.hp + prev.temp) fx("damage", item);
  else if (next.hp > prev.hp) fx("heal", item);
  if (next.dying > prev.dying) fx("stars", item);
}

function detectPcFx(states: Record<string, PcState>) {
  const next = new Map<string, VitalSnap>();
  for (const s of Object.values(states)) {
    const snap = { hp: s.hp, temp: s.temp, dying: s.dying, shield: s.shield?.hp ?? 0 };
    next.set(s.id, snap);
    if (prevPc && lastItems.length) vitalsFx(prevPc.get(s.id), snap, pcToken(s.id));
  }
  prevPc = next;
}

function detectNpcFx(items: Item[]) {
  const next = new Map<string, VitalSnap>();
  for (const item of items) {
    const d = tokenData(item);
    if (d?.kind !== "npc") continue;
    const n = npcState(d);
    const snap = { hp: n.hp, temp: n.temp, dying: 0, shield: 0 };
    next.set(item.id, snap);
    if (prevNpc) vitalsFx(prevNpc.get(item.id), snap, item);
  }
  prevNpc = next;
}

async function resetOverlays() {
  rendered.clear();
  targetsDrawn.clear();
  resetFx();
  ringSig = null;
  if (!(await OBR.scene.isReady())) return;
  const old = await OBR.scene.local.getItems((i) => i.id.startsWith(OVERLAY_PREFIX));
  if (old.length) await OBR.scene.local.deleteItems(old.map((i) => i.id));
  dpi = await OBR.scene.grid.getDpi();
  syncOverlays(await OBR.scene.items.getItems());
}

function setupOverlays() {
  OBR.scene.items.onChange((items) => syncOverlays(items));
  // El estado de los PJ vive en la sala: si cambia, se redibujan sus barras
  live.subscribe((states) => {
    detectPcFx(states);
    if (lastItems.length) syncOverlays(lastItems);
  });
  // Se suscribe ya cargado, para no avisar del turno en curso al abrir la sala
  combatStore.start().then(() => combatStore.subscribe(onCombatChange));
  OBR.scene.grid.onChange((grid) => {
    if (grid.dpi !== dpi) resetOverlays();
  });
  OBR.scene.onReadyChange(async (ready) => {
    if (!ready) {
      rendered.clear();
      targetsDrawn.clear();
      lastItems = [];
      prevNpc = null;
      return;
    }
    await resetOverlays();
    // Al abrir una escena nueva, intenta vincular el token con el mismo nombre que tu personaje
    const c = store.activeCharacter(roomId());
    if (!c) return;
    const linked = await OBR.scene.items.getItems((i) => tokenData(i)?.characterId === c.id);
    if (linked.length) return;
    const cand = await autoLinkCandidate(c, { nameOnly: true });
    if (cand) {
      await linkToken(cand.id, c, meId);
      OBR.notification.show(`${c.name} vinculado automáticamente a "${cand.name}".`, "INFO");
    }
  });
  OBR.player.onChange((p) => {
    if (p.selection?.length) store.setLastSelection(p.selection);
    if (p.role !== role) {
      role = p.role;
      resetOverlays();
    }
    meName = p.name;
  });
  resetOverlays();
}

// Publica la hoja activa para que el GM pueda abrirla aunque el jugador no abra la extensión
function publishActive() {
  const c = store.activeCharacter(roomId());
  publishPlayer(c ? { character: c, extras: extrasStore.get(c.id) } : null);
}

watchForUpdates();
whenReady().then(async (ok) => {
  if (!ok) return;
  role = await OBR.player.getRole();
  meId = await OBR.player.getId();
  meName = await OBR.player.getName();
  await setupContextMenus();
  setupRolls();
  await live.start();
  setupOverlays();
  publishActive();
  ensureActiveState();
  console.info("[PF2e] Extensión lista");
});
