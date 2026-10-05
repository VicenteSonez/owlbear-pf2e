import { useState } from "react";
import { fmtMod, type Character, type Weapon } from "../pathbuilder";
import type { PcState } from "../live";
import { BONUS_LABEL, checkAdjust, modsText, type BonusType } from "../rules";
import { applyWeaponFlags, extraKey, store, type WeaponFlags } from "../storage";
import { newId } from "../shared";
import type { CustomMod, Extras } from "../extras";
import { ATTACK_FX, defaultWeaponFx, type AttackFx } from "../fx";
import { featuresOf, guessSlinger, type SlingerKind } from "../classes";
import { strikeAttack, strikeDamage, type StrikeContext, type StrikeOpts } from "../strike";
import { damageReqs } from "../requests";
import { FxDir } from "./FxDir";
import { NpcPicker, useNpcOptions } from "./NpcPicker";
import { useActions } from "./ctx";
import { spellstrikeStep } from "./classActions";
import { DamageTypeList } from "./DamageBox";
import { FxColors } from "./FxColors";

const MAP_LABEL = ["1er ataque", "2º ataque", "3er ataque"];
const weaponKey = (w: Weapon) => w.key ?? w.name.toLowerCase();

interface Props {
  character: Character;
  state?: PcState;
  canEdit: boolean;
  extras: Extras;
  canEditExtras: boolean;
  updateExtras: (fn: (e: Extras) => Extras) => void;
  onPatch: (fn: (s: PcState) => PcState) => void;
}

// Bonos y penalizadores del jugador para ataque y daño
function CustomMods({ extras, canEdit, update }: { extras: Extras; canEdit: boolean; update: (fn: (e: Extras) => Extras) => void }) {
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [value, setValue] = useState("");
  const [type, setType] = useState<BonusType>("circumstance");
  const [to, setTo] = useState<CustomMod["to"]>("atk");
  const mods = extras.mods ?? [];
  const active = mods.filter((m) => m.on);
  const set = (fn: (l: CustomMod[]) => CustomMod[]) => update((x) => ({ ...x, mods: fn(x.mods ?? []) }));
  return (
    <div className="custom-mods">
      <button className="cm-head" onClick={() => setOpen((o) => !o)}>
        <b>Bonos y penalizadores</b>
        <span className="muted small">
          {active.length ? active.map((m) => `${m.label || "Ajuste"} ${fmtMod(m.value)}`).join(" · ") : "Ninguno activo"}
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
              <b className={m.value < 0 ? "down" : "up"}>{fmtMod(m.value)}</b>
              <span className="muted small">
                {BONUS_LABEL[m.type]} · {m.to === "atk" ? "ataque" : "daño"}
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
                const v = parseInt(value.replace(/[^\d-]/g, ""), 10);
                if (!Number.isFinite(v) || !v) return;
                set((l) => [...l, { id: newId(), label: label.trim(), value: v, type, to, on: true }]);
                setLabel("");
                setValue("");
              }}
            >
              <input placeholder="Nombre (Bendecir…)" value={label} onChange={(e) => setLabel(e.target.value)} />
              <input className="sm" placeholder="+1" value={value} onChange={(e) => setValue(e.target.value)} />
              <select value={type} onChange={(e) => setType(e.target.value as BonusType)}>
                <option value="status">Estado</option>
                <option value="circumstance">Circunstancial</option>
                <option value="item">Objeto</option>
                <option value="untyped">Sin tipo</option>
              </select>
              <select value={to} onChange={(e) => setTo(e.target.value as CustomMod["to"])}>
                <option value="atk">Ataque</option>
                <option value="dmg">Daño</option>
              </select>
              <button className="btn">+</button>
            </form>
          )}
          <p className="muted small">Del mismo tipo solo cuenta el mayor bono y el peor penalizador; los sin tipo se suman.</p>
        </div>
      )}
    </div>
  );
}

