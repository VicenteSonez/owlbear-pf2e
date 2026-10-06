import { useState } from "react";
import OBR from "@owlbear-rodeo/sdk";
import { fmtMod, type SpellCaster } from "../../pathbuilder";
import { live, petStateId, useLiveStates, type Resources } from "../../live";
import { checkAdjust, modsText, stackMods, withBuff, type Mod } from "../../rules";
import { SAVE_LABEL } from "../../shared";
import type { ExtraSpell, SpellMeta } from "../../extras";
import { newId } from "../../shared";
import { inventoryRows, type InvRow } from "./InventoryPanel";
import { MAGIC_DESIGNS, defaultColor, traditionDesign, type MagicDesign } from "../../fx";
import { featuresOf, fontSlots, highestRank, type ClassState } from "../../classes";
import { useCombat } from "../../combat";
import { inOwlbear } from "../../obr";
import { useActions } from "../ctx";
import { NpcPicker, useNpcOptions } from "../NpcPicker";
import { spellstrikeStep } from "../classActions";
import { IconPips, PanelHead } from "./common";
import { IconFlame, IconSpark } from "./icons";
import { setIn, type SideProps } from "./types";
import { SpellRow, metaOf } from "./SpellRow";
import { DamageLauncher, setLastCast } from "./DamageLauncher";
import { RunesPanel } from "./RunesPanel";
import { FxColors } from "../FxColors";
import { ThrallLinker } from "./ThrallLinker";
import { selectedTokens, withThralls } from "../thralls";
import type { FxKind } from "../../fx";

const TYPE_LABEL: Record<string, string> = { prepared: "Preparado", spontaneous: "Espontáneo", focus: "Foco" };
const TRADITION: Record<string, string> = { arcane: "arcana", divine: "divina", occult: "ocultista", primal: "primigenia" };

