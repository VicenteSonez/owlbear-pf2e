import { useState, type ReactNode } from "react";
import { DAMAGE_TYPES, autoIwr, hasIwr, iwrEntryText, resolveIwr, shieldBroken, type Iwr, type IwrEntry, type IwrPick, type ShieldState } from "../rules";
import type { DamageOpts } from "../damage";

// Lista de tipos de daño para los campos de texto (con los grupos de resistencias)
export function DamageTypeList() {
  return (
    <datalist id="pf2-damage-types">
      {[...DAMAGE_TYPES, "físico", "todo"].map((t) => (
        <option key={t} value={t} />
      ))}
    </datalist>
  );
}

// Chips de inmunidad/resistencia/debilidad y bloqueo con escudo para un daño concreto
export function IwrChips(props: {
  iwr?: Iwr;
  type: string;
  pick: IwrPick;
  onPick: (p: IwrPick) => void;
  shield?: ShieldState;
  block?: boolean;
  onBlock?: (b: boolean) => void;
}) {
  const { iwr, pick, onPick, shield } = props;
  const toggle = (list: number[], i: number) => (list.includes(i) ? list.filter((x) => x !== i) : [...list, i]);
  const canBlock = !!shield && !shieldBroken(shield) && !!props.onBlock;
  if (!hasIwr(iwr) && !canBlock) return null;
  return (
    <div className="iwr-chips">
      {(iwr?.imm ?? []).length > 0 && (
        <button type="button" className={`chip ${pick.imm ? "on" : ""}`} title="Inmunidad: el daño queda en 0" onClick={() => onPick({ ...pick, imm: !pick.imm })}>
          Inmune ({iwr!.imm!.join(", ")})
        </button>
      )}
      {(iwr?.res ?? []).map((r, i) => (
        <button key={`r${i}`} type="button" className={`chip ${pick.res.includes(i) ? "on" : ""}`} title={`Resistencia${r.off ? " situacional" : ""}: se resta al daño (de varias cuenta la mayor)`} onClick={() => onPick({ ...pick, res: toggle(pick.res, i) })}>
          Resist. {iwrEntryText(r)}
        </button>
      ))}
      {(iwr?.weak ?? []).map((w, i) => (
        <button key={`w${i}`} type="button" className={`chip warn ${pick.weak.includes(i) ? "on" : ""}`} title="Debilidad: se suma al daño total" onClick={() => onPick({ ...pick, weak: toggle(pick.weak, i) })}>
          Debil. {iwrEntryText(w)}
        </button>
      ))}
      {canBlock && (
        <button type="button" className={`chip ${props.block ? "on" : ""}`} title={`Bloquear con ${shield!.name} (dureza ${shield!.hardness})`} onClick={() => props.onBlock!(!props.block)}>
          🛡 Bloquear
        </button>
      )}
    </div>
  );
}

// Daño / curación / temporales con tipo de daño y resistencias
export function DamageBox(props: {
  iwr?: Iwr;
  shield?: ShieldState;
  disabled?: boolean;
  onDamage: (amount: number, o: DamageOpts) => void;
  onHeal: (amount: number) => void;
  onTemp?: (amount: number) => void;
  children?: ReactNode;
}) {
  const { iwr, shield, disabled } = props;
  const [amount, setAmount] = useState("");
  const [type, setType] = useState("");
  const [pick, setPick] = useState<IwrPick | null>(null);
  const [block, setBlock] = useState(false);
  const cur = pick ?? autoIwr(iwr, type);
  const n = parseInt(amount, 10);
  const value = Number.isFinite(n) && n > 0 ? n : 0;
  const preview = value ? resolveIwr(value, iwr, cur) : null;

  const reset = () => {
    setAmount("");
    setPick(null);
    setBlock(false);
  };
  const damage = () => {
    if (!value) return;
    props.onDamage(value, { type, pick: cur, block });
    reset();
  };

  return (
    <div className="dmg-box">
      <div className="hp-ctrl">
        <input
          inputMode="numeric"
          placeholder="Cant."
          value={amount}
          disabled={disabled}
          onChange={(e) => setAmount(e.target.value.replace(/\D/g, ""))}
          onKeyDown={(e) => e.key === "Enter" && damage()}
        />
        <input
          className="dmg-type"
          list="pf2-damage-types"
          placeholder="Tipo"
          value={type}
          disabled={disabled}
          onChange={(e) => {
            setType(e.target.value);
            setPick(null);
          }}
        />
        <button className="btn danger" disabled={disabled} onClick={damage}>
          Daño
        </button>
        <button
          className="btn heal"
          disabled={disabled}
          onClick={() => {
            if (value) props.onHeal(value);
            reset();
          }}
        >
          Curar
        </button>
        {props.onTemp && (
          <button
            className="btn ghost"
            disabled={disabled}
            title="PG temporales = cantidad"
            onClick={() => {
              props.onTemp!(value);
              reset();
            }}
          >
            Temp
          </button>
        )}
        {props.children}
      </div>
      <IwrChips iwr={iwr} type={type} pick={cur} onPick={setPick} shield={shield} block={block} onBlock={setBlock} />
      {preview && (preview.notes || block) && (
        <div className="muted small dmg-preview">
          {value} → <b>{preview.total}</b> {preview.notes ? `(${preview.notes})` : ""}
          {block ? " · menos la dureza del escudo" : ""}
        </div>
      )}
      <DamageTypeList />
    </div>
  );
}

