import { useState } from "react";
import { fmtMod, type Character } from "../pathbuilder";
import type { PcState } from "../live";
import { checkAdjust, modsText, type RollCtx } from "../rules";
import { store } from "../storage";
import { hasAct } from "../explore";

export interface InitOption {
  key: string;
  label: string;
  base: number;
  ctx: RollCtx;
}

// Percepción y todas las habilidades (incluidos los Saberes) sirven para la iniciativa
export function initOptions(c: Character): InitOption[] {
  return [
    { key: "perception", label: "Percepción", base: c.perception.mod, ctx: { kind: "perception" } },
    ...c.skills.map((s) => ({
      key: s.key,
      label: s.label,
      base: s.mod,
      ctx: { kind: "skill", key: s.key.startsWith("lore:") ? "lore" : s.key, ability: s.ability ?? "int" } as RollCtx,
    })),
  ];
}

// Fórmula de iniciativa con las condiciones que la afectan (Asustado, Enfermo…) y el bono
// de Atento de quien vigile en exploración
export function initFormula(opt: InitOption, state?: PcState, scout = 0) {
  const a = checkAdjust(state?.cond, opt.ctx.kind === "perception" || opt.ctx.kind === "skill" ? { ...opt.ctx, init: true } : opt.ctx);
  const notes = [modsText(a.applied), scout ? `Atento +${scout}` : ""].filter(Boolean).join(", ");
  const value = opt.base + a.total + scout;
  return { formula: `1d20${fmtMod(value)}`, notes: notes || undefined, value };
}

interface Props {
  character: Character;
  state?: PcState;
  // Bono de Atento del grupo
  scout?: number;
  onRoll: (opt: InitOption, winsTies: boolean) => void;
  onClose?: () => void;
  inline?: boolean;
}

export function InitPanel({ character: c, state, scout = 0, onRoll, onClose, inline }: Props) {
  const [pref, setPref] = useState(() => store.initPref(c.id));
  // Con Pasar desapercibido la iniciativa es Sigilo, salvo que el jugador elija otra aquí
  const [picked, setPicked] = useState(false);
  const options = initOptions(c);
  const skill = hasAct(state, "avoid") && !picked ? "stealth" : pref.skill;
  const opt = options.find((o) => o.key === skill) ?? options[0];
  const f = initFormula(opt, state, scout);
  const update = (p: Partial<typeof pref>) => {
    const next = { ...pref, ...p };
    setPref(next);
    store.setInitPref(c.id, next);
  };
  return (
    <div className={inline ? "init-panel inline" : "flat-menu init-panel"} role="group" aria-label="Iniciativa">
      <div className="ds-head">
        <b>⚔ Iniciativa</b>
        {state?.init && (
          <span className="init-current" title={`${state.init.label}${state.init.winsTies ? " · gana empates" : ""}`}>
            Actual <b>{state.init.value}</b>
          </span>
        )}
        {onClose && (
          <button className="ds-close" onClick={onClose} title="Cerrar">
            ✕
          </button>
        )}
      </div>
      <div className="init-row">
        <select
          value={opt.key}
          onChange={(e) => {
            setPicked(true);
            update({ skill: e.target.value });
          }}
          title="Habilidad para la iniciativa"
        >
          {options.map((o) => (
            <option key={o.key} value={o.key}>
              {o.label} {fmtMod(o.base)}
            </option>
          ))}
        </select>
        <label className="init-ties" title="Algunas dotes hacen que ganes los empates; si no, los PNJ van antes">
          <input type="checkbox" checked={pref.winsTies} onChange={(e) => update({ winsTies: e.target.checked })} />
          Gano empates
        </label>
        <button
          className="btn init-roll"
          title={f.notes}
          onClick={() => {
            onRoll(opt, pref.winsTies);
            onClose?.();
          }}
        >
          Tirar <b className={f.value < opt.base ? "down" : f.value > opt.base ? "up" : ""}>{fmtMod(f.value)}</b>
        </button>
      </div>
      {(scout > 0 || (hasAct(state, "avoid") && opt.key === "stealth")) && (
        <div className="init-hints muted small">
          {scout > 0 && <span>👁 Atento: +{scout} circunstancial</span>}
          {hasAct(state, "avoid") && opt.key === "stealth" && <span>👣 Pasar desapercibido: Sigilo como iniciativa</span>}
        </div>
      )}
    </div>
  );
}
