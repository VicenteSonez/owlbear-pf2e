import { useMemo, useState } from "react";
import { fmtMod, type Character } from "../pathbuilder";
import type { PcState } from "../live";
import { extrasStore } from "../extras";
import { DEGREE_LABEL, checkAdjust, levelDc, modsText } from "../rules";
import { SAVE_LABEL, newId, npcLabel, type SaveKey } from "../shared";
import {
  removeSaveEffect,
  resultKey,
  saveEffects,
  saveResults,
  useSaveEffects,
  useSaveResults,
  type SaveEffect,
  type SaveTarget,
} from "../requests";
import { basicSaveDamage, dealDamage, parseTargetKey } from "../damage";
import { autoRoll } from "../autoRoll";
import { useSceneTokens } from "./hooks";
import { useActions } from "./ctx";
import { DamageTypeList } from "./DamageBox";

const SAVES: SaveKey[] = ["fortitude", "reflex", "will"];

export interface SaveDefaults {
  name?: string;
  save?: SaveKey;
  dc?: number;
  basic?: boolean;
  fear?: boolean;
  dmg?: string;
  ty?: string;
}

// Posibles objetivos: PJ (y mascotas) de la sala y PNJ de la escena
export function useTargetOptions(states: Record<string, PcState>, playersOnly = false) {
  const tokens = useSceneTokens();
  return useMemo(() => {
    const pcs = Object.values(states)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((s) => ({ k: `pc:${s.id}`, n: s.name, pc: true }));
    const npcs = tokens
      .filter((t) => t.data.kind === "npc" && (!playersOnly || (t.item.visible && !t.data.hidden)))
      .map((t) => ({ k: `npc:${t.item.id}`, n: npcLabel({ name: t.item.name || t.data.name, num: t.data.num, nick: t.data.nick }), pc: false }));
    return [...pcs, ...npcs];
  }, [states, tokens, playersOnly]);
}

// Formulario para pedir una salvación a varios objetivos
export function SaveRequestForm(props: {
  states: Record<string, PcState>;
  defaults?: SaveDefaults;
  targets?: string[];
  from: { id: string; name: string };
  onDone?: () => void;
  compact?: boolean;
}) {
  const { notify } = useActions();
  const d = props.defaults ?? {};
  const [name, setName] = useState(d.name ?? "");
  const [save, setSave] = useState<SaveKey>(d.save ?? "reflex");
  const [dc, setDc] = useState(String(d.dc ?? ""));
  const [lvl, setLvl] = useState("");
  const [basic, setBasic] = useState(!!d.basic);
  const [fear, setFear] = useState(!!d.fear);
  const [dmg, setDmg] = useState(d.dmg ?? "");
  const [ty, setTy] = useState(d.ty ?? "");
  const [sel, setSel] = useState<string[]>(props.targets ?? []);
  const options = useTargetOptions(props.states);
  const dcNum = parseInt(dc, 10);

  const send = async () => {
    if (!Number.isFinite(dcNum) || !sel.length) return;
    const targets: SaveTarget[] = sel.flatMap((k) => {
      const o = options.find((x) => x.k === k);
      return o ? [{ k, n: o.n }] : [];
    });
    const eff: SaveEffect = {
      id: newId(),
      name: name.trim() || "Efecto",
      save,
      dc: dcNum,
      basic: basic || undefined,
      fear: fear || undefined,
      dmg: dmg.trim() || undefined,
      ty: ty.trim() || undefined,
      from: props.from.id,
      fromName: props.from.name,
      targets,
      t: Date.now(),
    };
    await saveEffects.set(eff.id, eff);
    await notify({
      label: `Salvación de ${SAVE_LABEL[save]}:`,
      title: eff.name,
      detail: targets.map((t) => t.n).join(", "),
      tag: "Salvación",
      charName: props.from.name,
    });
    props.onDone?.();
  };

  return (
    <div className={`save-form ${props.compact ? "compact" : ""}`}>
      <div className="sf-row">
        <input placeholder="Nombre del efecto" value={name} onChange={(e) => setName(e.target.value)} />
        <select value={save} onChange={(e) => setSave(e.target.value as SaveKey)}>
          {SAVES.map((s) => (
            <option key={s} value={s}>
              {SAVE_LABEL[s]}
            </option>
          ))}
        </select>
        <label className="sf-dc" title="CD (oculta para los jugadores)">
          CD
          <input inputMode="numeric" value={dc} onChange={(e) => setDc(e.target.value.replace(/\D/g, ""))} />
        </label>
        <label className="sf-dc" title="Rellena la CD estándar de un nivel">
          Nv
          <input
            inputMode="numeric"
            value={lvl}
            placeholder="—"
            onChange={(e) => {
              const v = e.target.value.replace(/\D/g, "");
              setLvl(v);
              if (v !== "") setDc(String(levelDc(parseInt(v, 10))));
            }}
          />
        </label>
      </div>
      <div className="sf-row">
        <label className="te-check">
          <input type="checkbox" checked={basic} onChange={(e) => setBasic(e.target.checked)} /> Básica
        </label>
        <label className="te-check" title="Rasgo de miedo (el Himno valeroso da +1)">
          <input type="checkbox" checked={fear} onChange={(e) => setFear(e.target.checked)} /> Miedo
        </label>
        <input className="sm2" placeholder="Daño (2d6)" value={dmg} onChange={(e) => setDmg(e.target.value)} />
        <input className="sm2" list="pf2-damage-types" placeholder="Tipo" value={ty} onChange={(e) => setTy(e.target.value)} />
        <DamageTypeList />
      </div>
      <div className="sf-targets">
        {options.map((o) => (
          <button
            key={o.k}
            type="button"
            className={`chip ${sel.includes(o.k) ? "on" : ""}`}
            onClick={() => setSel((l) => (l.includes(o.k) ? l.filter((x) => x !== o.k) : [...l, o.k]))}
          >
            {o.pc ? "" : "◆ "}
            {o.n}
          </button>
        ))}
        {options.length === 0 && <span className="muted small">No hay PJ ni PNJ para elegir.</span>}
      </div>
      <div className="sf-row">
        <button className="btn primary" disabled={!Number.isFinite(dcNum) || !sel.length} onClick={send}>
          Pedir salvación
        </button>
        {props.onDone && (
          <button className="btn ghost" onClick={props.onDone}>
            Cancelar
          </button>
        )}
      </div>
    </div>
  );
}

