// Ficha del PNJ en la pestaña GM: nivel, número, salvaciones, ataques contra un PJ,
// conjuros, escudo, inmunidades/resistencias/debilidades y su objetivo en el mapa.
import { useState } from "react";
import { fmtMod } from "../pathbuilder";
import type { PcState } from "../live";
import { TARGET_COLORS } from "../live";
import { autoFlat } from "../autoRoll";
import {
  DEGREE_LABEL,
  autoIwr,
  checkAdjust,
  levelDc,
  modsText,
  withBuff,
  type Degree,
  type IwrPick,
} from "../rules";
import { SAVE_LABEL, newId, npcLabel, type NpcAttack, type NpcSpell, type NpcState, type SaveKey, type SpellKind } from "../shared";
import { ATTACK_FX, MAGIC_DESIGNS, type AttackFx, type MagicDesign } from "../fx";
import { dealDamage, readTarget, type TargetInfo } from "../damage";
import { useActions } from "./ctx";
import { NumInput } from "./bits";
import { IwrChips, IwrEditor, DamageTypeList } from "./DamageBox";
import { ShieldCard } from "./ShieldCard";
import { SaveRequestForm } from "./SavesPanel";

const MAP_LABEL = ["1º", "2º", "3º"];
const KIND_LABEL: Record<SpellKind, string> = { atk: "Ataque", save: "Salvación", fx: "Efecto" };

interface Props {
  tokenId: string;
  itemName: string;
  state: NpcState;
  states: Record<string, PcState>;
  onPatch: (fn: (n: NpcState) => NpcState) => void;
}

// Resultado del último ataque (o conjuro de ataque) para tirar el daño después
interface LastHit {
  label: string;
  dmg?: string;
  ty?: string;
  melee: boolean;
  degree: Degree;
  target: TargetInfo;
  spell?: boolean;
}

const parseMod = (t: string) => {
  const n = parseInt(t.replace(/[^\d-]/g, ""), 10);
  return Number.isFinite(n) ? n : 0;
};

