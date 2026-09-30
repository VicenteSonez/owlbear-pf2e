import OBR, { type Item } from "@owlbear-rodeo/sdk";
import type { Character } from "./pathbuilder";
import { META_PLAYER, META_TOKEN, type PlayerMeta, type TokenData, type VitalState } from "./shared";

// Fuera de Owlbear (abriendo la página directamente) funciona en modo local de prueba.
export const inOwlbear = window.self !== window.top;

export function whenReady(): Promise<boolean> {
  if (!inOwlbear) return Promise.resolve(false);
  return new Promise((resolve) => {
    if (OBR.isReady) resolve(true);
    else OBR.onReady(() => resolve(true));
  });
}

export const roomId = () => (inOwlbear ? OBR.room.id : "local");

export const tokenData = (item: Item): TokenData | undefined =>
  item.metadata[META_TOKEN] as TokenData | undefined;

export async function sceneReady(): Promise<boolean> {
  return inOwlbear ? OBR.scene.isReady() : false;
}

export async function findTokenFor(characterId: string): Promise<Item | undefined> {
  if (!(await sceneReady())) return undefined;
  const items = await OBR.scene.items.getItems(
    (i) => (i.metadata[META_TOKEN] as TokenData | undefined)?.characterId === characterId,
  );
  return items[0];
}

export function tokenFromCharacter(c: Character, v: VitalState, ownerId: string, name: string): TokenData {
  return {
    kind: "pc",
    characterId: c.id,
    ownerId,
    name,
    hp: v.hp,
    maxHp: c.maxHp,
    temp: v.temp,
    ac: v.ac,
    baseAc: c.ac,
    updatedAt: Date.now(),
  };
}

// Vincula una hoja a un token y desvincula cualquier otro token de la escena con esa hoja
export async function linkToken(itemId: string, c: Character, v: VitalState) {
  const ownerId = await OBR.player.getId();
  const previous = await OBR.scene.items.getItems(
    (i) => i.id !== itemId && (i.metadata[META_TOKEN] as TokenData | undefined)?.characterId === c.id,
  );
  if (previous.length) {
    await OBR.scene.items.updateItems(previous.map((i) => i.id), (drafts) => {
      for (const d of drafts) delete d.metadata[META_TOKEN];
    });
  }
  await OBR.scene.items.updateItems([itemId], (drafts) => {
    for (const d of drafts) d.metadata[META_TOKEN] = tokenFromCharacter(c, v, ownerId, c.name);
  });
}

export async function patchToken(itemId: string, patch: Partial<TokenData>) {
  await OBR.scene.items.updateItems([itemId], (drafts) => {
    for (const d of drafts) {
      const cur = d.metadata[META_TOKEN] as TokenData | undefined;
      if (!cur) continue;
      d.metadata[META_TOKEN] = { ...cur, ...patch, updatedAt: Date.now() };
    }
  });
}

export async function unlinkToken(itemId: string) {
  await OBR.scene.items.updateItems([itemId], (drafts) => {
    for (const d of drafts) delete d.metadata[META_TOKEN];
  });
}

export async function publishPlayer(meta: PlayerMeta | null) {
  if (!inOwlbear) return;
  await OBR.player.setMetadata({ [META_PLAYER]: meta ?? undefined });
}

// Tokens candidatos para vinculación automática: capa de personajes, sin hoja,
// cuyo nombre coincide con el personaje o que fueron creados por este jugador.
export async function autoLinkCandidate(c: Character, opts: { nameOnly?: boolean } = {}): Promise<Item | undefined> {
  if (!(await sceneReady())) return undefined;
  const me = await OBR.player.getId();
  const items = await OBR.scene.items.getItems(
    (i) => i.layer === "CHARACTER" && !i.metadata[META_TOKEN],
  );
  const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
  const full = norm(c.name);
  const first = full.split(/[\s-]+/)[0];
  const byName = items.filter((i) => {
    const n = norm(i.name);
    return n.length >= 3 && (n === full || full.includes(n) || (first.length >= 3 && n.includes(first)));
  });
  if (byName.length === 1) return byName[0];
  if (opts.nameOnly) return undefined;
  const mine = items.filter((i) => i.createdUserId === me);
  if (mine.length === 1) return mine[0];
  return undefined;
}
