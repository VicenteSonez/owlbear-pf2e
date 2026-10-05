import { useEffect, useMemo, useState } from "react";
import OBR, { type Item } from "@owlbear-rodeo/sdk";
import type { Character } from "../pathbuilder";
import { live, type PcState } from "../live";
import { inOwlbear, patchNpc, unlinkToken } from "../obr";
import { DEATH_DYING, effectiveAc, effectiveMaxHp } from "../rules";
import { META_TOKEN, hpColor, npcLabel, npcState, type NpcState, type TokenData } from "../shared";
import { useSaveEffects } from "../requests";
import { ConditionRow, CondIcon } from "./bits";
import { EffectsPanel, type Target } from "./EffectsPanel";
import { useSceneTokens } from "./hooks";
import { PendingDamage, usePendingCount } from "./PendingDamage";
import { SaveEffectsList, SaveRequestForm } from "./SavesPanel";
import { useActions } from "./ctx";

interface Props {
  states: Record<string, PcState>;
  sheets: Record<string, Character>;
  onOpenSheet: (id: string) => void;
  onUpload: () => void;
  onResolvePersistent: (t: Target) => void;
}

type Sel = { kind: "pc" | "npc"; id: string } | null;
type GmTab = "sheets" | "saves" | "damage";

// Numera los PNJ con el mismo nombre ("Goblin 1", "Goblin 2"), de izquierda a derecha
async function numberNpcs(tokens: { item: Item; data: TokenData }[]) {
  const groups = new Map<string, { item: Item; data: TokenData }[]>();
  for (const t of tokens) {
    if (t.data.kind !== "npc") continue;
    const key = (t.item.name || t.data.name).trim().toLowerCase();
    groups.set(key, [...(groups.get(key) ?? []), t]);
  }
  const updates = new Map<string, number | undefined>();
  for (const list of groups.values()) {
    const sorted = [...list].sort((a, b) => a.item.position.x - b.item.position.x || a.item.position.y - b.item.position.y);
    sorted.forEach((t, i) => updates.set(t.item.id, list.length > 1 ? i + 1 : undefined));
  }
  if (!updates.size) return;
  await OBR.scene.items.updateItems([...updates.keys()], (drafts) => {
    for (const d of drafts) {
      const cur = d.metadata[META_TOKEN] as TokenData | undefined;
      if (cur?.kind === "npc") d.metadata[META_TOKEN] = { ...cur, num: updates.get(d.id) };
    }
  });
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
  const [tab, setTab] = useState<GmTab>("sheets");
  const [newSave, setNewSave] = useState(false);
  const pending = usePendingCount();
  const saveCount = Object.keys(useSaveEffects()).length;
  const { meId } = useActions();

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
    if (n) target = { kind: "npc", tokenId: n.id, state: n.state, itemName: n.item.name };
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

  const tabs = (
    <nav className="gm-tabs">
      <button className={tab === "sheets" ? "on" : ""} onClick={() => setTab("sheets")}>
        Fichas
      </button>
      <button className={tab === "saves" ? "on" : ""} onClick={() => setTab("saves")}>
        Salvaciones{saveCount ? ` (${saveCount})` : ""}
      </button>
      <button className={`${tab === "damage" ? "on" : ""} ${pending ? "alert" : ""}`} onClick={() => setTab("damage")}>
        Daño pendiente{pending ? ` (${pending})` : ""}
      </button>
    </nav>
  );

  if (tab !== "sheets") {
    return (
      <div className="gm-col">
        {tabs}
        <div className="gm-pane">
          {tab === "saves" && (
            <>
              {newSave ? (
                <SaveRequestForm states={states} from={{ id: meId, name: "GM" }} onDone={() => setNewSave(false)} />
              ) : (
                <button className="btn primary" onClick={() => setNewSave(true)}>
                  + Nuevo efecto de salvación
                </button>
              )}
              <SaveEffectsList states={states} sheets={sheets} />
            </>
          )}
          {tab === "damage" && <PendingDamage />}
        </div>
      </div>
    );
  }

  return (
    <div className="gm-col">
      {tabs}
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
            {npcs.length > 1 && inOwlbear && (
              <button className="btn ghost small-btn" title="Numera los PNJ con el mismo nombre (Goblin 1, Goblin 2…)" onClick={() => numberNpcs(tokens)}>
                # Numerar
              </button>
            )}
          </div>
          {npcs.length === 0 && (
            <p className="muted small">Haz clic derecho en un token → "Añadir HP/CA (PNJ)" para agregarlo aquí.</p>
          )}
          {npcs.map((n) => {
            const ac = effectiveAc(n.state.baseAc, n.state.acAdj, n.state.cond, n.state.shield).ac;
            return (
              <MiniCard
                key={n.id}
                name={npcLabel({ name: n.item.name || n.state.name, num: n.state.num })}
                sub={`${n.state.level ? `Nivel ${n.state.level} · ` : ""}${n.state.hidden ? "Oculto a jugadores" : "Visible para jugadores"}`}
                hp={n.state.hp}
                maxHp={effectiveMaxHp(n.state.maxHp, n.state.level, n.state.cond)}
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
              states={states}
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
    </div>
  );
}
