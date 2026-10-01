import { useState } from "react";
import type { Character } from "../pathbuilder";
import type { PcState } from "../live";
import { parseFormula } from "../dice";
import {
  COVERS,
  CONDITIONS,
  DEATH_DYING,
  applyDamage,
  applyHealing,
  effectiveAc,
  effectiveMaxHp,
  modsText,
  type ConditionDef,
  type Conditions,
} from "../rules";
import { hpColor, newId, type NpcState } from "../shared";
import { Pips, iconUrl } from "./bits";

export type Target =
  | { kind: "pc"; state: PcState; sheet?: Character }
  | { kind: "npc"; tokenId: string; state: NpcState };

interface Props {
  target: Target;
  onPatchPc: (id: string, fn: (s: PcState) => PcState) => void;
  onPatchNpc: (tokenId: string, fn: (n: NpcState) => NpcState) => void;
  onOpenSheet: (id: string) => void;
  onRemove: (t: Target) => void;
  onResolvePersistent: (t: Target) => void;
}

// Quita las condiciones en 0 para que la metadata de la sala ocupe lo mínimo
function clean(c: Conditions): Conditions {
  const out: Conditions = {};
  for (const [k, v] of Object.entries(c)) {
    if (v === undefined || v === false || v === 0) continue;
    if (Array.isArray(v) && v.length === 0) continue;
    (out as Record<string, unknown>)[k] = v;
  }
  return out;
}

