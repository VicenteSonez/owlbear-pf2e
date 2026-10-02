// Respaldo de arranque: vite.config.ts lo pone en línea al inicio del <head> de cada página,
// así funciona aunque el resto de los archivos no cargue.
// - GitHub Pages deja el HTML hasta 10 minutos en caché. Si se publica una versión nueva en ese
//   lapso, el HTML viejo apunta a archivos que ya no existen y la página queda vacía. En ese caso
//   se recarga una vez pidiendo todo de nuevo.
// - Si la app se cae sin dibujar nada, muestra el error y un botón para recargar.
(function () {
  var key = "pf2.bootRetry." + location.pathname;
  var reloading = false;

  function reload() {
    if (reloading) return;
    reloading = true;
    fetch(location.href, { cache: "reload" })
      .catch(function () {})
      .then(function () {
        location.reload();
      });
  }

  function show(msg) {
    var root = document.getElementById("root");
    if (reloading || !root || root.childElementCount) return;
    root.innerHTML =
      '<div style="padding:24px;font:13px/1.4 system-ui,sans-serif;color:#e7e9ee">' +
      '<p style="margin:0 0 8px">No se pudo abrir la extensión.</p>' +
      '<p style="margin:0 0 12px;color:#959cab;overflow-wrap:anywhere"></p>' +
      '<button type="button" style="background:#262a33;color:#e7e9ee;border:1px solid #363b47;' +
      'border-radius:4px;padding:5px 10px;cursor:pointer">Recargar</button></div>';
    root.querySelectorAll("p")[1].textContent = msg;
    root.querySelector("button").onclick = reload;
  }

  function failedLoad(what) {
    var last = Number(sessionStorage.getItem(key)) || 0;
    // Solo un intento automático cada 30 s para no quedar en bucle
    if (Date.now() - last > 30000) {
      sessionStorage.setItem(key, String(Date.now()));
      reload();
    } else {
      show("No se pudo cargar " + what);
    }
  }

  addEventListener(
    "error",
    function (e) {
      var t = e.target;
      if (t && (t.tagName === "SCRIPT" || t.tagName === "LINK")) {
        failedLoad(t.src || t.href);
      } else {
        var msg = String((e.error && e.error.message) || e.message || "Error desconocido");
        // React vacía la raíz al caerse; se revisa después de que termine
        setTimeout(function () {
          show(msg);
        }, 0);
      }
    },
    true,
  );

  // Un import dinámico (dados 3D) que apunta a un archivo de una versión anterior
  addEventListener("vite:preloadError", function (e) {
    e.preventDefault();
    failedLoad("un módulo de la extensión");
  });
})();
