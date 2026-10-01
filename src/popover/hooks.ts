import { useCallback, useEffect, useState } from "react";
import OBR, { type Item, type Player } from "@owlbear-rodeo/sdk";
import { inOwlbear, roomId, tokenData, whenReady } from "../obr";
import { store } from "../storage";
import { CHANNEL_ROLL, META_PLAYER, visibleEntry, type PlayerMeta, type RollEntry } from "../shared";

export interface Me {
  id: string;
  name: string;
  color: string;
  role: "GM" | "PLAYER";
}

export interface Session {
  ready: boolean;
  me: Me;
  room: string;
}

// En modo local de desarrollo se actúa como GM para poder probar la pestaña GM
const LOCAL_ME: Me = { id: "local", name: "Local", color: "#e8622c", role: import.meta.env.DEV ? "GM" : "PLAYER" };

export function useSession(): Session {
  const [s, setS] = useState<Session>({ ready: false, me: LOCAL_ME, room: "local" });
  useEffect(() => {
    let off: (() => void) | undefined;
    whenReady().then(async (ok) => {
      if (!ok) {
        setS({ ready: true, me: LOCAL_ME, room: "local" });
        return;
      }
      const [id, name, color, role] = await Promise.all([
        OBR.player.getId(),
        OBR.player.getName(),
        OBR.player.getColor(),
        OBR.player.getRole(),
      ]);
      setS({ ready: true, me: { id, name, color, role }, room: roomId() });
      off = OBR.player.onChange((p) =>
        setS((prev) => ({ ...prev, me: { id: p.id, name: p.name, color: p.color, role: p.role } })),
      );
    });
    return () => off?.();
  }, []);
  return s;
}

export function useParty(enabled: boolean): Player[] {
  const [players, setPlayers] = useState<Player[]>([]);
  useEffect(() => {
    if (!enabled || !inOwlbear) return;
    OBR.party.getPlayers().then(setPlayers);
    return OBR.party.onChange(setPlayers);
  }, [enabled]);
  return players;
}

export const playerMeta = (p: Player) => p.metadata[META_PLAYER] as PlayerMeta | undefined;

// Token de la escena vinculado a una hoja (si hay)
export function useLinkedToken(characterId: string | undefined): Item | undefined {
  const [token, setToken] = useState<Item | undefined>();
  useEffect(() => {
    setToken(undefined);
    if (!characterId || !inOwlbear) return;
    let alive = true;
    const find = (items: Item[]) => items.find((i) => tokenData(i)?.characterId === characterId);
    const load = async () => {
      if (!(await OBR.scene.isReady())) {
        if (alive) setToken(undefined);
        return;
      }
      const items = await OBR.scene.items.getItems();
      if (alive) setToken(find(items));
    };
    load();
    const offItems = OBR.scene.items.onChange((items) => setToken(find(items)));
    const offReady = OBR.scene.onReadyChange(() => load());
    return () => {
      alive = false;
      offItems();
      offReady();
    };
  }, [characterId]);
  return token;
}

export function useRollLog(session: Session) {
  const [log, setLog] = useState<RollEntry[]>([]);

  useEffect(() => {
    if (!session.ready) return;
    setLog(store.log(session.room));
    if (!inOwlbear) return;
    return OBR.broadcast.onMessage(CHANNEL_ROLL, (event) => {
      const e = visibleEntry(event.data as RollEntry, session.me.id, session.me.role);
      if (e) setLog((prev) => [e, ...prev.filter((x) => x.id !== e.id)].slice(0, 60));
    });
  }, [session.ready, session.room, session.me.id, session.me.role]);

  const publish = useCallback(
    async (entry: RollEntry) => {
      const mine = visibleEntry(entry, session.me.id, session.me.role)!;
      setLog((prev) => [mine, ...prev.filter((x) => x.id !== mine.id)].slice(0, 60));
      if (inOwlbear) {
        // El script de fondo de cada cliente la guarda en su registro
        await OBR.broadcast.sendMessage(CHANNEL_ROLL, entry, { destination: "ALL" });
      } else {
        store.pushLog(session.room, mine);
      }
    },
    [session.me.id, session.me.role, session.room],
  );

  const clear = useCallback(() => {
    store.clearLog(session.room);
    setLog([]);
  }, [session.room]);

  return { log, publish, clear };
}
