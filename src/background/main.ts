import OBR, { buildImage, buildShape, buildText, type Item } from "@owlbear-rodeo/sdk";
import { autoLinkCandidate, linkToken, npcToToken, publishPlayer, roomId, tokenData, whenReady } from "../obr";
import { store } from "../storage";
import { watchForUpdates } from "../autoUpdate";
import { live, needsSheetSync, seedState, syncSheet } from "../live";
import { DEATH_DYING, activeConditionIcons, effectiveAc, effectiveMaxHp } from "../rules";
import {
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
      const data = npcToToken({ name: item.name, hp: 20, maxHp: 20, temp: 0, baseAc: 15, acAdj: 0, cond: {}, hidden: true });
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
  });
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
}

function viewFor(d: TokenData): TokenView | null {
  if (d.kind === "pc") {
    const s = d.characterId ? live.get(d.characterId) : undefined;
    if (!s) return null;
    const ac = effectiveAc(s.baseAc, s.acAdj, s.cond, s.shield).ac;
    const icons: TokenView["icons"] = [];
    if (s.dying > 0) icons.push({ icon: s.dying >= DEATH_DYING ? "dead" : "dying", value: s.dying });
    if (s.wounded > 0) icons.push({ icon: "wounded", value: s.wounded });
    if (s.shield?.raised) icons.push({ icon: "shield", value: s.shield.bonus });
    icons.push(...activeConditionIcons(s.cond).map((c) => ({ icon: c.icon, value: c.value })));
    return {
      hp: s.hp,
      maxHp: effectiveMaxHp(s.maxHp, s.level, s.cond),
      temp: s.temp,
      ac,
      acChanged: ac !== s.baseAc,
      dead: s.dying >= DEATH_DYING,
      icons,
      hiddenNpc: false,
    };
  }
  const n = npcState(d);
  const ac = effectiveAc(n.baseAc, n.acAdj, n.cond).ac;
  return {
    hp: n.hp,
    maxHp: n.maxHp,
    temp: n.temp,
    ac,
    acChanged: ac !== n.baseAc,
    dead: false,
    icons: activeConditionIcons(n.cond).map((c) => ({ icon: c.icon, value: c.value })),
    hiddenNpc: n.hidden,
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

  // Fila de íconos (condiciones, moribundo, escudo alzado) sobre la barra
  if (v.icons.length) {
    const size = dpi * 0.26;
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
      const v = d ? viewFor(d) : null;
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
  // El estado de los PJ vive en la sala: si cambia, se redibujan sus barras
  live.subscribe(() => {
    if (lastItems.length) syncOverlays(lastItems);
  });
  OBR.scene.grid.onChange((grid) => {
    if (grid.dpi !== dpi) resetOverlays();
  });
  OBR.scene.onReadyChange(async (ready) => {
    if (!ready) {
      rendered.clear();
      lastItems = [];
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
  publishPlayer(c ? { character: c } : null);
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