export function EffectsPanel({ target, onPatchPc, onPatchNpc, onOpenSheet, onRemove, onResolvePersistent }: Props) {
  const [amount, setAmount] = useState("");
  const [pFormula, setPFormula] = useState("");
  const [pType, setPType] = useState("");
  const [pError, setPError] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);

  const isPc = target.kind === "pc";
  const st = target.state;
  const cond = st.cond ?? {};
  const maxHp = isPc ? effectiveMaxHp(target.state.maxHp, target.state.level, cond) : target.state.maxHp;
  const { ac, applied } = effectiveAc(st.baseAc, st.acAdj, cond, isPc ? target.state.shield : undefined);
  const name = st.name;

  // Cambia condiciones sobre el estado más reciente. Drenado sube → pierde nivel×Δ PG (solo PJ).
  const updCond = (fn: (c: Conditions) => Conditions) => {
    if (target.kind === "pc") {
      onPatchPc(target.state.id, (s) => {
        const next = clean(fn(s.cond ?? {}));
        const prevDrained = s.cond?.drained ?? 0;
        const newDrained = next.drained ?? 0;
        let hp = s.hp;
        if (newDrained > prevDrained) hp = Math.max(0, hp - s.level * (newDrained - prevDrained));
        hp = Math.min(hp, effectiveMaxHp(s.maxHp, s.level, next));
        return { ...s, cond: next, hp };
      });
    } else {
      onPatchNpc(target.tokenId, (n) => ({ ...n, cond: clean(fn(n.cond ?? {})) }));
    }
  };

  const changeHp = (mode: "damage" | "heal" | "temp") => {
    const n = parseInt(amount, 10);
    setAmount("");
    const v = Number.isFinite(n) && n > 0 ? n : 0;
    if (mode !== "temp" && !v) return;
    if (target.kind === "pc") {
      onPatchPc(target.state.id, (s) => {
        if (mode === "temp") return { ...s, temp: v };
        const max = effectiveMaxHp(s.maxHp, s.level, s.cond);
        return mode === "damage" ? applyDamage(s, v) : applyHealing(s, v, max);
      });
    } else {
      onPatchNpc(target.tokenId, (npc) => {
        if (mode === "temp") return { ...npc, temp: v };
        if (mode === "heal") return { ...npc, hp: Math.min(npc.maxHp, npc.hp + v) };
        const hit = applyDamage({ hp: npc.hp, temp: npc.temp, dying: 0, wounded: 0 }, v);
        return { ...npc, hp: hit.hp, temp: hit.temp };
      });
    }
  };

  const valued = (def: ConditionDef) => (cond[def.id] as number | undefined) ?? 0;
  const setValued = (def: ConditionDef, v: number) => updCond((c) => ({ ...c, [def.id]: Math.max(0, v) }));

  const addPersistent = () => {
    const formula = pFormula.trim();
    try {
      parseFormula(formula);
    } catch {
      setPError("Fórmula no válida (ej. 1d6, 2d4+1, 3)");
      return;
    }
    setPError(null);
    updCond((c) => ({ ...c, persistent: [...(c.persistent ?? []), { id: newId(), formula, type: pType.trim() }] }));
    setPFormula("");
    setPType("");
  };

  const pct = Math.max(0, Math.min(100, (st.hp / Math.max(1, maxHp)) * 100));

  return (
    <div className="effects">
      <div className="fx-head">
        <div>
          <h2>{name}</h2>
          <span className="muted small">
            {target.kind === "pc" ? (target.state.ownerName ? `Jugador: ${target.state.ownerName}` : "Hoja del GM") : "PNJ en la escena"}
          </span>
        </div>
        <div className={`ac-mini ${ac !== st.baseAc ? "changed" : ""}`} title={[`CA base ${st.baseAc}`, modsText(applied), `= ${ac}`].filter(Boolean).join("\n")}>
          <small>CA</small>
          <b>{ac}</b>
        </div>
      </div>

      <div className="hp-bar">
        <div className="hp-fill" style={{ width: `${pct}%`, background: hpColor(st.hp, maxHp) }} />
        <span>
          PG {st.hp}/{maxHp}
          {st.temp ? ` · Temp ${st.temp}` : ""}
        </span>
      </div>
      <div className="hp-ctrl">
        <input
          inputMode="numeric"
          placeholder="Cant."
          value={amount}
          onChange={(e) => setAmount(e.target.value.replace(/\D/g, ""))}
          onKeyDown={(e) => e.key === "Enter" && changeHp("damage")}
        />
        <button className="btn danger" onClick={() => changeHp("damage")}>
          Daño
        </button>
        <button className="btn heal" onClick={() => changeHp("heal")}>
          Curar
        </button>
        <button className="btn ghost" onClick={() => changeHp("temp")}>
          Temp
        </button>
        <span className="ac-adj">
          CA
          <button onClick={() => (isPc ? onPatchPc(target.state.id, (s) => ({ ...s, acAdj: s.acAdj - 1 })) : onPatchNpc(target.tokenId, (n) => ({ ...n, acAdj: n.acAdj - 1 })))}>
            −
          </button>
          <button onClick={() => (isPc ? onPatchPc(target.state.id, (s) => ({ ...s, acAdj: s.acAdj + 1 })) : onPatchNpc(target.tokenId, (n) => ({ ...n, acAdj: n.acAdj + 1 })))}>
            +
          </button>
        </span>
      </div>

      {target.kind === "pc" && (
        <div className="status-row">
          <Pips
            value={target.state.dying}
            max={DEATH_DYING}
            icon={target.state.dying >= DEATH_DYING ? "dead" : "dying"}
            label="Moribundo"
            danger
            onChange={(v) => onPatchPc(target.state.id, (s) => ({ ...s, dying: v }))}
          />
          <Pips
            value={target.state.wounded}
            max={4}
            icon="wounded"
            label="Herido"
            onChange={(v) => onPatchPc(target.state.id, (s) => ({ ...s, wounded: v }))}
          />
          <Pips
            value={target.state.hero}
            max={3}
            icon="hero"
            label="Puntos heroicos"
            onChange={(v) => onPatchPc(target.state.id, (s) => ({ ...s, hero: v }))}
          />
        </div>
      )}

      <h3>Condiciones</h3>
      <div className="cond-grid">
        {CONDITIONS.map((def) => {
          const v = valued(def);
          const active = def.valued ? v > 0 : !!cond[def.id];
          return (
            <div key={def.id} className={`cond-cell ${active ? "on" : ""}`} title={def.desc}>
              <button
                className="cond-toggle"
                onClick={() => (def.valued ? setValued(def, active ? 0 : 1) : updCond((c) => ({ ...c, offGuard: !c.offGuard })))}
              >
                <img src={iconUrl(def.icon)} alt="" width={24} height={24} />
                <span>{def.label}</span>
              </button>
              {def.valued && (
                <div className="cond-val">
                  <button onClick={() => setValued(def, v - 1)} disabled={v <= 0}>
                    −
                  </button>
                  <b>{v}</b>
                  <button onClick={() => setValued(def, v + 1)}>+</button>
                </div>
              )}
            </div>
          );
        })}
        {COVERS.map((cv) => {
          const active = cond.cover === cv.value;
          return (
            <div key={cv.value} className={`cond-cell ${active ? "on" : ""}`} title={cv.desc}>
              <button className="cond-toggle" onClick={() => updCond((c) => ({ ...c, cover: active ? undefined : cv.value }))}>
                <img src={iconUrl(cv.icon)} alt="" width={24} height={24} />
                <span>{cv.label}</span>
              </button>
            </div>
          );
        })}
      </div>

      <h3>Daño persistente</h3>
      <div className="persist">
        {(cond.persistent ?? []).map((p) => (
          <div key={p.id} className="persist-item">
            <img src={iconUrl("persistent")} alt="" width={18} height={18} />
            <b>{p.formula}</b> <span>{p.type || "sin tipo"}</span>
            <button
              className="link-btn"
              onClick={() => updCond((c) => ({ ...c, persistent: (c.persistent ?? []).filter((x) => x.id !== p.id) }))}
            >
              Quitar
            </button>
          </div>
        ))}
        <form
          className="persist-form"
          onSubmit={(e) => {
            e.preventDefault();
            addPersistent();
          }}
        >
          <input placeholder="1d6" value={pFormula} onChange={(e) => setPFormula(e.target.value)} />
          <input placeholder="Tipo (fuego, sangrado…)" value={pType} onChange={(e) => setPType(e.target.value)} />
          <button className="btn">Agregar</button>
        </form>
        {pError && <p className="error small">{pError}</p>}
        {(cond.persistent ?? []).length > 0 && (
          <button className="btn" onClick={() => onResolvePersistent(target)} title="Se hace solo al final de su turno cuando haya iniciativa">
            Resolver ahora: daño + prueba plana CD 15
          </button>
        )}
      </div>

      {target.kind === "npc" && (
        <>
          <h3>PNJ</h3>
          <div className="te-row">
            <NumInput label="PG máx" value={target.state.maxHp} onCommit={(n) => onPatchNpc(target.tokenId, (x) => ({ ...x, maxHp: Math.max(1, n), hp: Math.min(x.hp, Math.max(1, n)) }))} />
            <NumInput label="CA base" value={target.state.baseAc} onCommit={(n) => onPatchNpc(target.tokenId, (x) => ({ ...x, baseAc: n }))} />
            <label className="te-check">
              <input type="checkbox" checked={target.state.hidden} onChange={(e) => onPatchNpc(target.tokenId, (x) => ({ ...x, hidden: e.target.checked }))} />
              Ocultar a jugadores
            </label>
          </div>
        </>
      )}

      <div className="fx-actions">
        {target.kind === "pc" && target.sheet && (
          <button className="btn" onClick={() => onOpenSheet(target.state.id)}>
            Abrir hoja
          </button>
        )}
        {confirmRemove ? (
          <>
            <span className="muted small">{target.kind === "pc" ? "¿Quitar este PJ de la sala?" : "¿Quitar los datos PF2e del token?"}</span>
            <button className="btn danger" onClick={() => onRemove(target)}>
              Sí, quitar
            </button>
            <button className="btn ghost" onClick={() => setConfirmRemove(false)}>
              No
            </button>
          </>
        ) : (
          <button className="btn ghost" onClick={() => setConfirmRemove(true)}>
            {target.kind === "pc" ? "Quitar de la sala" : "Quitar datos PF2e"}
          </button>
        )}
      </div>
    </div>
  );
}

function NumInput({ label, value, onCommit }: { label: string; value: number; onCommit: (n: number) => void }) {
  const [text, setText] = useState(String(value));
  const [prev, setPrev] = useState(value);
  if (prev !== value) {
    setPrev(value);
    setText(String(value));
  }
  return (
    <label className="te-field">
      <span>{label}</span>
      <input
        inputMode="numeric"
        value={text}
        onChange={(e) => setText(e.target.value.replace(/[^\d-]/g, ""))}
        onBlur={() => {
          const n = parseInt(text, 10);
          if (Number.isFinite(n)) onCommit(n);
          else setText(String(value));
        }}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      />
    </label>
  );
}
