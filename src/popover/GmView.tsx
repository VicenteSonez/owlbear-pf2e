import { useEffect, useMemo, useState } from "react";
import OBR, { type Item } from "@owlbear-rodeo/sdk";
import type { Character } from "../pathbuilder";
import { live, type PcState } from "../live";
import { inOwlbear, patchNpc, tokenData, unlinkToken } from "../obr";
import { DEATH_DYING, effectiveAc, effectiveMaxHp } from "../rules";
import { hpColor, npcState, type NpcState, type TokenData } from "../shared";
import { ConditionRow, CondIcon } from "./bits";
import { EffectsPanel, type Target } from "./EffectsPanel";

interface Props {
  states: Record<string, PcState>;
  sheets: Record<string, Character>;
  onOpenSheet: (id: string) => void;
  onUpload: () => void;
  onResolvePersistent: (t: Target) => void;
}

type Sel = { kind: "pc" | "npc"; id: string } | null;

// Tokens de la escena con datos PF2e (PJ vinculados y PNJ)
function useSceneTokens() {
  const [tokens, setTokens] = useState<{ item: Item; data: TokenData }[]>([]);
  useEffect(() => {
    if (!inOwlbear) return;
    let alive = true;
    const pick = (items: Item[]) =>
      items.flatMap((item) => {
        const data = tokenData(item);
        return data ? [{ item, data }] : [];
      });
    const load = async () => {
      if (!(await OBR.scene.isReady())) {
        if (alive) setTokens([]);
        return;
      }
      const items = await OBR.scene.items.getItems();
      if (alive) setTokens(pick(items));
    };
    load();
    const offItems = OBR.scene.items.onChange((items) => setTokens(pick(items)));
    const offReady = OBR.scene.onReadyChange(() => load());
    return () => {
      alive = false;
      offItems();
      offReady();
    };
  }, []);
  return tokens;
}

function MiniCard(props: {
  name: string;
  sub: string;
  hp: number;
  maxHp: number;
  ac: number;
  acChanged: boolean;
  dying?: number;
  cond: PcState["cond"];
  selected: boolean;
  badge?: string;
  onClick: () => void;
}) {
  const pct = Math.max(0, Math.min(100, (props.hp / Math.max(1, props.maxHp)) * 100));
  return (
    <button className={`gm-card ${props.selected ? "on" : ""}`} onClick={props.onClick}>
      <div className="gm-card-top">
        <b>{props.name}</b>
        {props.badge && <span className="badge">{props.badge}</span>}
        {props.dying ? <CondIcon icon={props.dying >= DEATH_DYING ? "dead" : "dying"} label="Moribundo" value={props.dying} size={16} /> : null}
        <span className={`gm-ac ${props.acChanged ? "changed" : ""}`}>CA {props.ac}</span>
      </div>
      <div className="muted small">{props.sub}</div>
      <div className="mini-bar">
        <div style={{ width: `${pct}%`, background: hpColor(props.hp, props.maxHp) }} />
        <span>
          {props.hp}/{props.maxHp}
        </span>
      </div>
      <ConditionRow cond={props.cond} size={16} />
    </button>
  );
}

