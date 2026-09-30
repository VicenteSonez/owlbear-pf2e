import { useState } from "react";
import type { Item } from "@owlbear-rodeo/sdk";
import type { Character } from "../pathbuilder";
import { inOwlbear } from "../obr";
import { applyHpDelta, hpColor, type VitalState } from "../shared";

interface Props {
  character: Character;
  vitals: VitalState;
  canEdit: boolean;
  token?: Item;
  remote: boolean;
  onUpdate: (p: Partial<Omit<VitalState, "updatedAt">>) => void;
  onLink: () => void;
  onUnlink: () => void;
}

export function Vitals({ character: c, vitals: v, canEdit, token, remote, onUpdate, onLink, onUnlink }: Props) {
  const [amount, setAmount] = useState("");
  const pct = Math.max(0, Math.min(100, (v.hp / c.maxHp) * 100));
  const tempPct = Math.min(100, (v.temp / c.maxHp) * 100);

  const apply = (sign: 1 | -1) => {
    const n = parseInt(amount, 10);
    if (!Number.isFinite(n) || n <= 0) return;
    onUpdate(applyHpDelta({ ...v, maxHp: c.maxHp }, sign * n));
    setAmount("");
  };

  return (
    <section className="vitals">
      <div className="head">
        <div className={`ac-shield ${v.ac !== c.ac ? "changed" : ""}`} title={`CA base ${c.ac}`}>
          <small>CA</small>
          <b>{v.ac}</b>
          {canEdit && (
            <div className="ac-btns">
              <button onClick={() => onUpdate({ ac: v.ac - 1 })}>−</button>
              <button onClick={() => onUpdate({ ac: v.ac + 1 })}>+</button>
            </div>
          )}
        </div>
        <div className="identity">
          <h1 title={c.name}>{c.name}</h1>
          <div className="sub">
            {c.ancestry} {c.className} {c.level}
            {c.heritage ? ` · ${c.heritage}` : ""}
          </div>
          <div className="sub muted">
            {c.background} · {c.size} · {c.speed} ft · CD clase {c.classDc}
          </div>
        </div>
      </div>

      <div className="hp">
        <div className="hp-bar">
          <div className="hp-fill" style={{ width: `${pct}%`, background: hpColor(v.hp, c.maxHp) }} />
          {v.temp > 0 && <div className="hp-temp" style={{ width: `${tempPct}%` }} />}
          <span>
            PG {v.hp}/{c.maxHp}
            {v.temp ? ` · Temp ${v.temp}` : ""}
          </span>
        </div>
        {canEdit ? (
          <div className="hp-ctrl">
            <input
              inputMode="numeric"
              placeholder="Cant."
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/\D/g, ""))}
              onKeyDown={(e) => e.key === "Enter" && apply(-1)}
            />
            <button className="btn danger" onClick={() => apply(-1)}>Daño</button>
            <button className="btn heal" onClick={() => apply(1)}>Curar</button>
            <button
              className="btn ghost"
              title="PG temporales = cantidad"
              onClick={() => {
                const n = parseInt(amount, 10);
                onUpdate({ temp: Number.isFinite(n) ? n : 0 });
                setAmount("");
              }}
            >
              Temp
            </button>
            {v.ac !== c.ac && (
              <button className="btn ghost" title="Restaurar CA base" onClick={() => onUpdate({ ac: c.ac })}>
                CA {c.ac}
              </button>
            )}
          </div>
        ) : (
          <div className="muted small">Solo lectura: este personaje no tiene token en la escena.</div>
        )}
      </div>

      {inOwlbear && !remote && (
        <div className="link-row">
          {token ? (
            <>
              <span className="linked">🔗 Token: {token.name || "sin nombre"}</span>
              <button className="link-btn" onClick={onUnlink}>Desvincular</button>
            </>
          ) : (
            <>
              <span className="muted">Sin token vinculado en esta escena</span>
              <button className="link-btn" onClick={onLink}>Vincular token</button>
            </>
          )}
        </div>
      )}
    </section>
  );
}
