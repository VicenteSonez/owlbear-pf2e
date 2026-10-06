// Estado de un PNJ tal como lo puede ver cada uno: el GM ve los números; los jugadores ven
// lo que el GM deje (números, solo barra y estados, o nada)
import { effectiveAc, effectiveMaxHp } from "../rules";
import { hpColor, hpDescriptor, npcPlayerView, type NpcState } from "../shared";
import { ConditionRow } from "./bits";
import { useActions } from "./ctx";

export function NpcHpBar({ state: n, compact }: { state: NpcState; compact?: boolean }) {
  const { isGm } = useActions();
  const view = isGm ? "full" : npcPlayerView(n);
  if (view === "none") return null;
  const max = effectiveMaxHp(n.maxHp, n.level, n.cond);
  const pct = Math.max(0, Math.min(100, (n.hp / Math.max(1, max)) * 100));
  return (
    <div className={`mini-bar ${compact ? "ie-bar" : ""}`} title={view === "full" ? `${n.hp}/${max}` : undefined}>
      <div style={{ width: `${pct}%`, background: hpColor(n.hp, max) }} />
      <span>
        {view === "full" ? `${n.hp}/${max}${n.temp ? ` +${n.temp}` : ""}` : hpDescriptor(n.hp, max)}
      </span>
    </div>
  );
}

export function NpcStatus({ state: n, name }: { state: NpcState; name: string }) {
  const { isGm } = useActions();
  const view = isGm ? "full" : npcPlayerView(n);
  if (view === "none") return null;
  const ac = effectiveAc(n.baseAc, n.acAdj, n.cond, n.shield).ac;
  return (
    <div className="npc-status">
      <div className="ns-head">
        <b>{name}</b>
        {view === "full" && <span className="badge">CA {ac}</span>}
      </div>
      <NpcHpBar state={n} />
      <ConditionRow cond={n.cond} size={16} />
    </div>
  );
}
