import { useState } from "react";
import OBR from "@owlbear-rodeo/sdk";
import { fmtMod, type SpellCaster } from "../../pathbuilder";
import { live, petStateId, useLiveStates, type Resources } from "../../live";
import { checkAdjust, modsText, stackMods, withBuff, type Mod } from "../../rules";
import { SAVE_LABEL } from "../../shared";
import type { SpellMeta } from "../../extras";
import { MAGIC_DESIGNS, defaultColor, traditionDesign, type MagicDesign } from "../../fx";
import { featuresOf, fontSlots, highestRank, type ClassState } from "../../classes";
import { useCombat } from "../../combat";
import { inOwlbear } from "../../obr";
import { store } from "../../storage";
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
    const base = impulse ? c.impulse : k ? { attack: k.attack, dc: k.dc } : undefined;
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
  const cast = async (name: string, rank: number, src: Src, k: SpellCaster | undefined, o: { amp?: boolean; defaults?: SpellMeta } = {}) => {
    if (!name || !canEdit || !available(src)) return;
    const meta = metaOf(extras, name, o.defaults);
    const kind = meta.kind ?? "fx";
    const ampText = o.amp ? " (amplificado)" : "";
    const isImpulse = src.kind === "impulse";
    const stats = statsOf(k, isImpulse);

    // Estupefacto: prueba plana CD 5 + X o el conjuro se pierde (el recurso se gasta igual)
    const stup = state?.cond.stupefied ?? 0;
    if (stup > 0) {
      const flat = await roll({ label: `${name}: prueba de Estupefacto`, formula: "1d20", kind: "flat", flat: { dc: 5 + stup, label: "Estupefacto" } });
      if (!flat) return;
      if (flat.degree !== "success") {
        consume(src, o.amp);
        await notify({ label: `${c.name} pierde ${name}`, detail: `Estupefacto ${stup}: falló la prueba plana CD ${5 + stup}`, tag: "Conjuro perdido" });
        return;
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
        label: `${c.name} lanza ${name}${ampText}`,
        formula: `1d20${fmtMod(stats.attack)}`,
        kind: "check",
        notes: [detail, stats.notes].filter(Boolean).join(" · ") || undefined,
        vs: target ? { dc: target.ac, name: target.name } : undefined,
        tag: "Conjuro",
      });
      degree = r?.degree;
    } else {
      await notify({ label: `${c.name} lanza ${name}${ampText}`, detail, tag: "Conjuro" });
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
  };

  // Nigromante: los tokens seleccionados pasan a ser siervos
  const createThralls = async (design: MagicDesign) => {
    if (!inOwlbear) return;
    const max = f.puppeteer ? 3 : 2;
    let ids = (await OBR.player.getSelection()) ?? [];
    const last = store.lastSelection();
    if (!ids.length && last && Date.now() - last.t < 120_000) ids = last.ids;
    ids = ids.slice(0, max);
    if (!ids.length) {
      OBR.notification.show(`Selecciona hasta ${max} tokens en el mapa para que sean tus siervos y vuelve a lanzar.`, "INFO");
      return;
    }
    patchCls((x) => ({ ...x, thralls: [...(x.thralls ?? []).filter((t) => !ids.includes(t.tok)), ...ids.map((tok) => ({ tok }))] }));
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

  if (!c.casters.length && !f.kinetic && !f.runes) {
    return (
      <div className="side-panel">
        <PanelHead title="Magia" />
        <p className="muted">Este personaje no lanza conjuros.</p>
      </div>
    );
  }

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

      {f.runes && <RunesPanel c={c} state={state} extras={extras} canEdit={canEdit} canEditExtras={canEditExtras} updateExtras={updateExtras} patch={patch} />}
    </div>
  );
}