export function AttacksTab({ character: c, state, canEdit, extras, canEditExtras, updateExtras, onPatch }: Props) {
  const { roll, notify, playFx } = useActions();
  const [flags, setFlags] = useState<Record<string, WeaponFlags>>(() => store.weaponFlags(c.id));
  const [flagsFor, setFlagsFor] = useState(c.id);
  const [fxPref, setFxPrefState] = useState(() => store.fxPref(c.id));
  const [opts, setOpts] = useState<StrikeOpts>({});
  if (flagsFor !== c.id) {
    setFlagsFor(c.id);
    setFlags(store.weaponFlags(c.id));
    setFxPrefState(store.fxPref(c.id));
    setOpts({});
  }
  const f = featuresOf(c);
  const npcs = useNpcOptions();
  const cls = state?.cls;
  const targetTok = state?.target;
  const target = npcs.find((n) => n.tok === targetTok);
  const strikeTarget = target ? { key: `npc:${target.tok}`, tok: target.tok, cond: target.state.cond } : undefined;
  const o: StrikeOpts = { ...opts, target: strikeTarget };

  const setFxPref = (p: { dir: number; on: boolean }) => {
    setFxPrefState(p);
    store.setFxPref(c.id, p);
  };
  const setFlag = (w: Weapon, patch: WeaponFlags) => {
    const key = weaponKey(w);
    const next = { ...flags, [key]: { ...flags[key], ...patch } };
    setFlags(next);
    store.setWeaponFlags(c.id, next);
  };
  const fxOf = (w: Weapon): AttackFx | "none" => flags[weaponKey(w)]?.fx ?? defaultWeaponFx(w);
  const weapons = c.weapons.map((w) => applyWeaponFlags(w, flags[weaponKey(w)]));
  const ctxFor = (w: Weapon): StrikeContext => ({ c, s: state, x: extras, f, slinger: flags[weaponKey(w)]?.sling });

  const setTarget = (tok: string | undefined) => onPatch((s) => ({ ...s, target: tok }));

  const attack = async (w: Weapon, mapIndex: number) => {
    const a = strikeAttack(w, ctxFor(w), o, mapIndex);
    const fx = fxOf(w);
    const r = await roll({
      label: `${w.name}: ${MAP_LABEL[mapIndex]}`,
      formula: a.formula,
      kind: "check",
      notes: a.notes || undefined,
      vs: target ? { dc: target.ac, name: target.name } : undefined,
      tag: "Ataque",
      fx: fxPref.on && fx !== "none" ? (target ? { kind: fx, to: target.tok } : { kind: fx, dir: fxPref.dir }) : undefined,
    });
    if (!r) return;
    // La estratagema se gasta al usarla
    if (o.stratagem && cls?.strat) {
      onPatch((s) => ({ ...s, cls: { ...s.cls, strat: undefined } }));
      setOpts((p) => ({ ...p, stratagem: false }));
    }
    spellstrikeStep(state, onPatch, notify, playFx, { attack: w.name });
  };

  const damage = async (w: Weapon, crit: boolean) => {
    const d = strikeDamage(w, ctxFor(w), o);
    const r = await roll({
      label: `${w.name}: ${crit ? "Crítico" : "Daño"}${w.damageType ? ` (${w.damageType})` : ""}`,
      formula: d.formula,
      kind: "damage",
      crit,
      notes: d.notes || undefined,
      vs: undefined,
      tag: target ? `→ ${target.name}` : undefined,
    });
    if (!r) return;
    // Efectos de clase al golpear
    if (d.sneak) playFx({ kind: "rogue", from: `pc:${c.id}`, color: extras.cls?.colors?.rogue });
    if (d.finisher) {
      playFx({ kind: "finisher", from: `pc:${c.id}`, color: extras.cls?.colors?.finisher });
      onPatch((s) => ({ ...s, cls: { ...s.cls, panache: undefined } }));
      setOpts((p) => ({ ...p, finisher: false }));
    }
    if (opts.preyFirst) setOpts((p) => ({ ...p, preyFirst: false }));
    if (target) {
      const mortal = cls?.exploit?.mode === "mortal" && cls.exploit.tok === target.tok;
      const id = newId();
      await damageReqs.set(id, {
        id,
        from: c.id,
        fromName: c.name,
        tok: target.tok,
        n: target.name,
        amt: r.total,
        ty: w.damageType,
        crit,
        label: w.name,
        mortal: mortal || undefined,
        t: Date.now(),
      });
    }
  };

  const toggles: { key: keyof StrikeOpts; label: string; title: string; show: boolean }[] = [
    { key: "preyFirst", label: "1er ataque a la presa", title: "Precisión: +1d8 de precisión al primer ataque del turno contra tu presa", show: f.edge === "precision" && !!cls?.prey },
    { key: "flurry", label: "Ráfaga", title: "Penalizador por ataque múltiple reducido (se aplica solo contra tu presa)", show: f.edge === "flurry" },
    { key: "finisher", label: "Golpe de gracia", title: "Requiere Panache; lo gasta al tirar el daño", show: f.precise && !!cls?.panache },
    { key: "stratagem", label: `Estratagema (${cls?.strat?.v ?? "—"})`, title: "Ataque con Inteligencia usando el d20 guardado, +daño de precisión", show: f.stratagem && !!cls?.strat },
    { key: "sneak", label: "Furtivo", title: "Fuerza el Ataque furtivo (si el objetivo no figura desprevenido)", show: f.sneak > 0 },
  ];

  return (
    <>
      <CustomMods extras={extras} canEdit={canEditExtras} update={updateExtras} />
      {weapons.length === 0 && !c.impulse && <p className="muted">Este personaje no tiene armas en Pathbuilder.</p>}
      {weapons.length > 0 && (
        <div className="fx-row">
          <div>
            <b>Objetivo</b>
            <NpcPicker value={targetTok} onChange={setTarget} placeholder="— Sin objetivo (dirección) —" disabled={!canEdit} />
            <span className="muted small">
              {target
                ? "Se compara con su CA; el daño queda pendiente hasta que el GM lo autorice."
                : fxPref.on
                  ? "Sin objetivo: elige hacia dónde atacas."
                  : "Apagado: los ataques no muestran efecto."}
            </span>
          </div>
          {!target && <FxDir dir={fxPref.dir} on={fxPref.on} onChange={setFxPref} />}
        </div>
      )}
      {toggles.some((t) => t.show) && (
        <div className="strike-opts">
          {toggles
            .filter((t) => t.show)
            .map((t) => (
              <button key={t.key} className={`chip ${opts[t.key] ? "on" : ""}`} title={t.title} onClick={() => setOpts((p) => ({ ...p, [t.key]: !p[t.key] }))}>
                {t.label}
              </button>
            ))}
          {f.sneak > 0 && <FxColors kinds={["rogue"]} extras={extras} canEdit={canEditExtras} updateExtras={updateExtras} />}
        </div>
      )}
      {weapons.map((w) => {
        const steps = [0, 1, 2].map((m) => strikeAttack(w, ctxFor(w), o, m));
        const dmg = strikeDamage(w, ctxFor(w), o);
        const sling = flags[weaponKey(w)]?.sling ?? guessSlinger(w);
        return (
          <div key={weaponKey(w)} className="weapon">
            <div className="weapon-head">
              <b>{w.name}</b>
              <span className="muted small" title={dmg.notes || undefined}>
                {dmg.formula} {w.damageType}
              </span>
            </div>
            <div className="extras">
              {!w.bomb && (
                <button className={`chip ${w.agile ? "on" : ""}`} onClick={() => setFlag(w, { agile: !w.agile })} title="Ágil: penalizador por ataque múltiple −4/−8">
                  Ágil
                </button>
              )}
              {!w.ranged && (
                <button className={`chip ${w.finesse ? "on" : ""}`} onClick={() => setFlag(w, { finesse: !w.finesse })} title="Sutil: usa Destreza (Torpe lo penaliza; Débil, no)">
                  Sutil
                </button>
              )}
              {!w.bomb && (
                <button className={`chip ${w.ranged ? "on" : ""}`} onClick={() => setFlag(w, { ranged: !w.ranged })} title="A distancia o cuerpo a cuerpo">
                  {w.ranged ? "A distancia" : "Cuerpo a cuerpo"}
                </button>
              )}
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
              {w.bomb && (
                <>
                  <label className="range" title="Daño de la bomba">
                    Daño
                    <input className="wide" defaultValue={w.dmgFormula ?? "1d6"} onBlur={(e) => setFlag(w, { dmg: e.target.value.trim() || undefined })} />
                  </label>
                  <label className="range" title="Tipo de daño">
                    <input className="wide" list="pf2-damage-types" placeholder="sin tipo" defaultValue={w.damageType} onBlur={(e) => setFlag(w, { dmgType: e.target.value.trim() })} />
                  </label>
                  <DamageTypeList />
                </>
              )}
              {f.slinger && w.ranged && (
                <select className="fx-select" value={sling} title="Precisión del pistolero" onChange={(e) => setFlag(w, { sling: e.target.value as SlingerKind })}>
                  <option value="none">Sin precisión</option>
                  <option value="crossbow">Ballesta (+{f.slingerLegend ? 3 : 2})</option>
                  <option value="pistol">Pistola (+1d{f.slingerLegend ? 6 : 4})</option>
                </select>
              )}
              <select className="fx-select" value={fxOf(w)} title="Efecto visual de este ataque" onChange={(e) => setFlag(w, { fx: e.target.value as AttackFx | "none" })}>
                <option value="none">✦ Sin efecto</option>
                <optgroup label="Cuerpo a cuerpo">
                  {ATTACK_FX.filter((x) => !x.ranged).map((x) => (
                    <option key={x.id} value={x.id}>
                      ✦ {x.label}
                    </option>
                  ))}
                </optgroup>
                <optgroup label="A distancia">
                  {ATTACK_FX.filter((x) => x.ranged).map((x) => (
                    <option key={x.id} value={x.id}>
                      ✦ {x.label}
                    </option>
                  ))}
                </optgroup>
              </select>
              {w.extra
                .filter((e) => !(/precision/i.test(e.type) && (f.precise || f.sneak > 0 || f.stratagem)))
                .map((e) => (
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
              {steps.map((a, m) => (
                <button key={m} className={`btn ${a.value < w.attack - (w.agile ? 4 : 5) * m ? "down" : ""}`} title={a.notes || undefined} onClick={() => attack(w, m)}>
                  {fmtMod(a.value)}
                </button>
              ))}
              <button className="btn" onClick={() => damage(w, false)}>
                Daño
              </button>
              <button className="btn crit" onClick={() => damage(w, true)}>
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
            <span className="muted small">Kineticista (Constitución) · lista completa en la pestaña Magia</span>
          </div>
          <div className="weapon-btns">
            {(() => {
              const atk = checkAdjust(state?.cond, { kind: "impulse-attack" });
              const dc = checkAdjust(state?.cond, { kind: "impulse-dc" });
              return (
                <>
                  <button
                    className="btn"
                    title={modsText(atk.applied) || undefined}
                    onClick={() =>
                      roll({
                        label: "Ataque de impulso",
                        formula: `1d20${fmtMod(c.impulse!.attack + atk.total)}`,
                        kind: "check",
                        notes: modsText(atk.applied) || undefined,
                        vs: target ? { dc: target.ac, name: target.name } : undefined,
                      })
                    }
                  >
                    Ataque <b className={atk.total < 0 ? "down" : ""}>{fmtMod(c.impulse.attack + atk.total)}</b>
                  </button>
                  <span className="dc" title={modsText(dc.applied) || undefined}>
                    CD {c.impulse.dc + dc.total}
                  </span>
                </>
              );
            })()}
          </div>
        </div>
      )}
    </>
  );
}
