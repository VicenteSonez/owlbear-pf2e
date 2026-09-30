import { useState } from "react";
import { PROF_LABEL, damageFormula, fmtMod, mapSteps, type Character, type Stat, type Weapon } from "../pathbuilder";
import type { RollEntry } from "../shared";
import { store } from "../storage";
import type { RollRequest } from "./App";
import { LogList } from "./LogList";

type Tab = "attacks" | "skills" | "defense" | "spells" | "log";

interface Props {
  character: Character;
  onRoll: (r: RollRequest) => void;
  onWeapon: (w: Weapon, what: "attack" | "damage" | "crit", mapIndex?: number, bonus?: number) => void;
  log: RollEntry[];
  onClearLog: () => void;
}

const ABILITY_LABEL: Record<string, string> = {
  str: "FUE", dex: "DES", con: "CON", int: "INT", wis: "SAB", cha: "CAR",
};

function Rank({ prof }: { prof: number }) {
  return <span className={`rank r${prof}`}>{PROF_LABEL[prof] ?? "U"}</span>;
}

export function SheetTabs({ character: c, onRoll, onWeapon, log, onClearLog }: Props) {
  const [tab, setTab] = useState<Tab>("attacks");
  // Rasgo ágil editable por arma (Pathbuilder no exporta rasgos)
  const [weapons, setWeapons] = useState(c.weapons);
  const [prevId, setPrevId] = useState(c.id + c.importedAt);
  if (prevId !== c.id + c.importedAt) {
    setPrevId(c.id + c.importedAt);
    setWeapons(c.weapons);
  }

  const saveWeapons = (next: Weapon[]) => {
    setWeapons(next);
    if (store.characters().some((x) => x.id === c.id)) store.saveCharacter({ ...c, weapons: next });
  };
  const toggleAgile = (i: number) => saveWeapons(weapons.map((w, j) => (j === i ? { ...w, agile: !w.agile } : w)));
  const toggleExtra = (i: number, k: number) =>
    saveWeapons(
      weapons.map((w, j) =>
        j === i ? { ...w, extra: w.extra.map((e, n) => (n === k ? { ...e, active: !e.active } : e)) } : w,
      ),
    );

  const check = (s: Stat) => onRoll({ label: s.label, formula: `1d20${fmtMod(s.mod)}`, kind: "check" });

  const tabs: [Tab, string][] = [
    ["attacks", "Ataques"],
    ["skills", "Habilidades"],
    ["defense", "Defensa"],
    ...(c.casters.length ? ([["spells", "Conjuros"]] as [Tab, string][]) : []),
    ["log", "Registro"],
  ];

  return (
    <section className="tabs">
      <nav>
        {tabs.map(([k, label]) => (
          <button key={k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>
            {label}
          </button>
        ))}
      </nav>
      <div className="tab-body">
        {tab === "attacks" && (
          <>
            {weapons.length === 0 && <p className="muted">Este personaje no tiene armas en Pathbuilder.</p>}
            {weapons.map((w, i) => (
              <div key={i} className="weapon">
                <div className="weapon-head">
                  <b>{w.name}</b>
                  <span className="muted small">
                    {damageFormula(w)} {w.damageType}
                  </span>
                  <button className={`chip ${w.agile ? "on" : ""}`} onClick={() => toggleAgile(i)} title="Ágil: MAP −4/−8">
                    Ágil
                  </button>
                </div>
                {w.extra.length > 0 && (
                  <div className="extras">
                    {w.extra.map((e, k) => (
                      <button
                        key={k}
                        className={`chip ${e.active ? "on" : ""}`}
                        onClick={() => toggleExtra(i, k)}
                        title="Sumar este daño extra a Daño y Crítico"
                      >
                        +{e.dice}d{e.sides} {e.type}
                      </button>
                    ))}
                  </div>
                )}
                <div className="weapon-btns">
                  {mapSteps(w).map((b, m) => (
                    <button key={m} className="btn" onClick={() => onWeapon(w, "attack", m, b)}>
                      {fmtMod(b)}
                    </button>
                  ))}
                  <button className="btn" onClick={() => onWeapon(w, "damage")}>Daño</button>
                  <button className="btn crit" onClick={() => onWeapon(w, "crit")}>Crítico</button>
                </div>
              </div>
            ))}
          </>
        )}

        {tab === "skills" && (
          <>
            <button className="stat-row wide" onClick={() => check(c.perception)}>
              <Rank prof={c.perception.prof} />
              <span>Percepción (iniciativa)</span>
              <b>{fmtMod(c.perception.mod)}</b>
            </button>
            <div className="grid2">
              {c.skills.map((s) => (
                <button key={s.key} className={`stat-row ${s.prof ? "" : "untrained"}`} onClick={() => check(s)}>
                  <Rank prof={s.prof} />
                  <span>{s.label}</span>
                  <b>{fmtMod(s.mod)}</b>
                </button>
              ))}
            </div>
          </>
        )}

        {tab === "defense" && (
          <>
            <div className="saves">
              {c.saves.map((s) => (
                <button key={s.key} className="save" onClick={() => check(s)}>
                  <Rank prof={s.prof} />
                  <span>{s.label}</span>
                  <b>{fmtMod(s.mod)}</b>
                </button>
              ))}
            </div>
            <div className="abilities">
              {Object.entries(c.abilities).map(([k, v]) => (
                <div key={k} className="ability">
                  <small>{ABILITY_LABEL[k]}</small>
                  <b>{fmtMod(v)}</b>
                </div>
              ))}
            </div>
            <div className="facts">
              <div>CA base <b>{c.ac}</b></div>
              <div>PG máx <b>{c.maxHp}</b></div>
              <div>CD de clase <b>{c.classDc}</b></div>
              <div>Velocidad <b>{c.speed} ft</b></div>
            </div>
          </>
        )}

        {tab === "spells" &&
          c.casters.map((cs, i) => (
            <div key={i} className="caster">
              <div className="caster-head">
                <b>{cs.name}</b>
                <span className="muted small">
                  {cs.tradition} {cs.type !== "focus" ? cs.type : ""}
                </span>
              </div>
              <div className="weapon-btns">
                <button
                  className="btn"
                  onClick={() => onRoll({ label: `${cs.name}: Ataque de conjuro`, formula: `1d20${fmtMod(cs.attack)}`, kind: "check" })}
                >
                  Ataque {fmtMod(cs.attack)}
                </button>
                <span className="dc">CD {cs.dc}</span>
              </div>
              {cs.spells.map((s) => (
                <div key={s.rank} className="spell-rank">
                  <small>{s.rank === -1 ? "Foco" : s.rank === 0 ? "Trucos" : `Rango ${s.rank}`}</small>
                  <span>{s.names.join(", ")}</span>
                </div>
              ))}
            </div>
          ))}

        {tab === "log" && (
          <>
            <div className="log-tools">
              <button className="btn ghost" onClick={onClearLog}>Limpiar registro</button>
            </div>
            <LogList log={log} />
          </>
        )}
      </div>
    </section>
  );
}
