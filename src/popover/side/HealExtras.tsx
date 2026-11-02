// Pestaña de sanación: habilidades curativas que el jugador agrega a mano (rasgos, dotes,
// objetos) y los consumibles comunes de curación del inventario y del recetario.
import { useState } from "react";
import type { Character } from "../../pathbuilder";
import { live, useLiveStates } from "../../live";
import type { Extras, HealAbility } from "../../extras";
import { healTarget, parseTargetKey } from "../../damage";
import { patchNpc } from "../../obr";
import { damageReqs } from "../../requests";
import { newId } from "../../shared";
import { HEAL_ITEMS, SOURCE_LABEL, SOURCE_ORDER, matchHealItem, withFastHealing, type HealItemDef, type HealSource } from "../../healItems";
import { useActions } from "../ctx";
import { useNpcOptions } from "../NpcPicker";
import { inventoryRows } from "./InventoryPanel";
import { alchemyPools, quickMade, recipeRows } from "./RecipesPanel";
import { setIn, type SideProps } from "./types";

// Objetivos posibles ("pc:<id>" o "npc:<token>") y cómo curarlos: a un PNJ, si no es el GM,
// la curación va al GM como pedido (igual que el daño)
function useHealTargets(c: Character) {
  const { isGm } = useActions();
  const { states } = useLiveStates();
  const npcs = useNpcOptions();
  const pcs = Object.values(states).sort((a, b) => a.name.localeCompare(b.name));
  const nameOf = (k: string) => {
    const t = parseTargetKey(k);
    if (!t) return "";
    return t.kind === "pc" ? (states[t.id]?.name ?? "") : (npcs.find((n) => n.tok === t.tokenId)?.name ?? "PNJ");
  };
  const undead = (k: string) => {
    const t = parseTargetKey(k);
    if (!t) return false;
    return t.kind === "pc" ? !!states[t.id]?.undead : !!npcs.find((n) => n.tok === t.tokenId)?.state.undead;
  };
  const heal = async (k: string, amount: number, label: string) => {
    const t = parseTargetKey(k);
    if (!t) return;
    if (t.kind === "pc" || isGm) return healTarget(t, amount);
    const id = newId();
    await damageReqs.set(id, { id, from: c.id, fromName: c.name, tok: t.tokenId, n: nameOf(k), amt: amount, ty: "", label, heal: true, t: Date.now() });
  };
  return { isGm, pcs, npcs, nameOf, undead, heal };
}

type Targets = ReturnType<typeof useHealTargets>;

function TargetOptions({ tg, npcs = true, skip = [] }: { tg: Targets; npcs?: boolean; skip?: string[] }) {
  return (
    <>
      <optgroup label="PJ">
        {tg.pcs
          .filter((s) => !skip.includes(`pc:${s.id}`))
          .map((s) => (
            <option key={s.id} value={`pc:${s.id}`}>
              {s.name}
            </option>
          ))}
      </optgroup>
      {npcs && tg.npcs.length > 0 && (
        <optgroup label={tg.isGm ? "PNJ" : "PNJ (lo autoriza el GM)"}>
          {tg.npcs
            .filter((n) => !skip.includes(`npc:${n.tok}`))
            .map((n) => (
              <option key={n.tok} value={`npc:${n.tok}`}>
                {n.name}
              </option>
            ))}
        </optgroup>
      )}
    </>
  );
}

// ---------- Habilidades curativas ----------

const EMPTY: HealAbility = { id: "", n: "", f: "" };

