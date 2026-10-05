import { useState } from "react";
import { PROF_LABEL, fmtMod, type Character, type Stat } from "../pathbuilder";
import type { RollEntry } from "../shared";
import type { PcState } from "../live";
import type { Extras } from "../extras";
import { checkAdjust, effectiveMaxHp, modsText, stackMods, type Mod, type RollCtx } from "../rules";
import { OUTWIT_SKILLS, featuresOf } from "../classes";
import { dealDamage } from "../damage";
import type { RollRequest } from "./App";
import { LogList } from "./LogList";
import { ShieldCard } from "./ShieldCard";
import { speedTitle } from "./Vitals";
import { AttacksTab } from "./AttacksTab";
import { IwrEditor } from "./DamageBox";
import { classSpeed } from "./ClassBar";

type Tab = "attacks" | "skills" | "defense" | "spells" | "log";

interface Props {
  character: Character;
  state?: PcState;
  canEdit: boolean;
  extras: Extras;
  canEditExtras: boolean;
  updateExtras: (fn: (e: Extras) => Extras) => void;
  onRoll: (r: RollRequest) => void;
  onPatch: (fn: (s: PcState) => PcState) => void;
  log: RollEntry[];
  onClearLog: () => void;
}

const ABILITY_LABEL: Record<string, string> = {
  str: "FUE", dex: "DES", con: "CON", int: "INT", wis: "SAB", cha: "CAR",
};

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

export function SheetTabs(props: Props) {
  const { character: c, state, canEdit, onRoll, onPatch, log, onClearLog } = props;
  const [tab, setTab] = useState<Tab>("attacks");
  // Bonos de explorador que se activan a mano: Cazar presa y Burlar
  const [huntBonus, setHuntBonus] = useState(false);
  const [outwitBonus, setOutwitBonus] = useState(false);
  const f = featuresOf(c);

  // Bonificadores de las condiciones activas (y de los bonos manuales) para cada tirada
  const extraMods = (ctx: RollCtx): Mod[] => {
    const out: Mod[] = [];
    const key = ctx.kind === "perception" ? "perception" : ctx.kind === "skill" ? ctx.key : "";
    if (huntBonus && (key === "perception" || key === "survival")) out.push({ label: "Cazar presa", type: "circumstance", value: 2 });
    if (outwitBonus && OUTWIT_SKILLS.includes(key)) out.push({ label: "Burlar", type: "circumstance", value: 2 });
    return out;
  };
  const adjust = (base: number, ctx: RollCtx) => {
    const cond = checkAdjust(state?.cond, ctx, state?.shield).applied;
    const a = stackMods([...cond, ...extraMods(ctx)]);
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

  const tabs: [Tab, string][] = [
    ["attacks", "Ataques"],
    ["skills", "Habilidades"],
    ["defense", "Defensa"],
    ...(c.casters.length ? ([["spells", "Conjuros"]] as [Tab, string][]) : []),
    ["log", "Registro"],
  ];

  const perception = adjust(c.perception.mod, { kind: "perception" });
  const speed = classSpeed(c, state);

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
          <AttacksTab
            character={c}
            state={state}
            canEdit={canEdit}
            extras={props.extras}
            canEditExtras={props.canEditExtras}
            updateExtras={props.updateExtras}
            onPatch={onPatch}
          />
        )}

        {tab === "skills" && (
          <>
            {(f.huntPrey || f.edge === "outwit") && (
              <div className="strike-opts">
                {f.huntPrey && (
                  <button className={`chip ${huntBonus ? "on" : ""}`} title="+2 circunstancial a Percepción y Supervivencia contra tu presa" onClick={() => setHuntBonus((v) => !v)}>
                    Cazar presa +2
                  </button>
                )}
                {f.edge === "outwit" && (
                  <button className={`chip ${outwitBonus ? "on" : ""}`} title="+2 circunstancial a Engaño, Sigilo y Recordar conocimiento contra tu presa" onClick={() => setOutwitBonus((v) => !v)}>
                    Burlar +2
                  </button>
                )}
              </div>
            )}
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
            {state && (
              <ShieldCard
                shield={state.shield}
                canEdit={canEdit}
                onSet={(fn) => onPatch((x) => ({ ...x, shield: fn(x.shield) }))}
                onBlock={(dmg) => dealDamage({ kind: "pc", id: state.id }, dmg, { block: true })}
              />
            )}
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
              <div title={[speedTitle(c), speed.notes].filter(Boolean).join("\n")}>
                Velocidad <b className={`speed ${speed.value > c.speed ? "up" : ""}`}>{speed.value} ft</b>
              </div>
            </div>
            <div className="senses-box">
              <small>Sentidos</small>
              <span>{c.senses?.length ? c.senses.join(" · ") : "Visión normal"}</span>
            </div>
            {state && (
              <div className="senses-box">
                <small>Inmunidades, resistencias y debilidades</small>
                <IwrEditor iwr={state.iwr} canEdit={canEdit} onChange={(iwr) => onPatch((x) => ({ ...x, iwr }))} />
              </div>
            )}
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
