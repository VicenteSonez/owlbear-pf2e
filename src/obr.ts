import OBR, { type Item } from "@owlbear-rodeo/sdk";
import type { Character } from "./pathbuilder";
import { META_PLAYER, META_TOKEN, npcState, type NpcState, type PlayerMeta, type TokenData } from "./shared";

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

// Vincula una hoja a un token y desvincula cualquier otro token de la escena con esa hoja.
// El token solo guarda el vínculo: PG, condiciones y demás viven en la sala.
export async function linkToken(itemId: string, c: Pick<Character, "id" | "name">, ownerId?: string) {
  const owner = ownerId ?? (await OBR.player.getId());
  const previous = await OBR.scene.items.getItems(
    (i) => i.id !== itemId && (i.metadata[META_TOKEN] as TokenData | undefined)?.characterId === c.id,
  );
  if (previous.length) {
    await OBR.scene.items.updateItems(previous.map((i) => i.id), (drafts) => {
      for (const d of drafts) d.metadata[META_TOKEN] = undefined; // Owlbear ignora `delete` en el borrador
    });
  }
  const data: TokenData = { kind: "pc", characterId: c.id, ownerId: owner, name: c.name };
  await OBR.scene.items.updateItems([itemId], (drafts) => {
    for (const d of drafts) d.metadata[META_TOKEN] = data;
  });
}

export function npcToToken(n: NpcState): TokenData {
  const out: TokenData = { ...n, kind: "npc", updatedAt: Date.now() };
  // Sin listas vacías ni campos sin valor: la metadata de la escena tiene un límite
  if (!n.attacks.length) delete out.attacks;
  if (!n.spells.length) delete out.spells;
  if (!n.level) delete out.level;
  for (const k of Object.keys(out) as (keyof TokenData)[]) if (out[k] === undefined) delete out[k];
  return out;
}

// Todos los PNJ de la escena (para elegir objetivo)
export async function sceneNpcs(): Promise<{ item: Item; state: NpcState }[]> {
  if (!(await sceneReady())) return [];
  const items = await OBR.scene.items.getItems((i) => (i.metadata[META_TOKEN] as TokenData | undefined)?.kind === "npc");
  return items.map((item) => ({ item, state: npcState(item.metadata[META_TOKEN] as TokenData) }));
}

// Modifica el estado de un PNJ guardado en su token
export async function patchNpc(itemId: string, fn: (n: NpcState) => NpcState) {
  await OBR.scene.items.updateItems([itemId], (drafts) => {
    for (const d of drafts) {
      const cur = d.metadata[META_TOKEN] as TokenData | undefined;
      if (cur?.kind !== "npc") continue;
      d.metadata[META_TOKEN] = npcToToken(fn(npcState(cur)));
    }
  });
}

// Nombre elegido para un token: se guarda en el token de Owlbear y en sus datos PF2e
export async function renameToken(itemId: string, name: string) {
  await OBR.scene.items.updateItems([itemId], (drafts) => {
    for (const d of drafts) {
      if (name) d.name = name;
      const cur = d.metadata[META_TOKEN] as TokenData | undefined;
      if (cur?.kind === "npc") d.metadata[META_TOKEN] = { ...cur, nick: name || undefined };
      else if (cur) d.metadata[META_TOKEN] = { ...cur, name: name || cur.name };
    }
  });
}

export async function unlinkToken(itemId: string) {
  await OBR.scene.items.updateItems([itemId], (drafts) => {
    for (const d of drafts) d.metadata[META_TOKEN] = undefined; // Owlbear ignora `delete` en el borrador
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
