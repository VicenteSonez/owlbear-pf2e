import { useState } from "react";
import { fmtMod } from "../pathbuilder";
import { BONUS_LABEL, type BonusType } from "../rules";
import { newId } from "../shared";
import type { CustomMod } from "../extras";
import { parseFormula } from "../dice";
import { DamageTypeList } from "./DamageBox";

const isDice = (t: string) => /d/i.test(t);
const validFormula = (t: string) => {
  try {
    parseFormula(t);
    return true;
  } catch {
    return false;
  }
};

// Bonos y penalizadores a mano para ataque y daño (los del jugador y los de cada PNJ)
export function ModsEditor({ mods, canEdit, onChange }: { mods: CustomMod[]; canEdit: boolean; onChange: (fn: (l: CustomMod[]) => CustomMod[]) => void }) {
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [value, setValue] = useState("");
  const [type, setType] = useState<BonusType>("circumstance");
  const [to, setTo] = useState<CustomMod["to"]>("atk");
  const [dt, setDt] = useState("");
  const [pers, setPers] = useState(false);
  const [critOnly, setCritOnly] = useState(false);
  const [perDie, setPerDie] = useState(false);
  const [splash, setSplash] = useState(false);
  const [error, setError] = useState("");
  const active = mods.filter((m) => m.on);
  const set = onChange;
  return (
    <div className="custom-mods">
      <button className="cm-head" onClick={() => setOpen((o) => !o)}>
        <b>Bonos y penalizadores</b>
        <span className="muted small">
          {active.length ? active.map((m) => `${m.label || "Ajuste"} ${modValueText(m)}`).join(" · ") : "Ninguno activo"}
        </span>
        <span className="muted">{open ? "▴" : "▾"}</span>
      </button>
      {open && (
        <div className="cm-body">
          {mods.map((m) => (
            <div key={m.id} className="cm-row">
              <button className={`chip ${m.on ? "on" : ""}`} disabled={!canEdit} onClick={() => set((l) => l.map((x) => (x.id === m.id ? { ...x, on: !x.on } : x)))}>
                {m.on ? "Activo" : "Apagado"}
              </button>
              <span className="cm-label">{m.label || "Ajuste"}</span>
              <b className={m.value < 0 ? "down" : "up"}>{modValueText(m)}</b>
              <span className="muted small">
                {m.dice || m.pers || m.splash ? "" : `${BONUS_LABEL[m.type]} · `}
                {m.to === "atk" ? "ataque" : m.pers ? "daño persistente" : m.splash ? "salpicadura" : "daño"}
                {m.dt ? ` · ${m.dt}` : ""}
                {m.perDie ? " · por dado" : ""}
                {m.critOnly ? " · solo crítico" : ""}
              </span>
              {canEdit && (
                <button className="row-x" title="Quitar" onClick={() => set((l) => l.filter((x) => x.id !== m.id))}>
                  ✕
                </button>
              )}
            </div>
          ))}
          {canEdit && (
            <form
              className="cm-form"
              onSubmit={(e) => {
                e.preventDefault();
                const raw = value.trim().replace(/^\+/, "");
                const dmg = to === "dmg";
                const extra = {
                  dt: dmg ? dt.trim() || undefined : undefined,
                  pers: (dmg && pers) || undefined,
                  critOnly: (dmg && critOnly) || undefined,
                  perDie: (dmg && perDie) || undefined,
                  splash: (dmg && splash && !pers) || undefined,
                };
                // Al daño se puede escribir un dado (1d4) con su tipo
                if (dmg && isDice(raw)) {
                  if (!validFormula(raw)) {
                    setError("Fórmula no válida (ej. 1d4, 2d6)");
                    return;
                  }
                  set((l) => [...l, { id: newId(), label: label.trim(), value: 0, type: "untyped", to, on: true, dice: raw, ...extra }]);
                } else {
                  const v = parseInt(raw.replace(/[^\d-]/g, ""), 10);
                  if (!Number.isFinite(v) || !v) {
                    setError(dmg ? "Escribe un número (+1) o un dado (1d4)" : "Escribe un número (+1, −2)");
                    return;
                  }
                  set((l) => [...l, { id: newId(), label: label.trim(), value: v, type: pers || splash ? "untyped" : type, to, on: true, ...extra }]);
                }
                setError("");
                setLabel("");
                setValue("");
                setDt("");
                setPers(false);
                setCritOnly(false);
                setPerDie(false);
                setSplash(false);
              }}
            >
              <input placeholder="Nombre (Bendecir…)" value={label} onChange={(e) => setLabel(e.target.value)} />
              <input className="sm" placeholder={to === "dmg" ? "+1 / 1d4" : "+1"} value={value} onChange={(e) => setValue(e.target.value)} />
              <select value={type} disabled={to === "dmg" && (isDice(value) || pers || splash)} title="Tipo de bono (los dados, el persistente y la salpicadura no se apilan por tipo)" onChange={(e) => setType(e.target.value as BonusType)}>
                <option value="status">Estado</option>
                <option value="circumstance">Circunstancial</option>
                <option value="item">Objeto</option>
                <option value="untyped">Sin tipo</option>
              </select>
              <select value={to} onChange={(e) => setTo(e.target.value as CustomMod["to"])}>
                <option value="atk">Ataque</option>
                <option value="dmg">Daño</option>
              </select>
              {to === "dmg" && (
                <>
                  <input className="md" list="pf2-damage-types" placeholder="Tipo de daño" value={dt} onChange={(e) => setDt(e.target.value)} />
                  <label className="te-check" title="Se multiplica por los dados de daño del arma (dado base + runas de golpe)">
                    <input type="checkbox" checked={perDie} onChange={(e) => setPerDie(e.target.checked)} /> Por dado
                  </label>
                  <label className="te-check" title="Se agrega al objetivo como daño persistente">
                    <input type="checkbox" checked={pers} onChange={(e) => setPers(e.target.checked)} /> Persistente
                  </label>
                  <label className="te-check" title="Daño de salpicadura: al objetivo y, con un éxito, a los que estén a 5 pies">
                    <input type="checkbox" checked={splash} onChange={(e) => setSplash(e.target.checked)} /> Salpicadura
                  </label>
                  <label className="te-check" title="Solo con crítico; ese daño no se multiplica">
                    <input type="checkbox" checked={critOnly} onChange={(e) => setCritOnly(e.target.checked)} /> Solo crítico
                  </label>
                  <DamageTypeList />
                </>
              )}
              <button className="btn">+</button>
            </form>
          )}
          {error && <p className="error small">{error}</p>}
          <p className="muted small">
            Del mismo tipo solo cuenta el mayor bono y el peor penalizador; los sin tipo se suman. Al daño también puedes poner dados (1d4) con su tipo, daño
            persistente o de salpicadura, y que sea por cada dado del arma. Lo de “solo crítico” no se multiplica.
          </p>
        </div>
      )}
    </div>
  );
}

export const modValueText = (m: CustomMod) => `${m.dice ? `+${m.dice}` : fmtMod(m.value)}${m.perDie ? "/dado" : ""}`;
