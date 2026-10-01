import { useState } from "react";
import { PROF_LABEL, damageFormula, fmtMod, mapSteps, type Character, type Stat, type Weapon } from "../pathbuilder";
import type { RollEntry } from "../shared";
import type { PcState } from "../live";
import { checkAdjust, effectiveMaxHp, modsText, type RollCtx } from "../rules";
import { applyWeaponFlags, extraKey, store, type WeaponFlags } from "../storage";
import type { RollRequest } from "./App";
import { LogList } from "./LogList";
import { ShieldCard } from "./ShieldCard";
import { speedTitle } from "./Vitals";
import { FxDir } from "./FxDir";
import { ATTACK_FX, defaultWeaponFx, type AttackFx } from "../fx";

type Tab = "attacks" | "skills" | "defense" | "spells" | "log";

interface Props {
  character: Character;
  state?: PcState;
  canEdit: boolean;
  onRoll: (r: RollRequest) => void;
  onPatch: (fn: (s: PcState) => PcState) => void;
  log: RollEntry[];
  onClearLog: () => void;
}

const ABILITY_LABEL: Record<string, string> = {
  str: "FUE", dex: "DES", con: "CON", int: "INT", wis: "SAB", cha: "CAR",
};

const MAP_LABEL = ["1er ataque", "2º ataque", "3er ataque"];

function Rank({ prof }: { prof: number }) {
  return <span className={`rank r${prof}`}>{PROF_LABEL[prof] ?? "U"}</span>;
}

// Valor mostrado: rojo si una condición lo bajó, verde si lo subió
function Val({ base, value, notes }: { base: number; value: number; notes?: string }) {
  const cls = value < base ? "down" : value > base ? "up" : "";
  return (
    <b className={cls} title={notes ? `${fmtMod(base)} en la hoja · ${notes}` : undefined}>
      {fmtMod(value)}
    </b>
  );
}

const weaponKey = (w: Weapon) => w.key ?? w.name.toLowerCase();

