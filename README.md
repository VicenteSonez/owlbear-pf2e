# PF2e Hojas de Personaje para Owlbear Rodeo

Extensión de Owlbear Rodeo que:

- **Importa hojas de Pathbuilder 2e** (archivo JSON o ID de Pathbuilder): clase, ascendencia, nivel, PG, CA, armas, habilidades, salvaciones, percepción y conjuros.
- **Tira dados 3D** con el bono correcto ya sumado. Las armas tienen botones de ataque con penalizador por ataque múltiple (+11 / +6 / +1, o −4/−8 si son ágiles), además de Daño y Crítico.
- Incluye un **registro de tiradas compartido** con toda la sala y **tiradas secretas** que solo ve el GM.
- **Sincroniza PG y CA con los tokens** en ambas direcciones y muestra una barra de vida y un escudo con la CA encima de cada token.

## Instalar en Owlbear (GitHub Pages)

1. Crea un repositorio en GitHub (por ejemplo `owlbear-pf2e`) y sube esta carpeta:
   ```bash
   git init
   git add .
   git commit -m "Extensión PF2e"
   git branch -M main
   git remote add origin https://github.com/TU_USUARIO/owlbear-pf2e.git
   git push -u origin main
   ```
2. En GitHub ve a **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. Espera a que termine la acción *Publicar en GitHub Pages* (pestaña **Actions**).
4. En Owlbear Rodeo abre tu perfil → **Extensions → Add Custom Extension** y pega:
   `https://TU_USUARIO.github.io/owlbear-pf2e/manifest.json`
5. Dentro de la sala, activa la extensión (menú de extensiones de la sala). Todos los jugadores la verán.

Cada vez que hagas `git push` a `main` se publica la nueva versión.

## Uso

**Jugadores**
1. Abrir la extensión (icono d20) → subir el JSON de Pathbuilder (*Menú → Export → Export JSON*) o pegar el ID.
2. Si hay un token en el mapa con el nombre del personaje (o solo uno creado por ti), se vincula automáticamente. Si no, selecciona tu token y pulsa **Vincular token**, o haz clic derecho en el token → **Vincular a mi hoja PF2e**.
3. Clic en cualquier habilidad, salvación o arma para tirar. **Mod.** suma un bono circunstancial a las pruebas de d20. **Secreta** envía la tirada solo al GM.
4. PG y CA se editan en la hoja o con clic derecho en el token → **HP / CA**. Ambos lados se mantienen sincronizados.

**GM**
- Pestaña **Grupo**: ve a todos los personajes con su PG y abre sus hojas para tirar por ellos.
- Clic derecho en cualquier token → **Añadir HP/CA (PNJ)** para enemigos. Sus estadísticas quedan ocultas a los jugadores por defecto.
- Ve el resultado de las tiradas secretas.

## Desarrollo local

```bash
npm install
npm run dev
```

En Owlbear añade `http://localhost:5173/manifest.json` como extensión personalizada para probar en vivo. Si abres `http://localhost:5173` directamente en el navegador, funciona en modo local de prueba (sin mapa ni sala), con un botón para cargar un personaje de ejemplo.

## Notas y límites

- Pathbuilder no exporta los rasgos de las armas. El rasgo **Ágil** se detecta por el nombre del arma y se puede activar o desactivar a mano en cada arma. *Deadly* y *Fatal* no se aplican automáticamente al crítico: usa la tirada libre para el dado extra.
- Los daños extra de Pathbuilder se muestran como interruptores bajo cada arma. Los de runas (fuego, etc.) vienen activados; los de **precisión** (Precise Strike, Sneak Attack) vienen apagados porque son condicionales.
- El crítico duplica el total (dados + bonos), según las reglas del Player Core.
- Los personajes se guardan en el navegador de cada jugador. Para subir de nivel, vuelve a importar el JSON: se actualizan los máximos y se conserva el vínculo con el token.
- Las tiradas secretas se ocultan en la interfaz de los jugadores, pero viajan por la sala. Un jugador con conocimientos técnicos podría verlas en las herramientas de desarrollo.