export function HealAbilities({ character: c, state, extras, canEdit, canEditExtras, updateExtras }: SideProps) {
  const { roll } = useActions();
  const tg = useHealTargets(c);
  const list = extras.heal?.abilities ?? [];
  const [draft, setDraft] = useState<HealAbility | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [targets, setTargets] = useState<Record<string, string[]>>({});
  const [manual, setManual] = useState<Record<string, string>>({});
  const self = state ? `pc:${state.id}` : "";

  const save = (a: HealAbility) =>
    updateExtras((x) => {
      const prev = x.heal?.abilities ?? [];
      const next = prev.some((p) => p.id === a.id) ? prev.map((p) => (p.id === a.id ? a : p)) : [...prev, a];
      return { ...x, heal: { ...x.heal, abilities: next } };
    });
  const remove = (id: string) =>
    updateExtras((x) => {
      const next = (x.heal?.abilities ?? []).filter((p) => p.id !== id);
      return { ...x, heal: { ...x.heal, abilities: next.length ? next : undefined } };
    });

  const use = async (a: HealAbility) => {
    const formula = (a.f || manual[a.id] || "").trim().replace(/^\+/, "");
    const who = targets[a.id] ?? (self ? [self] : []);
    if (!formula || !who.length) return;
    const r = await roll({ label: `Cura a ${who.map(tg.nameOf).join(", ")}`, title: a.n, formula, kind: "damage", tag: "Curación" });
    if (!r) return;
    for (const k of who) await tg.heal(k, r.total, a.n);
  };

  return (
    <section className="heal-abilities">
      <h3>Habilidades curativas</h3>
      {list.map((a) => {
        const isOpen = open === a.id;
        const who = targets[a.id] ?? (self ? [self] : []);
        const setWho = (v: string[]) => setTargets((t) => ({ ...t, [a.id]: v }));
        return (
          <div key={a.id} className={`feat heal-ab ${isOpen ? "open" : ""}`}>
            <div className="feat-row">
              <button className="link-btn feat-name" onClick={() => setOpen(isOpen ? null : a.id)}>
                {a.n}
              </button>
              <span className="chip small-chip on">{a.f || "a mano"}</span>
              {canEditExtras && (
                <>
                  <button className="ename-btn" title="Editar" onClick={() => setDraft(a)}>
                    ✎
                  </button>
                  <button className="row-x" title="Quitar" onClick={() => remove(a.id)}>
                    ✕
                  </button>
                </>
              )}
            </div>
            {isOpen && (
              <div className="heal-use">
                {a.note && <p className="muted small">{a.note}</p>}
                <div className="cb-row heal-targets">
                  {who.map((k) => (
                    <button key={k} className="chip on" title="Quitar objetivo" onClick={() => setWho(who.filter((x) => x !== k))}>
                      {tg.nameOf(k) || "?"} ✕
                    </button>
                  ))}
                  <select value="" onChange={(e) => e.target.value && setWho([...who, e.target.value])} title="Agregar objetivo">
                    <option value="">+ Objetivo</option>
                    <TargetOptions tg={tg} skip={who} />
                  </select>
                </div>
                <div className="cb-row">
                  {!a.f && (
                    <input
                      className="sm2"
                      placeholder="2d8+5 / 10"
                      value={manual[a.id] ?? ""}
                      onChange={(e) => {
                        const v = e.target.value;
                        setManual((m) => ({ ...m, [a.id]: v }));
                      }}
                    />
                  )}
                  <button className="btn heal" disabled={!canEdit || !who.length || !(a.f || manual[a.id]?.trim())} onClick={() => use(a)}>
                    ✚ Curar{who.length > 1 ? ` a ${who.length}` : ""}
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })}
      {canEditExtras && !draft && (
        <button className="btn heal-add" onClick={() => setDraft({ ...EMPTY, id: newId() })}>
          + Agregar habilidades curativas
        </button>
      )}
      {draft && (
        <form
          className="heal-ab-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (!draft.n.trim()) return;
            save({ id: draft.id, n: draft.n.trim(), f: draft.f?.trim().replace(/^\+/, "") || undefined, note: draft.note?.trim() || undefined });
            setOpen(draft.id);
            setDraft(null);
          }}
        >
          <input autoFocus placeholder="Nombre (Imposición de manos…)" value={draft.n} onChange={(e) => setDraft({ ...draft, n: e.target.value })} />
          <input placeholder="Cura: 2d8+5 / 10 · vacío = a mano" value={draft.f ?? ""} onChange={(e) => setDraft({ ...draft, f: e.target.value })} />
          <textarea placeholder="Notas (opcional)" value={draft.note ?? ""} onChange={(e) => setDraft({ ...draft, note: e.target.value })} />
          <div className="cb-row">
            <button className="btn primary" disabled={!draft.n.trim()}>
              Guardar
            </button>
            <button type="button" className="link-btn" onClick={() => setDraft(null)}>
              Cancelar
            </button>
          </div>
        </form>
      )}
      {!list.length && !draft && !canEditExtras && <p className="muted small">Sin habilidades curativas.</p>}
    </section>
  );
}

// ---------- Consumibles de curación ----------

// Bono a las salvaciones contra enfermedades y venenos del Elixir de vida, por grado
const ELIXIR_SAVE = [1, 1, 2, 2, 3, 4];

interface Stock {
  def: HealItemDef;
  // Filas del inventario y recetas que lo tienen (clave y cuántos)
  inv: { key: string; n: number }[];
  rec: { key: string; n: number; q: number }[];
  // Se puede crear al momento con un vial versátil
  vial: boolean;
}

function stocks(c: Character, extras: Extras): Stock[] {
  const byId = new Map<string, Stock>();
  const get = (def: HealItemDef) => {
    let s = byId.get(def.id);
    if (!s) byId.set(def.id, (s = { def, inv: [], rec: [], vial: false }));
    return s;
  };
  for (const r of inventoryRows(c, extras)) {
    const def = matchHealItem(extras.names?.[r.key] ?? r.name);
    if (def) get(def).inv.push({ key: r.key, n: extras.qty?.[r.key] ?? r.qty });
  }
  const pools = alchemyPools(c, {});
  if (pools.showAA || pools.showVV) {
    for (const r of recipeRows(c, extras)) {
      const def = matchHealItem(extras.names?.[r.key] ?? r.name);
      if (!def) continue;
      const s = get(def);
      s.rec.push({ key: r.key, n: extras.qty?.[r.key] ?? 0, q: quickMade(extras, r.key) });
      if (pools.showVV) s.vial = true;
    }
  }
  return HEAL_ITEMS.map((d) => byId.get(d.id)).filter((s): s is Stock => !!s);
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

export function HealConsumables({ character: c, state, extras, canEdit, canEditExtras, updateExtras, patch }: SideProps) {
  const { roll, notify } = useActions();
  const tg = useHealTargets(c);
  const { vv } = alchemyPools(c, state?.res ?? {});
  const list = stocks(c, extras);
  const [src, setSrc] = useState<Record<string, HealSource>>({});
  const [target, setTarget] = useState<Record<string, string>>({});
  const self = state ? `pc:${state.id}` : "";

  if (!list.length) return null;

  // Cuántos hay por fuente (Alquimia rápida: lo ya hecho más los viales si conoce la receta)
  const count = (s: Stock, from: HealSource) =>
    from === "ar" ? sum(s.rec.map((r) => r.q)) + (s.vial ? vv : 0) : from === "aa" ? sum(s.rec.map((r) => r.n - r.q)) : sum(s.inv.map((r) => Math.max(0, r.n)));
  const sources = (s: Stock) => SOURCE_ORDER.filter((f) => (f === "inv" ? s.inv.length : s.rec.length) > 0);
  // "1 + 5 viales": lo ya hecho con Alquimia rápida y los viales para hacer más
  const countText = (s: Stock, from: HealSource) => {
    if (from !== "ar" || !s.vial) return String(count(s, from));
    const made = sum(s.rec.map((r) => r.q));
    const vials = `${vv} vial${vv === 1 ? "" : "es"}`;
    return made ? `${made} + ${vials}` : vials;
  };

  // Descuenta uno de la fuente elegida
  const spend = (s: Stock, from: HealSource) => {
    if (from === "inv") {
      const r = s.inv.find((x) => x.n > 0);
      // En el inventario 0 se guarda tal cual (sin valor volvería a la cantidad de la hoja)
      if (r) updateExtras((x) => ({ ...x, qty: { ...x.qty, [r.key]: r.n - 1 } }));
      return;
    }
    const made = s.rec.find((x) => (from === "ar" ? x.q > 0 : x.n - x.q > 0));
    if (made) {
      updateExtras((x) => ({
        ...x,
        qty: setIn(x.qty, made.key, made.n - 1 || undefined),
        qmade: from === "ar" ? setIn(x.qmade, made.key, made.q - 1 || undefined) : x.qmade,
      }));
    } else if (from === "ar" && s.vial && vv > 0) {
      patch((st) => ({ ...st, res: { ...st.res, vv: Math.max(0, (st.res?.vv ?? vv) - 1) } }));
    }
  };

  const use = async (s: Stock, from: HealSource, k: string) => {
    const d = s.def;
    const who = tg.nameOf(k);
    if (d.fh) {
      spend(s, from);
      const t = parseTargetKey(k);
      if (t?.kind === "pc") await live.patch(t.id, (x) => ({ ...x, cond: withFastHealing(x.cond, d.fh!) }));
      else if (t?.kind === "npc") await patchNpc(t.tokenId, (n) => ({ ...n, cond: withFastHealing(n.cond, d.fh!) }));
      await notify({ label: `${d.name} →`, title: who, detail: `Sanación rápida ${d.fh} durante 1 minuto (10 rondas) · ${SOURCE_LABEL[from]}`, tag: "Curación" });
      return;
    }
    const notes = [SOURCE_LABEL[from], d.fam === "elixir" ? `+${ELIXIR_SAVE[d.grade - 1]} a salvaciones contra enfermedades y venenos (10 min)` : ""].filter(Boolean).join(" · ");
    const r = await roll({ label: `${d.name} → ${who}`, title: d.name, formula: d.f!, kind: "damage", notes, tag: "Curación" });
    if (!r) return;
    spend(s, from);
    await tg.heal(k, r.total, d.name);
  };

  return (
    <section className="heal-items">
      <h3>Consumibles de curación</h3>
      {list.map((s) => {
        const d = s.def;
        const opts = sources(s);
        // Primero lo ya hecho (rápida, avanzada, inventario); crear uno con un vial, al final
        const ready = (f: HealSource) => (f === "ar" ? sum(s.rec.map((r) => r.q)) : count(s, f));
        const from = src[d.id] && opts.includes(src[d.id]) ? src[d.id] : (opts.find((f) => ready(f) > 0) ?? opts.find((f) => count(s, f) > 0) ?? opts[0]);
        const k = target[d.id] ?? self;
        const left = count(s, from);
        // A un PNJ solo el GM le da la sanación rápida (no viaja en un pedido)
        const npcOk = !d.fh || tg.isGm;
        const bad = tg.undead(k);
        const needsRoom = from === "ar" && !s.rec.some((r) => r.q > 0);
        return (
          <div key={d.id} className={`heal-item ${left ? "" : "empty"}`}>
            <div className="cb-row">
              <b>{d.name}</b>
              <span className="muted small">{d.f ? `Cura ${d.f}` : `Sanación rápida ${d.fh} · 1 min`}</span>
              <span className="hi-stock muted small">
                {opts.map((f) => `${f === "ar" ? "AR" : f === "aa" ? "AA" : "Inv."} ${countText(s, f)}`).join(" · ")}
              </span>
            </div>
            <div className="cb-row">
              {opts.length > 1 && (
                <select value={from} onChange={(e) => setSrc((m) => ({ ...m, [d.id]: e.target.value as HealSource }))} title="De dónde se gasta">
                  {opts.map((f) => (
                    <option key={f} value={f}>
                      {SOURCE_LABEL[f]} ({countText(s, f)})
                    </option>
                  ))}
                </select>
              )}
              <select value={k} onChange={(e) => setTarget((m) => ({ ...m, [d.id]: e.target.value }))} title="Objetivo">
                <TargetOptions tg={tg} npcs={npcOk} />
              </select>
              <button
                className="btn heal"
                disabled={!canEditExtras || (needsRoom && !canEdit) || left <= 0 || !k || bad}
                title={bad ? "No cura a muertos vivientes" : left <= 0 ? "No te quedan" : `Gasta 1 (${SOURCE_LABEL[from]})`}
                onClick={() => use(s, from, k)}
              >
                Usar
              </button>
            </div>
          </div>
        );
      })}
    </section>
  );
}