const isPrepared = (k: SpellCaster) => k.type.toLowerCase() === "prepared";
const namesAt = (list: { rank: number; names: string[] }[] | undefined, rank: number) => list?.find((s) => s.rank === rank)?.names ?? [];
const norm = (s: string) => s.toLowerCase().replace(/[’']/g, "'").trim();

// De dónde sale el conjuro: decide qué recurso gasta
type Src =
  | { kind: "cantrip" }
  | { kind: "focus" }
  | { kind: "spont"; key: string; total: number }
  | { kind: "prep"; key: string; bit: number }
  | { kind: "font"; bit: number }
  | { kind: "impulse" }
  | { kind: "free" };

// Conjuros de foco que tienen automatización propia
type Special = "anthem" | "boost" | "thrall" | "charge" | null;
const specialOf = (name: string): Special => {
  const n = norm(name);
  if (n === "courageous anthem") return "anthem";
  if (n === "boost eidolon") return "boost";
  if (n === "create thrall") return "thrall";
  if (n === "thrall charge") return "charge";
  return null;
};
const SPECIAL_LABEL: Record<Exclude<Special, null>, string> = {
  anthem: "+1 de estado a ataque y daño de todos los aliados hasta tu próximo turno",
  boost: "+2 de estado al daño del eidolón por dado (máx. +8) hasta tu próximo turno",
  thrall: "Selecciona en el mapa los tokens que serán tus siervos",
  charge: "Un siervo suma 1d6 a su daño",
};

// Pergaminos del inventario: "Scroll of Fireball (Rank 3)" → conjuro y rango
const SCROLL_RE = /^scroll of\s+/i;
export const isScroll = (name: string) => SCROLL_RE.test(name.trim());
const scrollSpell = (name: string) => name.trim().replace(SCROLL_RE, "").replace(/\s*\(.*\)\s*$/, "").trim();
const scrollRankGuess = (name: string) => {
  const m = /(?:rank|level|rango|nivel)\s*(\d+)/i.exec(name) ?? /\((\d+)(?:st|nd|rd|th|º)?\)/i.exec(name);
  return m ? Math.max(1, Math.min(10, parseInt(m[1], 10))) : 1;
};

const BASE_IMPULSES: [string, SpellMeta][] = [
  ["Base Kinesis", { kind: "fx" }],
  ["Elemental Blast", { kind: "atk" }],
];

export function MagicPanel(props: SideProps) {
  const { character: c, state, extras, canEdit, canEditExtras, updateExtras, patch } = props;
  const { roll, notify, playFx } = useActions();
  const { states } = useLiveStates();
  const combat = useCombat();
  const npcs = useNpcOptions();
  const f = featuresOf(c);
  const [newRow, setNewRow] = useState<Record<string, string>>({});
  const [showColors, setShowColors] = useState(false);
  // Create Thrall lanzado sin tokens seleccionados: se ofrece vincularlos o crearlos
  const [thrallPrompt, setThrallPrompt] = useState(false);
  // Pergamino esperando confirmación (se consume al usarlo)
  const [confirmScroll, setConfirmScroll] = useState<string | null>(null);
  const [newScroll, setNewScroll] = useState({ n: "", rank: "1" });
  const [newSpell, setNewSpell] = useState({ n: "", rank: "1", uses: "1", caster: "" });
  const res: Resources = state?.res ?? {};
  const cls: ClassState = state?.cls ?? {};
  const prefs = extras.cls ?? {};
  const patchRes = (fn: (r: Resources) => Resources) => patch((s) => ({ ...s, res: fn(s.res ?? {}) }));
  const patchCls = (fn: (k: ClassState) => ClassState) => patch((s) => ({ ...s, cls: fn(s.cls ?? {}) }));
  const me = `pc:${c.id}`;

  // Trucos y conjuros de foco usan rango = mitad del nivel redondeado hacia arriba
  const autoRank = Math.ceil(c.level / 2);
  const casters = c.casters.filter((k) => k.type !== "focus");
  const focusCasters = c.casters.filter((k) => k.type === "focus");
  const focusCantrips = focusCasters.flatMap((fk) => namesAt(fk.spells, 0).map((n) => ({ n, k: fk })));
  const focusSpells = focusCasters.flatMap((fk) => namesAt(fk.spells, -1).map((n) => ({ n, k: fk })));
  const focusMax = c.focusMax ?? Math.min(3, focusSpells.length);
  const focusNow = Math.min(focusMax, res.focus ?? focusMax);

  const rename = (key: string, original: string) => (v: string) =>
    updateExtras((x) => ({ ...x, names: setIn(x.names, key, v && v !== original ? v : undefined) }));
  const nameOf = (key: string, original: string) => extras.names?.[key] ?? original;

  // Ataque y CD de un lanzador con condiciones (y Vindicación contra la presa)
  const target = npcs.find((n) => n.tok === state?.target);
  const statsOf = (k?: SpellCaster, impulse = false) => {
    // Sin lanzador (conjuro de un objeto en alguien que no lanza): la CD de clase
    const base = impulse ? c.impulse : k ? { attack: k.attack, dc: k.dc } : { attack: c.classDc - 10, dc: c.classDc };
    if (!base) return { attack: 0, dc: 10, notes: undefined as string | undefined };
    const ctxA = impulse ? ({ kind: "impulse-attack" } as const) : ({ kind: "spell-attack", target: target ? `npc:${target.tok}` : undefined } as const);
    const ctxD = impulse ? ({ kind: "impulse-dc" } as const) : ({ kind: "spell-dc" } as const);
    const extra: Mod[] = [];
    if ((cls.edge ?? prefs.edge ?? f.edge) === "vindication" && target && cls.prey === target.tok) extra.push({ label: "Vindicación", type: "status", value: 1 });
    const a = stackMods([...checkAdjust(state?.cond, ctxA).applied, ...extra]);
    const d = checkAdjust(state?.cond, ctxD);
    return { attack: base.attack + a.total, dc: base.dc + d.total, notes: modsText(a.applied) || undefined };
  };
  const mainCaster = casters[0] ?? focusCasters[0];
  const divineCaster = casters.find((k) => k.tradition.toLowerCase().startsWith("div")) ?? mainCaster;

  // ---------- Recursos ----------
  const available = (src: Src): boolean => {
    switch (src.kind) {
      case "focus":
        return focusNow > 0;
      case "spont":
        return (res.used?.[src.key] ?? 0) < src.total;
      case "prep":
        return ((res.used?.[src.key] ?? 0) & (1 << src.bit)) === 0;
      case "font":
        return ((res.used?.font ?? 0) & (1 << src.bit)) === 0;
      case "impulse":
        return !!cls.aura;
      default:
        return true;
    }
  };
  const consume = (src: Src, amp = false) => {
    patchRes((r) => {
      const used = { ...(r.used ?? {}) };
      let focus = r.focus;
      if (src.kind === "focus" || amp) focus = Math.max(0, (focus ?? focusMax) - 1);
      if (src.kind === "spont") used[src.key] = (used[src.key] ?? 0) + 1;
      if (src.kind === "prep") used[src.key] = (used[src.key] ?? 0) | (1 << src.bit);
      if (src.kind === "font") used.font = (used.font ?? 0) | (1 << src.bit);
      return { ...r, used, focus };
    });
  };

  // ---------- Efecto visual ----------
  const designFor = (name: string, meta: SpellMeta, src: Src, k?: SpellCaster): MagicDesign => {
    if (meta.fx) return meta.fx;
    const sp = specialOf(name);
    if (sp === "anthem") return "bardic";
    if (sp === "thrall") return prefs.thrallFx ?? "void";
    if (src.kind === "font") return norm(name) === "harm" ? "void" : "vital";
    if (src.kind === "impulse") return (meta.el ?? prefs.element ?? f.elements[0] ?? "fire") as MagicDesign;
    if (f.monk && (src.kind === "focus" || k?.type === "focus")) return "monk";
    return extras.magicFx?.design ?? traditionDesign(k?.tradition ?? mainCaster?.tradition ?? "arcane");
  };
  const colorFor = (d: MagicDesign) => prefs.colors?.[d] ?? extras.magicFx?.color ?? defaultColor(d);

  // ---------- Lanzar ----------
  // Devuelve si se intentó lanzar (aunque se pierda por Estupefacto)
  const cast = async (name: string, rank: number, src: Src, k: SpellCaster | undefined, o: { amp?: boolean; defaults?: SpellMeta; from?: string } = {}): Promise<boolean> => {
    if (!name || !canEdit || !available(src)) return false;
    const meta = metaOf(extras, name, o.defaults);
    const kind = meta.kind ?? "fx";
    const ampText = o.amp ? " (amplificado)" : "";
    const isImpulse = src.kind === "impulse";
    const stats = statsOf(k, isImpulse);

    // Estupefacto: prueba plana CD 5 + X o el conjuro se pierde (el recurso se gasta igual)
    const stup = state?.cond.stupefied ?? 0;
    if (stup > 0) {
      const flat = await roll({ label: `${name}: prueba de Estupefacto`, formula: "1d20", kind: "flat", flat: { dc: 5 + stup, label: "Estupefacto" } });
      if (!flat) return false;
      if (flat.degree !== "success") {
        consume(src, o.amp);
        await notify({ label: "Pierde el conjuro:", title: name, detail: `Estupefacto ${stup}: falló la prueba plana CD ${5 + stup}`, tag: "Conjuro perdido" });
        return true;
      }
    }
    consume(src, o.amp);

    const design = designFor(name, meta, src, k);
    playFx({ kind: design, from: me, color: colorFor(design) });
    const sp = specialOf(name);
    const eidolonIdx = (c.pets ?? []).findIndex((p) => /eidolon/i.test(p.type));
    if (sp === "boost" && eidolonIdx >= 0) playFx({ kind: design, from: `pc:${petStateId(c.id, eidolonIdx)}`, color: colorFor(design) });

    const ssSingle = !!cls.ss?.armed && (prefs.ssSingle ?? true);
    const detail = [
      o.from ?? "",
      isImpulse ? `Nivel ${c.level}` : rank > 0 ? `Rango ${rank}` : "Truco",
      kind === "save" ? `Salvación de ${SAVE_LABEL[meta.save ?? "reflex"]}${meta.basic ? " básica" : ""} · CD ${stats.dc}` : kind === "atk" ? (ssSingle ? "Ataque con el Golpe de conjuro" : "Ataque") : "Efecto",
      meta.blood && f.bloodMagic ? "🩸 Magia de sangre" : "",
      isImpulse && meta.junction && f.gate === "single" ? "Unión de impulso" : "",
      isImpulse && meta.overflow ? "Desborde: el aura se apaga" : "",
      sp ? SPECIAL_LABEL[sp] : "",
    ]
      .filter(Boolean)
      .join(" · ");
    let degree;
    if (kind === "atk" && !ssSingle) {
      const r = await roll({
        label: "Lanza (ataque de conjuro)",
        title: `${name}${ampText}`,
        formula: `1d20${fmtMod(stats.attack)}`,
        kind: "check",
        notes: [detail, stats.notes].filter(Boolean).join(" · ") || undefined,
        vs: target ? { dc: target.ac, name: target.name } : undefined,
        tag: "Conjuro",
      });
      degree = r?.degree;
    } else {
      await notify({ label: o.from ? `Lanza desde ${o.from.toLowerCase()}` : "Lanza", title: `${name}${ampText}`, detail, tag: "Conjuro" });
    }
    setLastCast(c.id, {
      name: `${name}${ampText}`,
      rank: isImpulse ? c.level : rank > 0 ? rank : autoRank,
      slot: src.kind === "spont" || src.kind === "prep" || src.kind === "font",
      degree,
      dmg: meta.dmg,
      ty: meta.ty,
      heal: meta.heal || src.kind === "font" && norm(name) === "heal",
      t: Date.now(),
    });

    // Rasgos de clase que reaccionan al lanzar
    patchCls((x) => ({
      ...x,
      castR: combat.active ? combat.round : x.castR,
      aura: isImpulse && meta.overflow ? undefined : x.aura,
      boost: sp === "boost" ? true : x.boost,
    }));
    spellstrikeStep(state, patch, notify, playFx, { spell: name }, { kind: design, from: me, color: colorFor(design) });
    if (sp === "anthem") {
      for (const s of Object.values(live.all())) {
        await live.patch(s.id, (x) => ({
          ...x,
          cond: withBuff(x.cond, { id: "anthem", n: "Himno valeroso", ty: "status", atk: 1, dmg: 1, fear: 1, icon: "anthem", until: { key: me, at: "start" } }),
        }));
      }
    }
    if (sp === "thrall") await createThralls(design);
    if (sp === "charge") await chargeThrall();
    return true;
  };

  // ---------- Pergaminos ----------
  const scrolls = inventoryRows(c, extras)
    .map((r) => ({ ...r, name: extras.names?.[r.key] ?? r.name, qty: extras.qty?.[r.key] ?? r.qty }))
    .filter((r) => isScroll(r.name) && r.qty > 0);
  const scrollRank = (r: InvRow) => extras.srank?.[r.key] ?? scrollRankGuess(r.name);
  // Usar un pergamino lo gasta: baja la cantidad o lo quita del inventario
  const consumeScroll = (r: InvRow) =>
    updateExtras((x) => {
      const qty = (x.qty?.[r.key] ?? r.qty) - 1;
      if (qty > 0) return { ...x, qty: setIn(x.qty, r.key, qty) };
      if (r.added) return { ...x, added: (x.added ?? []).filter((a) => a.key !== r.key), qty: setIn(x.qty, r.key, undefined), srank: setIn(x.srank, r.key, undefined) };
      return { ...x, gone: setIn(x.gone, r.key, true), qty: setIn(x.qty, r.key, undefined) };
    });
  const useScroll = async (r: InvRow) => {
    setConfirmScroll(null);
    const ok = await cast(scrollSpell(r.name), scrollRank(r), { kind: "free" }, mainCaster, { from: "Pergamino" });
    if (ok) consumeScroll(r);
  };

  // ---------- Conjuros agregados a mano ----------
  const xspells = extras.xspells ?? [];
  const xCaster = (x: ExtraSpell) => c.casters.find((k) => k.name === x.caster) ?? mainCaster;
  const xSrc = (x: ExtraSpell): Src => (x.uses > 0 ? { kind: "spont", key: `x:${x.id}`, total: x.uses } : { kind: "free" });

  // Nigromante: los tokens seleccionados pasan a ser siervos; si no hay, se ofrece elegirlos o crearlos
  const thrallMax = f.puppeteer ? 3 : 2;
  const createThralls = async (design: MagicDesign) => {
    if (!inOwlbear) return;
    const ids = (await selectedTokens()).filter((id) => id !== state?.target).slice(0, thrallMax);
    if (!ids.length) {
      setThrallPrompt(true);
      return;
    }
    patchCls((x) => withThralls(x, ids, thrallMax));
    for (const tok of ids) playFx({ kind: design, from: tok, color: colorFor(design) });
  };
  const chargeThrall = async () => {
    const list = cls.thralls ?? [];
    if (!list.length) return;
    let sel: string[] = [];
    if (inOwlbear) sel = (await OBR.player.getSelection()) ?? [];
    const tok = list.find((t) => sel.includes(t.tok))?.tok ?? list.find((t) => !t.ch)?.tok ?? list[0].tok;
    patchCls((x) => ({ ...x, thralls: (x.thralls ?? []).map((t) => (t.tok === tok ? { ...t, ch: true } : t)) }));
  };

  // ---------- Filas ----------
  const castBtn = (name: string, rank: number, src: Src, k?: SpellCaster, o: { amp?: boolean; defaults?: SpellMeta; label?: string } = {}) => (
    <button
      className={`btn small-btn cast-btn ${o.amp ? "amp" : ""}`}
      disabled={!canEdit || !name || !available(src) || (o.amp && focusNow <= 0)}
      title={!available(src) ? (src.kind === "impulse" ? "Activa tu aura cinética" : "Sin recursos") : undefined}
      onClick={() => cast(name, rank, src, k, o)}
    >
      {o.label ?? "Lanzar"}
    </button>
  );

  const addRow = (group: string) => {
    const v = (newRow[group] ?? "").trim();
    if (!v) return;
    updateExtras((x) => ({ ...x, addedSpells: { ...x.addedSpells, [group]: [...(x.addedSpells?.[group] ?? []), v] } }));
    setNewRow((m) => ({ ...m, [group]: "" }));
  };
  const removeAdded = (group: string, i: number) =>
    updateExtras((x) => ({ ...x, addedSpells: { ...x.addedSpells, [group]: (x.addedSpells?.[group] ?? []).filter((_, j) => j !== i) } }));
  // Función (no componente) para que el campo no pierda el foco al escribir
  const addRowEl = (group: string) =>
    canEditExtras ? (
      <form
        className="add-row slim"
        onSubmit={(e) => {
          e.preventDefault();
          addRow(group);
        }}
      >
        <input placeholder="+ Agregar conjuro…" value={newRow[group] ?? ""} onChange={(e) => setNewRow((m) => ({ ...m, [group]: e.target.value }))} />
      </form>
    ) : null;
  const added = (group: string) => extras.addedSpells?.[group] ?? [];
  const rowProps = { extras, canEditExtras, updateExtras };

  const signatures = (k: SpellCaster) => extras.signature?.[k.name] ?? [];
  const toggleSig = (k: SpellCaster, name: string) =>
    updateExtras((x) => {
      const cur = x.signature?.[k.name] ?? [];
      const next = cur.includes(name) ? cur.filter((n) => n !== name) : [...cur, name];
      return { ...x, signature: { ...x.signature, [k.name]: next } };
    });

  const noCasting = !c.casters.length && !f.kinetic && !f.runes;

  // Trucos de todos los lanzadores (preparados o del repertorio) + trucos de foco
  const cantrips = casters.flatMap((k) => {
    const list = isPrepared(k) && namesAt(k.prepared, 0).length ? namesAt(k.prepared, 0) : namesAt(k.spells, 0);
    return list.map((name, i) => ({ key: `ct:${k.name}:${i}`, name, k, focus: false }));
  });
  cantrips.push(...focusCantrips.map((x, i) => ({ key: `fct:${i}`, name: x.n, k: x.k, focus: true })));

  // Impulsos del kineticista
  const impulseNames = f.kinetic
    ? [...new Set([...BASE_IMPULSES.map(([n]) => n), ...(c.feats ?? []).filter((ft) => /impulse/i.test(ft.type)).map((ft) => ft.name), ...(prefs.impulses ?? [])])]
    : [];
  const featChoices = (c.feats ?? []).filter((ft) => /class/i.test(ft.type) && !impulseNames.includes(ft.name)).map((ft) => ft.name);

  const fontRank = highestRank(c.level);
  const fontChoice = (i: number): "heal" | "harm" => (f.versatileFont ? (prefs.fontChoice?.[i] ?? f.font ?? "heal") : (f.font ?? "heal"));

  return (
    <div className="side-panel">
      <PanelHead title="Libro de conjuros">
        <button
          className="btn ghost small-btn"
          disabled={!canEdit}
          title="Recupera todos los espacios de conjuro y los puntos de foco"
          onClick={() => patchRes((r) => ({ ...r, used: undefined, focus: undefined }))}
        >
          ↻ Restaurar
        </button>
      </PanelHead>

      <div className="magic-cfg">
        <span className="muted small">Efecto</span>
        <select
          value={extras.magicFx?.design ?? ""}
          disabled={!canEditExtras}
          onChange={(e) => updateExtras((x) => ({ ...x, magicFx: { ...x.magicFx, design: (e.target.value || undefined) as MagicDesign | undefined } }))}
        >
          <option value="">Según la tradición</option>
          {MAGIC_DESIGNS.map((d) => (
            <option key={d.id} value={d.id}>
              {d.label}
            </option>
          ))}
        </select>
        <label className="fx-color" title="Color de tus efectos de magia">
          🎨
          <input
            type="color"
            value={extras.magicFx?.color ?? defaultColor(extras.magicFx?.design ?? traditionDesign(mainCaster?.tradition ?? "arcane"))}
            disabled={!canEditExtras}
            onChange={(e) => updateExtras((x) => ({ ...x, magicFx: { ...x.magicFx, color: e.target.value } }))}
          />
        </label>
        {extras.magicFx?.color && canEditExtras && (
          <button className="link-btn" onClick={() => updateExtras((x) => ({ ...x, magicFx: { ...x.magicFx, color: undefined } }))}>
            color original
          </button>
        )}
        <button className={`link-btn ${showColors ? "on" : ""}`} onClick={() => setShowColors((v) => !v)} title="Color de cada efecto de clase">
          colores…
        </button>
        <span className="muted small target-hint">Objetivo</span>
        <NpcPicker value={state?.target} onChange={(tok) => patch((s) => ({ ...s, target: tok }))} placeholder="— Sin objetivo —" disabled={!canEdit} />
      </div>

      {showColors && (
        <FxColors
          kinds={
            [
              ...(f.anthem ? ["bardic"] : []),
              ...(f.font ? ["vital", "void"] : []),
              ...(f.monk ? ["monk"] : []),
              ...(f.runes ? ["arcane"] : []),
              ...(f.thrall ? ["void", "spirit"] : []),
              ...(f.spark ? ["divine"] : []),
              ...(f.kinetic ? ["fire", "water", "air", "earth", "metal", "wood"] : []),
            ].filter((k, i, arr) => arr.indexOf(k) === i) as FxKind[]
          }
          extras={extras}
          canEdit={canEditExtras}
          updateExtras={updateExtras}
        />
      )}

      {[...casters, ...focusCasters].map((k) => {
        const a = statsOf(k);
        return (
          <div key={k.name} className="book-stat">
            <b>{k.name}</b>
            <span className="muted small">
              {TRADITION[k.tradition] ?? k.tradition} · {k.innate ? "Innato" : (TYPE_LABEL[k.type.toLowerCase()] ?? k.type)}
            </span>
            <button
              className="btn small-btn"
              title={a.notes}
              onClick={() =>
                roll({ label: `${k.name}: Ataque de conjuro`, formula: `1d20${fmtMod(a.attack)}`, kind: "check", notes: a.notes, vs: target ? { dc: target.ac, name: target.name } : undefined, fx: { kind: "spell" } })
              }
            >
              Ataque {fmtMod(a.attack)}
            </button>
            <span className="dc">CD {a.dc}</span>
          </div>
        );
      })}

      {thrallPrompt && f.thrall && (
        <ThrallLinker
          {...props}
          max={thrallMax}
          color={colorFor(prefs.thrallFx ?? "void")}
          prompt
          onDone={() => setThrallPrompt(false)}
        />
      )}

      {noCasting && <p className="muted small">Este personaje no lanza conjuros de clase: aquí están sus pergaminos y los conjuros que agregue (de objetos, dotes…), con su CD de clase.</p>}

      <DamageLauncher c={c} state={state} states={states} />

      {cantrips.length > 0 && (
        <section className="spell-group">
          <h3>
            Trucos <span className="rank-tag">Rango {autoRank}</span>
          </h3>
          {cantrips.map((s) => {
            const name = nameOf(s.key, s.name);
            const sp = specialOf(name);
            const special = s.focus && (sp || f.psychic);
            return (
              <SpellRow
                key={s.key}
                {...rowProps}
                name={name}
                className={`${s.focus ? "focus-cantrip" : ""} ${special ? "special" : ""}`}
                onRename={rename(s.key, s.name)}
                lead={s.focus ? <span className="focus-mark" title="Truco de foco">✦</span> : undefined}
                actions={
                  <>
                    {castBtn(name, 0, { kind: "cantrip" }, s.k)}
                    {s.focus && f.psychic && castBtn(name, 0, { kind: "cantrip" }, s.k, { amp: true, label: "Amplificar" })}
                  </>
                }
              />
            );
          })}
          {cantrips.some((s) => s.focus && specialOf(nameOf(s.key, s.name))) && (
            <p className="muted small special-note">
              {cantrips
                .map((s) => specialOf(nameOf(s.key, s.name)))
                .filter((x, i, arr): x is Exclude<Special, null> => !!x && arr.indexOf(x) === i)
                .map((x) => SPECIAL_LABEL[x])
                .join(" · ")}
            </p>
          )}
        </section>
      )}

      {f.font && (
        <section className="spell-group font">
          <h3>
            Fuente divina <span className="rank-tag">Rango {fontRank}</span>
          </h3>
          {Array.from({ length: fontSlots(c.level) }, (_, i) => {
            const choice = fontChoice(i);
            const name = choice === "harm" ? "Harm" : "Heal";
            const used = ((res.used?.font ?? 0) & (1 << i)) !== 0;
            return (
              <SpellRow
                key={i}
                {...rowProps}
                name={name}
                className={`font-slot ${used ? "used" : ""}`}
                defaults={{ kind: "fx", heal: choice === "heal" }}
                lead={
                  <button
                    className={`cast ${used ? "on" : ""}`}
                    disabled={!canEdit}
                    title={used ? "Usado (clic para recuperar)" : "Marcar como usado"}
                    onClick={() => patchRes((r) => ({ ...r, used: setIn(r.used, "font", ((r.used?.font ?? 0) ^ (1 << i)) || undefined) }))}
                  >
                    {used ? "✓" : ""}
                  </button>
                }
                actions={
                  <>
                    {f.versatileFont && (
                      <select
                        className="fx-select"
                        value={choice}
                        disabled={!canEditExtras}
                        onChange={(e) =>
                          updateExtras((x) => {
                            const list = [...(x.cls?.fontChoice ?? [])];
                            list[i] = e.target.value as "heal" | "harm";
                            return { ...x, cls: { ...x.cls, fontChoice: list } };
                          })
                        }
                      >
                        <option value="heal">Heal</option>
                        <option value="harm">Harm</option>
                      </select>
                    )}
                    {castBtn(name, fontRank, { kind: "font", bit: i }, divineCaster)}
                  </>
                }
              />
            );
          })}
        </section>
      )}

      {casters.map((k) =>
        (k.perDay ?? []).map((slots, rank) => {
          if (rank === 0) return null;
          const prepared = isPrepared(k);
          const group = `${prepared ? "sp" : "rep"}:${k.name}:${rank}`;
          const extra = added(group);
          const listed = prepared ? namesAt(k.prepared, rank) : namesAt(k.spells, rank);
          const total = prepared ? Math.max(slots, listed.length + extra.length) : slots;
          const sigHere = !prepared
            ? signatures(k).filter((n) => {
                const base = k.spells.find((s) => s.names.includes(n))?.rank ?? 99;
                return base < rank && !listed.includes(n);
              })
            : [];
          if (!total && !listed.length && !extra.length) return null;
          const usedKey = `${k.name}:${rank}`;
          const used = res.used?.[usedKey] ?? 0;
          const spont: Src = { kind: "spont", key: usedKey, total };
          const canSig = !prepared && c.level >= 3;
          return (
            <section key={`${k.name}-${rank}`} className="spell-group">
              <h3>
                Rango {rank}
                {casters.length > 1 && <span className="muted small"> · {k.name}</span>}
                {!prepared && total > 0 && (
                  <IconPips
                    value={Math.max(0, total - used)}
                    max={total}
                    icon={<IconSpark size={15} />}
                    label="Espacios disponibles"
                    canEdit={canEdit}
                    onChange={(v) => patchRes((r) => ({ ...r, used: setIn(r.used, usedKey, total - v || undefined) }))}
                  />
                )}
              </h3>
              {prepared
                ? Array.from({ length: total }, (_, i) => {
                    const key = `sp:${k.name}:${rank}:${i}`;
                    const isUsed = (used & (1 << i)) !== 0;
                    const original = listed[i] ?? extra[i - listed.length] ?? "";
                    const name = nameOf(key, original);
                    return (
                      <SpellRow
                        key={key}
                        {...rowProps}
                        name={name}
                        placeholder="Espacio vacío"
                        className={isUsed ? "used" : ""}
                        onRename={rename(key, original)}
                        blood={f.bloodMagic}
                        lead={
                          <button
                            className={`cast ${isUsed ? "on" : ""}`}
                            disabled={!canEdit}
                            title={isUsed ? "Usado (clic para recuperar)" : "Marcar como lanzado"}
                            onClick={() => patchRes((r) => ({ ...r, used: setIn(r.used, usedKey, (used ^ (1 << i)) || undefined) }))}
                          >
                            {isUsed ? "✓" : ""}
                          </button>
                        }
                        actions={castBtn(name, rank, { kind: "prep", key: usedKey, bit: i }, k)}
                      />
                    );
                  })
                : [
                    ...listed.map((original, i) => {
                      const key = `rep:${k.name}:${rank}:${i}`;
                      const name = nameOf(key, original);
                      return (
                        <SpellRow
                          key={key}
                          {...rowProps}
                          name={name}
                          onRename={rename(key, original)}
                          blood={f.bloodMagic}
                          signature={canSig ? { on: signatures(k).includes(original), toggle: () => toggleSig(k, original) } : undefined}
                          actions={castBtn(name, rank, spont, k)}
                        />
                      );
                    }),
                    ...extra.map((name, i) => (
                      <SpellRow
                        key={`add:${group}:${i}`}
                        {...rowProps}
                        name={name}
                        blood={f.bloodMagic}
                        signature={canSig ? { on: signatures(k).includes(name), toggle: () => toggleSig(k, name) } : undefined}
                        onRemove={() => removeAdded(group, i)}
                        actions={castBtn(name, rank, spont, k)}
                      />
                    )),
                    ...sigHere.map((name) => (
                      <SpellRow
                        key={`sig:${group}:${name}`}
                        {...rowProps}
                        name={name}
                        className="signature"
                        lead={<span className="sig-mark" title="Conjuro distintivo, potenciado a este rango">✦ Distintivo</span>}
                        actions={castBtn(name, rank, spont, k)}
                      />
                    )),
                  ]}
              {addRowEl(group)}
            </section>
          );
        }),
      )}

      {(focusSpells.length > 0 || focusMax > 0) && (
        <section className="spell-group focus">
          <h3>
            Conjuros de foco <span className="rank-tag">Rango {autoRank}</span>
            <IconPips
              value={focusNow}
              max={Math.max(1, focusMax)}
              icon={<IconFlame size={16} />}
              label="Puntos de foco"
              canEdit={canEdit}
              onChange={(v) => patchRes((r) => ({ ...r, focus: v === focusMax ? undefined : v }))}
            />
          </h3>
          {focusSpells.map((x, i) => {
            const key = `foc:${i}`;
            const name = nameOf(key, x.n);
            const sp = specialOf(name);
            return (
              <SpellRow
                key={key}
                {...rowProps}
                name={name}
                className={sp ? "special" : ""}
                onRename={rename(key, x.n)}
                blood={f.bloodMagic}
                actions={castBtn(name, autoRank, { kind: "focus" }, x.k)}
              />
            );
          })}
          {added("focus").map((name, i) => (
            <SpellRow key={`addf:${i}`} {...rowProps} name={name} blood={f.bloodMagic} onRemove={() => removeAdded("focus", i)} actions={castBtn(name, autoRank, { kind: "focus" }, focusCasters[0])} />
          ))}
          {addRowEl("focus")}
        </section>
      )}

      {f.kinetic && (
        <section className="spell-group impulses">
          <h3>
            Impulsos <span className="rank-tag">Nivel {c.level}</span>
            <span className={`badge ${cls.aura ? "" : "bad"}`}>{cls.aura ? "Aura activa" : "Aura apagada"}</span>
          </h3>
          {(() => {
            const a = statsOf(undefined, true);
            return (
              <div className="book-stat">
                <b>Impulsos</b>
                <span className="muted small">Constitución</span>
                <span className="dc">Ataque {fmtMod(a.attack)}</span>
                <span className="dc">CD {a.dc}</span>
              </div>
            );
          })()}
          {impulseNames.map((name) => {
            const defaults = BASE_IMPULSES.find(([n]) => n === name)?.[1];
            const manual = (prefs.impulses ?? []).includes(name);
            return (
              <SpellRow
                key={name}
                {...rowProps}
                name={name}
                impulse
                defaults={defaults}
                className="special"
                onRemove={manual ? () => updateExtras((x) => ({ ...x, cls: { ...x.cls, impulses: (x.cls?.impulses ?? []).filter((n) => n !== name) } })) : undefined}
                actions={castBtn(name, c.level, { kind: "impulse" }, undefined)}
              />
            );
          })}
          {canEditExtras && (
            <form
              className="add-row slim"
              onSubmit={(e) => {
                e.preventDefault();
                const v = (newRow.impulse ?? "").trim();
                if (!v) return;
                updateExtras((x) => ({ ...x, cls: { ...x.cls, impulses: [...(x.cls?.impulses ?? []).filter((n) => n !== v), v] } }));
                setNewRow((m) => ({ ...m, impulse: "" }));
              }}
            >
              <input list="pf2-impulse-feats" placeholder="+ Agregar impulso…" value={newRow.impulse ?? ""} onChange={(e) => setNewRow((m) => ({ ...m, impulse: e.target.value }))} />
              <datalist id="pf2-impulse-feats">
                {featChoices.map((n) => (
                  <option key={n} value={n} />
                ))}
              </datalist>
            </form>
          )}
        </section>
      )}

      <section className="spell-group scrolls">
        <h3>
          Pergaminos <span className="rank-tag">del inventario</span>
        </h3>
        {!scrolls.length && <p className="muted small">Los objetos “Scroll of…” del inventario aparecen aquí.</p>}
        {scrolls.map((r) => {
          const spell = scrollSpell(r.name);
          const rank = scrollRank(r);
          return (
            <div key={r.key}>
              <SpellRow
                {...rowProps}
                name={spell}
                className="scroll"
                lead={<span className="scroll-mark" title={r.name}>📜</span>}
                actions={
                  <>
                    <select
                      className="rank-select"
                      value={rank}
                      disabled={!canEditExtras}
                      title="Rango del conjuro del pergamino"
                      onChange={(e) => {
                        const v = parseInt(e.target.value, 10);
                        updateExtras((x) => ({ ...x, srank: setIn(x.srank, r.key, v) }));
                      }}
                    >
                      {Array.from({ length: 10 }, (_, i) => (
                        <option key={i + 1} value={i + 1}>
                          R{i + 1}
                        </option>
                      ))}
                    </select>
                    {r.qty > 1 && <span className="badge">×{r.qty}</span>}
                    <button className="btn small-btn cast-btn" disabled={!canEdit} onClick={() => setConfirmScroll(r.key)}>
                      Usar
                    </button>
                  </>
                }
              />
              {confirmScroll === r.key && (
                <div className="confirm-row">
                  <span>
                    ¿Usar <b>{spell}</b>? El pergamino se consume{r.qty > 1 ? ` (quedan ${r.qty - 1})` : " y sale del inventario"}.
                  </span>
                  <button className="btn small-btn danger" onClick={() => useScroll(r)}>
                    Sí, usar
                  </button>
                  <button className="btn small-btn ghost" onClick={() => setConfirmScroll(null)}>
                    No
                  </button>
                </div>
              )}
            </div>
          );
        })}
        {canEditExtras && (
          <form
            className="add-row slim"
            onSubmit={(e) => {
              e.preventDefault();
              const n = newScroll.n.trim();
              if (!n) return;
              const key = `inv+${Date.now().toString(36)}`;
              const rank = parseInt(newScroll.rank, 10) || 1;
              updateExtras((x) => ({ ...x, added: [...(x.added ?? []), { key, list: "inv", name: `Scroll of ${n}` }], srank: setIn(x.srank, key, rank) }));
              setNewScroll({ n: "", rank: "1" });
            }}
          >
            <input placeholder="+ Agregar pergamino (conjuro)…" value={newScroll.n} onChange={(e) => setNewScroll((v) => ({ ...v, n: e.target.value }))} />
            <select value={newScroll.rank} title="Rango" onChange={(e) => setNewScroll((v) => ({ ...v, rank: e.target.value }))}>
              {Array.from({ length: 10 }, (_, i) => (
                <option key={i + 1} value={i + 1}>
                  R{i + 1}
                </option>
              ))}
            </select>
            <button className="btn small-btn" disabled={!newScroll.n.trim()}>
              +
            </button>
          </form>
        )}
      </section>

      <section className="spell-group extra-spells">
        <h3>
          Conjuros adicionales <span className="rank-tag">innatos, de objetos…</span>
        </h3>
        {!xspells.length && <p className="muted small">Conjuros que no vienen en Pathbuilder (de un objeto, una dote…). Se lanzan con el ataque y la CD del lanzador que elijas.</p>}
        {xspells.map((x) => {
          const src = xSrc(x);
          const k = xCaster(x);
          const usedN = res.used?.[`x:${x.id}`] ?? 0;
          return (
            <SpellRow
              key={x.id}
              {...rowProps}
              name={x.n}
              className="extra-spell"
              onRemove={() => updateExtras((e) => ({ ...e, xspells: (e.xspells ?? []).filter((y) => y.id !== x.id) }))}
              lead={<span className="rank-tag">{x.rank ? `R${x.rank}` : "Truco"}</span>}
              actions={
                <>
                  {x.uses > 0 ? (
                    <IconPips
                      value={Math.max(0, x.uses - usedN)}
                      max={x.uses}
                      icon={<IconSpark size={13} />}
                      label="Usos disponibles"
                      canEdit={canEdit}
                      onChange={(v) => patchRes((r) => ({ ...r, used: setIn(r.used, `x:${x.id}`, x.uses - v || undefined) }))}
                    />
                  ) : (
                    <span className="muted small" title="Sin límite de usos">a voluntad</span>
                  )}
                  {castBtn(x.n, x.rank, src, k)}
                </>
              }
            />
          );
        })}
        {canEditExtras && (
          <form
            className="add-row slim xs-form"
            onSubmit={(e) => {
              e.preventDefault();
              const n = newSpell.n.trim();
              if (!n) return;
              const spell: ExtraSpell = {
                id: newId(),
                n,
                rank: Math.max(0, Math.min(10, parseInt(newSpell.rank, 10) || 0)),
                uses: Math.max(0, Math.min(9, parseInt(newSpell.uses, 10) || 0)),
                caster: newSpell.caster || undefined,
              };
              updateExtras((x) => ({ ...x, xspells: [...(x.xspells ?? []), spell] }));
              setNewSpell({ n: "", rank: "1", uses: "1", caster: newSpell.caster });
            }}
          >
            <input placeholder="+ Agregar conjuro…" value={newSpell.n} onChange={(e) => setNewSpell((v) => ({ ...v, n: e.target.value }))} />
            <select value={newSpell.rank} title="Rango (0 = truco)" onChange={(e) => setNewSpell((v) => ({ ...v, rank: e.target.value }))}>
              {Array.from({ length: 11 }, (_, i) => (
                <option key={i} value={i}>
                  {i ? `R${i}` : "Truco"}
                </option>
              ))}
            </select>
            <select value={newSpell.uses} title="Usos por día" onChange={(e) => setNewSpell((v) => ({ ...v, uses: e.target.value }))}>
              <option value="0">A voluntad</option>
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>
                  {n}/día
                </option>
              ))}
            </select>
            {c.casters.length > 0 && (
              <select value={newSpell.caster} title="Ataque y CD de" onChange={(e) => setNewSpell((v) => ({ ...v, caster: e.target.value }))}>
                <option value="">{mainCaster?.name ?? "Principal"}</option>
                {c.casters.filter((k) => k !== mainCaster).map((k) => (
                  <option key={k.name} value={k.name}>
                    {k.name}
                  </option>
                ))}
              </select>
            )}
            <button className="btn small-btn" disabled={!newSpell.n.trim()}>
              +
            </button>
          </form>
        )}
      </section>

      {f.runes && <RunesPanel c={c} state={state} extras={extras} canEdit={canEdit} canEditExtras={canEditExtras} updateExtras={updateExtras} patch={patch} />}
    </div>
  );
}