export function SheetTabs({ character: c, state, canEdit, onRoll, onPatch, log, onClearLog }: Props) {
  const [tab, setTab] = useState<Tab>("attacks");
  const [flags, setFlags] = useState<Record<string, WeaponFlags>>(() => store.weaponFlags(c.id));
  const [flagsFor, setFlagsFor] = useState(c.id);
  if (flagsFor !== c.id) {
    setFlagsFor(c.id);
    setFlags(store.weaponFlags(c.id));
  }

  const weapons = c.weapons.map((w) => applyWeaponFlags(w, flags[weaponKey(w)]));
  // Efectos de ataque en el mapa: dirección elegida y efecto de cada arma
  const [fxPref, setFxPrefState] = useState(() => store.fxPref(c.id));
  const [fxFor, setFxFor] = useState(c.id);
  if (fxFor !== c.id) {
    setFxFor(c.id);
    setFxPrefState(store.fxPref(c.id));
  }
  const setFxPref = (p: { dir: number; on: boolean }) => {
    setFxPrefState(p);
    store.setFxPref(c.id, p);
  };
  const fxOf = (w: Weapon): AttackFx | "none" => flags[weaponKey(w)]?.fx ?? defaultWeaponFx(w);
  const setFlag = (w: Weapon, patch: WeaponFlags) => {
    const key = weaponKey(w);
    const next = { ...flags, [key]: { ...flags[key], ...patch } };
    setFlags(next);
    store.setWeaponFlags(c.id, next);
  };

  // Bonificadores de las condiciones activas para cada tipo de tirada
  const adjust = (base: number, ctx: RollCtx) => {
    const a = checkAdjust(state?.cond, ctx, state?.shield);
    return { value: base + a.total, notes: modsText(a.applied) };
  };
  const rollCheck = (label: string, base: number, ctx: RollCtx) => {
    const a = adjust(base, ctx);
    // Los ataques de conjuro e impulso muestran chispas y runas sobre el token
    const magic = ctx.kind === "spell-attack" || ctx.kind === "impulse-attack";
    onRoll({ label, formula: `1d20${fmtMod(a.value)}`, kind: "check", notes: a.notes || undefined, fx: magic ? { kind: "spell" } : undefined });
  };
  const statCtx = (s: Stat): RollCtx => ({ kind: "skill", key: s.key.startsWith("lore:") ? "lore" : s.key, ability: s.ability ?? "int" });
  const saveCtx = (s: Stat): RollCtx => ({ kind: "save", key: s.key as "fortitude" | "reflex" | "will" });

  const rollWeapon = (w: Weapon, what: "attack" | "damage" | "crit", mapIndex = 0) => {
    const melee = !w.ranged;
    if (what === "attack") {
      const a = adjust(w.attack, { kind: "attack", melee, finesse: w.finesse });
      const step = mapSteps({ ...w, attack: a.value })[mapIndex];
      const fx = fxOf(w);
      onRoll({
        label: `${w.name}: ${MAP_LABEL[mapIndex]}`,
        formula: `1d20${fmtMod(step)}`,
        kind: "check",
        notes: a.notes || undefined,
        fx: fxPref.on && fx !== "none" ? { kind: fx, dir: fxPref.dir } : undefined,
      });
      return;
    }
    const pen = checkAdjust(state?.cond, { kind: "damage", melee });
    onRoll({
      label: `${w.name}: ${what === "crit" ? "Crítico" : "Daño"}${w.damageType ? ` (${w.damageType})` : ""}`,
      formula: damageFormula(w) + (pen.total ? fmtMod(pen.total) : ""),
      kind: "damage",
      crit: what === "crit",
      notes: modsText(pen.applied) || undefined,
    });
  };

  const tabs: [Tab, string][] = [
    ["attacks", "Ataques"],
    ["skills", "Habilidades"],
    ["defense", "Defensa"],
    ...(c.casters.length ? ([["spells", "Conjuros"]] as [Tab, string][]) : []),
    ["log", "Registro"],
  ];

  const perception = adjust(c.perception.mod, { kind: "perception" });

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
            {weapons.length === 0 && !c.impulse && <p className="muted">Este personaje no tiene armas en Pathbuilder.</p>}
            {weapons.length > 0 && (
              <div className="fx-row">
                <div>
                  <b>Efecto en el mapa</b>
                  <span className="muted small">
                    {fxPref.on ? "Elige hacia dónde atacas; se ve al tirar el ataque." : "Apagado: los ataques no muestran efecto."}
                  </span>
                </div>
                <FxDir dir={fxPref.dir} on={fxPref.on} onChange={setFxPref} />
              </div>
            )}
            {weapons.map((w) => {
              const atk = adjust(w.attack, { kind: "attack", melee: !w.ranged, finesse: w.finesse });
              const steps = mapSteps({ ...w, attack: atk.value });
              const pen = checkAdjust(state?.cond, { kind: "damage", melee: !w.ranged });
              return (
                <div key={weaponKey(w)} className="weapon">
                  <div className="weapon-head">
                    <b>{w.name}</b>
                    <span className="muted small">
                      {damageFormula(w)}
                      {pen.total ? fmtMod(pen.total) : ""} {w.damageType}
                    </span>
                  </div>
                  <div className="extras">
                    <button className={`chip ${w.agile ? "on" : ""}`} onClick={() => setFlag(w, { agile: !w.agile })} title="Ágil: penalizador por ataque múltiple −4/−8">
                      Ágil
                    </button>
                    {!w.ranged && (
                      <button className={`chip ${w.finesse ? "on" : ""}`} onClick={() => setFlag(w, { finesse: !w.finesse })} title="Sutil: Torpe penaliza su ataque">
                        Sutil
                      </button>
                    )}
                    <button className={`chip ${w.ranged ? "on" : ""}`} onClick={() => setFlag(w, { ranged: !w.ranged })} title="A distancia o cuerpo a cuerpo">
                      {w.ranged ? "A distancia" : "Cuerpo a cuerpo"}
                    </button>
                    {w.ranged && (
                      <label className="range" title="Incremento de alcance">
                        Alcance
                        <input
                          inputMode="numeric"
                          value={w.range ?? ""}
                          placeholder="—"
                          onChange={(e) => {
                            const v = parseInt(e.target.value.replace(/\D/g, ""), 10);
                            setFlag(w, { range: Number.isFinite(v) ? v : undefined });
                          }}
                        />
                        ft
                      </label>
                    )}
                    <select
                      className="fx-select"
                      value={fxOf(w)}
                      title="Efecto visual de este ataque"
                      onChange={(e) => setFlag(w, { fx: e.target.value as AttackFx | "none" })}
                    >
                      <option value="none">✦ Sin efecto</option>
                      <optgroup label="Cuerpo a cuerpo">
                        {ATTACK_FX.filter((f) => !f.ranged).map((f) => (
                          <option key={f.id} value={f.id}>
                            ✦ {f.label}
                          </option>
                        ))}
                      </optgroup>
                      <optgroup label="A distancia">
                        {ATTACK_FX.filter((f) => f.ranged).map((f) => (
                          <option key={f.id} value={f.id}>
                            ✦ {f.label}
                          </option>
                        ))}
                      </optgroup>
                    </select>
                    {w.extra.map((e) => (
                      <button
                        key={extraKey(e)}
                        className={`chip ${e.active ? "on" : ""}`}
                        onClick={() => setFlag(w, { extras: { ...flags[weaponKey(w)]?.extras, [extraKey(e)]: !e.active } })}
                        title="Sumar este daño extra a Daño y Crítico"
                      >
                        +{e.dice}d{e.sides} {e.type}
                      </button>
                    ))}
                  </div>
                  <div className="weapon-btns">
                    {steps.map((b, m) => (
                      <button key={m} className={`btn ${atk.value < w.attack ? "down" : ""}`} title={atk.notes || undefined} onClick={() => rollWeapon(w, "attack", m)}>
                        {fmtMod(b)}
                      </button>
                    ))}
                    <button className="btn" onClick={() => rollWeapon(w, "damage")}>
                      Daño
                    </button>
                    <button className="btn crit" onClick={() => rollWeapon(w, "crit")}>
                      Crítico
                    </button>
                  </div>
                </div>
              );
            })}
            {c.impulse && (
              <div className="weapon">
                <div className="weapon-head">
                  <b>Impulsos</b>
                  <span className="muted small">Kineticista (Constitución)</span>
                </div>
                <div className="weapon-btns">
                  {(() => {
                    const atk = adjust(c.impulse.attack, { kind: "impulse-attack" });
                    const dc = adjust(c.impulse.dc, { kind: "impulse-dc" });
                    return (
                      <>
                        <button className="btn" onClick={() => rollCheck("Ataque de impulso", c.impulse!.attack, { kind: "impulse-attack" })}>
                          Ataque <Val base={c.impulse.attack} value={atk.value} notes={atk.notes} />
                        </button>
                        <span className="dc" title={dc.notes || undefined}>
                          CD {dc.value}
                        </span>
                      </>
                    );
                  })()}
                </div>
              </div>
            )}
          </>
        )}

        {tab === "skills" && (
          <>
            <button className="stat-row wide" onClick={() => rollCheck("Percepción", c.perception.mod, { kind: "perception" })}>
              <Rank prof={c.perception.prof} />
              <span>Percepción (iniciativa)</span>
              <Val base={c.perception.mod} value={perception.value} notes={perception.notes} />
            </button>
            <div className="grid2">
              {c.skills.map((s) => {
                const a = adjust(s.mod, statCtx(s));
                return (
                  <button key={s.key} className={`stat-row ${s.prof ? "" : "untrained"}`} onClick={() => rollCheck(s.label, s.mod, statCtx(s))}>
                    <Rank prof={s.prof} />
                    <span>{s.label}</span>
                    <Val base={s.mod} value={a.value} notes={a.notes} />
                  </button>
                );
              })}
            </div>
          </>
        )}

        {tab === "defense" && (
          <>
            <div className="saves">
              {c.saves.map((s) => {
                const a = adjust(s.mod, saveCtx(s));
                return (
                  <button key={s.key} className="save" onClick={() => rollCheck(s.label, s.mod, saveCtx(s))}>
                    <Rank prof={s.prof} />
                    <span>{s.label}</span>
                    <Val base={s.mod} value={a.value} notes={a.notes} />
                  </button>
                );
              })}
            </div>
            {state && <ShieldCard state={state} canEdit={canEdit} onPatch={onPatch} />}
            <div className="abilities">
              {Object.entries(c.abilities).map(([k, v]) => (
                <div key={k} className="ability">
                  <small>{ABILITY_LABEL[k]}</small>
                  <b>{fmtMod(v)}</b>
                </div>
              ))}
            </div>
            <div className="facts">
              <div>
                CA de la hoja <b>{c.ac}</b>
              </div>
              <div>
                PG máx <b>{state ? effectiveMaxHp(state.maxHp, state.level, state.cond) : c.maxHp}</b>
              </div>
              <div>
                CD de clase <b>{adjust(c.classDc, { kind: "class-dc" }).value}</b>
              </div>
              <div title={speedTitle(c)}>
                Velocidad <b className="speed">{c.speed} ft</b>
              </div>
            </div>
            <div className="senses-box">
              <small>Sentidos</small>
              <span>{c.senses?.length ? c.senses.join(" · ") : "Visión normal"}</span>
            </div>
            {c.parserVersion === undefined && (
              <p className="muted small">Vuelve a importar el JSON de Pathbuilder para ver sentidos, escudo y detalle de velocidad.</p>
            )}
          </>
        )}

        {tab === "spells" &&
          c.casters.map((cs, i) => {
            const atk = adjust(cs.attack, { kind: "spell-attack" });
            const dc = adjust(cs.dc, { kind: "spell-dc" });
            return (
              <div key={i} className="caster">
                <div className="caster-head">
                  <b>{cs.name}</b>
                  <span className="muted small">
                    {cs.tradition} {cs.type !== "focus" ? cs.type : ""}
                  </span>
                </div>
                <div className="weapon-btns">
                  <button className="btn" onClick={() => rollCheck(`${cs.name}: Ataque de conjuro`, cs.attack, { kind: "spell-attack" })}>
                    Ataque <Val base={cs.attack} value={atk.value} notes={atk.notes} />
                  </button>
                  <span className={`dc ${dc.value < cs.dc ? "down" : ""}`} title={dc.notes || undefined}>
                    CD {dc.value}
                  </span>
                </div>
                {cs.spells.map((s) => (
                  <div key={s.rank} className="spell-rank">
                    <small>{s.rank === -1 ? "Foco" : s.rank === 0 ? "Trucos" : `Rango ${s.rank}`}</small>
                    <span>{s.names.join(", ")}</span>
                  </div>
                ))}
              </div>
            );
          })}

        {tab === "log" && (
          <>
            <div className="log-tools">
              <button className="btn ghost" onClick={onClearLog}>
                Limpiar registro
              </button>
            </div>
            <LogList log={log} />
          </>
        )}
      </div>
    </section>
  );
}