export function NpcSheet({ tokenId, itemName, state: n, states, onPatch }: Props) {
  const { roll, notify, publish, playFx, meId } = useActions();
  const name = npcLabel({ name: itemName || n.name, num: n.num });
  const [last, setLast] = useState<LastHit | null>(null);
  const [pick, setPick] = useState<IwrPick | null>(null);
  const [block, setBlock] = useState(false);
  const [editAtk, setEditAtk] = useState(false);
  const [editSp, setEditSp] = useState(false);
  const [saveFor, setSaveFor] = useState<NpcSpell | null>(null);
  const targetPc = n.target?.startsWith("pc:") ? states[n.target.slice(3)] : undefined;
  const who = { id: meId, name };
  const secret = n.hidden;

  const fxTo = n.target;
  // Provocado por un guardián: −1 contra cualquiera que no sea él (se calcula, no se guarda)
  const taunter = Object.values(states).find((s) => s.cls?.taunt === tokenId);
  const cond = taunter
    ? withBuff(n.cond, { id: "taunted", n: `Provocado por ${taunter.name}`, ty: "circumstance", vsOthers: { v: -1, except: `pc:${taunter.id}` } })
    : n.cond;

  const rollAttack = async (a: NpcAttack, map: number) => {
    if (!n.target) return;
    const tgt = await readTarget({ kind: "pc", id: n.target.slice(3) });
    if (!tgt) return;
    const adj = checkAdjust(cond, { kind: "attack", melee: a.melee, finesse: !!a.dex, target: n.target });
    const step = (a.agile ? 4 : 5) * map;
    // Burlar (explorador): +1 circunstancial a la CA contra su presa
    const pc = states[n.target.slice(3)];
    const outwit = pc?.cls?.prey === tokenId && pc.cls.edge === "outwit" ? 1 : 0;
    const r = await roll(
      {
        label: `${name}: ${a.n || "Ataque"} (${MAP_LABEL[map]})`,
        formula: `1d20${fmtMod(a.atk + adj.total - step)}`,
        kind: "check",
        notes: modsText(adj.applied) || undefined,
        vs: { dc: tgt.ac + outwit, name: tgt.name },
        secret: true,
        charName: name,
        tag: "Ataque",
      },
      { quick: true },
    );
    if (!r?.degree) return;
    const fx = a.fx ?? (a.melee ? "slash" : "arrow");
    if (fx !== "none") playFx({ kind: fx, from: tokenId, to: fxTo });
    // Provocado: si ataca a alguien que no es el guardián queda desprevenido hasta su próximo turno
    if (taunter && `pc:${taunter.id}` !== n.target) {
      onPatch((x) => ({
        ...x,
        cond: withBuff(x.cond, { id: "taunt-og", n: "Desprevenido (Provocar)", ty: "circumstance", ac: -2, icon: "off-guard", until: { key: `npc:${tokenId}`, at: "start" } }),
      }));
    }
    setLast({ label: a.n || "Ataque", dmg: a.dmg, ty: a.ty, melee: a.melee, degree: r.degree, target: tgt });
    setPick(null);
    setBlock(false);
  };

  const rollDamage = async (crit: boolean) => {
    if (!last?.dmg) return;
    const pen = last.spell ? { total: 0, applied: [] } : checkAdjust(n.cond, { kind: "damage", melee: last.melee });
    const r = await roll(
      {
        label: `${name}: ${last.label} (${crit ? "crítico" : "daño"})`,
        formula: last.dmg + (pen.total ? fmtMod(pen.total) : ""),
        kind: "damage",
        crit,
        notes: modsText(pen.applied) || undefined,
        secret: true,
        charName: name,
      },
      { quick: true },
    );
    if (!r) return;
    const out = await dealDamage(last.target.ref, r.total, { type: last.ty, pick: pick ?? autoIwr(last.target.iwr, last.ty ?? ""), block });
    await notify({
      label: `${last.target.name} recibe ${out.total} de daño`,
      detail: [last.ty, out.notes].filter(Boolean).join(" · "),
      tag: crit ? "Crítico" : "Daño",
      charName: name,
      secret,
    });
    setLast(null);
  };

  const castSpell = async (sp: NpcSpell) => {
    // Estupefacto: prueba plana CD 5 + X o el conjuro se pierde
    const stup = n.cond.stupefied ?? 0;
    if (stup > 0) {
      const flat = autoFlat({ playerId: meId, playerName: "GM", playerColor: "#e8622c" }, name, `${sp.n}: prueba de Estupefacto`, 5 + stup);
      await publish({ ...flat, secret: secret || undefined });
      if (flat.degree !== "success") {
        await notify({ label: `${name} pierde ${sp.n}`, detail: `Estupefacto ${stup}: falló la prueba plana CD ${5 + stup}`, tag: "Conjuro perdido", charName: name, secret });
        return;
      }
    }
    const detail =
      sp.kind === "save" ? `Salvación de ${SAVE_LABEL[sp.save ?? "reflex"]}${sp.basic ? " básica" : ""}` : sp.kind === "atk" ? "Ataque de conjuro" : "Efecto";
    await notify({ label: `${name} lanza ${sp.n}`, detail, tag: "Conjuro", charName: name, secret });
    playFx({ kind: sp.fx ?? "arcane", from: tokenId });
    if (sp.kind === "atk" && n.target) {
      const tgt = await readTarget({ kind: "pc", id: n.target.slice(3) });
      if (!tgt) return;
      const adj = checkAdjust(cond, { kind: "spell-attack", target: n.target });
      const r = await roll(
        {
          label: `${name}: ${sp.n} (ataque de conjuro)`,
          formula: `1d20${fmtMod((n.spellAtk ?? 0) + adj.total)}`,
          kind: "check",
          notes: modsText(adj.applied) || undefined,
          vs: { dc: tgt.ac, name: tgt.name },
          secret: true,
          charName: name,
          tag: "Conjuro",
        },
        { quick: true },
      );
      if (r?.degree) setLast({ label: sp.n, dmg: sp.dmg, ty: sp.ty, melee: false, degree: r.degree, target: tgt, spell: true });
    }
    if (sp.kind === "save") setSaveFor(sp);
  };

  const attacks = n.attacks;
  const spells = n.spells;
  const setAttack = (id: string, p: Partial<NpcAttack>) => onPatch((x) => ({ ...x, attacks: x.attacks.map((a) => (a.id === id ? { ...a, ...p } : a)) }));
  const setSpell = (id: string, p: Partial<NpcSpell>) => onPatch((x) => ({ ...x, spells: x.spells.map((s) => (s.id === id ? { ...s, ...p } : s)) }));

  return (
    <div className="npc-sheet">
      <h3>PNJ</h3>
      <div className="te-row wrap">
        <NumInput label="Nivel" value={n.level} title="Para la CD estándar y Drenado" onCommit={(v) => onPatch((x) => ({ ...x, level: Math.max(-1, Math.min(25, v)) }))} />
        <NumInput label="Nº" value={n.num ?? 0} title="Número para distinguir criaturas iguales (0 = sin número)" onCommit={(v) => onPatch((x) => ({ ...x, num: v > 0 ? v : undefined }))} />
        <NumInput label="PG máx" value={n.maxHp} onCommit={(v) => onPatch((x) => ({ ...x, maxHp: Math.max(1, v), hp: Math.min(x.hp, Math.max(1, v)) }))} />
        <NumInput label="CA base" value={n.baseAc} onCommit={(v) => onPatch((x) => ({ ...x, baseAc: v }))} />
        <span className="npc-dc" title="CD estándar por nivel">
          CD nv. <b>{levelDc(Math.max(0, n.level))}</b>
        </span>
        <label className="te-check">
          <input type="checkbox" checked={n.hidden} onChange={(e) => onPatch((x) => ({ ...x, hidden: e.target.checked }))} />
          Ocultar a jugadores
        </label>
      </div>
      <div className="te-row wrap">
        <NumInput label="Percepción" value={n.per ?? 0} onCommit={(v) => onPatch((x) => ({ ...x, per: v }))} />
        {(["fortitude", "reflex", "will"] as SaveKey[]).map((k) => (
          <NumInput
            key={k}
            label={SAVE_LABEL[k]}
            value={n.saves?.[k] ?? 0}
            onCommit={(v) => onPatch((x) => ({ ...x, saves: { fortitude: 0, reflex: 0, will: 0, ...x.saves, [k]: v } }))}
          />
        ))}
      </div>
      <div className="npc-quick">
        <button className="btn small-btn" onClick={() => roll({ label: `${name}: Percepción`, formula: `1d20${fmtMod((n.per ?? 0) + checkAdjust(n.cond, { kind: "perception" }).total)}`, kind: "check", secret: true, charName: name }, { quick: true })}>
          🎲 Percepción {fmtMod(n.per ?? 0)}
        </button>
        {(["fortitude", "reflex", "will"] as SaveKey[]).map((k) => {
          const adj = checkAdjust(n.cond, { kind: "save", key: k });
          return (
            <button key={k} className="btn small-btn" onClick={() => roll({ label: `${name}: ${SAVE_LABEL[k]}`, formula: `1d20${fmtMod((n.saves?.[k] ?? 0) + adj.total)}`, kind: "check", notes: modsText(adj.applied) || undefined, secret: true, charName: name }, { quick: true })}>
              🎲 {SAVE_LABEL[k]} {fmtMod((n.saves?.[k] ?? 0) + adj.total)}
            </button>
          );
        })}
      </div>

      <h3>Objetivo</h3>
      <div className="te-row wrap">
        <select className="npc-target" value={n.target ?? ""} onChange={(e) => onPatch((x) => ({ ...x, target: e.target.value || undefined }))}>
          <option value="">— Sin objetivo —</option>
          {Object.values(states)
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((s) => (
              <option key={s.id} value={`pc:${s.id}`}>
                {s.name}
              </option>
            ))}
        </select>
        <span className="swatches" title="Color de su diana sobre el objetivo">
          {TARGET_COLORS.map((c) => (
            <button key={c} className={`swatch tiny ${n.color === c ? "on" : ""}`} style={{ background: c }} onClick={() => onPatch((x) => ({ ...x, color: c }))} />
          ))}
        </span>
      </div>
      {targetPc && <p className="muted small">Ataca a {targetPc.name}: la tirada es secreta y se compara con su CA.</p>}
      {taunter && <p className="muted small">Provocado por {taunter.name}: −1 a ataques y CD contra otros; si ataca a otro queda desprevenido.</p>}

      <h3>
        Ataques
        <button className={`btn ghost small-btn ${editAtk ? "on" : ""}`} onClick={() => setEditAtk((e) => !e)}>
          {editAtk ? "Listo" : "✎ Editar"}
        </button>
      </h3>
      {attacks.length === 0 && !editAtk && <p className="muted small">Sin ataques. Pulsa ✎ Editar para agregarlos.</p>}
      {attacks.map((a) =>
        editAtk ? (
          <div key={a.id} className="npc-edit">
            <input placeholder="Nombre" defaultValue={a.n} onBlur={(e) => setAttack(a.id, { n: e.target.value.trim() })} />
            <input className="sm" placeholder="+0" defaultValue={fmtMod(a.atk)} title="Bono de ataque" onBlur={(e) => setAttack(a.id, { atk: parseMod(e.target.value) })} />
            <input className="md" placeholder="1d8+4" defaultValue={a.dmg} title="Daño" onBlur={(e) => setAttack(a.id, { dmg: e.target.value.trim() })} />
            <input className="md" list="pf2-damage-types" placeholder="Tipo" defaultValue={a.ty} onBlur={(e) => setAttack(a.id, { ty: e.target.value.trim() })} />
            <button className={`chip ${a.melee ? "on" : ""}`} onClick={() => setAttack(a.id, { melee: !a.melee })}>
              {a.melee ? "Cuerpo a cuerpo" : "A distancia"}
            </button>
            <button className={`chip ${a.dex ? "on" : ""}`} title="Fuerza: lo afecta Débil · Destreza: lo afecta Torpe" onClick={() => setAttack(a.id, { dex: !a.dex })}>
              {a.dex ? "Destreza" : "Fuerza"}
            </button>
            <button className={`chip ${a.agile ? "on" : ""}`} onClick={() => setAttack(a.id, { agile: !a.agile })}>
              Ágil
            </button>
            <select className="fx-select" value={a.fx ?? (a.melee ? "slash" : "arrow")} onChange={(e) => setAttack(a.id, { fx: e.target.value as AttackFx | "none" })}>
              <option value="none">✦ Sin efecto</option>
              {ATTACK_FX.map((f) => (
                <option key={f.id} value={f.id}>
                  ✦ {f.label}
                </option>
              ))}
            </select>
            <button className="row-x" title="Quitar" onClick={() => onPatch((x) => ({ ...x, attacks: x.attacks.filter((y) => y.id !== a.id) }))}>
              ✕
            </button>
          </div>
        ) : (
          <div key={a.id} className="weapon">
            <div className="weapon-head">
              <b>{a.n || "Ataque"}</b>
              <span className="muted small">
                {a.dmg} {a.ty} · {a.melee ? "c. a c." : "distancia"} · {a.dex ? "Des" : "Fue"}
                {a.agile ? " · ágil" : ""}
              </span>
            </div>
            <div className="weapon-btns">
              {[0, 1, 2].map((m) => {
                const adj = checkAdjust(cond, { kind: "attack", melee: a.melee, finesse: !!a.dex, target: n.target });
                return (
                  <button key={m} className={`btn ${adj.total < 0 ? "down" : ""}`} disabled={!n.target} title={n.target ? modsText(adj.applied) || undefined : "Elige un objetivo"} onClick={() => rollAttack(a, m)}>
                    {fmtMod(a.atk + adj.total - (a.agile ? 4 : 5) * m)}
                  </button>
                );
              })}
            </div>
          </div>
        ),
      )}
      {editAtk && (
        <button className="btn ghost" onClick={() => onPatch((x) => ({ ...x, attacks: [...x.attacks, { id: newId(), n: "", atk: 0, dmg: "", ty: "", melee: true }] }))}>
          + Ataque
        </button>
      )}

      {last && (
        <div className={`npc-last ${last.degree.includes("success") ? "ok" : "fail"}`}>
          <div>
            <b>{last.label}</b> → {last.target.name}: <span className="deg">{DEGREE_LABEL[last.degree]}</span>
          </div>
          {last.dmg ? (
            <>
              <IwrChips
                iwr={last.target.iwr}
                type={last.ty ?? ""}
                pick={pick ?? autoIwr(last.target.iwr, last.ty ?? "")}
                onPick={setPick}
                shield={last.target.shield}
                block={block}
                onBlock={setBlock}
              />
              <div className="te-row">
                <button className="btn danger" onClick={() => rollDamage(last.degree === "crit-success")}>
                  {last.degree === "crit-success" ? "Daño crítico (×2)" : "Tirar daño"} {last.dmg}
                </button>
                {last.degree !== "crit-success" && (
                  <button className="btn crit" onClick={() => rollDamage(true)}>
                    Crítico
                  </button>
                )}
                <button className="btn ghost" onClick={() => setLast(null)}>
                  Cerrar
                </button>
              </div>
            </>
          ) : (
            <button className="btn ghost" onClick={() => setLast(null)}>
              Cerrar
            </button>
          )}
        </div>
      )}

      <h3>
        Conjuros
        <button className={`btn ghost small-btn ${editSp ? "on" : ""}`} onClick={() => setEditSp((e) => !e)}>
          {editSp ? "Listo" : "✎ Editar"}
        </button>
      </h3>
      <div className="te-row">
        <NumInput label="Ataque de conjuro" value={n.spellAtk ?? 0} onCommit={(v) => onPatch((x) => ({ ...x, spellAtk: v }))} />
        <NumInput label="CD de conjuro" value={n.spellDc ?? 0} onCommit={(v) => onPatch((x) => ({ ...x, spellDc: v }))} />
      </div>
      {spells.length === 0 && !editSp && <p className="muted small">Sin conjuros.</p>}
      {spells.map((sp) =>
        editSp ? (
          <div key={sp.id} className="npc-edit spell">
            <input placeholder="Conjuro" defaultValue={sp.n} onBlur={(e) => setSpell(sp.id, { n: e.target.value.trim() })} />
            <select value={sp.kind} onChange={(e) => setSpell(sp.id, { kind: e.target.value as SpellKind })}>
              {(Object.keys(KIND_LABEL) as SpellKind[]).map((k) => (
                <option key={k} value={k}>
                  {KIND_LABEL[k]}
                </option>
              ))}
            </select>
            {sp.kind === "save" && (
              <>
                <select value={sp.save ?? "reflex"} onChange={(e) => setSpell(sp.id, { save: e.target.value as SaveKey })}>
                  {(["fortitude", "reflex", "will"] as SaveKey[]).map((k) => (
                    <option key={k} value={k}>
                      {SAVE_LABEL[k]}
                    </option>
                  ))}
                </select>
                <button className={`chip ${sp.basic ? "on" : ""}`} onClick={() => setSpell(sp.id, { basic: !sp.basic })}>
                  Básica
                </button>
              </>
            )}
            <input className="md" placeholder="Daño" defaultValue={sp.dmg} onBlur={(e) => setSpell(sp.id, { dmg: e.target.value.trim() || undefined })} />
            <input className="md" list="pf2-damage-types" placeholder="Tipo" defaultValue={sp.ty} onBlur={(e) => setSpell(sp.id, { ty: e.target.value.trim() || undefined })} />
            <select className="fx-select" value={sp.fx ?? "arcane"} onChange={(e) => setSpell(sp.id, { fx: e.target.value as MagicDesign })}>
              {MAGIC_DESIGNS.map((d) => (
                <option key={d.id} value={d.id}>
                  ✦ {d.label}
                </option>
              ))}
            </select>
            <button className="row-x" title="Quitar" onClick={() => onPatch((x) => ({ ...x, spells: x.spells.filter((y) => y.id !== sp.id) }))}>
              ✕
            </button>
            <textarea className="feat-notes" placeholder="Descripción" defaultValue={sp.desc} onBlur={(e) => setSpell(sp.id, { desc: e.target.value || undefined })} />
          </div>
        ) : (
          <div key={sp.id} className="spell-row npc-spell" title={sp.desc}>
            <span className="ename">{sp.n || "Conjuro"}</span>
            <span className="badge">{KIND_LABEL[sp.kind]}{sp.kind === "save" ? ` · ${SAVE_LABEL[sp.save ?? "reflex"]}` : ""}</span>
            {sp.dmg && <span className="muted small">{sp.dmg} {sp.ty}</span>}
            <button className="btn small-btn" disabled={sp.kind === "atk" && !n.target} onClick={() => castSpell(sp)}>
              Lanzar
            </button>
          </div>
        ),
      )}
      {editSp && (
        <button className="btn ghost" onClick={() => onPatch((x) => ({ ...x, spells: [...x.spells, { id: newId(), n: "", kind: "save", save: "reflex" }] }))}>
          + Conjuro
        </button>
      )}
      {saveFor && (
        <SaveRequestForm
          states={states}
          defaults={{
            name: saveFor.n,
            save: saveFor.save,
            // Provocado: −1 a la CD si el objetivo no es el guardián
            dc: (n.spellDc || levelDc(Math.max(0, n.level))) - (taunter && n.target !== `pc:${taunter.id}` ? 1 : 0),
            basic: saveFor.basic,
            dmg: saveFor.dmg,
            ty: saveFor.ty,
          }}
          targets={n.target ? [n.target] : []}
          from={who}
          onDone={() => setSaveFor(null)}
          compact
        />
      )}

      <h3>Escudo</h3>
      <ShieldCard
        shield={n.shield}
        canEdit
        onSet={(fn) => onPatch((x) => ({ ...x, shield: fn(x.shield) }))}
        onBlock={(dmg) => dealDamage({ kind: "npc", tokenId }, dmg, { block: true })}
      />

      <h3>Inmunidades, resistencias y debilidades</h3>
      <IwrEditor iwr={n.iwr} canEdit onChange={(iwr) => onPatch((x) => ({ ...x, iwr }))} />
      <DamageTypeList />
    </div>
  );
}
