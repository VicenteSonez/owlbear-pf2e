// GitHub Pages guarda las páginas en caché hasta 10 minutos. Cada página abierta de la
// extensión revisa version.json y, si hay una compilación nueva, se recarga sola.
const CHECK_EVERY_MS = 60_000;

export function watchForUpdates() {
  if (import.meta.env.DEV) return;
  const versionUrl = new URL("version.json", window.location.href).href;
  const check = async () => {
    try {
      const res = await fetch(versionUrl, { cache: "no-store" });
      const { build } = (await res.json()) as { build?: string };
      if (!build || build === __BUILD_ID__) return;
      // Evita bucles si el navegador todavía entrega la página vieja
      const key = `pf2.reloadedFor.${window.location.pathname}`;
      if (sessionStorage.getItem(key) === build) return;
      sessionStorage.setItem(key, build);
      await fetch(window.location.href, { cache: "reload" }).catch(() => undefined);
      window.location.reload();
    } catch {
      // sin red o sin version.json: se intenta en el siguiente ciclo
    }
  };
  setTimeout(check, 4_000);
  setInterval(check, CHECK_EVERY_MS);
}
