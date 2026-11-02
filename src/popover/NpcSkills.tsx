// Habilidades relevantes del PNJ (las que trae su ficha) e iniciativa: con qué tira
// (Percepción o una habilidad), un bono o penalizador extra y el botón que la mete al combate.
import { useState } from "react";
import { SKILLS, fmtMod } from "../pathbuilder";
import { modsText } from "../rules";
import { newId, type NpcSkill, type NpcState } from "../shared";
import { combatStore } from "../combat";
import { npcCheckAdjust, npcInitiative, npcSkillKey, npcSkillName } from "../npc";
import { useActions } from "./ctx";
import { NumInput } from "./bits";

interface Props {
  tokenId: string;
  name: string;
  n: NpcState;
  onPatch: (fn: (n: NpcState) => NpcState) => void;
}

const parseNum = (t: string) => {
  const v = parseInt(t.replace(/[^\d-]/g, ""), 10);
  return Number.isFinite(v) ? v : 0;
};

export function NpcSkills({ tokenId, name, n, onPatch }: Props) {
  const { roll } = useActions();
  const [edit, setEdit] = useState(false);
  const [msg, setMsg] = useState("");
  const skills = n.skills ?? [];
  const setSkills = (fn: (l: NpcSkill[]) => NpcSkill[]) =>
    onPatch((x) => {
      const l = fn(x.skills ?? []);
      return { ...x, skills: l.length ? l : undefined };
    });
  const ini = npcInitiative(n);
  const iniKey = n.init?.sk ?? "perception";

  const rollSkill = (s: NpcSkill) => {
    const adj = npcCheckAdjust(n, npcSkillKey(s));
    roll(
      { label: `${name}: ${npcSkillName(s)}`, formula: `1d20${fmtMod(s.v + adj.total)}`, kind: "check", notes: modsText(adj.applied) || undefined, secret: true, charName: name },
      { quick: true },
    );
  };

  // Tira la iniciativa (secreta) y la anota en el combate: si ya está en la lista la reemplaza
  const rollInit = async () => {
    const r = await roll(
      { label: `${name}: Iniciativa (${ini.label})`, formula: `1d20${fmtMod(ini.mod)}`, kind: "check", notes: ini.notes || undefined, secret: true, charName: name, tag: "Iniciativa" },
      { quick: true },
    );
    if (!r) return;
    await combatStore.start();
    const inList = combatStore.get().npcs.some((x) => x.tokenId === tokenId);
    await combatStore.patch((c) =>
      inList
        ? { ...c, npcs: c.npcs.map((x) => (x.tokenId === tokenId ? { ...x, name, init: r.total, mod: ini.mod, lbl: ini.label, tb: undefined } : x)) }
        : { ...c, npcs: [...c.npcs, { id: newId(), name, tokenId, mod: ini.mod, lbl: ini.label, init: r.total, hidden: n.veil || undefined }] },
    );
    setMsg(`${inList ? "Iniciativa actualizada" : "Agregado a la iniciativa"}: ${r.total}`);
    window.setTimeout(() => setMsg(""), 5000);
  };

  return (
    <>
      <h3>
        Habilidades
        <button className={`btn ghost small-btn ${edit ? "on" : ""}`} onClick={() => setEdit((e) => !e)}>
          {edit ? "Listo" : "✎ Editar"}
        </button>
      </h3>
      {!edit && skills.length === 0 && <p className="muted small">Sin habilidades anotadas: pon solo las que trae su ficha.</p>}
      {edit ? (
        <>
          {skills.map((s, i) => (
            <div key={i} className="npc-edit">
              <select
                value={s.k}
                onChange={(e) => {
                  const k = e.target.value;
                  setSkills((l) => l.map((x, j) => (j === i ? { ...x, k, n: k === "lore" ? x.n : undefined } : x)));
                }}
              >
                {SKILLS.map(([k, label]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ))}
                <option value="lore">Saber…</option>
              </select>
              {s.k === "lore" && <input placeholder="Saber de…" defaultValue={s.n} onBlur={(e) => setSkills((l) => l.map((x, j) => (j === i ? { ...x, n: e.target.value.trim() || undefined } : x)))} />}
              <input className="sm" defaultValue={fmtMod(s.v)} title="Modificador" onBlur={(e) => setSkills((l) => l.map((x, j) => (j === i ? { ...x, v: parseNum(e.target.value) } : x)))} />
              <button className="row-x" title="Quitar" onClick={() => setSkills((l) => l.filter((_, j) => j !== i))}>
                ✕
              </button>
            </div>
          ))}
          <button
            className="btn ghost"
            onClick={() => setSkills((l) => [...l, { k: SKILLS.find(([k]) => !l.some((x) => x.k === k))?.[0] ?? "lore", v: 0 }])}
          >
            + Habilidad
          </button>
        </>
      ) : (
        skills.length > 0 && (
          <div className="npc-quick">
            {skills.map((s, i) => {
              const adj = npcCheckAdjust(n, npcSkillKey(s));
              return (
                <button key={i} className={`btn small-btn ${adj.total < 0 ? "down" : ""}`} title={modsText(adj.applied) || undefined} onClick={() => rollSkill(s)}>
                  🎲 {npcSkillName(s)} {fmtMod(s.v + adj.total)}
                </button>
              );
            })}
          </div>
        )
      )}

      <div className="npc-init">
        <label className="te-field" title="Con qué tira la iniciativa: Percepción o una de sus habilidades (Sigilo si se escondía…)">
          <span>Iniciativa con</span>
          <select
            value={iniKey}
            onChange={(e) => {
              const sk = e.target.value;
              onPatch((x) => ({ ...x, init: sk === "perception" && !x.init?.b ? undefined : { ...x.init, sk } }));
            }}
          >
            <option value="perception">Percepción {fmtMod(n.per ?? 0)}</option>
            {skills.map((s, i) => (
              <option key={i} value={npcSkillKey(s)}>
                {npcSkillName(s)} {fmtMod(s.v)}
              </option>
            ))}
          </select>
        </label>
        <NumInput
          label="Bono/penal."
          value={n.init?.b ?? 0}
          title="Bono o penalizador extra a la iniciativa (rasgo, conjuro, circunstancia)"
          onCommit={(b) => onPatch((x) => ({ ...x, init: !b && (x.init?.sk ?? "perception") === "perception" ? undefined : { sk: x.init?.sk ?? "perception", b: b || undefined } }))}
        />
        <button className="btn primary" title={ini.notes || "Se tira en secreto y se anota en el combate"} onClick={rollInit}>
          🎲 Iniciativa {fmtMod(ini.mod)}
        </button>
      </div>
      {msg && <p className="ca-msg">{msg}</p>}
    </>
  );
}