// Editor de inmunidades, resistencias y debilidades. Puede haber varias del mismo tipo
// (con su origen); las situacionales no se aplican solas, se activan en cada daño.
export function IwrEditor({ iwr, canEdit, onChange }: { iwr?: Iwr; canEdit: boolean; onChange: (next: Iwr | undefined) => void }) {
  const [kind, setKind] = useState<"imm" | "res" | "weak">("res");
  const [type, setType] = useState("");
  const [val, setVal] = useState("");
  const [note, setNote] = useState("");
  const [situational, setSituational] = useState(false);
  const cur: Iwr = iwr ?? {};
  const set = (next: Iwr) => onChange(next.imm?.length || next.res?.length || next.weak?.length ? next : undefined);
  const add = () => {
    const t = type.trim().toLowerCase();
    const v = parseInt(val, 10);
    if (!t) return;
    if (kind === "imm") set({ ...cur, imm: [...(cur.imm ?? []).filter((x) => x !== t), t] });
    else if (Number.isFinite(v) && v > 0) {
      const entry: IwrEntry = { t, v, n: note.trim() || undefined, off: situational || undefined };
      // Solo se reemplaza una idéntica (mismo tipo y origen)
      set({ ...cur, [kind]: [...(cur[kind] ?? []).filter((x) => !(x.t === t && (x.n ?? "") === (entry.n ?? ""))), entry] });
    } else return;
    setType("");
    setVal("");
    setNote("");
    setSituational(false);
  };
  const toggleOff = (k: "res" | "weak", i: number) => set({ ...cur, [k]: (cur[k] ?? []).map((x, j) => (j === i ? { ...x, off: x.off ? undefined : true } : x)) });
  const entries = [
    ...(cur.imm ?? []).map((t, i) => ({ k: "imm" as const, i, text: `Inmune: ${t}`, off: false })),
    ...(cur.res ?? []).map((r, i) => ({ k: "res" as const, i, text: `Resistencia ${iwrEntryText(r)}`, off: !!r.off })),
    ...(cur.weak ?? []).map((w, i) => ({ k: "weak" as const, i, text: `Debilidad ${iwrEntryText(w)}`, off: !!w.off })),
  ];
  return (
    <div className="iwr-editor">
      {entries.length === 0 && <p className="muted small">Sin inmunidades, resistencias ni debilidades.</p>}
      <div className="iwr-list">
        {entries.map((e) => (
          <span key={`${e.k}${e.i}`} className={`chip ${e.off ? "" : "on"} ${e.k === "weak" ? "warn" : ""}`}>
            {e.text}
            {e.k !== "imm" && (
              <button
                className="chip-mode"
                disabled={!canEdit}
                title={e.off ? "Situacional: solo se aplica si la activas en el daño (clic para que se aplique sola)" : "Se aplica sola si coincide el tipo (clic para hacerla situacional)"}
                onClick={() => toggleOff(e.k as "res" | "weak", e.i)}
              >
                {e.off ? "situacional" : "auto"}
              </button>
            )}
            {canEdit && (
              <button
                className="chip-x"
                title="Quitar"
                onClick={() => {
                  const next: Iwr = { ...cur };
                  if (e.k === "imm") next.imm = (cur.imm ?? []).filter((_, j) => j !== e.i);
                  else next[e.k] = (cur[e.k] ?? []).filter((_, j) => j !== e.i);
                  set(next);
                }}
              >
                ✕
              </button>
            )}
          </span>
        ))}
      </div>
      {canEdit && (
        <form
          className="iwr-form"
          onSubmit={(e) => {
            e.preventDefault();
            add();
          }}
        >
          <select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
            <option value="res">Resistencia</option>
            <option value="imm">Inmunidad</option>
            <option value="weak">Debilidad</option>
          </select>
          <input list="pf2-damage-types" placeholder="Tipo (fuego, físico…)" value={type} onChange={(e) => setType(e.target.value)} />
          {kind !== "imm" && <input className="sm" inputMode="numeric" placeholder="Valor" value={val} onChange={(e) => setVal(e.target.value.replace(/\D/g, ""))} />}
          {kind !== "imm" && <input className="md" placeholder="Origen (opcional)" value={note} onChange={(e) => setNote(e.target.value)} />}
          {kind !== "imm" && (
            <label className="te-check" title="No se aplica sola: la activas en cada daño">
              <input type="checkbox" checked={situational} onChange={(e) => setSituational(e.target.checked)} /> Situacional
            </label>
          )}
          <button className="btn">Agregar</button>
          <DamageTypeList />
        </form>
      )}
      {(cur.res ?? []).length > 1 && <p className="muted small">De varias resistencias activas contra un mismo daño solo cuenta la mayor.</p>}
    </div>
  );
}
