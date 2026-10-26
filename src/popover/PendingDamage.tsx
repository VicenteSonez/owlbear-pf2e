// Daño que los jugadores hicieron a PNJ: el GM lo autoriza (con resistencias) o lo descarta.
// Un golpe puede traer varias partes (arma, espíritu, fuego de una runa…): cada tipo con sus
// resistencias y debilidades.
import { useEffect, useState } from "react";
import { addPersistent, autoIwr, type IwrPick } from "../rules";
import { newId } from "../shared";
import { patchNpc } from "../obr";
import { damageReqs, useDamageReqs, type DamageReq } from "../requests";
import { NO_IWR, dealDamage, finalParts, healTarget, mergeParts, readTarget, type DamagePart, type TargetInfo } from "../damage";
import { useActions } from "./ctx";
import { IwrChips } from "./DamageBox";

function ReqRow({ r }: { r: DamageReq }) {
  const { notify } = useActions();
  const [info, setInfo] = useState<TargetInfo | null>(null);
  // Partes del mismo tipo juntas (la salpicadura se suma al daño base)
  const [parts, setParts] = useState<DamagePart[]>(() => mergeParts(r.parts?.length ? r.parts : [{ amt: r.amt, ty: r.ty }]));
  const [amts, setAmts] = useState<string[]>(() => parts.map((p) => String(p.amt)));
  const [picks, setPicks] = useState<(IwrPick | null)[]>(() => parts.map(() => null));
  // Persistentes que se aplicarán (todos marcados al llegar)
  const [persOn, setPersOn] = useState<boolean[]>(() => (r.pers ?? []).map(() => true));
  useEffect(() => {
    readTarget({ kind: "npc", tokenId: r.tok }).then(setInfo);
  }, [r.tok]);
  // Si el pedido se reemplaza (mismo id, otra hora), se vuelve a leer
  const [seenT, setSeenT] = useState(r.t);
  if (seenT !== r.t) {
    const next = mergeParts(r.parts?.length ? r.parts : [{ amt: r.amt, ty: r.ty }]);
    setSeenT(r.t);
    setParts(next);
    setAmts(next.map((p) => String(p.amt)));
    setPicks(next.map(() => null));
  }

  // Debilidad mortal: activa la mayor debilidad del objetivo aunque no coincida el tipo (en la parte del arma)
  const weak = info?.iwr?.weak ?? [];
  const mortalIdx = weak.length ? weak.reduce((best, w, i) => (w.v > weak[best].v ? i : best), 0) : -1;
  const autoFor = (i: number): IwrPick => {
    const base = autoIwr(info?.iwr, parts[i].ty, { tags: r.tags, crit: r.crit, noTagMatch: i > 0 });
    return i === 0 && r.mortal && mortalIdx >= 0 && !base.weak.includes(mortalIdx) ? { ...base, weak: [mortalIdx] } : base;
  };
  const cur = parts.map((_, i) => picks[i] ?? autoFor(i));
  const values = parts.map((p, i) => ({ ...p, amt: parseInt(amts[i], 10) || 0 }));
  const preview = finalParts(values, info?.iwr, cur);

  const apply = async () => {
    if (r.heal) {
      const n = values.reduce((a, p) => a + p.amt, 0);
      await healTarget({ kind: "npc", tokenId: r.tok }, n);
      await notify({ label: `${r.n} recupera`, title: `${n} PG`, detail: r.label, tag: "Curación", charName: r.fromName, secret: info?.hidden });
    } else {
      const res = finalParts(values, info?.iwr, cur);
      const out = await dealDamage({ kind: "npc", tokenId: r.tok }, res.total, { pick: NO_IWR });
      const pers = (r.pers ?? []).filter((_, i) => persOn[i]);
      if (pers.length) {
        await patchNpc(r.tok, (x) => {
          let list = x.cond.persistent;
          // El de solo crítico no se duplica
          for (const p of pers) list = addPersistent(list, { id: newId(), formula: p.f, type: p.ty, crit: (r.crit && !p.crit) || undefined });
          return { ...x, cond: { ...x.cond, persistent: list } };
        });
      }
      await notify({
        label: `${r.n} recibe`,
        title: `${out.total} de daño`,
        detail: [
          r.label,
          values.map((p) => `${p.amt} ${p.ty || "sin tipo"}`).join(" + "),
          res.notes,
          ...pers.map((p) => `+ ${p.f}${r.crit && !p.crit ? " ×2" : ""} persistente ${p.ty}`.trim()),
        ]
          .filter(Boolean)
          .join(" · "),
        tag: r.splash ? "Salpicadura" : r.crit ? "Crítico" : "Daño",
        charName: r.fromName,
        secret: info?.hidden,
      });
    }
    await damageReqs.remove([r.id]);
  };

  return (
    <div className={`dmg-req ${r.heal ? "heal" : ""}`}>
      <div className="dr-head">
        <b>{r.fromName}</b> → <b>{r.n}</b>
        <span className="muted small">{r.label}</span>
        {r.crit && <span className="badge bad">crítico</span>}
        {r.splash && <span className="badge">salpicadura</span>}
        {r.mortal && <span className="badge bad">debilidad mortal</span>}
        {r.tags?.map((t) => (
          <span key={t} className="badge">
            {t}
          </span>
        ))}
      </div>
      {parts.map((p, i) => (
        <div key={i} className="dr-part">
          <div className="te-row">
            <input
              className="te-amount"
              inputMode="numeric"
              value={amts[i]}
              onChange={(e) => {
                const v = e.target.value.replace(/\D/g, "");
                setAmts((l) => l.map((x, j) => (j === i ? v : x)));
              }}
            />
            <span className="muted small">{r.heal ? "curación" : p.ty || "sin tipo"}</span>
          </div>
          {!r.heal && (
            <IwrChips iwr={info?.iwr} type={p.ty} pick={cur[i]} onPick={(pk) => setPicks((l) => l.map((x, j) => (j === i ? pk : x)))} />
          )}
        </div>
      ))}
      <div className="te-row">
        {!r.heal && (
          <span className="muted small">
            Total <b>{preview.total}</b>
            {preview.notes ? ` (${preview.notes})` : ""}
          </span>
        )}
        <button className={`btn ${r.heal ? "heal" : "danger"}`} onClick={apply}>
          {r.heal ? "Curar" : "Aplicar"}
        </button>
        <button className="btn ghost" onClick={() => damageReqs.remove([r.id])}>
          Descartar
        </button>
      </div>
      {r.typed?.length ? <div className="muted small">Incluye: {r.typed.join(" · ")}</div> : null}
      {(r.pers ?? []).map((p, i) => (
        <label key={i} className="te-check" title="Se agrega al PNJ (del mismo tipo queda el mayor)">
          <input type="checkbox" checked={!!persOn[i]} onChange={(e) => {
              const on = e.target.checked;
              setPersOn((l) => l.map((v, j) => (j === i ? on : v)));
            }} />
          Persistente {p.f}
          {r.crit && !p.crit ? " ×2" : ""} {p.ty || "sin tipo"}
        </label>
      ))}
    </div>
  );
}

export function PendingDamage() {
  const reqs = Object.values(useDamageReqs()).sort((a, b) => a.t - b.t);
  if (!reqs.length) return <p className="muted small">No hay daño pendiente de autorizar.</p>;
  return (
    <div className="dmg-reqs">
      {reqs.map((r) => (
        <ReqRow key={r.id} r={r} />
      ))}
    </div>
  );
}

export const usePendingCount = () => Object.keys(useDamageReqs()).length;
