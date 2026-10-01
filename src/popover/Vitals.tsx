import { useState } from "react";
import type { Item } from "@owlbear-rodeo/sdk";
import type { Character } from "../pathbuilder";
import type { PcState } from "../live";
import {
  DEATH_DYING,
  applyDamage,
  applyHealing,
  effectiveAc,
  effectiveMaxHp,
  modsText,
  shieldBroken,
} from "../rules";
import { hpColor } from "../shared";
import { CondIcon, ConditionRow, Pips } from "./bits";

interface Props {
  character: Character;
  state: PcState;
  canEdit: boolean;
  showLink: boolean;
  token?: Item;
  onPatch: (fn: (s: PcState) => PcState) => void;
  onLink: () => void;
  onUnlink: () => void;
}

export function speedTitle(c: Character) {
  if (c.speedBase === undefined) return `${c.speed} ft`;
  const bonus = c.speedBonus ?? 0;
  const parts = [`Base ${c.speedBase} ft`];
  if (bonus) parts.push(`${bonus > 0 ? "+" : "−"}${Math.abs(bonus)} ft de bonos y penalizadores`);
  return `${parts.join(", ")} = ${c.speed} ft`;
}

export function Vitals({ character: c, state: s, canEdit, showLink, token, onPatch, onLink, onUnlink }: Props) {
  const [amount, setAmount] = useState("");
  const maxHp = effectiveMaxHp(s.maxHp, s.level, s.cond);
  const { ac, applied } = effectiveAc(s.baseAc, s.acAdj, s.cond, s.shield);
  const pct = Math.max(0, Math.min(100, (s.hp / maxHp) * 100));
  const tempPct = Math.min(100, (s.temp / maxHp) * 100);
  const dead = s.dying >= DEATH_DYING;
  const acTitle = [`CA de la hoja ${s.baseAc}`, applied.length ? modsText(applied) : "", `= ${ac}`]
    .filter(Boolean)
    .join("\n");

  const readAmount = () => {
    const n = parseInt(amount, 10);
    setAmount("");
    return Number.isFinite(n) && n > 0 ? n : 0;
  };

  return (
    <section className="vitals">
      <div className="head">
        <div className={`ac-shield ${ac !== s.baseAc ? "changed" : ""}`} title={acTitle}>
          <small>CA</small>
          <b>{ac}</b>
          {canEdit && (
            <div className="ac-btns">
              <button onClick={() => onPatch((x) => ({ ...x, acAdj: x.acAdj - 1 }))}>−</button>
              <button onClick={() => onPatch((x) => ({ ...x, acAdj: x.acAdj + 1 }))}>+</button>
            </div>
          )}
        </div>
        <div className="identity">
          <div className="name-row">
            <h1 title={c.name}>{c.name}</h1>
            <Pips
              value={s.hero}
              max={3}
              icon="hero"
              label="Puntos heroicos"
              disabled={!canEdit}
              onChange={(v) => onPatch((x) => ({ ...x, hero: v }))}
            />
          </div>
          <div className="sub">
            {c.ancestry} {c.className} {c.level}
            {c.heritage ? ` · ${c.heritage}` : ""}
          </div>
          <div className="sub muted">
            {c.background} · {c.size} ·{" "}
            <span className="speed" title={speedTitle(c)}>
              {c.speed} ft
            </span>{" "}
            · CD clase {c.classDc}
          </div>
          {c.senses && c.senses.length > 0 && <div className="sub senses">👁 {c.senses.join(" · ")}</div>}
        </div>
      </div>

      <div className="hp">
        <div className={`hp-bar ${dead ? "dead" : ""}`}>
          <div className="hp-fill" style={{ width: `${pct}%`, background: hpColor(s.hp, maxHp) }} />
          {s.temp > 0 && <div className="hp-temp" style={{ width: `${tempPct}%` }} />}
          <span>
            {dead ? "MUERTO · " : ""}PG {s.hp}/{maxHp}
            {s.temp ? ` · Temp ${s.temp}` : ""}
          </span>
        </div>
        <div className="status-row">
          <Pips
            value={s.dying}
            max={DEATH_DYING}
            icon={dead ? "dead" : "dying"}
            label="Moribundo"
            danger
            disabled={!canEdit}
            onChange={(v) => onPatch((x) => ({ ...x, dying: v }))}
          />
          <Pips
            value={s.wounded}
            max={4}
            icon="wounded"
            label="Herido"
            disabled={!canEdit}
            onChange={(v) => onPatch((x) => ({ ...x, wounded: v }))}
          />
          {canEdit && (s.dying > 0 || s.wounded > 0) && (
            <button className="link-btn" title="Quitar moribundo y herido" onClick={() => onPatch((x) => ({ ...x, dying: 0, wounded: 0 }))}>
              Limpiar
            </button>
          )}
          {s.shield && (
            <button
              className={`shield-chip ${s.shield.raised ? "on" : ""} ${shieldBroken(s.shield) ? "broken" : ""}`}
              disabled={!canEdit || shieldBroken(s.shield)}
              title={
                shieldBroken(s.shield)
                  ? `${s.shield.name}: roto`
                  : s.shield.raised
                    ? "Escudo alzado: clic para bajarlo"
                    : "Alzar escudo (+CA hasta el inicio de tu turno)"
              }
              onClick={() => onPatch((x) => (x.shield ? { ...x, shield: { ...x.shield, raised: !x.shield.raised } } : x))}
            >
              <CondIcon icon="shield" label={s.shield.name} size={16} />
              +{s.shield.bonus}
              <small>
                {s.shield.hp}/{s.shield.maxHp}
                {shieldBroken(s.shield) ? " roto" : ""}
              </small>
            </button>
          )}
        </div>
        {canEdit ? (
          <div className="hp-ctrl">
            <input
              inputMode="numeric"
              placeholder="Cant."
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/\D/g, ""))}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  const n = readAmount();
                  if (n) onPatch((x) => applyDamage(x, n));
                }
              }}
            />
            <button
              className="btn danger"
              onClick={() => {
                const n = readAmount();
                if (n) onPatch((x) => applyDamage(x, n));
              }}
            >
              Daño
            </button>
            <button
              className="btn heal"
              onClick={() => {
                const n = readAmount();
                if (n) onPatch((x) => applyHealing(x, n, effectiveMaxHp(x.maxHp, x.level, x.cond)));
              }}
            >
              Curar
            </button>
            <button
              className="btn ghost"
              title="PG temporales = cantidad"
              onClick={() => {
                const n = readAmount();
                onPatch((x) => ({ ...x, temp: n }));
              }}
            >
              Temp
            </button>
            {s.acAdj !== 0 && (
              <button className="btn ghost" title="Quitar el ajuste manual de CA" onClick={() => onPatch((x) => ({ ...x, acAdj: 0 }))}>
                CA {s.acAdj > 0 ? "−" : "+"}
                {Math.abs(s.acAdj)}
              </button>
            )}
          </div>
        ) : null}
        <ConditionRow cond={s.cond} />
      </div>

      {showLink && (
        <div className="link-row">
          {token ? (
            <>
              <span className="linked">🔗 Token: {token.name || "sin nombre"}</span>
              <button className="link-btn" onClick={onUnlink}>
                Desvincular
              </button>
            </>
          ) : (
            <>
              <span className="muted">Sin token vinculado en esta escena</span>
              <button className="link-btn" onClick={onLink}>
                Vincular token
              </button>
            </>
          )}
        </div>
      )}
    </section>
  );
}
