// Botones de rasgos de clase en la hoja principal. Cada botón abre su panel debajo.
// El estado vive en PcState.cls (lo ven el GM y el mapa); las preferencias, en Extras.
import { useState } from "react";
import { fmtMod, type Character } from "../pathbuilder";
import type { PcState } from "../live";
import type { ClassPrefs, Extras } from "../extras";
import { DEGREE_LABEL, checkAdjust, levelDc, withBuff, type Degree } from "../rules";
import {
  HUNTER_EDGE_LABEL,
  IMPLEMENTS,
  IMPLEMENT_KIND_LABEL,
  etchMax,
  featuresOf,
  overdriveBonus,
  panacheSpeed,
  panacheSpeedIdle,
  type ClassState,
  type HunterEdge,
  type ImplementKind,
} from "../classes";
import { defaultColor, type FxKind, type MagicDesign } from "../fx";
import { useCombat } from "../combat";
import { randomDie } from "../dice";
import { dealDamage } from "../damage";
import { NpcPicker, useNpcOptions } from "./NpcPicker";
import { useActions } from "./ctx";
import { runeLabel } from "./side/RunesPanel";
import { ELEMENTS } from "../classes";

interface Props {
  character: Character;
  state?: PcState;
  extras: Extras;
  canEdit: boolean;
  canEditExtras: boolean;
  updateExtras: (fn: (e: Extras) => Extras) => void;
  onPatch: (fn: (s: PcState) => PcState) => void;
}

// Velocidad con Furia y Panache (Pathbuilder ya suma la parte fija de nivel 3)
export function classSpeed(c: Character, s?: PcState) {
  const f = featuresOf(c);
  let value = c.speed;
  const notes: string[] = [];
  if (f.rageSpeed && s?.cls?.rage) {
    value += 5;
    notes.push("+5 por Furia");
  }
  if (f.panache && f.vivacious && s?.cls?.panache) {
    const extra = panacheSpeed(c.level) - panacheSpeedIdle(c.level);
    value += extra;
    notes.push(`+${extra} por Panache`);
  }
  return { value, notes: notes.join(", ") };
}

type Panel = "rage" | "exploit" | "impl" | "prey" | "panache" | "strat" | "taunt" | "od" | "psyche" | "spark" | "curse" | "ss" | "tactics" | "invoke" | "aura";

