// Vincular siervos a la hoja del nigromante: con los tokens seleccionados en el mapa o
// creando siervos nuevos junto a su token. Aparece al lanzar Create Thrall y en la pestaña Mascota.
import { useEffect, useState } from "react";
import OBR from "@owlbear-rodeo/sdk";
import { inOwlbear } from "../../obr";
import { useActions } from "../ctx";
import { createThrallTokens, selectedTokens, withThralls } from "../thralls";
import type { SideProps } from "./types";

export function ThrallLinker(props: SideProps & { max: number; color: string; prompt?: boolean; onDone?: () => void }) {
  const { character: c, state, canEdit, patch, max, color, prompt, onDone } = props;
  const { playFx } = useActions();
  const [sel, setSel] = useState(0);
  const count = state?.cls?.thralls?.length ?? 0;

  // Cuántos tokens hay seleccionados ahora mismo en el mapa
  useEffect(() => {
    if (!inOwlbear) return;
    OBR.player.getSelection().then((ids) => setSel(ids?.length ?? 0));
    return OBR.player.onChange((p) => setSel(p.selection?.length ?? 0));
  }, []);

  const link = (ids: string[]) => {
    if (!ids.length) return;
    patch((s) => ({ ...s, cls: withThralls(s.cls ?? {}, ids, max) }));
    for (const tok of ids) playFx({ kind: "void", from: tok, color });
    onDone?.();
  };

  const linkSelected = async () => {
    const ids = (await selectedTokens()).filter((id) => id !== state?.target).slice(0, max);
    if (ids.length) link(ids);
    else if (inOwlbear) OBR.notification.show(`Selecciona hasta ${max} tokens en el mapa y vuelve a pulsar.`, "INFO");
  };

  const create = async (n: number) => {
    const ids = await createThrallTokens(c.id, n, color, count);
    link(ids);
  };

  return (
    <div className={`thrall-linker ${prompt ? "prompt" : ""}`}>
      {prompt && (
        <div className="tl-head">
          <b>☠ Create Thrall</b>
          <span className="muted small">Elige tus siervos (máx. {max})</span>
          {onDone && (
            <button className="link-btn" onClick={onDone}>
              Cerrar
            </button>
          )}
        </div>
      )}
      <div className="cb-row">
        <button className="btn primary" disabled={!canEdit || !inOwlbear} onClick={linkSelected} title="Los tokens seleccionados en el mapa pasan a ser tus siervos">
          🔗 Vincular seleccionados{sel ? ` (${sel})` : ""}
        </button>
        <button className="btn" disabled={!canEdit || !inOwlbear} onClick={() => create(1)} title="Crea un siervo junto a tu token">
          + Crear siervo
        </button>
        {max > 1 && (
          <button className="btn ghost" disabled={!canEdit || !inOwlbear} onClick={() => create(max)}>
            + Crear {max}
          </button>
        )}
      </div>
      <span className="muted small">Tienes {count}/{max} siervos. Se marcan en el mapa con una calavera de tu color.</span>
    </div>
  );
}