// Modificador de salvación de un objetivo (PJ desde su hoja, mascota desde sus notas, PNJ desde su token)
function saveModFor(k: string, save: SaveKey, sheets: Record<string, Character>, states: Record<string, PcState>, npcs: Record<string, { saves?: Record<SaveKey, number> }>) {
  if (k.startsWith("pc:")) {
    const id = k.slice(3);
    const s = states[id];
    if (s?.pet) {
      const mods = extrasStore.get(s.pet.parent).pets?.[s.pet.index]?.mods;
      return mods?.[save];
    }
    return sheets[id]?.saves.find((x) => x.key === save)?.mod;
  }
  return npcs[k.slice(4)]?.saves?.[save];
}

// Lista de efectos de salvación activos: cada uno queda hasta que todos tiren y el GM lo cierre
export function SaveEffectsList(props: {
  states: Record<string, PcState>;
  sheets: Record<string, Character>;
  // Solo los efectos que incluyen a este PJ (barra de la hoja del jugador)
  only?: string[];
  pendingOnly?: boolean;
}) {
  const { roll, isGm, meId, publish } = useActions();
  const effects = useSaveEffects();
  const results = useSaveResults();
  const tokens = useSceneTokens();
  const npcs = useMemo(() => {
    const m: Record<string, { saves?: Record<SaveKey, number>; cond: PcState["cond"]; hidden: boolean; name: string }> = {};
    for (const t of tokens) if (t.data.kind === "npc") m[t.item.id] = { saves: t.data.saves, cond: t.data.cond ?? {}, hidden: !!t.data.hidden || !t.item.visible, name: t.item.name };
    return m;
  }, [tokens]);
  const [busy, setBusy] = useState(false);

  const list = Object.values(effects)
    .sort((a, b) => b.t - a.t)
    .filter((e) => !props.only || e.targets.some((t) => props.only!.includes(t.k)))
    .filter((e) => !props.pendingOnly || e.targets.some((t) => props.only?.includes(t.k) && !results[resultKey(e.id, t.k)]));
  if (!list.length) return props.only ? null : <p className="muted small">No hay salvaciones pendientes.</p>;

  const canRoll = (k: string) => {
    if (isGm) return true;
    if (!k.startsWith("pc:")) return false;
    const s = props.states[k.slice(3)];
    return !!s && s.owner === meId;
  };

  const rollFor = async (e: SaveEffect, t: SaveTarget) => {
    if (busy) return;
    setBusy(true);
    try {
      const mod = saveModFor(t.k, e.save, props.sheets, props.states, npcs);
      const cond = t.k.startsWith("pc:") ? props.states[t.k.slice(3)]?.cond : npcs[t.k.slice(4)]?.cond;
      const adj = checkAdjust(cond, { kind: "save", key: e.save, fear: e.fear });
      const base = mod ?? 0;
      const label = `${e.name}: ${SAVE_LABEL[e.save]}`;
      const hiddenNpc = t.k.startsWith("npc:") && npcs[t.k.slice(4)]?.hidden;
      const r = await roll(
        {
          label,
          formula: `1d20${fmtMod(base + adj.total)}`,
          kind: "check",
          notes: [mod === undefined ? "sin modificador anotado" : "", modsText(adj.applied)].filter(Boolean).join(" · ") || undefined,
          vs: { dc: e.dc },
          secret: hiddenNpc || undefined,
          charName: t.n,
          charId: t.k.startsWith("pc:") ? t.k.slice(3) : undefined,
          tag: "Salvación",
        },
        { quick: true },
      );
      if (r?.degree) await saveResults.set(resultKey(e.id, t.k), { total: r.total, degree: r.degree, nat: r.nat, t: Date.now() });
    } finally {
      setBusy(false);
    }
  };

  // Salvación básica: se tira el daño una vez y a cada uno se le aplica según su grado
  const applyBasic = async (e: SaveEffect) => {
    if (!e.dmg || busy) return;
    setBusy(true);
    try {
      let rolled: number;
      try {
        const entry = autoRoll({ playerId: meId, playerName: "GM", playerColor: "#e8622c" }, e.fromName, `${e.name}: daño`, e.dmg, "damage");
        rolled = entry.total;
        await publish({ ...entry, secret: true });
      } catch {
        return;
      }
      for (const t of e.targets) {
        const rk = resultKey(e.id, t.k);
        const res = saveResults.all()[rk];
        if (!res || res.applied !== undefined) continue;
        const amount = e.basic ? basicSaveDamage(rolled, res.degree) : res.degree.includes("success") ? 0 : rolled;
        const ref = parseTargetKey(t.k);
        const out = ref && amount > 0 ? await dealDamage(ref, amount, { type: e.ty }) : { total: 0, notes: "" };
        await saveResults.set(rk, { ...res, applied: out.total });
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="save-list">
      {list.map((e) => {
        const done = e.targets.filter((t) => results[resultKey(e.id, t.k)]).length;
        const all = done === e.targets.length;
        return (
          <div key={e.id} className={`save-effect ${all ? "done" : ""}`}>
            <div className="se-head">
              <b>{e.name}</b>
              <span className="badge">{SAVE_LABEL[e.save]}</span>
              {e.basic && <span className="badge">básica</span>}
              {e.fear && <span className="badge">miedo</span>}
              {isGm && <span className="dc">CD {e.dc}</span>}
              <span className="muted small">
                {done}/{e.targets.length}
              </span>
              {isGm && (
                <button className="row-x" title="Cerrar este efecto" onClick={() => removeSaveEffect(e.id)}>
                  ✕
                </button>
              )}
            </div>
            <div className="se-targets">
              {e.targets
                .filter((t) => !props.only || isGm || props.only.includes(t.k) || results[resultKey(e.id, t.k)])
                .map((t) => {
                  const r = results[resultKey(e.id, t.k)];
                  return (
                    <div key={t.k} className="se-target">
                      <span className="se-name">{t.n}</span>
                      {r ? (
                        <span className={`deg ${r.degree.includes("success") ? "ok" : "fail"}`}>
                          {DEGREE_LABEL[r.degree]}
                          {isGm ? ` (${r.total})` : ""}
                          {r.applied !== undefined ? ` · −${r.applied} PG` : ""}
                        </span>
                      ) : canRoll(t.k) ? (
                        <button className="btn small-btn" disabled={busy} onClick={() => rollFor(e, t)}>
                          Tirar {SAVE_LABEL[e.save]}
                        </button>
                      ) : (
                        <span className="muted small">pendiente…</span>
                      )}
                      {isGm && r && (
                        <button className="link-btn" title="Borrar este resultado" onClick={() => saveResults.remove([resultKey(e.id, t.k)])}>
                          ↺
                        </button>
                      )}
                    </div>
                  );
                })}
            </div>
            {isGm && e.dmg && (
              <div className="se-foot">
                <button className="btn small-btn danger" disabled={busy || !done} onClick={() => applyBasic(e)} title="Tira el daño y lo aplica a quienes ya tiraron">
                  Aplicar daño {e.dmg} {e.ty ?? ""} {e.basic ? "(básica)" : "(a quien falle)"}
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// Para la hoja del jugador: tiradas pendientes de sus PJ y mascotas
export function PendingSaves({ charId, states, sheets }: { charId: string; states: Record<string, PcState>; sheets: Record<string, Character> }) {
  const keys = [`pc:${charId}`, ...Object.values(states).filter((s) => s.pet?.parent === charId).map((s) => `pc:${s.id}`)];
  return (
    <div className="pending-saves">
      <SaveEffectsList states={states} sheets={sheets} only={keys} pendingOnly />
    </div>
  );
}

