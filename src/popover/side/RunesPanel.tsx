// Repertorio de runas del rúnico: grabar (fijas) y trazar (hasta el final de su próximo turno)
import { useState } from "react";
import type { Character } from "../../pathbuilder";
import type { PcState } from "../../live";
import type { ClassState } from "../../classes";
import { etchMax, runeSlots } from "../../classes";
import type { Extras, Rune } from "../../extras";
import { useCombat } from "../../combat";
import { defaultColor } from "../../fx";
import { useActions } from "../ctx";
import { Counter, EditableName } from "./common";

export const runeLabel = (runes: Rune[], k: string) => runes[parseInt(k, 10)]?.n || `Runa ${parseInt(k, 10) + 1}`;

export function RunesPanel(props: {
  c: Character;
  state?: PcState;
  extras: Extras;
  canEdit: boolean;
  canEditExtras: boolean;
  updateExtras: (fn: (e: Extras) => Extras) => void;
  patch: (fn: (s: PcState) => PcState) => void;
}) {
  const { c, state, extras, canEdit, canEditExtras, updateExtras, patch } = props;
  const { notify, playFx } = useActions();
  const combat = useCombat();
  const [open, setOpen] = useState<number | null>(null);
  const runes = extras.cls?.runes ?? [];
  const cls: ClassState = state?.cls ?? {};
  const slots = Math.max(runeSlots(c.level), runes.length);
  const etchedTotal = Object.values(cls.etched ?? {}).reduce((a, b) => a + b, 0);
  const max = etchMax(c.level);
  const color = extras.cls?.colors?.arcane ?? defaultColor("arcane");

  const setRune = (i: number, r: Partial<Rune>) =>
    updateExtras((x) => {
      const list = [...(x.cls?.runes ?? [])];
      while (list.length <= i) list.push({ n: "" });
      list[i] = { ...list[i], ...r };
      return { ...x, cls: { ...x.cls, runes: list } };
    });
  const patchCls = (fn: (k: ClassState) => ClassState) => patch((s) => ({ ...s, cls: fn(s.cls ?? {}) }));

  const etch = (i: number) => {
    if (etchedTotal >= max) return;
    patchCls((k) => ({ ...k, etched: { ...k.etched, [i]: (k.etched?.[i] ?? 0) + 1 } }));
    notify({ label: "Graba la runa:", title: runeLabel(runes, String(i)), tag: "Runa grabada" });
    playFx({ kind: "arcane", from: `pc:${c.id}`, color });
  };
  const trace = (i: number) => {
    patchCls((k) => ({ ...k, traced: [...(k.traced ?? []), { k: String(i), r: combat.active ? combat.round : 0 }] }));
    notify({ label: "Traza la runa:", title: runeLabel(runes, String(i)), tag: "Runa trazada" });
    playFx({ kind: "arcane", from: `pc:${c.id}`, color });
  };
  const setEtched = (i: number, v: number) =>
    patchCls((k) => {
      const etched: Record<string, number> = { ...k.etched, [i]: v };
      if (!v) delete etched[String(i)];
      return { ...k, etched: Object.keys(etched).length ? etched : undefined };
    });
  const setTraced = (i: number, v: number) =>
    patchCls((k) => {
      const others = (k.traced ?? []).filter((t) => t.k !== String(i));
      const mine = (k.traced ?? []).filter((t) => t.k === String(i)).slice(0, v);
      while (mine.length < v) mine.push({ k: String(i), r: combat.active ? combat.round : 0 });
      const traced = [...others, ...mine];
      return { ...k, traced: traced.length ? traced : undefined };
    });

  return (
    <section className="spell-group runes">
      <h3>
        Runas
        <span className="rank-tag">
          Grabadas {etchedTotal}/{max}
        </span>
      </h3>
      {Array.from({ length: slots }, (_, i) => {
        const r = runes[i] ?? { n: "" };
        const etched = cls.etched?.[i] ?? 0;
        const traced = (cls.traced ?? []).filter((t) => t.k === String(i)).length;
        return (
          <div key={i} className={`rune ${open === i ? "open" : ""}`}>
            <div className="spell-row">
              <EditableName value={r.n} placeholder={`Runa ${i + 1}`} canEdit={canEditExtras} onChange={(v) => setRune(i, { n: v })} />
              <button className="spell-kind" title="Notas" onClick={() => setOpen(open === i ? null : i)}>
                📝
              </button>
              <button className="btn small-btn" disabled={!canEdit || !r.n || etchedTotal >= max} title="Grabar (runa fija)" onClick={() => etch(i)}>
                Grabar
              </button>
              <button className="btn small-btn" disabled={!canEdit || !r.n} title="Trazar (dura hasta el final de tu próximo turno)" onClick={() => trace(i)}>
                Trazar
              </button>
            </div>
            {(etched > 0 || traced > 0 || open === i) && (
              <div className="rune-counts">
                <span className="muted small">Grabadas</span>
                <Counter value={etched} max={etched + Math.max(0, max - etchedTotal)} canEdit={canEdit} onChange={(v) => setEtched(i, v)} />
                <span className="muted small">Trazadas</span>
                <Counter value={traced} max={20} canEdit={canEdit} onChange={(v) => setTraced(i, v)} />
              </div>
            )}
            {open === i && (
              <textarea
                className="feat-notes"
                placeholder="Efecto de la runa…"
                value={r.note ?? ""}
                readOnly={!canEditExtras}
                onChange={(e) => setRune(i, { note: e.target.value || undefined })}
              />
            )}
          </div>
        );
      })}
      {canEditExtras && (
        <button className="btn ghost small-btn" onClick={() => setRune(slots, { n: "" })}>
          + Espacio de runa
        </button>
      )}
    </section>
  );
}
