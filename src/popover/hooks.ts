import { useCallback, useEffect, useRef, useState } from "react";
import OBR, { type Item, type Player } from "@owlbear-rodeo/sdk";
import type { Character } from "../pathbuilder";
import { inOwlbear, linkToken, patchToken, publishPlayer, roomId, tokenData, whenReady } from "../obr";
import { store } from "../storage";
import { CHANNEL_ROLL, META_PLAYER, visibleEntry, type PlayerMeta, type RollEntry, type VitalState } from "../shared";

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

const LOCAL_ME: Me = { id: "local", name: "Local", color: "#e8622c", role: "PLAYER" };

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

const sameVitals = (a?: VitalState, b?: VitalState) =>
  !!a && !!b && a.hp === b.hp && a.temp === b.temp && a.ac === b.ac;

/**
 * HP/CA de un personaje. Si hay un token vinculado en la escena, el token manda
 * (salvo que el cambio local sea más reciente, p. ej. al entrar a una escena nueva).
 * mode "own": la hoja es del jugador actual (se guarda y se publica).
 * mode "remote": el GM mirando la hoja de otro (solo edita si hay token).
 */
export function useVitals(c: Character | undefined, mode: "own" | "remote", remote?: VitalState) {
  const [vitals, setVitals] = useState<VitalState | undefined>();
  const [token, setToken] = useState<Item | undefined>();
  const ref = useRef<VitalState | undefined>(undefined);
  const tokenRef = useRef<Item | undefined>(undefined);

  const set = useCallback(
    (v: VitalState, persist: boolean) => {
      ref.current = v;
      setVitals(v);
      if (persist && mode === "own" && c) {
        store.setVitals(c.id, v);
        publishPlayer({ character: c, vitals: v });
      }
    },
    [c, mode],
  );

  useEffect(() => {
    if (!c) return;
    const initial =
      mode === "own" ? store.vitals(c) : (remote ?? { hp: c.maxHp, temp: 0, ac: c.ac, updatedAt: 0 });
    set(initial, false);
    if (mode === "own") publishPlayer({ character: c, vitals: initial });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [c?.id, c?.importedAt, mode]);

  // El GM mirando a otro jugador sin token: sigue lo que publique el jugador
  useEffect(() => {
    if (mode === "remote" && remote && !tokenRef.current && !sameVitals(remote, ref.current)) set(remote, false);
  }, [mode, remote, set]);

  useEffect(() => {
    if (!c || !inOwlbear) return;
    let alive = true;
    const check = async (items?: Item[]) => {
      if (!(await OBR.scene.isReady())) {
        tokenRef.current = undefined;
        if (alive) setToken(undefined);
        return;
      }
      const list = items ?? (await OBR.scene.items.getItems());
      const t = list.find((i) => tokenData(i)?.characterId === c.id);
      tokenRef.current = t;
      if (!alive) return;
      setToken(t);
      if (!t) return;
      const td = tokenData(t)!;
      const cur = ref.current;
      if (mode === "own") {
        if (cur && cur.updatedAt > td.updatedAt && !sameVitals(cur, td as VitalState)) {
          await patchToken(t.id, { hp: cur.hp, temp: cur.temp, ac: cur.ac, maxHp: c.maxHp, baseAc: c.ac });
          return;
        }
        // Reimportaste la hoja (subiste de nivel): actualiza máximos del token
        if (td.maxHp !== c.maxHp || td.baseAc !== c.ac || td.name !== c.name) {
          const acDiff = td.ac - td.baseAc;
          await patchToken(t.id, { maxHp: c.maxHp, baseAc: c.ac, ac: c.ac + acDiff, hp: Math.min(td.hp, c.maxHp), name: c.name });
          return;
        }
      }
      const next: VitalState = { hp: td.hp, temp: td.temp, ac: td.ac, updatedAt: td.updatedAt };
      if (!sameVitals(next, cur)) set(next, true);
      else if (cur) ref.current = { ...cur, updatedAt: Math.max(cur.updatedAt, td.updatedAt) };
    };
    check();
    const offItems = OBR.scene.items.onChange((items) => check(items));
    const offReady = OBR.scene.onReadyChange(() => check());
    return () => {
      alive = false;
      offItems();
      offReady();
    };
  }, [c, mode, set]);

  const canEdit = mode === "own" || !!token;

  const update = useCallback(
    (patch: Partial<Omit<VitalState, "updatedAt">>) => {
      const cur = ref.current;
      if (!cur || !c) return;
      if (mode === "remote" && !tokenRef.current) return;
      const next = { ...cur, ...patch, updatedAt: Date.now() };
      set(next, true);
      if (tokenRef.current) patchToken(tokenRef.current.id, patch);
    },
    [c, mode, set],
  );

  const link = useCallback(
    async (itemId: string) => {
      if (!c || !ref.current) return;
      await linkToken(itemId, c, ref.current);
    },
    [c],
  );

  return { vitals, token, update, link, canEdit };
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
