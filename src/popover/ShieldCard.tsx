import { useState } from "react";
import { SHIELDS } from "../pathbuilder";
import { shieldBroken, shieldDestroyed, shieldRepair, type ShieldState } from "../rules";
import { CondIcon } from "./bits";

// Sirve para PJ (estado de la sala) y PNJ (estado del token)
interface Props {
  shield?: ShieldState;
  canEdit: boolean;
  onSet: (fn: (s: ShieldState | undefined) => ShieldState | undefined) => void;
  // Bloquear: resta la dureza; el resto lo reciben el escudo y quien lo lleva
  onBlock: (damage: number) => void;
}

type Form = { name: string; bonus: string; hp: string; hardness: string };

const PRESETS: [string, string][] = [
  ["Escudo de madera", "wooden shield"],
  ["Escudo de acero", "steel shield"],
  ["Broquel", "buckler"],
  ["Escudo torre", "tower shield"],
  ["Escudo fortaleza", "fortress shield"],
];

const toForm = (s?: ShieldState): Form => ({
  name: s?.name ?? "Escudo de madera",
  bonus: String(s?.bonus ?? 2),
  hp: String(s?.maxHp ?? 12),
  hardness: String(s?.hardness ?? 3),
});

export function ShieldCard({ shield, canEdit, onSet, onBlock }: Props) {
  const [form, setForm] = useState<Form | null>(null);
  const [amount, setAmount] = useState("");

  if (form) {
    const save = () => {
      const maxHp = Math.max(1, parseInt(form.hp, 10) || 1);
      const next: ShieldState = {
        name: form.name.trim() || "Escudo",
        bonus: Math.max(0, parseInt(form.bonus, 10) || 0),
        hardness: Math.max(0, parseInt(form.hardness, 10) || 0),
        maxHp,
        hp: shield ? Math.min(shield.hp, maxHp) : maxHp,
        raised: false,
      };
      onSet(() => next);
      setForm(null);
    };
    const field = (key: keyof Form, label: string, numeric = true) => (
      <label className="te-field">
        <span>{label}</span>
        <input
          inputMode={numeric ? "numeric" : "text"}
          value={form[key]}
          onChange={(e) => setForm({ ...form, [key]: numeric ? e.target.value.replace(/\D/g, "") : e.target.value })}
        />
      </label>
    );
    return (
      <div className="shield-card">
        <div className="sc-head">
          <b>{shield ? "Editar escudo" : "Nuevo escudo"}</b>
          <select
            className="sc-preset"
            value=""
            onChange={(e) => {
              const preset = PRESETS.find(([, key]) => key === e.target.value);
              const stats = SHIELDS[e.target.value];
              if (preset && stats)
                setForm({ name: preset[0], bonus: String(stats.bonus), hp: String(stats.hp), hardness: String(stats.hardness) });
            }}
          >
            <option value="">Predefinido…</option>
            {PRESETS.map(([label, key]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div className="te-row">{field("name", "Nombre", false)}</div>
        <div className="te-row">
          {field("bonus", "Bono a la CA")}
          {field("hp", "PG")}
          {field("hardness", "Dureza")}
        </div>
        <div className="te-row">
          <button className="btn heal" onClick={save}>
            Guardar
          </button>
          <button className="btn ghost" onClick={() => setForm(null)}>
            Cancelar
          </button>
          {shield && (
            <button
              className="btn danger"
              onClick={() => {
                onSet(() => undefined);
                setForm(null);
              }}
            >
              Quitar
            </button>
          )}
        </div>
      </div>
    );
  }

  if (!shield) {
    return canEdit ? (
      <button className="btn ghost add-shield" onClick={() => setForm(toForm())}>
        <CondIcon icon="shield" label="Escudo" size={16} /> Agregar escudo
      </button>
    ) : null;
  }

  const broken = shieldBroken(shield);
  const destroyed = shieldDestroyed(shield);
  const bt = Math.floor(shield.maxHp / 2);
  const pct = shield.maxHp ? (shield.hp / shield.maxHp) * 100 : 0;
  const n = () => {
    const v = parseInt(amount, 10);
    setAmount("");
    return Number.isFinite(v) && v > 0 ? v : 0;
  };

  return (
    <div className={`shield-card ${broken ? "broken" : ""}`}>
      <div className="sc-head">
        <CondIcon icon="shield" label={shield.name} size={20} />
        <b>{shield.name}</b>
        <span className="muted small">
          +{shield.bonus} CA · Dureza {shield.hardness}
        </span>
        {destroyed ? <span className="badge bad">Destruido</span> : broken ? <span className="badge bad">Roto</span> : null}
        {canEdit && (
          <button className="link-btn" onClick={() => setForm(toForm(shield))}>
            Editar
          </button>
        )}
      </div>
      <div className="sc-bar" title={`Se rompe con ${bt} PG o menos`}>
        <div style={{ width: `${pct}%` }} />
        <i style={{ left: `${(bt / Math.max(1, shield.maxHp)) * 100}%` }} />
        <span>
          {shield.hp}/{shield.maxHp} PG
        </span>
      </div>
      {canEdit && (
        <div className="te-row">
          <button
            className={`btn ${shield.raised ? "on" : ""}`}
            disabled={broken}
            title="El bono se suma a la CA hasta el inicio de tu turno"
            onClick={() => onSet((x) => (x ? { ...x, raised: !x.raised } : x))}
          >
            {shield.raised ? "Bajar escudo" : "Alzar escudo"}
          </button>
          <input className="te-amount" inputMode="numeric" placeholder="Cant." value={amount} onChange={(e) => setAmount(e.target.value.replace(/\D/g, ""))} />
          <button
            className="btn danger"
            title="Resta la dureza y el resto lo reciben el escudo y el PJ"
            onClick={() => {
              const dmg = n();
              if (dmg) onBlock(dmg);
            }}
          >
            Bloquear
          </button>
          <button
            className="btn heal"
            onClick={() => {
              const rep = n();
              if (rep) onSet((x) => (x ? shieldRepair(x, rep) : x));
            }}
          >
            Reparar
          </button>
        </div>
      )}
    </div>
  );
}
