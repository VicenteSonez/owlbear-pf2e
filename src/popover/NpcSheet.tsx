// Ficha del PNJ en la pestaña GM: nivel, número, salvaciones, ataques contra un PJ,
// conjuros, escudo, inmunidades/resistencias/debilidades y su objetivo en el mapa.
import { useState } from "react";
import { fmtMod } from "../pathbuilder";
import type { PcState } from "../live";
import { TARGET_COLORS } from "../live";
import { autoFlat } from "../autoRoll";
import {
  DEGREE_LABEL,
  FLAT_LABEL,
  addPersistent,
  autoIwr,
  checkAdjust,
  hiddenFrom,
  levelDc,
  modsText,
  stackMods,
  targetFlatDc,
  withBuff,
  type Degree,
  type IwrPick,
} from "../rules";
import { ikonVsAttack } from "../classes";
import { PLAYER_VIEW_LABEL, SAVE_LABEL, newId, npcLabel, npcPlayerView, type DamageSpec, type NpcAttack, type NpcSpell, type NpcState, type PersistentSpec, type SaveKey } from "../shared";
import { live } from "../live";
import { findTokenFor, inOwlbear, renameToken, tokenData } from "../obr";
import { parseFormula } from "../dice";
import { ATTACK_FX, type AttackFx } from "../fx";
import { NO_IWR, dealDamage, finalParts, mergeParts, readTarget, type TargetInfo, type TargetRef } from "../damage";
import { damageText, fixedCooldown, npcAtkMods, npcDamage, spellAtkOf, spellDcOf, spellReady, spendSpell } from "../npc";
import OBR from "@owlbear-rodeo/sdk";
import { useActions } from "./ctx";
import { NumInput } from "./bits";
import { IwrChips, IwrEditor, DamageTypeList } from "./DamageBox";
import { ShieldCard } from "./ShieldCard";
import { SaveRequestForm } from "./SavesPanel";
import { ModsEditor } from "./ModsEditor";
import { ExtraDamage, NpcSpells } from "./NpcSpells";
import { NpcSkills } from "./NpcSkills";
import { distancesFrom } from "./splash";

const MAP_LABEL = ["1º", "2º", "3º"];

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
  dmg2?: DamageSpec[];
  melee: boolean;
  thrown?: boolean;
  pers?: PersistentSpec;
  degree: Degree;
  target: TargetInfo;
  spell?: boolean;
  // El objetivo estaba desprevenido (para los bonos "solo si está desprevenido")
  og?: boolean;
}

const validFormula = (f: string) => {
  try {
    parseFormula(f);
    return true;
  } catch {
    return false;
  }
};

const parseMod = (t: string) => {
  const n = parseInt(t.replace(/[^\d-]/g, ""), 10);
  return Number.isFinite(n) ? n : 0;
};