export function ClassBar({ character: c, state, extras, canEdit, canEditExtras, updateExtras, onPatch }: Props) {
  const { roll, notify, playFx } = useActions();
  const combat = useCombat();
  const npcs = useNpcOptions();
  const f = featuresOf(c);
  const [open, setOpen] = useState<Panel | null>(null);
  const [exploitRoll, setExploitRoll] = useState<{ tok: string; degree: Degree } | null>(null);
  const [other, setOther] = useState("");
  const [invokeSel, setInvokeSel] = useState<string[]>([]);
  const [newImpl, setNewImpl] = useState("");
  const cls: ClassState = state?.cls ?? {};
  const prefs: ClassPrefs = extras.cls ?? {};
  const me = `pc:${c.id}`;
  const edge: HunterEdge | undefined = prefs.edge ?? f.edge;
  const color = (k: FxKind) => prefs.colors?.[k] ?? defaultColor(k);
  const magicDesign: MagicDesign = extras.magicFx?.design ?? "arcane";
  const magicColor = extras.magicFx?.color;

  const patchCls = (fn: (k: ClassState) => ClassState) => onPatch((s) => ({ ...s, cls: fn(s.cls ?? {}) }));
  const setPrefs = (fn: (p: ClassPrefs) => ClassPrefs) => updateExtras((x) => ({ ...x, cls: fn(x.cls ?? {}) }));
  const npcName = (tok?: string) => npcs.find((n) => n.tok === tok)?.name ?? "PNJ";
  const skill = (pred: (key: string) => boolean) => c.skills.find((s) => pred(s.key.toLowerCase()));

  const implList = prefs.implements ?? [];
  const activeImpl = cls.impl ?? [];
  const exploitText = cls.exploit
    ? `${npcName(cls.exploit.tok)} · ${cls.exploit.mode === "anti" ? "Antítesis" : cls.exploit.mode === "mortal" ? "Debilidad mortal" : (cls.exploit.note ?? "Otro")}`
    : "Sin objetivo";
  // Cada rasgo es una tarjeta con su estado actual debajo del nombre
  const buttons: { id: Panel; label: string; sub?: string; on?: boolean; show: boolean; glow?: boolean; title?: string; icon: string }[] = [
    { id: "rage", label: "Furia", icon: "🔥", sub: cls.rage ? "Activa" : state?.cond.fatigued ? "Fatigado" : "Inactiva", on: !!cls.rage, show: f.rage, title: "Furia: PG temporales y daño extra cuerpo a cuerpo" },
    { id: "exploit", label: "Explotar vulnerabilidad", icon: "👁", sub: exploitText, on: !!cls.exploit, show: f.exploit },
    { id: "impl", label: "Implementos", icon: "🔔", sub: activeImpl.length ? activeImpl.join(" · ") : implList.length ? "Ninguno activo" : "Agrega tus implementos", on: activeImpl.length > 0, show: f.thaumaturge },
    { id: "prey", label: "Presa", icon: "🎯", sub: cls.prey ? npcName(cls.prey) : "Sin presa", on: !!cls.prey, show: f.huntPrey },
    { id: "panache", label: "Panache", icon: "✨", sub: cls.panache ? "Con Panache" : "Sin Panache", on: !!cls.panache, show: f.panache },
    { id: "strat", label: "Estratagema", icon: "🧠", sub: cls.strat ? `d20 = ${cls.strat.v}` : "Sin tirar", on: !!cls.strat, show: f.stratagem },
    { id: "taunt", label: "Provocar", icon: "🛡", sub: cls.taunt ? npcName(cls.taunt) : "Nadie provocado", on: !!cls.taunt, show: f.taunt },
    { id: "od", label: "Sobrecarga", icon: "⚙", sub: cls.od ? `+${cls.od.b} al daño` : cls.odCd ? `Espera ${cls.odCd} rondas` : "Inactiva", on: !!cls.od, show: f.overdrive > 0 },
    {
      id: "psyche",
      label: "Desatar psique",
      icon: "🌀",
      sub: cls.psyche ? `${cls.psyche} rondas` : "Inactiva",
      on: !!cls.psyche,
      show: f.unleash || f.psychic,
      glow: combat.active && cls.castR !== undefined && cls.castR === combat.round - 1 && !cls.psyche,
    },
    { id: "spark", label: "Chispa divina", icon: "☀", sub: cls.spark ? `En ${cls.spark}` : "Sin ícono", on: !!cls.spark, show: f.spark },
    { id: "curse", label: "Maldición", icon: "🌒", sub: `Nivel ${cls.curse ?? 0}`, on: !!cls.curse, show: f.curse },
    { id: "ss", label: "Golpe de conjuro", icon: "⚡", sub: cls.ss?.used ? "Usado (recargar)" : cls.ss?.armed ? "Preparado" : "Listo", on: !!cls.ss?.armed, show: f.spellstrike },
    { id: "tactics", label: "Tácticas", icon: "🚩", sub: `${(prefs.tactics ?? []).filter(Boolean).length}/${f.tactics} preparadas`, show: f.tactics > 0 },
    { id: "invoke", label: "Invocar runas", icon: "ᚱ", sub: `${Object.values(cls.etched ?? {}).reduce((a, b) => a + b, 0) + (cls.traced?.length ?? 0)} activas`, show: f.runes },
    { id: "aura", label: "Aura cinética", icon: "💠", sub: cls.aura ? "Activa" : "Apagada", on: !!cls.aura, show: f.kineticAura },
  ];
  const shown = buttons.filter((b) => b.show);
  if (!shown.length) return null;
  const openPanel = shown.some((b) => b.id === open) ? open : null;

  // ---------- Acciones ----------

  const toggleRage = () => {
    if (!state) return;
    if (cls.rage) {
      patchCls((k) => ({ ...k, rage: undefined }));
      return;
    }
    if (state.cond.fatigued) return;
    const temp = c.level + c.abilities.con;
    onPatch((s) => ({ ...s, temp: Math.max(s.temp, temp), cls: { ...s.cls, rage: true } }));
    playFx({ kind: "rage", from: me, color: color("rage") });
    notify({ label: "Entra en", title: "Furia", detail: `+${temp} PG temporales`, tag: "Furia" });
  };

  const rollExploit = async (tok: string) => {
    const lore = skill((k) => k.includes("esoteric")) ?? skill((k) => k === "occultism");
    const target = npcs.find((n) => n.tok === tok);
    if (!target) return;
    const adj = checkAdjust(state?.cond, { kind: "skill", key: "lore", ability: "cha" });
    const r = await roll({
      label: "Explotar vulnerabilidad (Saber esotérico)",
      formula: `1d20${fmtMod((lore?.mod ?? 0) + adj.total)}`,
      kind: "check",
      vs: { dc: levelDc(Math.max(0, target.state.level)), name: target.name },
      tag: "Explotar",
    });
    if (!r?.degree) return;
    playFx({ kind: "occult", from: me, color: color("occult") });
    if (r.degree === "crit-failure") {
      onPatch((s) => ({
        ...s,
        cls: { ...s.cls, exploit: undefined },
        cond: withBuff(s.cond, { id: "exploit-og", n: "Desprevenido (Explotar)", ty: "circumstance", ac: -2, icon: "off-guard", until: { key: me, at: "start" } }),
      }));
      notify({ label: `Fallo crítico contra ${target.name}:`, title: "Explotar vulnerabilidad", detail: "Queda desprevenido hasta su próximo turno", tag: "Explotar" });
      setExploitRoll(null);
      return;
    }
    setExploitRoll({ tok, degree: r.degree });
  };

  const chooseExploit = (mode: "anti" | "mortal" | "other") => {
    if (!exploitRoll) return;
    const label = mode === "anti" ? "Antítesis personal" : mode === "mortal" ? "Debilidad mortal" : other.trim() || "Otro";
    patchCls((k) => ({ ...k, exploit: { tok: exploitRoll.tok, mode, note: mode === "other" ? label : undefined } }));
    notify({ label: `Explota a ${npcName(exploitRoll.tok)}:`, title: label, detail: "Explotar vulnerabilidad", tag: "Explotar" });
    setExploitRoll(null);
    setOther("");
  };

  const setPrey = (tok?: string) => {
    patchCls((k) => ({ ...k, prey: tok, edge }));
    if (tok) {
      playFx({ kind: "prey", from: tok, color: color("prey") });
      notify({ label: "Caza a su presa:", title: npcName(tok), tag: "Presa" });
    }
  };

  const togglePanache = () => {
    if (cls.panache) patchCls((k) => ({ ...k, panache: undefined }));
    else {
      patchCls((k) => ({ ...k, panache: true }));
      playFx({ kind: "panache", from: me, color: color("panache") });
      notify({ label: "Gana", title: "Panache", tag: "Panache" });
    }
  };

  const devise = async (tok?: string) => {
    if (!tok) return;
    const r = await roll({ label: "Divisar estratagema", formula: "1d20", kind: "free", tag: "Estratagema" });
    if (!r) return;
    patchCls((k) => ({ ...k, strat: { v: r.total, tok } }));
    playFx({ kind: "lens", from: tok, color: color("lens") });
  };

  const setTaunt = (tok?: string) => {
    patchCls((k) => ({ ...k, taunt: tok }));
    if (tok) {
      playFx({ kind: "taunt", from: tok, color: color("taunt") });
      notify({ label: "Provoca a:", title: npcName(tok), tag: "Provocar" });
    }
  };

  const overdrive = async () => {
    const crafting = skill((k) => k === "crafting");
    const adj = checkAdjust(state?.cond, { kind: "skill", key: "crafting", ability: "int" });
    const r = await roll({
      label: "Sobrecarga (Artesanía)",
      formula: `1d20${fmtMod((crafting?.mod ?? 0) + adj.total)}`,
      kind: "check",
      vs: { dc: levelDc(c.level), showDc: true },
      tag: "Sobrecarga",
    });
    if (!r?.degree) return;
    const bonus = overdriveBonus(r.degree, c.abilities.int, f.overdrive);
    if (bonus) {
      patchCls((k) => ({ ...k, od: bonus, odCd: r.degree === "crit-success" ? 10 : k.odCd }));
      playFx({ kind: "overdrive", from: me, color: color("overdrive") });
      notify({ label: `Sobrecarga (${DEGREE_LABEL[r.degree]}):`, title: `+${bonus.b} al daño${bonus.fire ? " de fuego" : ""}`, tag: "Sobrecarga" });
    } else {
      const dmg = Math.ceil(c.level / 2);
      const cd = randomDie(4);
      patchCls((k) => ({ ...k, od: undefined, odCd: cd }));
      playFx({ kind: "explode", from: me, color: color("explode") });
      await dealDamage({ kind: "pc", id: c.id }, dmg, { type: "fuego" });
      notify({ label: "Sobrecarga:", title: "¡Explota!", detail: `${dmg} de daño · sin Sobrecarga por ${cd} rondas`, tag: "Sobrecarga" });
    }
  };

  const togglePsyche = () => {
    if (cls.psyche) patchCls((k) => ({ ...k, psyche: undefined }));
    else {
      patchCls((k) => ({ ...k, psyche: 2 }));
      playFx({ kind: magicDesign, from: me, color: magicColor });
      notify({ label: "Desata su", title: "Psique", detail: "+2×rango al daño de sus conjuros por 2 rondas", tag: "Psique" });
    }
  };

  const setSpark = (ikon?: string, transcend = false) => {
    patchCls((k) => ({ ...k, spark: ikon }));
    playFx({ kind: "divine", from: me, color: color("divine") });
    if (transcend) notify({ label: "Trasciende con su chispa divina:", title: cls.spark, tag: "Trascendencia" });
    else if (ikon) notify({ label: "Chispa divina inmanente en:", title: ikon, tag: "Inmanencia" });
    else notify({ label: "Apaga su", title: "Chispa divina", tag: "Chispa" });
  };

  const setCurse = (v: number) => {
    const next = Math.max(0, Math.min(4, v));
    if (next > (cls.curse ?? 0)) playFx({ kind: magicDesign, from: me, color: magicColor });
    patchCls((k) => ({ ...k, curse: next || undefined }));
  };

  const useTactic = (name: string) => {
    notify({ label: "Usa la táctica:", title: name, tag: "Táctica" });
    playFx({ kind: "banner", from: me, color: color("banner") });
  };

  // Runas activas: grabadas (cuenta) y trazadas (una por copia)
  const runes = prefs.runes ?? [];
  const activeRunes = [
    ...Object.entries(cls.etched ?? {}).flatMap(([k, n]) => Array.from({ length: n }, (_, i) => ({ id: `e:${k}:${i}`, k, kind: "etched" as const }))),
    ...(cls.traced ?? []).map((t, i) => ({ id: `t:${t.k}:${i}`, k: t.k, kind: "traced" as const })),
  ];
  const invoke = () => {
    const chosen = activeRunes.filter((r) => invokeSel.includes(r.id)).slice(0, 2);
    if (!chosen.length) return;
    patchCls((k) => {
      const etched = { ...(k.etched ?? {}) };
      let traced = [...(k.traced ?? [])];
      for (const r of chosen) {
        if (r.kind === "etched") etched[r.k] = Math.max(0, (etched[r.k] ?? 0) - 1);
        else {
          const i = traced.findIndex((t) => t.k === r.k);
          if (i >= 0) traced = traced.filter((_, j) => j !== i);
        }
      }
      for (const key of Object.keys(etched)) if (!etched[key]) delete etched[key];
      return { ...k, etched: Object.keys(etched).length ? etched : undefined, traced: traced.length ? traced : undefined };
    });
    notify({ label: "Invoca:", title: chosen.map((r) => runeLabel(runes, r.k)).join(" + "), tag: "Runas" });
    playFx({ kind: "arcane", from: me, color: color("arcane") });
    setInvokeSel([]);
  };

  // Implementos: el activo es el que tiene en la mano; "Usar" avisa a la mesa con su efecto
  const toggleImpl = (n: string) => patchCls((k) => {
    const cur = k.impl ?? [];
    const next = cur.includes(n) ? cur.filter((x) => x !== n) : [...cur, n];
    return { ...k, impl: next.length ? next : undefined };
  });
  const useImpl = (n: string, kind: ImplementKind, note?: string) => {
    notify({ label: `Usa su implemento (${IMPLEMENT_KIND_LABEL[kind]}):`, title: n, detail: note, tag: "Implemento" });
    playFx({ kind: "occult", from: me, color: color("occult") });
  };
  const setImpl = (i: number, patch: Partial<{ n: string; kind: ImplementKind; note?: string }>) =>
    setPrefs((p) => ({ ...p, implements: (p.implements ?? []).map((x, j) => (j === i ? { ...x, ...patch } : x)) }));

  const toggleAura = () => {
    if (cls.aura) patchCls((k) => ({ ...k, aura: undefined }));
    else {
      patchCls((k) => ({ ...k, aura: true }));
      const el = (prefs.element ?? f.elements[0] ?? "fire") as MagicDesign;
      playFx({ kind: el, from: me, color: color(el) });
      notify({ label: "Activa su", title: "Aura cinética", tag: "Aura" });
    }
  };

  // ---------- Paneles ----------

  const ColorPick = ({ k }: { k: FxKind }) => (
    <label className="fx-color" title="Color del efecto en el mapa">
      🎨
      <input
        type="color"
        value={color(k)}
        disabled={!canEditExtras}
        onChange={(e) => setPrefs((p) => ({ ...p, colors: { ...p.colors, [k]: e.target.value } }))}
      />
    </label>
  );

  const panel = () => {
    switch (openPanel) {
      case "rage":
        return (
          <>
            <div className="cb-row">
              <button className={`btn ${cls.rage ? "on" : ""}`} disabled={!canEdit || (!cls.rage && !!state?.cond.fatigued)} onClick={toggleRage}>
                {cls.rage ? "Terminar Furia" : "Entrar en Furia"}
              </button>
              {state?.cond.fatigued && !cls.rage && <span className="muted small">Fatigado: no puede entrar en Furia.</span>}
              <ColorPick k="rage" />
            </div>
            <div className="cb-row">
              <label className="te-check" title="El GM la activa al iniciar el combate">
                <input
                  type="checkbox"
                  checked={!!cls.autoRage}
                  disabled={!canEdit}
                  onChange={(e) => patchCls((k) => ({ ...k, autoRage: e.target.checked ? c.level + c.abilities.con : undefined }))}
                />
                Furia al iniciar combate
              </label>
            </div>
            <div className="cb-row">
              <span className="muted small">Daño de Furia</span>
              <input
                className="sm2"
                placeholder="2 (1 ágil)"
                defaultValue={prefs.rageDmg}
                disabled={!canEditExtras}
                onBlur={(e) => setPrefs((p) => ({ ...p, rageDmg: e.target.value.trim() || undefined }))}
              />
              <input
                className="sm2"
                list="pf2-damage-types"
                placeholder="tipo"
                defaultValue={prefs.rageType}
                disabled={!canEditExtras}
                onBlur={(e) => setPrefs((p) => ({ ...p, rageType: e.target.value.trim() || undefined }))}
              />
            </div>
          </>
        );
      case "exploit":
        return (
          <>
            <div className="cb-row">
              <NpcPicker value={exploitRoll?.tok ?? cls.exploit?.tok} onChange={(tok) => tok && rollExploit(tok)} placeholder="Elegir PNJ y tirar Saber esotérico" disabled={!canEdit} />
              <ColorPick k="occult" />
            </div>
            {exploitRoll && (
              <div className="cb-row">
                <span className={`deg ${exploitRoll.degree.includes("success") ? "ok" : "fail"}`}>{DEGREE_LABEL[exploitRoll.degree]}</span>
                <button className="btn small-btn" onClick={() => chooseExploit("anti")}>
                  Antítesis personal
                </button>
                {exploitRoll.degree.includes("success") && (
                  <button className="btn small-btn" onClick={() => chooseExploit("mortal")}>
                    Debilidad mortal
                  </button>
                )}
                <input className="sm2" placeholder="Otro…" value={other} onChange={(e) => setOther(e.target.value)} />
                <button className="btn small-btn" onClick={() => chooseExploit("other")}>
                  Otro
                </button>
              </div>
            )}
            {cls.exploit && (
              <div className="cb-row">
                <span className="muted small">
                  {npcName(cls.exploit.tok)}: {cls.exploit.mode === "anti" ? `Antítesis personal (+${2 + Math.floor(c.level / 2)} al daño)` : cls.exploit.mode === "mortal" ? "Debilidad mortal" : cls.exploit.note}
                </span>
                <button className="link-btn" onClick={() => patchCls((k) => ({ ...k, exploit: undefined }))}>
                  Quitar
                </button>
              </div>
            )}
            {f.empower && (
              <label className="te-check">
                <input type="checkbox" checked={prefs.empower ?? true} disabled={!canEditExtras} onChange={(e) => setPrefs((p) => ({ ...p, empower: e.target.checked }))} />
                Potenciación del implemento (+2 al daño de armas)
              </label>
            )}
          </>
        );
      case "impl":
        return (
          <>
            {!implList.length && <p className="muted small">Agrega tus implementos abajo (Amulet, Bell, Chalice…). Marca los que tienes en la mano y pulsa Usar para avisar a la mesa.</p>}
            {implList.map((im, i) => {
              const active = activeImpl.includes(im.n);
              return (
                <div key={`${im.n}${i}`} className={`impl-card ${active ? "on" : ""}`}>
                  <div className="cb-row">
                    <button className={`chip ${active ? "on" : ""}`} disabled={!canEdit} title="Implemento activo (en la mano)" onClick={() => toggleImpl(im.n)}>
                      {active ? "Activo" : "Inactivo"}
                    </button>
                    <b className="impl-name">{im.n}</b>
                    <select value={im.kind} disabled={!canEditExtras} title="Cómo se usa su efecto" onChange={(e) => setImpl(i, { kind: e.target.value as ImplementKind })}>
                      {(Object.keys(IMPLEMENT_KIND_LABEL) as ImplementKind[]).map((k) => (
                        <option key={k} value={k}>
                          {IMPLEMENT_KIND_LABEL[k]}
                        </option>
                      ))}
                    </select>
                    {im.kind === "passive" ? (
                      <span className="muted small">Siempre activa</span>
                    ) : (
                      <button className="btn small-btn primary" disabled={!canEdit} onClick={() => useImpl(im.n, im.kind, im.note)}>
                        Usar
                      </button>
                    )}
                    {canEditExtras && (
                      <button className="row-x" title="Quitar implemento" onClick={() => setPrefs((p) => ({ ...p, implements: (p.implements ?? []).filter((_, j) => j !== i) }))}>
                        ✕
                      </button>
                    )}
                  </div>
                  <textarea
                    className="feat-notes"
                    placeholder={canEditExtras ? "Qué hace su efecto (se muestra al usarlo)…" : "Sin notas"}
                    defaultValue={im.note}
                    readOnly={!canEditExtras}
                    onBlur={(e) => setImpl(i, { note: e.target.value.trim() || undefined })}
                  />
                </div>
              );
            })}
            {canEditExtras && (
              <form
                className="cb-row"
                onSubmit={(e) => {
                  e.preventDefault();
                  const v = newImpl.trim();
                  if (!v) return;
                  const known = IMPLEMENTS.find((x) => x.n.toLowerCase() === v.toLowerCase());
                  setPrefs((p) => ({ ...p, implements: [...(p.implements ?? []), { n: known?.n ?? v, kind: known?.kind ?? "a1", note: known?.desc }] }));
                  setNewImpl("");
                }}
              >
                <input className="sm2" list="pf2-implements" placeholder="Nuevo implemento…" value={newImpl} onChange={(e) => setNewImpl(e.target.value)} />
                <datalist id="pf2-implements">
                  {IMPLEMENTS.map((x) => (
                    <option key={x.n} value={x.n} />
                  ))}
                </datalist>
                <button className="btn small-btn">+</button>
                <ColorPick k="occult" />
              </form>
            )}
          </>
        );
      case "prey":
        return (
          <>
            <div className="cb-row">
              <NpcPicker value={cls.prey} onChange={setPrey} placeholder="— Sin presa —" disabled={!canEdit} />
              <ColorPick k="prey" />
            </div>
            <div className="cb-row">
              <span className="muted small">Ventaja del cazador</span>
              <select
                value={edge ?? ""}
                disabled={!canEditExtras}
                onChange={(e) => {
                  const v = (e.target.value || undefined) as HunterEdge | undefined;
                  setPrefs((p) => ({ ...p, edge: v }));
                  patchCls((k) => ({ ...k, edge: v }));
                }}
              >
                <option value="">—</option>
                {(Object.keys(HUNTER_EDGE_LABEL) as HunterEdge[]).map((k) => (
                  <option key={k} value={k}>
                    {HUNTER_EDGE_LABEL[k]}
                  </option>
                ))}
              </select>
            </div>
            <p className="muted small">
              {edge === "flurry" && "Ráfaga: −3/−6 (−2/−4 con ágil) contra tu presa."}
              {edge === "precision" && "Precisión: +1d8 de precisión al primer ataque del turno contra tu presa (márcalo en Ataques)."}
              {edge === "outwit" && "Burlar: +2 a Engaño, Sigilo y Recordar conocimiento (en Habilidades) y +1 a la CA contra tu presa."}
              {edge === "vindication" && "Vindicación: +1 de estado a tus ataques de conjuro contra tu presa."}
            </p>
          </>
        );
      case "panache":
        return (
          <div className="cb-row">
            <button className={`btn ${cls.panache ? "on" : ""}`} disabled={!canEdit} onClick={togglePanache}>
              {cls.panache ? "Perder Panache" : "Ganar Panache"}
            </button>
            <span className="muted small">{f.vivacious ? `+${panacheSpeed(c.level)} ft con Panache` : ""}</span>
            <ColorPick k="panache" />
            <ColorPick k="finisher" />
          </div>
        );
      case "strat":
        return (
          <div className="cb-row">
            <NpcPicker value={cls.strat?.tok} onChange={devise} placeholder="Elegir PNJ y tirar d20" disabled={!canEdit} />
            {cls.strat && (
              <>
                <b className="strat-v">d20 = {cls.strat.v}</b>
                <button className="link-btn" onClick={() => patchCls((k) => ({ ...k, strat: undefined }))}>
                  Limpiar
                </button>
              </>
            )}
            <ColorPick k="lens" />
          </div>
        );
      case "taunt":
        return (
          <div className="cb-row">
            <NpcPicker value={cls.taunt} onChange={setTaunt} placeholder="— Nadie provocado —" disabled={!canEdit} />
            <span className="muted small">−1 a sus ataques y CD contra otros; si ataca a otro, queda desprevenido.</span>
            <ColorPick k="taunt" />
          </div>
        );
      case "od":
        return (
          <>
            <div className="cb-row">
              <button className="btn" disabled={!canEdit || (cls.odCd ?? 0) > 0} onClick={overdrive}>
                Intentar Sobrecarga (CD {levelDc(c.level)})
              </button>
              {(cls.odCd ?? 0) > 0 && <span className="muted small">No disponible por {cls.odCd} rondas</span>}
              <ColorPick k="overdrive" />
              <ColorPick k="explode" />
            </div>
            {cls.od && (
              <div className="cb-row">
                <span>
                  +{cls.od.b} al daño{cls.od.fire ? " de fuego" : ""}
                </span>
                <button className="link-btn" onClick={() => patchCls((k) => ({ ...k, od: undefined }))}>
                  Terminar
                </button>
                {cls.odCd ? (
                  <button className="link-btn" onClick={() => patchCls((k) => ({ ...k, odCd: undefined }))}>
                    Quitar espera
                  </button>
                ) : null}
              </div>
            )}
          </>
        );
      case "psyche":
        return (
          <div className="cb-row">
            <button className={`btn ${cls.psyche ? "on" : ""}`} disabled={!canEdit || (!cls.psyche && (state?.cond.stupefied ?? 0) > 0)} onClick={togglePsyche}>
              {cls.psyche ? `Psique desatada (${cls.psyche} rondas)` : "Desatar psique"}
            </button>
            <span className="muted small">
              {(state?.cond.stupefied ?? 0) > 0 && !cls.psyche ? "Estupefacto: no puede." : "Requiere haber lanzado un conjuro el turno anterior."}
            </span>
          </div>
        );
      case "spark": {
        const ikons = prefs.ikons ?? [];
        return (
          <>
            <div className="cb-row">
              {ikons.map((ik) => (
                <button key={ik} className={`chip ${cls.spark === ik ? "on" : ""}`} disabled={!canEdit} onClick={() => setSpark(ik)} title={cls.spark ? "Transferir la chispa" : "Inmanencia"}>
                  {ik}
                </button>
              ))}
              {!ikons.length && <span className="muted small">Agrega tus íconos abajo.</span>}
            </div>
            <ColorPick k="divine" />
            {cls.spark && (
              <div className="cb-row">
                <button className="btn small-btn" onClick={() => setSpark(undefined, true)}>
                  Trascender
                </button>
                <button className="btn ghost small-btn" onClick={() => setSpark(undefined)}>
                  Apagar chispa
                </button>
              </div>
            )}
            {canEditExtras && (
              <form
                className="cb-row"
                onSubmit={(e) => {
                  e.preventDefault();
                  const input = (e.target as HTMLFormElement).elements.namedItem("ikon") as HTMLInputElement;
                  const v = input.value.trim();
                  if (v) setPrefs((p) => ({ ...p, ikons: [...(p.ikons ?? []).filter((x) => x !== v), v] }));
                  input.value = "";
                }}
              >
                <input name="ikon" className="sm2" placeholder="Nuevo ícono…" />
                <button className="btn small-btn">+</button>
                {ikons.length > 0 && (
                  <select value="" onChange={(e) => e.target.value && setPrefs((p) => ({ ...p, ikons: (p.ikons ?? []).filter((x) => x !== e.target.value) }))}>
                    <option value="">Quitar ícono…</option>
                    {ikons.map((ik) => (
                      <option key={ik} value={ik}>
                        {ik}
                      </option>
                    ))}
                  </select>
                )}
              </form>
            )}
          </>
        );
      }
      case "curse":
        return (
          <div className="cb-row">
            <span>Cursebound</span>
            <button className="btn small-btn" disabled={!canEdit || !cls.curse} onClick={() => setCurse((cls.curse ?? 0) - 1)}>
              −
            </button>
            <b className="curse-v">{cls.curse ?? 0}</b>
            <button className="btn small-btn" disabled={!canEdit || (cls.curse ?? 0) >= 4} onClick={() => setCurse((cls.curse ?? 0) + 1)}>
              +
            </button>
          </div>
        );
      case "ss":
        return (
          <>
            <div className="cb-row">
              {cls.ss?.used ? (
                <button className="btn" disabled={!canEdit} onClick={() => patchCls((k) => ({ ...k, ss: undefined }))}>
                  Recargar Golpe de conjuro
                </button>
              ) : (
                <button className={`btn ${cls.ss?.armed ? "on" : ""}`} disabled={!canEdit} onClick={() => patchCls((k) => ({ ...k, ss: k.ss?.armed ? undefined : { armed: true } }))}>
                  {cls.ss?.armed ? "Cancelar" : "Activar Golpe de conjuro"}
                </button>
              )}
              {cls.ss?.armed && (
                <span className="muted small">
                  Esperando {cls.ss.spell ? "" : "conjuro"}
                  {!cls.ss.spell && !cls.ss.attack ? " y " : ""}
                  {cls.ss.attack ? "" : "ataque"}…
                </span>
              )}
            </div>
            <label className="te-check">
              <input type="checkbox" checked={prefs.ssSingle ?? true} disabled={!canEditExtras} onChange={(e) => setPrefs((p) => ({ ...p, ssSingle: e.target.checked }))} />
              Una sola tirada (el ataque del arma sirve para el conjuro)
            </label>
          </>
        );
      case "tactics": {
        const tactics = prefs.tactics ?? [];
        return (
          <div className="tactics">
            {Array.from({ length: f.tactics }, (_, i) => {
              const name = tactics[i] ?? "";
              return (
                <div key={i} className="cb-row">
                  <input
                    className="tactic-name"
                    defaultValue={name}
                    placeholder={`Táctica ${i + 1}`}
                    disabled={!canEditExtras}
                    onBlur={(e) =>
                      setPrefs((p) => {
                        const next = [...(p.tactics ?? [])];
                        next[i] = e.target.value.trim();
                        return { ...p, tactics: next };
                      })
                    }
                  />
                  <button className="btn small-btn" disabled={!name} onClick={() => useTactic(name)}>
                    Usar
                  </button>
                </div>
              );
            })}
            <ColorPick k="banner" />
          </div>
        );
      }
      case "invoke":
        return (
          <>
            {!activeRunes.length && <p className="muted small">No hay runas grabadas ni trazadas (se graban y trazan en la pestaña Magia).</p>}
            <div className="cb-row">
              {activeRunes.map((r) => (
                <button
                  key={r.id}
                  className={`chip ${invokeSel.includes(r.id) ? "on" : ""}`}
                  onClick={() => setInvokeSel((l) => (l.includes(r.id) ? l.filter((x) => x !== r.id) : l.length >= 2 ? [l[1], r.id] : [...l, r.id]))}
                >
                  {r.kind === "etched" ? "◆" : "◇"} {runeLabel(runes, r.k)}
                </button>
              ))}
            </div>
            <div className="cb-row">
              <button className="btn" disabled={!canEdit || !invokeSel.length} onClick={invoke}>
                Invocar ({invokeSel.length}/2)
              </button>
              <span className="muted small">
                Grabadas {Object.values(cls.etched ?? {}).reduce((a, b) => a + b, 0)}/{etchMax(c.level)}
              </span>
            </div>
          </>
        );
      case "aura":
        return (
          <div className="cb-row">
            <button className={`btn ${cls.aura ? "on" : ""}`} disabled={!canEdit || (!cls.aura && (state?.hp ?? 0) <= 0)} onClick={toggleAura}>
              {cls.aura ? "Apagar aura" : "Activar aura"}
            </button>
            <select
              value={prefs.element ?? f.elements[0] ?? "fire"}
              disabled={!canEditExtras}
              title="Elemento del aura y de los impulsos sin elemento propio"
              onChange={(e) => setPrefs((p) => ({ ...p, element: e.target.value }))}
            >
              {ELEMENTS.map((el) => (
                <option key={el.id} value={el.id}>
                  {el.label}
                </option>
              ))}
            </select>
            <ColorPick k={(prefs.element ?? f.elements[0] ?? "fire") as MagicDesign} />
            <span className="muted small">Los impulsos solo se pueden usar con el aura activa. Se apaga a 0 PG o con un impulso de desborde.</span>
          </div>
        );
      default:
        return null;
    }
  };

  const current = shown.find((b) => b.id === openPanel);
  return (
    <section className="class-bar">
      <div className="cb-title">Rasgos de clase</div>
      <div className={`cb-buttons ${shown.length === 1 ? "single" : ""}`}>
        {shown.map((b) => (
          <button
            key={b.id}
            className={`cb-btn ${b.on ? "on" : ""} ${openPanel === b.id ? "open" : ""} ${b.glow ? "glow" : ""}`}
            title={b.title ?? "Abrir el panel"}
            onClick={() => setOpen((o) => (o === b.id ? null : b.id))}
          >
            <span className="cb-icon" aria-hidden>
              {b.icon}
            </span>
            <span className="cb-text">
              <b>{b.label}</b>
              {b.sub && <small>{b.sub}</small>}
            </span>
            <span className="cb-caret" aria-hidden>
              {openPanel === b.id ? "▴" : "▾"}
            </span>
          </button>
        ))}
      </div>
      {current && (
        <div className="cb-panel">
          <div className="cb-panel-head">
            <span aria-hidden>{current.icon}</span> {current.label}
            <button className="link-btn" onClick={() => setOpen(null)}>
              Cerrar
            </button>
          </div>
          {panel()}
        </div>
      )}
    </section>
  );
}
