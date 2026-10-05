// Fila de conjuro con su configuración (descripción, tipo de tirada, daño, diseño del efecto)
import { useState, type ReactNode } from "react";
import { SAVE_LABEL, type SaveKey, type SpellKind } from "../../shared";
import { MAGIC_DESIGNS, type MagicDesign } from "../../fx";
import { spellKey, type Extras, type SpellMeta } from "../../extras";
import { ELEMENTS } from "../../classes";
import { EditableName } from "./common";
import { DamageTypeList } from "../DamageBox";

export const KIND_LABEL: Record<SpellKind, string> = { atk: "Ataque", save: "Salvación", fx: "Efecto" };

export const metaOf = (extras: Extras, name: string, defaults?: SpellMeta): SpellMeta => ({ ...defaults, ...extras.spells?.[spellKey(name)] });

interface Props {
  name: string;
  placeholder?: string;
  extras: Extras;
  canEditExtras: boolean;
  updateExtras: (fn: (e: Extras) => Extras) => void;
  onRename?: (v: string) => void;
  // Botón de lanzar (y otros, como Amplificar)
  actions?: ReactNode;
  // Casilla de usado (preparados)
  lead?: ReactNode;
  className?: string;
  defaults?: SpellMeta;
  // Opciones extra según el tipo de lista
  blood?: boolean;
  impulse?: boolean;
  signature?: { on: boolean; toggle: () => void };
  onRemove?: () => void;
}

export function SpellRow(props: Props) {
  const { name, extras, canEditExtras, updateExtras } = props;
  const [open, setOpen] = useState(false);
  const meta = metaOf(extras, name, props.defaults);
  const set = (patch: Partial<SpellMeta>) =>
    updateExtras((x) => {
      const k = spellKey(name);
      const next = { ...x.spells?.[k], ...patch };
      for (const key of Object.keys(next) as (keyof SpellMeta)[]) if (next[key] === undefined || next[key] === "" || next[key] === false) delete next[key];
      const spells = { ...x.spells };
      if (Object.keys(next).length) spells[k] = next;
      else delete spells[k];
      return { ...x, spells };
    });
  const kind = meta.kind ?? "fx";
  const tag = kind === "save" ? `${KIND_LABEL.save} · ${SAVE_LABEL[meta.save ?? "reflex"]}` : KIND_LABEL[kind];

  return (
    <div className={`spell-wrap ${open ? "open" : ""} ${props.className ?? ""}`}>
      <div className="spell-row">
        {props.lead}
        {props.onRename ? (
          <EditableName value={name} placeholder={props.placeholder} canEdit={canEditExtras} onChange={props.onRename} />
        ) : (
          <span className="ename">
            <span>{name || props.placeholder}</span>
          </span>
        )}
        {name && (
          <button className={`spell-kind k-${kind}`} title="Configurar y describir" onClick={() => setOpen((o) => !o)}>
            {tag}
            {meta.desc ? " ·📝" : ""}
            {meta.blood ? " ·🩸" : ""}
          </button>
        )}
        {props.signature?.on && <span className="sig-mark" title="Conjuro distintivo">✦</span>}
        {props.actions}
      </div>
      {open && name && (
        <div className="spell-cfg">
          <div className="sf-row">
            <select value={kind} disabled={!canEditExtras} onChange={(e) => set({ kind: e.target.value as SpellKind })}>
              {(Object.keys(KIND_LABEL) as SpellKind[]).map((k) => (
                <option key={k} value={k}>
                  {KIND_LABEL[k]}
                </option>
              ))}
            </select>
            {kind === "save" && (
              <>
                <select value={meta.save ?? "reflex"} disabled={!canEditExtras} onChange={(e) => set({ save: e.target.value as SaveKey })}>
                  {(["fortitude", "reflex", "will"] as SaveKey[]).map((k) => (
                    <option key={k} value={k}>
                      {SAVE_LABEL[k]}
                    </option>
                  ))}
                </select>
                <label className="te-check">
                  <input type="checkbox" checked={!!meta.basic} disabled={!canEditExtras} onChange={(e) => set({ basic: e.target.checked })} /> Básica
                </label>
              </>
            )}
            <input className="sm2" placeholder="Daño (2d6)" defaultValue={meta.dmg} disabled={!canEditExtras} onBlur={(e) => set({ dmg: e.target.value.trim() || undefined })} />
            <input className="sm2" list="pf2-damage-types" placeholder="Tipo" defaultValue={meta.ty} disabled={!canEditExtras} onBlur={(e) => set({ ty: e.target.value.trim() || undefined })} />
            <label className="te-check" title="Cura en vez de dañar">
              <input type="checkbox" checked={!!meta.heal} disabled={!canEditExtras} onChange={(e) => set({ heal: e.target.checked })} /> Curación
            </label>
          </div>
          <div className="sf-row">
            <select value={meta.fx ?? ""} disabled={!canEditExtras} title="Diseño del efecto en el mapa" onChange={(e) => set({ fx: (e.target.value || undefined) as MagicDesign | undefined })}>
              <option value="">✦ Efecto predeterminado</option>
              {MAGIC_DESIGNS.map((d) => (
                <option key={d.id} value={d.id}>
                  ✦ {d.label}
                </option>
              ))}
            </select>
            {props.blood && (
              <label className="te-check" title="Al lanzarlo se activa tu Magia de sangre">
                <input type="checkbox" checked={!!meta.blood} disabled={!canEditExtras} onChange={(e) => set({ blood: e.target.checked })} /> Magia de sangre
              </label>
            )}
            {props.signature && (
              <label className="te-check" title="Se puede lanzar desde cualquier rango igual o mayor">
                <input type="checkbox" checked={props.signature.on} disabled={!canEditExtras} onChange={props.signature.toggle} /> Distintivo
              </label>
            )}
            {props.impulse && (
              <>
                <select value={meta.el ?? ""} disabled={!canEditExtras} onChange={(e) => set({ el: e.target.value || undefined })}>
                  <option value="">Elemento…</option>
                  {ELEMENTS.map((el) => (
                    <option key={el.id} value={el.id}>
                      {el.label}
                    </option>
                  ))}
                </select>
                <label className="te-check" title="Desborde: apaga el aura al usarlo">
                  <input type="checkbox" checked={!!meta.overflow} disabled={!canEditExtras} onChange={(e) => set({ overflow: e.target.checked })} /> Desborde
                </label>
                <label className="te-check" title="Activa la Unión de impulso">
                  <input type="checkbox" checked={!!meta.junction} disabled={!canEditExtras} onChange={(e) => set({ junction: e.target.checked })} /> Unión
                </label>
              </>
            )}
            {props.onRemove && canEditExtras && (
              <button className="link-btn" onClick={props.onRemove}>
                Quitar fila
              </button>
            )}
          </div>
          <textarea
            className="feat-notes"
            placeholder={canEditExtras ? "Descripción del conjuro…" : "Sin descripción"}
            value={meta.desc ?? ""}
            readOnly={!canEditExtras}
            onChange={(e) => set({ desc: e.target.value || undefined })}
          />
          <DamageTypeList />
        </div>
      )}
    </div>
  );
}
