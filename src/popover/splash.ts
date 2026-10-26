// Distancias en el mapa para la salpicadura: qué tokens quedan a 5 pies (o más) del objetivo
import OBR from "@owlbear-rodeo/sdk";
import { inOwlbear, tokenData } from "../obr";

// Distancia en pies, de borde a borde, desde el token dado a cada token con datos PF2e
export async function distancesFrom(tokenId: string): Promise<Record<string, number>> {
  if (!inOwlbear || !(await OBR.scene.isReady())) return {};
  const [items, dpi, scale] = await Promise.all([
    OBR.scene.items.getItems((i) => !!tokenData(i)),
    OBR.scene.grid.getDpi(),
    OBR.scene.grid.getScale().catch(() => null),
  ]);
  const ft = scale?.parsed.unit === "ft" && scale.parsed.multiplier > 0 ? scale.parsed.multiplier : 5;
  const ids = items.map((i) => i.id);
  if (!ids.includes(tokenId)) return {};
  const bounds = await Promise.all(ids.map((id) => OBR.scene.items.getItemBounds([id])));
  const b0 = bounds[ids.indexOf(tokenId)];
  const out: Record<string, number> = {};
  ids.forEach((id, i) => {
    if (id === tokenId) return;
    const b = bounds[i];
    const dx = Math.max(0, Math.abs(b.center.x - b0.center.x) - (b.width + b0.width) / 2);
    const dy = Math.max(0, Math.abs(b.center.y - b0.center.y) - (b.height + b0.height) / 2);
    // Casillas de separación (se cuenta la casilla del vecino): pegado = 5 pies
    const cells = Math.round(Math.max(dx, dy) / dpi);
    out[id] = (cells + 1) * ft;
  });
  return out;
}
