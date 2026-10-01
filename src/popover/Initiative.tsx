import { useState } from "react";
import { fmtMod, type Character } from "../pathbuilder";
import type { PcState } from "../live";
import { checkAdjust, modsText, type RollCtx } from "../rules";
import { store } from "../storage";

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

// Fórmula de iniciativa con las condiciones que la afectan (Asustado, Enfermo…)
export function initFormula(opt: InitOption, state?: PcState) {
  const a = checkAdjust(state?.cond, opt.ctx);
  return { formula: `1d20${fmtMod(opt.base + a.total)}`, notes: modsText(a.applied) || undefined, value: opt.base + a.total };
}

interface Props {
  character: Character;
  state?: PcState;
  onRoll: (opt: InitOption, winsTies: boolean) => void;
  onClose?: () => void;
  inline?: boolean;
}

export function InitPanel({ character: c, state, onRoll, onClose, inline }: Props) {
  const [pref, setPref] = useState(() => store.initPref(c.id));
  const options = initOptions(c);
  const opt = options.find((o) => o.key === pref.skill) ?? options[0];
  const f = initFormula(opt, state);
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
        <select value={opt.key} onChange={(e) => update({ skill: e.target.value })} title="Habilidad para la iniciativa">
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
          Tirar <b className={f.value < opt.base ? "down" : ""}>{fmtMod(f.value)}</b>
        </button>
      </div>
    </div>
  );
}
