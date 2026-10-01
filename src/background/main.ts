import OBR, { buildShape, buildText, type Item } from "@owlbear-rodeo/sdk";
import { autoLinkCandidate, linkToken, publishPlayer, roomId, tokenData, whenReady } from "../obr";
import { store } from "../storage";
import { watchForUpdates } from "../autoUpdate";
import {
  CHANNEL_ROLL,
  ID,
  META_TOKEN,
  OVERLAY_PREFIX,
  TOAST_KEY,
  TOAST_POPOVER,
  hpColor,
  visibleEntry,
  type RollEntry,
  type TokenData,
} from "../shared";

const icon = (name: string) => new URL(`icons/${name}.svg`, window.location.href).href;
const embedUrl = new URL("token.html", window.location.href).href;

let role: "GM" | "PLAYER" = "PLAYER";
let meId = "";

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
      await linkToken(context.items[0].id, c, store.vitals(c));
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
    embed: { url: embedUrl, height: 168 },
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
    embed: { url: embedUrl, height: 136 },
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
      const data: TokenData = {
        kind: "npc",
        name: item.name,
        hp: 20,
        maxHp: 20,
        temp: 0,
        ac: 15,
        baseAc: 15,
        hidden: true,
        updatedAt: Date.now(),
      };
      await OBR.scene.items.updateItems([item.id], (drafts) => {
        for (const d of drafts) d.metadata[META_TOKEN] = data;
      });
    },
  });
}

// ---------- Tiradas compartidas: registro + tarjetas abajo a la derecha ----------

const toastUrl = new URL("toast.html", window.location.href).href;
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
  });
  // La ventana de tarjetas escribe aquí al cerrar una tarjeta o limpiar todas
  window.addEventListener("storage", (e) => {
    if (e.key === TOAST_KEY) syncToasts();
  });
}

// ---------- Barras de HP y CA sobre los tokens (items locales de cada cliente) ----------

const rendered = new Map<string, string>();
let dpi = 150;
let syncing = false;
let pending: Item[] | null = null;

const overlayIds = (tokenId: string) =>
  ["bg", "fill", "temp", "text", "ac", "actext"].map((p) => `${OVERLAY_PREFIX}-${p}-${tokenId}`);

function signature(item: Item, d: TokenData) {
  return JSON.stringify([d.hp, d.maxHp, d.temp, d.ac, d.baseAc, d.hidden, item.scale, item.visible, dpi]);
}

function shouldShow(item: Item, d: TokenData) {
  if (role === "GM") return true;
  return item.visible && !(d.kind === "npc" && d.hidden);
}

async function buildOverlay(item: Item, d: TokenData): Promise<Item[]> {
  const bounds = await OBR.scene.items.getItemBounds([item.id]);
  const w = Math.max(bounds.width * 0.9, dpi * 0.8);
  const h = dpi * 0.17;
  const x = bounds.center.x - w / 2;
  const y = bounds.min.y - h - dpi * 0.06;
  const ratio = d.maxHp > 0 ? Math.max(0, Math.min(1, d.hp / d.maxHp)) : 0;
  const tempRatio = d.maxHp > 0 ? Math.min(1, d.temp / d.maxHp) : 0;
  const [bgId, fillId, tempId, textId, acId, acTextId] = overlayIds(item.id);
  const common = <T extends ReturnType<typeof buildShape> | ReturnType<typeof buildText>>(b: T) =>
    b
      .attachedTo(item.id)
      .layer("ATTACHMENT")
      .locked(true)
      .disableHit(true)
      .visible(item.visible)
      .disableAttachmentBehavior(["ROTATION", "SCALE", "LOCKED", "COPY"]) as T;

  const z = Date.now();
  const out: Item[] = [
    common(buildShape().id(bgId))
      .shapeType("RECTANGLE")
      .width(w)
      .height(h)
      .position({ x, y })
      .fillColor("#15171c")
      .fillOpacity(0.85)
      .strokeColor("#000000")
      .strokeWidth(dpi * 0.015)
      .strokeOpacity(0.9)
      .zIndex(z)
      .build(),
  ];
  if (ratio > 0) {
    out.push(
      common(buildShape().id(fillId))
        .shapeType("RECTANGLE")
        .width(w * ratio)
        .height(h)
        .position({ x, y })
        .fillColor(hpColor(d.hp, d.maxHp))
        .fillOpacity(0.95)
        .strokeWidth(0)
        .zIndex(z + 1)
        .build(),
    );
  }
  if (tempRatio > 0) {
    out.push(
      common(buildShape().id(tempId))
        .shapeType("RECTANGLE")
        .width(w * tempRatio)
        .height(h * 0.3)
        .position({ x, y: y + h * 0.7 })
        .fillColor("#4aa3ff")
        .fillOpacity(1)
        .strokeWidth(0)
        .zIndex(z + 2)
        .build(),
    );
  }
  const hpText = `${d.hp}/${d.maxHp}${d.temp ? ` +${d.temp}` : ""}`;
  out.push(
    common(buildText().id(textId))
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
      .zIndex(z + 3)
      .build(),
  );

  // Escudo con la CA a la izquierda de la barra
  const s = h * 1.9;
  const acCenter = { x: x - s * 0.35, y: y + h / 2 };
  const acChanged = d.ac !== d.baseAc;
  out.push(
    common(buildShape().id(acId))
      .shapeType("HEXAGON")
      .width(s)
      .height(s)
      .position(acCenter)
      .fillColor(acChanged ? "#7a3a12" : "#23272f")
      .fillOpacity(0.95)
      .strokeColor("#e8622c")
      .strokeWidth(dpi * 0.02)
      .zIndex(z + 4)
      .build(),
    common(buildText().id(acTextId))
      .textType("PLAIN")
      .plainText(String(d.ac))
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
      .zIndex(z + 5)
      .build(),
  );
  return out;
}

