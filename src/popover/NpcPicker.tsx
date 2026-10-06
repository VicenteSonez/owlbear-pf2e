import { useMemo } from "react";
import { effectiveAc } from "../rules";
import { npcLabel, npcState, type NpcState } from "../shared";
import { useSceneTokens } from "./hooks";
import { useActions } from "./ctx";

export interface NpcOption {
  tok: string;
  name: string;
  state: NpcState;
  ac: number;
}

// PNJ de la escena que este cliente puede elegir (los jugadores, solo los visibles)
export function useNpcOptions(): NpcOption[] {
  const tokens = useSceneTokens();
  const { isGm } = useActions();
  return useMemo(
    () =>
      tokens
        .filter((t) => t.data.kind === "npc" && (isGm || t.item.visible))
        .map((t) => {
          const state = npcState(t.data);
          return {
            tok: t.item.id,
            name: npcLabel({ name: t.item.name || state.name, num: state.num, nick: state.nick }),
            state,
            ac: effectiveAc(state.baseAc, state.acAdj, state.cond, state.shield).ac,
          };
        })
        .sort((a, b) => a.name.localeCompare(b.name)),
    [tokens, isGm],
  );
}

export function NpcPicker(props: { value?: string; onChange: (tok: string | undefined) => void; placeholder?: string; disabled?: boolean; title?: string }) {
  const options = useNpcOptions();
  return (
    <select
      className="npc-picker"
      value={props.value ?? ""}
      disabled={props.disabled}
      title={props.title}
      onChange={(e) => props.onChange(e.target.value || undefined)}
    >
      <option value="">{props.placeholder ?? "— Elegir PNJ —"}</option>
      {options.map((o) => (
        <option key={o.tok} value={o.tok}>
          {o.name}
        </option>
      ))}
      {props.value && !options.some((o) => o.tok === props.value) && <option value={props.value}>(fuera de la escena)</option>}
    </select>
  );
}
