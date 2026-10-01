import { useRef, useState } from "react";
import { parsePathbuilder, type Character } from "../pathbuilder";

interface Props {
  characters: Character[];
  activeId: string | null;
  // "gm": el GM sube la hoja de un PJ que controla él o de un jugador ausente
  mode?: "own" | "gm";
  onImported: (c: Character, raw: unknown) => void;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onCancel?: () => void;
}

export function Importer({ characters, activeId, mode = "own", onImported, onSelect, onDelete, onCancel }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [pbId, setPbId] = useState("");
  const [loading, setLoading] = useState(false);
  const [drag, setDrag] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = (raw: unknown) => {
    try {
      onImported(parsePathbuilder(raw), raw);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const readFile = async (file?: File | null) => {
    if (!file) return;
    try {
      load(JSON.parse(await file.text()));
    } catch {
      setError("No se pudo leer el archivo: ¿es un .json válido?");
    }
  };

  const fetchJson = async (url: string, failMsg: string) => {
    setLoading(true);
    try {
      const res = await fetch(url);
      const data = await res.json();
      if (data?.success === false) {
        setError(data.error === "Invalid ID." ? "Ese ID de Pathbuilder no existe." : String(data.error ?? failMsg));
        return;
      }
      load(data);
    } catch {
      setError(failMsg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="importer">
      <h2>{mode === "gm" ? "Subir la hoja de un PJ" : "Sube tu hoja de Pathbuilder 2e"}</h2>
      {mode === "gm" && (
        <p className="muted small">
          La hoja queda en la lista del GM y su estado se comparte con la sala.{" "}
          <button className="link-btn" onClick={onCancel}>
            Volver
          </button>
        </p>
      )}
      <p className="muted small">
        En Pathbuilder: Menú → Export → <b>Export JSON</b>. Descarga el archivo o copia el número de ID.
      </p>
      <div
        className={`drop ${drag ? "drag" : ""}`}
        onClick={() => fileRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          readFile(e.dataTransfer.files[0]);
        }}
      >
        Arrastra el .json aquí o haz clic para elegirlo
        <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={(e) => readFile(e.target.files?.[0])} />
      </div>
      <form
        className="free-row"
        onSubmit={(e) => {
          e.preventDefault();
          const id = pbId.replace(/\D/g, "");
          if (id)
            fetchJson(
              `https://pathbuilder2e.com/json.php?id=${id}`,
              "No se pudo conectar con Pathbuilder. Descarga el .json y súbelo como archivo.",
            );
        }}
      >
        <input value={pbId} placeholder="ID de Pathbuilder (ej. 123456)" onChange={(e) => setPbId(e.target.value)} />
        <button className="btn" disabled={loading}>{loading ? "…" : "Cargar"}</button>
      </form>
      <button
        className="btn ghost"
        onClick={() => fetchJson(new URL("ejemplo-pathbuilder.json", window.location.href).href, "No se encontró el ejemplo.")}
      >
        Probar con un personaje de ejemplo
      </button>
      {error && <p className="error">{error}</p>}

      {mode === "own" && characters.length > 0 && (
        <>
          <h2>Tus personajes</h2>
          <ul className="char-list">
            {characters.map((c) => (
              <li key={c.id} className={c.id === activeId ? "on" : ""}>
                <button className="char-pick" onClick={() => onSelect(c.id)}>
                  <b>{c.name}</b>
                  <span className="muted small">
                    {c.ancestry} {c.className} {c.level}
                  </span>
                </button>
                <button className="btn ghost" title="Eliminar de este navegador" onClick={() => onDelete(c.id)}>
                  ✕
                </button>
              </li>
            ))}
          </ul>
          <p className="muted small">
            Los personajes se guardan en este navegador. Para actualizar (subir de nivel), vuelve a importar el JSON: se
            reemplaza la hoja y se mantiene el vínculo con el token.
          </p>
        </>
      )}
    </section>
  );
}
