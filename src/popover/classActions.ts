// Pasos compartidos de algunos rasgos de clase que se disparan desde varias pestañas
import type { PcState } from "../live";
import type { RollFx } from "../fx";
import type { NoteRequest } from "./ctx";

type Patch = (fn: (s: PcState) => PcState) => void;

// Golpe de conjuro: espera un conjuro y un ataque (en cualquier orden) y luego avisa
export function spellstrikeStep(
  s: PcState | undefined,
  patch: Patch,
  notify: (n: NoteRequest) => Promise<void>,
  playFx: (fx: RollFx) => void,
  part: { attack?: string; spell?: string },
  fx?: RollFx,
) {
  const ss = s?.cls?.ss;
  if (!ss?.armed) return false;
  const next = { ...ss, ...part };
  if (next.attack && next.spell) {
    notify({ label: "Golpe de conjuro:", title: `${next.attack} + ${next.spell}`, tag: "Golpe de conjuro" });
    if (fx) playFx(fx);
    patch((x) => ({ ...x, cls: { ...x.cls, ss: { used: true } } }));
  } else {
    patch((x) => ({ ...x, cls: { ...x.cls, ss: next } }));
  }
  return true;
}
