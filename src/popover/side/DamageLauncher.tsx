// Lanzador de daño de conjuros: el último conjuro lanzado, su rango y grado; el daño se
// escribe a mano y se le suman los bonos al daño mágico (Potencia hechicera, Psique, Himno…)
import { useEffect, useState } from "react";
import { fmtMod, type Character } from "../../pathbuilder";
import type { PcState } from "../../live";
import { DEGREE_LABEL, conditionMods, modsText, stackMods, type Degree, type Mod } from "../../rules";
import { newId } from "../../shared";
import { damageReqs } from "../../requests";
import { dealDamage, healTarget } from "../../damage";
import { featuresOf } from "../../classes";
import { useActions } from "../ctx";
import { useNpcOptions } from "../NpcPicker";
import { DamageTypeList } from "../DamageBox";

export interface LastCast {
  name: string;
  rank: number;
  // De dónde salió: los de espacio cuentan para la Potencia hechicera
  slot: boolean;
  degree?: Degree;
  dmg?: string;
  ty?: string;
  heal?: boolean;
  t: number;
}

// Último conjuro de cada personaje (sobrevive a cambiar de pestaña)
const lastCasts = new Map<string, LastCast>();
const listeners = new Set<() => void>();
export function setLastCast(charId: string, l: LastCast) {
  lastCasts.set(charId, l);
  for (const fn of listeners) fn();
}
function useLastCast(charId: string) {
  const [v, setV] = useState(() => lastCasts.get(charId));
  useEffect(() => {
    const fn = () => setV(lastCasts.get(charId));
    listeners.add(fn);
    fn();
    return () => {
      listeners.delete(fn);
    };
  }, [charId]);
  return v;
}

export function DamageLauncher({ c, state, states }: { c: Character; state?: PcState; states: Record<string, PcState> }) {
  const { roll } = useActions();
  const last = useLastCast(c.id);
  const npcs = useNpcOptions();
  const f = featuresOf(c);
  const [formula, setFormula] = useState("");
  const [type, setType] = useState("");
  const [crit, setCrit] = useState(false);
  const [heal, setHeal] = useState(false);
  const [target, setTarget] = useState("");

  // Al lanzar otro conjuro se rellena con su daño
  useEffect(() => {
    if (!last) return;
    setFormula(last.dmg ?? "");
    setType(last.ty ?? "");
    setHeal(!!last.heal);
    setCrit(last.degree === "crit-success" && !last.heal);
    if (state?.target) setTarget(`npc:${state.target}`);
  }, [last, state?.target]);

  if (!last) {
    return (
      <div className="dmg-launcher empty">
        <b>Lanzador de daño</b>
        <span className="muted small">Lanza un conjuro para tirar su daño o curación aquí.</span>
      </div>
    );
  }

  const rank = last.rank;
  const mods: Mod[] = [...conditionMods(state?.cond, { kind: "damage", melee: false, spell: true })];
  if (f.potency && last.slot) mods.push({ label: "Potencia hechicera", type: "status", value: rank });
  if (state?.cls?.psyche) mods.push({ label: "Psique desatada", type: "status", value: 2 * rank });
  const { total, applied } = stackMods(mods);

  const go = async () => {
    const base = formula.trim();
    if (!base) return;
    const r = await roll({
      label: `${last.name}: ${heal ? "curación" : crit ? "daño crítico" : "daño"}`,
      formula: base + (total ? fmtMod(total) : ""),
      kind: "damage",
      crit,
      notes: modsText(applied) || undefined,
      tag: `Rango ${rank}`,
    });
    if (!r || !target) return;
    if (target.startsWith("npc:")) {
      const tok = target.slice(4);
      const n = npcs.find((x) => x.tok === tok);
      const id = newId();
      await damageReqs.set(id, { id, from: c.id, fromName: c.name, tok, n: n?.name ?? "PNJ", amt: r.total, ty: type, crit, label: last.name, heal: heal || undefined, t: Date.now() });
    } else if (target.startsWith("pc:")) {
      const ref = { kind: "pc" as const, id: target.slice(3) };
      if (heal) await healTarget(ref, r.total);
      else await dealDamage(ref, r.total, { type });
    }
  };

  return (
    <div className="dmg-launcher">
      <div className="dl-head">
        <b>{last.name}</b>
        <span className="rank-tag">Rango {rank}</span>
        {last.degree && <span className={`deg ${last.degree.includes("success") ? "ok" : "fail"}`}>{DEGREE_LABEL[last.degree]}</span>}
      </div>
      <div className="sf-row">
        <input className="sm2" placeholder="Daño (2d6)" value={formula} onChange={(e) => setFormula(e.target.value)} />
        <input className="sm2" list="pf2-damage-types" placeholder="Tipo" value={type} onChange={(e) => setType(e.target.value)} />
        <button className={`chip ${crit ? "on" : ""}`} onClick={() => setCrit((v) => !v)} title="Duplica el daño">
          Crítico ×2
        </button>
        <button className={`chip ${heal ? "on" : ""}`} onClick={() => setHeal((v) => !v)} title="Cura en vez de dañar">
          Curación
        </button>
      </div>
      <div className="sf-row">
        <select value={target} onChange={(e) => setTarget(e.target.value)} title="A quién se aplica">
          <option value="">— Solo tirar —</option>
          <optgroup label="PJ">
            {Object.values(states)
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((s) => (
                <option key={s.id} value={`pc:${s.id}`}>
                  {s.name}
                </option>
              ))}
          </optgroup>
          <optgroup label="PNJ (lo autoriza el GM)">
            {npcs.map((n) => (
              <option key={n.tok} value={`npc:${n.tok}`}>
                {n.name}
              </option>
            ))}
          </optgroup>
        </select>
        <button className={`btn ${heal ? "heal" : "danger"}`} disabled={!formula.trim()} onClick={go}>
          Tirar {formula.trim() ? `${formula.trim()}${total ? fmtMod(total) : ""}` : ""}
        </button>
      </div>
      {applied.length > 0 && <div className="muted small">{modsText(applied)}</div>}
      <DamageTypeList />
    </div>
  );
}