export function NpcSheet({ tokenId, itemName, state: n, states, onPatch }: Props) {
  const { roll, notify, publish, playFx, meId } = useActions();
  const name = npcLabel({ name: itemName || n.name, num: n.num, nick: n.nick });
  const [last, setLast] = useState<LastHit | null>(null);
  // Resistencias elegidas a mano, por tipo de daño (si no, las que coinciden)
  const [picks, setPicks] = useState<Record<string, IwrPick>>({});
  const [block, setBlock] = useState(false);
  // Aplicar también el daño persistente del golpe
  const [withPers, setWithPers] = useState(true);
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

  // Objetivo escondido u oculto de este PNJ: prueba plana (secreta) antes; con un fallo, falla
  const flatCheck = async (what: string, pc: PcState | undefined) => {
    const dc = targetFlatDc(pc?.cond, `npc:${tokenId}`);
    if (!dc) return true;
    const r = await roll({ label: `${name}: ${what}: prueba plana (${FLAT_LABEL[dc]})`, formula: "1d20", kind: "flat", flat: { dc, label: FLAT_LABEL[dc] }, secret: true, charName: name }, { quick: true });
    if (r?.degree === "success") return true;
    if (r) await notify({ label: `${name}: ${what} contra ${pc?.name ?? "su objetivo"}:`, title: "Falla", detail: `No supera la prueba plana CD ${dc}`, tag: "Ataque", charName: name, secret });
    return false;
  };
  // Atacar revela al PNJ escondido (el invisible sigue escondido)
  const reveal = () => {
    if (n.cond.hidden && !n.cond.invisible) onPatch((x) => ({ ...x, cond: { ...x.cond, hidden: undefined, hidFrom: undefined } }));
  };

  const rollAttack = async (a: NpcAttack, map: number) => {
    if (!n.target) return;
    const tgt = await readTarget({ kind: "pc", id: n.target.slice(3) });
    if (!tgt) return;
    const pc = states[n.target.slice(3)];
    if (!(await flatCheck(a.n || "Ataque", pc))) {
      reveal();
      return;
    }
    // Íconos del ejemplar: Mancha llamativa (−1 c. a c.) y Mirada afilada (+2 CA a distancia)
    const ik = ikonVsAttack(pc, a.melee);
    const step = (a.agile ? 4 : 5) * map;
    // Burlar (explorador): +1 circunstancial a la CA contra su presa
    const outwit = pc?.cls?.prey === tokenId && pc.cls.edge === "outwit" ? 1 : 0;
    // El PJ no ve al PNJ escondido: queda desprevenido ante el ataque
    const og = hiddenFrom(n.cond, n.target) && !pc?.cond.offGuard ? 2 : 0;
    const offGuard = !!og || !!pc?.cond.offGuard;
    // Condiciones, íconos del ejemplar y los bonos a mano del PNJ
    const adj = stackMods([...checkAdjust(cond, { kind: "attack", melee: a.melee, finesse: !!a.dex, target: n.target }).applied, ...ik.atk, ...npcAtkMods(n.mods, offGuard)]);
    const r = await roll(
      {
        label: `${name}: ${a.n || "Ataque"} (${MAP_LABEL[map]})`,
        formula: `1d20${fmtMod(a.atk + adj.total - step)}`,
        kind: "check",
        notes: [modsText(adj.applied), ik.notes, og ? "Objetivo desprevenido (no lo ve)" : ""].filter(Boolean).join(" · ") || undefined,
        vs: { dc: tgt.ac + outwit + ik.ac - og, name: tgt.name },
        secret: true,
        charName: name,
        tag: "Ataque",
      },
      { quick: true },
    );
    if (!r?.degree) return;
    reveal();
    // El efecto solo se ve si el ataque acierta
    const fx = a.fx ?? (a.melee ? "slash" : "arrow");
    if (fx !== "none" && (r.degree === "success" || r.degree === "crit-success")) playFx({ kind: fx, from: tokenId, to: fxTo });
    // Provocado: si ataca a alguien que no es el guardián queda desprevenido hasta su próximo turno
    if (taunter && `pc:${taunter.id}` !== n.target) {
      onPatch((x) => ({
        ...x,
        cond: withBuff(x.cond, { id: "taunt-og", n: "Desprevenido (Provocar)", ty: "circumstance", ac: -2, icon: "off-guard", until: { key: `npc:${tokenId}`, at: "start" } }),
      }));
    }
    setLast({ label: a.n || "Ataque", dmg: a.dmg, ty: a.ty, dmg2: a.dmg2, melee: a.melee, thrown: a.thrown, pers: a.pers, degree: r.degree, target: tgt, og: offGuard });
    setPicks({});
    setBlock(false);
    setWithPers(true);
  };

  // Daño del golpe: fórmula del ataque, otros tipos y bonos a mano (los conjuros no llevan bonos ni Débil)
  const hitDamage = (h: LastHit, crit: boolean) =>
    npcDamage({
      dmg: h.dmg ?? "",
      ty: h.ty ?? "",
      dmg2: h.dmg2,
      pers: h.pers,
      mods: h.spell ? undefined : n.mods,
      pen: h.spell ? [] : checkAdjust(n.cond, { kind: "damage", melee: h.melee, str: h.thrown }).applied,
      crit,
      og: h.og,
    });
  // Tipos que recibe el objetivo (la salpicadura se suma al de su tipo)
  const hitTypes = (h: LastHit, crit: boolean) => {
    const d = hitDamage(h, crit);
    return mergeParts([{ amt: 0, ty: d.ty }, ...d.groups.map((g) => ({ amt: 0, ty: g.ty }))]).map((p) => p.ty);
  };
  const pickFor = (h: LastHit, ty: string, i: number, crit: boolean) => picks[ty.toLowerCase()] ?? autoIwr(h.target.iwr, ty, { crit, noTagMatch: i > 0 });

  // Salpicadura a los que estén a 5 pies del objetivo (sin contar al propio PNJ)
  const splashNearby = async (h: LastHit, amt: number, ty: string) => {
    if (!inOwlbear || amt <= 0 || h.target.ref.kind !== "pc") return [];
    const tok = await findTokenFor(h.target.ref.id);
    if (!tok) return [];
    const dist = await distancesFrom(tok.id);
    const ids = Object.keys(dist).filter((id) => dist[id] <= 5 && id !== tokenId);
    const items = ids.length ? await OBR.scene.items.getItems(ids) : [];
    const out: string[] = [];
    for (const it of items) {
      const d = tokenData(it);
      const ref: TargetRef | null = d?.kind === "pc" && d.characterId ? { kind: "pc", id: d.characterId } : d?.kind === "npc" ? { kind: "npc", tokenId: it.id } : null;
      if (!ref || !d) continue;
      const r = await dealDamage(ref, amt, { type: ty });
      out.push(`${d.kind === "npc" ? npcLabel({ name: it.name || d.name, num: d.num, nick: d.nick }) : it.name} ${r.total}`);
    }
    return out;
  };

  // splashOnly: el ataque falló y solo llega la salpicadura al objetivo
  const rollDamage = async (crit: boolean, splashOnly = false) => {
    if (!last?.dmg) return;
    const d = hitDamage(last, crit && !splashOnly);
    const sp = d.groups.find((g) => g.splash);
    if (splashOnly && !sp) return;
    const groups = splashOnly ? [] : d.groups;
    const r = await roll(
      {
        label: `${name}: ${last.label} (${splashOnly ? "salpicadura" : crit ? "crítico" : "daño"})`,
        formula: splashOnly ? sp!.f : d.formula,
        extra: groups.length ? groups.map((g) => ({ f: g.f, mult: g.mult })) : undefined,
        kind: "damage",
        crit: crit && !splashOnly,
        notes: d.notes || undefined,
        secret: true,
        charName: name,
      },
      { quick: true },
    );
    if (!r) return;
    const amts = r.parts ?? [r.total];
    const raw: { amt: number; ty: string }[] = splashOnly ? [{ amt: r.total, ty: sp!.ty }] : [{ amt: amts[0] ?? r.total, ty: d.ty }, ...groups.map((g, i) => ({ amt: amts[i + 1] ?? 0, ty: g.ty }))];
    const parts = mergeParts(raw);
    const res = finalParts(parts, last.target.iwr, parts.map((p, i) => pickFor(last, p.ty, i, crit)));
    const out = await dealDamage(last.target.ref, res.total, { pick: NO_IWR, block });
    // Con un éxito la salpicadura también llega a los que están a 5 pies
    const splashIdx = sp && !splashOnly ? groups.indexOf(sp) : -1;
    const splashed = splashIdx >= 0 && last.degree.includes("success") ? await splashNearby(last, amts[splashIdx + 1] ?? 0, sp!.ty) : [];
    // Persistentes (el de "solo crítico" requiere crítico y no se duplica; si no, con crítico se duplica)
    const pers = splashOnly || !withPers ? [] : d.pers.filter((p) => validFormula(p.f));
    if (pers.length && last.target.ref.kind === "pc") {
      await live.patch(last.target.ref.id, (s) => {
        let list = s.cond.persistent;
        for (const p of pers) list = addPersistent(list, { id: newId(), formula: p.f, type: p.ty, crit: (crit && !p.crit) || undefined });
        return { ...s, cond: { ...s.cond, persistent: list } };
      });
    }
    await notify({
      label: `${name} → ${last.target.name}`,
      title: `${out.total} de daño`,
      detail: [
        parts.map((p) => `${p.amt} ${p.ty || "sin tipo"}`).join(" + "),
        res.notes,
        out.notes,
        ...pers.map((p) => `+ ${p.f}${crit && !p.crit ? " ×2" : ""} persistente ${p.ty}`.trim()),
        splashed.length ? `Salpicadura: ${splashed.join(", ")}` : "",
      ]
        .filter(Boolean)
        .join(" · "),
      tag: splashOnly ? "Salpicadura" : crit ? "Crítico" : "Daño",
      charName: name,
      secret,
    });
    setLast(null);
  };

  const castSpell = async (sp: NpcSpell) => {
    if (spellReady(n, sp)) return;
    // Enfriamiento: rondas fijas o un dado que se tira ahora (en secreto)
    let cdRounds = fixedCooldown(sp.cd);
    if (cdRounds === null) {
      const r = await roll({ label: `${name}: ${sp.n}: enfriamiento`, formula: sp.cd!.trim(), kind: "free", secret: true, charName: name }, { quick: true });
      cdRounds = Math.max(1, r?.total ?? 1);
    }
    // Se gasta el uso, el espacio o el recurso aunque Estupefacto haga perder el conjuro
    const rounds = cdRounds;
    onPatch((x) => spendSpell(x, sp.id, rounds));
    // Estupefacto: prueba plana CD 5 + X o el conjuro se pierde (los poderes no la piden)
    const stup = sp.pow ? 0 : (n.cond.stupefied ?? 0);
    if (stup > 0) {
      const flat = autoFlat({ playerId: meId, playerName: "GM", playerColor: "#e8622c" }, name, `${sp.n}: prueba de Estupefacto`, 5 + stup);
      await publish({ ...flat, secret: secret || undefined });
      if (flat.degree !== "success") {
        await notify({ label: "Pierde el conjuro:", title: sp.n, detail: `Estupefacto ${stup}: falló la prueba plana CD ${5 + stup}`, tag: "Conjuro perdido", charName: name, secret });
        return;
      }
    }
    const detail =
      sp.kind === "save" ? `Salvación de ${SAVE_LABEL[sp.save ?? "reflex"]}${sp.basic ? " básica" : ""}` : sp.kind === "atk" ? "Ataque de conjuro" : "Efecto";
    await notify({
      label: sp.pow ? "Usa" : "Lanza",
      title: sp.n,
      detail: [detail, sp.area ? "Área" : "", rounds ? `Enfriamiento: ${rounds} ronda${rounds === 1 ? "" : "s"}` : ""].filter(Boolean).join(" · "),
      tag: sp.pow ? "Poder" : "Conjuro",
      charName: name,
      secret,
    });
    playFx({ kind: sp.fx ?? "arcane", from: tokenId });
    const pc = n.target?.startsWith("pc:") ? states[n.target.slice(3)] : undefined;
    // De un solo objetivo: si está escondido u oculto, prueba plana antes
    if (pc && !sp.area && !(await flatCheck(sp.n, pc))) return;
    if (sp.kind === "atk" && n.target) {
      const tgt = await readTarget({ kind: "pc", id: n.target.slice(3) });
      if (!tgt) return;
      const ik = ikonVsAttack(pc, false);
      const adj = checkAdjust(cond, { kind: "spell-attack", target: n.target });
      const og = hiddenFrom(n.cond, n.target) && !pc?.cond.offGuard ? 2 : 0;
      const r = await roll(
        {
          label: `${name}: ${sp.n} (${sp.pow ? "ataque" : "ataque de conjuro"})`,
          formula: `1d20${fmtMod(spellAtkOf(n, sp) + adj.total)}`,
          kind: "check",
          notes: [modsText(adj.applied), ik.notes].filter(Boolean).join(" · ") || undefined,
          vs: { dc: tgt.ac + ik.ac - og, name: tgt.name },
          secret: true,
          charName: name,
          tag: "Conjuro",
        },
        { quick: true },
      );
      if (r?.degree) {
        setLast({ label: sp.n, dmg: sp.dmg, ty: sp.ty, dmg2: sp.dmg2, melee: false, degree: r.degree, target: tgt, spell: true });
        setPicks({});
        setBlock(false);
      }
    }
    if (sp.kind === "save") setSaveFor(sp);
  };

  const attacks = n.attacks;
  const setAttack = (id: string, p: Partial<NpcAttack>) => onPatch((x) => ({ ...x, attacks: x.attacks.map((a) => (a.id === id ? { ...a, ...p } : a)) }));

  return (
    <div className="npc-sheet">
      <h3>PNJ</h3>
      <div className="te-row wrap">
        <label className="te-field wide" title="Nombre que ven todos (también cambia el nombre del token en Owlbear)">
          <span>Nombre</span>
          <input
            key={n.nick ?? itemName}
            defaultValue={n.nick || itemName || n.name}
            onBlur={(e) => {
              const v = e.target.value.trim();
              if (v === (n.nick || itemName || n.name)) return;
              if (inOwlbear) renameToken(tokenId, v);
            }}
            onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
          />
        </label>
        <label className="te-field" title="Qué ven los jugadores sobre el token y en el combate">
          <span>Jugadores</span>
          <select
            value={npcPlayerView(n)}
            onChange={(e) => {
              const v = e.target.value as keyof typeof PLAYER_VIEW_LABEL;
              onPatch((x) => ({ ...x, hidden: v !== "full", veil: v === "none" || undefined }));
            }}
          >
            <option value="full">Ven todo (PG y CA)</option>
            <option value="status">Barra y estados, sin números</option>
            <option value="none">No ven nada</option>
          </select>
        </label>
      </div>
      <div className="te-row wrap">
        <NumInput label="Nivel" value={n.level} title="Para la CD estándar y Drenado" onCommit={(v) => onPatch((x) => ({ ...x, level: Math.max(-1, Math.min(25, v)) }))} />
        <NumInput label="Nº" value={n.num ?? 0} title="Número para distinguir criaturas iguales (0 = sin número)" onCommit={(v) => onPatch((x) => ({ ...x, num: v > 0 ? v : undefined }))} />
        <NumInput label="PG máx" value={n.maxHp} onCommit={(v) => onPatch((x) => ({ ...x, maxHp: Math.max(1, v), hp: Math.min(x.hp, Math.max(1, v)) }))} />
        <NumInput label="CA base" value={n.baseAc} onCommit={(v) => onPatch((x) => ({ ...x, baseAc: v }))} />
        <span className="npc-dc" title="CD estándar por nivel">
          CD nv. <b>{levelDc(Math.max(0, n.level))}</b>
        </span>
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

      <NpcSkills tokenId={tokenId} name={name} n={n} onPatch={onPatch} />

      <h3>Objetivo</h3>
      <div className="te-row wrap">
        <select
          className="npc-target"
          value={n.target ?? ""}
          onChange={(e) => {
            // El valor se lee ya: el parche corre después y React habrá devuelto el select a su valor
            const target = e.target.value || undefined;
            onPatch((x) => ({ ...x, target }));
          }}
        >
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
            <ExtraDamage list={a.dmg2} onChange={(dmg2) => setAttack(a.id, { dmg2 })} />
            <button className={`chip ${a.melee ? "on" : ""}`} onClick={() => setAttack(a.id, { melee: !a.melee })}>
              {a.melee ? "Cuerpo a cuerpo" : "A distancia"}
            </button>
            <button className={`chip ${a.dex ? "on" : ""}`} title="Fuerza: lo afecta Débil · Destreza: lo afecta Torpe" onClick={() => setAttack(a.id, { dex: !a.dex })}>
              {a.dex ? "Destreza" : "Fuerza"}
            </button>
            <button className={`chip ${a.agile ? "on" : ""}`} onClick={() => setAttack(a.id, { agile: !a.agile })}>
              Ágil
            </button>
            {!a.melee && (
              <button className={`chip ${a.thrown ? "on" : ""}`} title="Arrojadiza: el daño suma Fuerza (lo penaliza Débil)" onClick={() => setAttack(a.id, { thrown: !a.thrown || undefined })}>
                Arrojadiza
              </button>
            )}
            <input
              className="md"
              placeholder="Persist."
              title="Daño persistente del golpe (1d6)"
              defaultValue={a.pers?.f}
              onBlur={(e) => {
                const f = e.target.value.trim();
                setAttack(a.id, { pers: f ? { ty: "", ...a.pers, f } : undefined });
              }}
            />
            {a.pers && (
              <>
                <input className="md" list="pf2-damage-types" placeholder="Tipo pers." defaultValue={a.pers.ty} onBlur={(e) => setAttack(a.id, { pers: { ...a.pers!, ty: e.target.value.trim() } })} />
                <button className={`chip ${a.pers.crit ? "on" : ""}`} title="El persistente solo aparece con un crítico" onClick={() => setAttack(a.id, { pers: { ...a.pers!, crit: a.pers!.crit ? undefined : true } })}>
                  Solo crítico
                </button>
              </>
            )}
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
                {damageText(a.dmg, a.ty, a.dmg2)} · {a.melee ? "c. a c." : a.thrown ? "arrojadiza" : "distancia"} · {a.dex ? "Des" : "Fue"}
                {a.agile ? " · ágil" : ""}
                {a.pers ? ` · ${a.pers.f} persist. ${a.pers.ty}${a.pers.crit ? " (crítico)" : ""}` : ""}
              </span>
            </div>
            <div className="weapon-btns">
              {[0, 1, 2].map((m) => {
                const adj = stackMods([...checkAdjust(cond, { kind: "attack", melee: a.melee, finesse: !!a.dex, target: n.target }).applied, ...npcAtkMods(n.mods)]);
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
      <ModsEditor mods={n.mods ?? []} canEdit onChange={(fn) => onPatch((x) => {
          const mods = fn(x.mods ?? []);
          return { ...x, mods: mods.length ? mods : undefined };
        })} />

      {last && (
        <div className={`npc-last ${last.degree.includes("success") ? "ok" : "fail"}`}>
          <div>
            <b>{last.label}</b> → {last.target.name}: <span className="deg">{DEGREE_LABEL[last.degree]}</span>
          </div>
          {last.dmg ? (
            (() => {
              const crit = last.degree === "crit-success";
              const d = hitDamage(last, crit);
              const types = hitTypes(last, crit);
              // Persistentes posibles (los de solo crítico también, para saber que existen)
              const allPers = hitDamage(last, true).pers;
              const splash = d.groups.some((g) => g.splash);
              return (
                <>
                  <div className="muted small">
                    {d.shown}
                    {d.notes ? ` · ${d.notes}` : ""}
                  </div>
                  {types.map((ty, i) => (
                    <div key={ty || i} className="dr-part">
                      {types.length > 1 && <span className="muted small">{ty || "sin tipo"}</span>}
                      <IwrChips
                        iwr={last.target.iwr}
                        type={ty}
                        pick={pickFor(last, ty, i, crit)}
                        onPick={(pk) => setPicks((m) => ({ ...m, [ty.toLowerCase()]: pk }))}
                        shield={i === 0 ? last.target.shield : undefined}
                        block={block}
                        onBlock={i === 0 ? setBlock : undefined}
                      />
                    </div>
                  ))}
                  {allPers.length > 0 && (
                    <label className="te-check" title="Se agrega al objetivo (del mismo tipo queda el mayor)">
                      <input type="checkbox" checked={withPers} onChange={(e) => setWithPers(e.target.checked)} />
                      Persistente {allPers.map((p) => `${p.f} ${p.ty}${p.crit ? " (solo con crítico)" : ""}`.trim()).join(", ")} · con crítico ×2
                    </label>
                  )}
                  <div className="te-row">
                    <button className="btn danger" onClick={() => rollDamage(crit)}>
                      {crit ? "Daño crítico (×2)" : "Tirar daño"} {damageText(last.dmg, undefined, last.dmg2)}
                    </button>
                    {!crit && (
                      <button className="btn crit" onClick={() => rollDamage(true)}>
                        Crítico
                      </button>
                    )}
                    {splash && last.degree === "failure" && (
                      <button className="btn ghost" title="Falló: solo la salpicadura llega al objetivo" onClick={() => rollDamage(false, true)}>
                        Solo salpicadura
                      </button>
                    )}
                    <button className="btn ghost" onClick={() => setLast(null)}>
                      Cerrar
                    </button>
                  </div>
                </>
              );
            })()
          ) : (
            <button className="btn ghost" onClick={() => setLast(null)}>
              Cerrar
            </button>
          )}
        </div>
      )}

      <h3>
        Conjuros y poderes
        <button className={`btn ghost small-btn ${editSp ? "on" : ""}`} onClick={() => setEditSp((e) => !e)}>
          {editSp ? "Listo" : "✎ Editar"}
        </button>
      </h3>
      <NpcSpells
        n={n}
        edit={editSp}
        onPatch={onPatch}
        onCast={castSpell}
        blocked={(sp) => (sp.kind === "atk" && !n.target ? "Elige un objetivo" : null)}
      />
      {saveFor && (
        <SaveRequestForm
          // Otro conjuro o poder: el formulario empieza de nuevo con su CD y daño
          key={saveFor.id}
          states={states}
          defaults={{
            name: saveFor.n,
            save: saveFor.save,
            // Provocado: −1 a la CD si el objetivo no es el guardián
            dc: spellDcOf(n, saveFor, levelDc(Math.max(0, n.level))) - (taunter && n.target !== `pc:${taunter.id}` ? 1 : 0),
            basic: saveFor.basic,
            dmg: saveFor.dmg,
            ty: saveFor.ty,
            dmg2: saveFor.dmg2,
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