async function syncOverlays(items: Item[]) {
  if (syncing) {
    pending = items;
    return;
  }
  syncing = true;
  try {
    const wanted = new Map<string, { item: Item; data: TokenData }>();
    for (const item of items) {
      const d = tokenData(item);
      if (d && shouldShow(item, d)) wanted.set(item.id, { item, data: d });
    }
    const toDelete: string[] = [];
    const toAdd: Item[] = [];
    for (const id of [...rendered.keys()]) {
      if (!wanted.has(id)) {
        toDelete.push(...overlayIds(id));
        rendered.delete(id);
      }
    }
    for (const [id, { item, data }] of wanted) {
      const sig = signature(item, data);
      if (rendered.get(id) === sig) continue;
      if (rendered.has(id)) toDelete.push(...overlayIds(id));
      toAdd.push(...(await buildOverlay(item, data)));
      rendered.set(id, sig);
    }
    if (toDelete.length) {
      const existing = new Set((await OBR.scene.local.getItems()).map((i) => i.id));
      const del = toDelete.filter((id) => existing.has(id));
      if (del.length) await OBR.scene.local.deleteItems(del);
    }
    if (toAdd.length) await OBR.scene.local.addItems(toAdd);
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

async function resetOverlays() {
  rendered.clear();
  if (!(await OBR.scene.isReady())) return;
  const old = await OBR.scene.local.getItems((i) => i.id.startsWith(OVERLAY_PREFIX));
  if (old.length) await OBR.scene.local.deleteItems(old.map((i) => i.id));
  dpi = await OBR.scene.grid.getDpi();
  syncOverlays(await OBR.scene.items.getItems());
}

function setupOverlays() {
  OBR.scene.items.onChange((items) => syncOverlays(items));
  OBR.scene.grid.onChange((grid) => {
    if (grid.dpi !== dpi) resetOverlays();
  });
  OBR.scene.onReadyChange(async (ready) => {
    if (!ready) {
      rendered.clear();
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
      await linkToken(cand.id, c, store.vitals(c));
      OBR.notification.show(`${c.name} vinculado automáticamente a "${cand.name}".`, "INFO");
    }
  });
  OBR.player.onChange((p) => {
    if (p.role !== role) {
      role = p.role;
      resetOverlays();
    }
  });
  resetOverlays();
}

// Publica la hoja activa para que el GM vea al grupo aunque no abran la extensión
function publishActive() {
  const c = store.activeCharacter(roomId());
  publishPlayer(c ? { character: c, vitals: store.vitals(c) } : null);
}

watchForUpdates();
whenReady().then(async (ok) => {
  if (!ok) return;
  role = await OBR.player.getRole();
  meId = await OBR.player.getId();
  await setupContextMenus();
  setupRolls();
  setupOverlays();
  publishActive();
  console.info("[PF2e] Extensión lista");
});