export function GmView({ states, sheets, onOpenSheet, onUpload, onResolvePersistent }: Props) {
  const tokens = useSceneTokens();
  const [sel, setSel] = useState<Sel>(null);

  const pcs = useMemo(() => Object.values(states).sort((a, b) => a.name.localeCompare(b.name)), [states]);
  const npcs = useMemo(
    () => tokens.filter((t) => t.data.kind === "npc").map((t) => ({ id: t.item.id, item: t.item, state: npcState(t.data) })),
    [tokens],
  );

  // Seleccionar un token en el mapa selecciona su personaje aquí
  useEffect(() => {
    if (!inOwlbear) return;
    return OBR.player.onChange((p) => {
      const ids = p.selection ?? [];
      if (ids.length !== 1) return;
      const t = tokens.find((x) => x.item.id === ids[0]);
      if (!t) return;
      if (t.data.kind === "pc" && t.data.characterId) setSel({ kind: "pc", id: t.data.characterId });
      else if (t.data.kind === "npc") setSel({ kind: "npc", id: t.item.id });
    });
  }, [tokens]);

  let target: Target | null = null;
  if (sel?.kind === "pc" && states[sel.id]) target = { kind: "pc", state: states[sel.id], sheet: sheets[sel.id] };
  if (sel?.kind === "npc") {
    const n = npcs.find((x) => x.id === sel.id);
    if (n) target = { kind: "npc", tokenId: n.id, state: n.state };
  }

  const patchPc = (id: string, fn: (s: PcState) => PcState) => live.patch(id, fn);
  const patchNpcState = (tokenId: string, fn: (n: NpcState) => NpcState) => patchNpc(tokenId, fn);

  const remove = async (t: Target) => {
    if (t.kind === "pc") {
      await live.remove(t.state.id);
      const linked = tokens.filter((x) => x.data.characterId === t.state.id);
      for (const l of linked) await unlinkToken(l.item.id);
    } else {
      await unlinkToken(t.tokenId);
    }
    setSel(null);
  };

  return (
    <div className="gm">
      <aside className="gm-list">
        <div className="gm-section">
          <h3>Personajes jugadores</h3>
          <button className="btn ghost small-btn" onClick={onUpload} title="Subir el JSON de Pathbuilder de un PJ">
            + Subir hoja
          </button>
        </div>
        {pcs.length === 0 && <p className="muted small">Aún no hay PJ en esta sala. Aparecen cuando cada jugador sube su hoja.</p>}
        {pcs.map((s) => {
          const ac = effectiveAc(s.baseAc, s.acAdj, s.cond, s.shield).ac;
          return (
            <MiniCard
              key={s.id}
              name={s.name}
              sub={`${s.ownerName ?? "GM"} · Nivel ${s.level}`}
              hp={s.hp}
              maxHp={effectiveMaxHp(s.maxHp, s.level, s.cond)}
              ac={ac}
              acChanged={ac !== s.baseAc}
              dying={s.dying}
              cond={s.cond}
              selected={sel?.kind === "pc" && sel.id === s.id}
              // No se selecciona el token en el mapa: la barra de Owlbear taparía este panel
              onClick={() => setSel({ kind: "pc", id: s.id })}
            />
          );
        })}

        <div className="gm-section">
          <h3>PNJ en la escena</h3>
        </div>
        {npcs.length === 0 && (
          <p className="muted small">Haz clic derecho en un token → "Añadir HP/CA (PNJ)" para agregarlo aquí.</p>
        )}
        {npcs.map((n) => {
          const ac = effectiveAc(n.state.baseAc, n.state.acAdj, n.state.cond).ac;
          return (
            <MiniCard
              key={n.id}
              name={n.item.name || n.state.name}
              sub={n.state.hidden ? "Oculto a jugadores" : "Visible para jugadores"}
              hp={n.state.hp}
              maxHp={n.state.maxHp}
              ac={ac}
              acChanged={ac !== n.state.baseAc}
              cond={n.state.cond}
              badge={n.state.hidden ? "oculto" : undefined}
              selected={sel?.kind === "npc" && sel.id === n.id}
              onClick={() => setSel({ kind: "npc", id: n.id })}
            />
          );
        })}
      </aside>
      <section className="gm-detail">
        {target ? (
          <EffectsPanel
            key={target.kind === "pc" ? target.state.id : target.tokenId}
            target={target}
            onPatchPc={patchPc}
            onPatchNpc={patchNpcState}
            onOpenSheet={onOpenSheet}
            onRemove={remove}
            onResolvePersistent={onResolvePersistent}
          />
        ) : (
          <div className="gm-empty">
            <p>Selecciona un personaje de la lista o un token en el mapa para asignarle condiciones y efectos.</p>
          </div>
        )}
      </section>
    </div>
  );
}
