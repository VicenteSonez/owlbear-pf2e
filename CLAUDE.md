# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Owlbear Rodeo extension (SDK v3) for Pathfinder 2e. It imports Pathbuilder 2e JSON sheets, rolls 3D dice with the bonuses already added, applies PF2e conditions and rules, and keeps HP/AC in sync with map tokens. Stack: React 19, Vite 8, TypeScript. All UI text and code comments are in **Spanish**; keep them that way.

The pending feature lists live in `Prompts pendientes.docx` and `Prompts pendientes_v2.docx`, which are not committed. The work is split into phases: 1 dice ✅, 2 rules/sheet/GM tab ✅, 3 combat/initiative ✅, 4 side tabs (Dotes, Inventario, Magia, Recetas, Mascota) ✅, 5 map VFX ✅, 6 (v2 list: NPC sheets, saves, IWR, targets, spell casting, class features, more VFX) ✅.

## Commands

```bash
npm install
npm run dev      # Vite on :5173 (predev copies dice-box assets into public/dice-box)
npm run build    # tsc --noEmit && vite build. This is the only type check/lint.
```

There is no test framework. To check the parser against `public/ejemplo-pathbuilder.json`:

```bash
npx tsc src/pathbuilder.ts --ignoreConfig --outDir dist-test --module es2022 --target es2022 --skipLibCheck && node scripts/check-parser.mjs; rm -rf dist-test
```

Other Pathbuilder samples sit untracked in the repo root (`Alquimista.json`, `Espontáneo.json`, etc.). They are the user's private characters: **don't commit them**, because the repo is public. Only `Fausto.json` is allowed.

## Deploy and testing

- Every push to `main` deploys to GitHub Pages through `.github/workflows/deploy.yml`. Live manifest: `https://vicentesonez.github.io/owlbear-pf2e/manifest.json`.
- `public/manifest.json` uses root-absolute paths. The `manifestBasePath` plugin in `vite.config.ts` rewrites them with `BASE_PATH` and writes `dist/version.json`.
- Auto-update: `src/autoUpdate.ts` polls `version.json` every 60s and reloads when `__BUILD_ID__` changes. This works around the Pages cache. Every page entry calls `watchForUpdates()`.
- Opening `http://localhost:5173` directly runs **standalone mode** (no OBR): live state goes to localStorage, and in DEV builds the local user is GM. DEV builds also expose `window.__pf2` for inspecting the dice overlay and live state.
- In the built-in browser pane, Owlbear can't load a localhost manifest (`ERR_BLOCKED_BY_CLIENT`). To test inside Owlbear, push and use the Pages build.
- The extension iframes are cross-origin, so in Owlbear use screenshots and coordinate clicks. Iframes must use `color-scheme: normal` to stay transparent.

## Architecture

There are four Vite entry pages, each its own Owlbear iframe:

| Page | Entry | Role |
|---|---|---|
| `index.html` | `src/popover/` | Action popover: sheet, dice, GM tab, importer |
| `background.html` | `src/background/main.ts` | Always running: context menus, token overlays, toast popover manager |
| `token.html` | `src/token/main.tsx` | Context-menu embed: HP/AC/conditions editor for one token |
| `toast.html` | `src/toast/main.tsx` | Roll result cards (bottom right). The background opens, sizes and closes it; cards are read from localStorage |

### State: where each piece lives

- **Character sheet** (`Character` from `src/pathbuilder.ts`): stored in the owning player's browser localStorage (`src/storage.ts`, raw JSON at `pf2.raw.<id>`). It is published to others through player metadata (`META_PLAYER`). The GM caches the sheets it sees.
  - `PARSER_VERSION`: bump it when parser output changes. Stored characters re-parse from raw JSON automatically.
- **Live PC state** (`PcState` in `src/live.ts`): HP, temp, dying/wounded, conditions, shield, hero points, AC adjustment. It lives in **room metadata**, one key per character (`cl.nacho.pf2e-sheets/pc/<id>`), so every client sees it and anyone can edit it.
  - Room metadata is capped at about 16KB in total, so keep the state small.
  - Access it through the `live` singleton and the `useLiveStates()` hook.
- **Token link / NPC state**: scene item metadata (`META_TOKEN`, `TokenData` in `src/shared.ts`).
  - PC tokens hold only `{kind:"pc", characterId, ownerId}`; their numbers come from live state.
  - NPC tokens hold their own HP/AC/cond. Read them through `npcState()` and write through `patchNpc()`.
  - `patchNpc` runs its updater **after** an await (OBR fetches the items first), so read `e.target.value`/`checked` into a const before calling it: by then React has reset the controlled input.
  - What players see of an NPC is `npcPlayerView()`: `hidden` hides the numbers (bar with a word like "Malherido" + conditions, no AC), `veil` hides everything. New NPCs start with numbers hidden.
  - `nick` is the name the GM chose (`renameToken` also renames the Owlbear item). Always build NPC names with `npcLabel({ name, num, nick })`.
- **PC names**: the owner can rename their character from the sheet header. The nickname lives in localStorage (`pf2.nicks`) and `store.characters()` applies it, so the sheet, live state and published sheet all use it.
- **Side tabs** (`src/popover/side/`: Dotes, Inventario, Magia, Recetas, Mascota) split their data by who can edit it. Magia is always shown: it also lists scrolls (inventory items named "Scroll of…", consumed on use through `Extras.gone`/`qty`) and spells added by hand (`Extras.xspells`, uses in `PcState.res.used["x:<id>"]`). Attacks added by hand are `Extras.weapons` (`customWeapon()` in `strike.ts`).
  - Resources the GM can also change (focus points, spent slots, Advanced Alchemy, Versatile Vials) go in `PcState.res`. Slot keys are `"<caster>:<rank>"`: a spent count for spontaneous casters, a bitmask for prepared ones.
  - The owner's notes (quantities, invested, money, renamed entries, feat notes, pet modifiers) go in `Extras` (`src/extras.ts`, localStorage `pf2.extras.<charId>`). They're published with the sheet in player metadata, so the GM sees them read-only.
  - Pets get their own `PcState` (`petStateId()`, `pet` field) to reuse HP bars, the token editor and the GM panel. They're left out of initiative.
  - The eidolon has `pet.shared`: its HP live in the summoner's state. Always patch HP through `live.hpHolder(id)` (or `dealDamage`/`healTarget`).
  - Spell config (description, attack/save/effect, damage, effect design) is in `Extras.spells`, keyed by spell name.
- **Targets and class state** (in `PcState`): `target` (NPC token the PC attacks), `color` (its target ring), `iwr`, and `cls` (`ClassState` from `src/classes.ts`: rage, panache, prey, taunt, stratagem, overdrive, runes…). NPCs keep the same kind of data in their token (`level`, `num`, `saves`, `attacks`, `spells`, `shield`, `iwr`, `target`).
- **Rolls**: sent with `OBR.broadcast` on `CHANNEL_ROLL` (destination ALL). `visibleEntry()` hides secret rolls from non-GMs. The log and toasts are kept per browser.
  - `kind: "note"` entries are notices without dice (spell cast, tactic, rune…). They're published with `notify()`.
  - `label` is the small line on top and `title` the big name (spell, feature, ability). Toast cards grow with their text: `toastCardHeight()` in `shared.ts` is used by both the toast page and the background, which sizes the popover.
  - `RollRequest.vs` compares the roll with a DC/AC and fills `degree`; the DC is only shown when `showDc` is set.
- **Shared requests** (`src/requests.ts`): one room key per request so players don't overwrite each other.
  - Damage requests (`${ID}/dmg/<id>`): a PC hits an NPC; the GM authorizes it (with IWR) in GM → "Daño pendiente".
  - Save effects (`${ID}/sv/<id>`) and one result key per target (`${ID}/svr/<id>|<target>`). They stay until the GM closes them.
- **Popover actions**: `ActionsContext` (`src/popover/ctx.ts`) gives `roll`, `notify`, `publish` and `playFx` to any panel.
- **Combat** (`src/combat.ts`):
  - The `Combat` object (round, current turn, NPC combatants, excluded PCs) lives in one room key, `META_COMBAT`, and **only the GM writes it**.
  - Each PC's initiative lives in its own `PcState.init`, so players rolling at the same moment don't overwrite each other.
  - Order is derived in `combatEntries()`: initiative descending, then the tiebreak `tb` (NPCs beat PCs unless the PC has `winsTies`). The GM's ▲/▼ buttons rewrite `init`/`tb`.
  - Turn effects in `src/turns.ts` run only on the GM's client, inside `useCombatActions().step`:
    - end of turn: persistent damage, Frightened −1;
    - start of turn: fast healing, lower the shield, recovery check.
  - The background script draws the gold ring on the token whose turn it is and notifies that PC's owner.

### Damage, targets and class features

- Persistent damage of the same type doesn't stack: `addPersistent()` keeps the highest (by average) and `persistentByType()` rolls one damage and one flat check per type. `crit` doubles it. Weapons (`Weapon.pers`, set in `WeaponFlags`), the player's custom damage mods and NPC attacks can carry persistent damage; it travels in `DamageReq.pers` for the GM to confirm.
- IWR entries can repeat a type with an origin (`n`); `off` marks a situational one that `autoIwr` doesn't pick.
- `src/damage.ts` applies damage/healing to any target (`TargetRef`: PC/pet or NPC token) with immunity, resistance (highest only), weakness (added after the total) and shield block. Use it instead of patching HP directly.
- `src/classes.ts` is pure: `featuresOf(c)` detects class features **by feat/special name** (so archetype dedications work too) and has the per-level numbers.
- `src/strike.ts` is pure: weapon attack and damage with conditions, the player's custom mods, the chosen target and class features (Rage, Sneak Attack, Precise Strike, stratagem…).
- Temporary bonuses from others (Courageous Anthem, taunt's off-guard…) are `Buff`s inside `Conditions.buffs`. `until` expires them at the start/end of someone's turn (`expireAll` in `turns.ts`).
- The Guardian's taunt is stored on the guardian (`cls.taunt`) and applied when the NPC attacks, because players can't write NPC tokens.

### Rules engine

`src/rules.ts` is pure and has no OBR imports. Put new rule logic here.

- Bonus stacking: highest bonus and worst penalty per type; untyped values add up.
- Which conditions affect which roll context (`conditionMods`).
- Effective AC (shield, cover) and effective max HP (drained).
- Dying/wounded transitions, recovery checks, degree of success with nat 20/1 shifts.
- Shield block, hardness and broken at half HP.

The UI shows values that already include conditions.

### Other modules

- `src/autoRoll.ts`: rolls without UI (flat checks, recovery, persistent damage).
- `src/dice.ts`: formula parsing/evaluation and the `Dice3D` wrapper around `@3d-dice/dice-box`.
  - Dice scale is capped at 8. Above that the physics returns face 0 or -1, and roll values fall back to random.
- `src/obr.ts`: OBR helpers (`inOwlbear`, `whenReady`, token link/unlink, `findTokenFor`).
- `src/background/main.ts` draws token overlays as **local** items: HP bar, AC hexagon and a condition icon row. Icons come from `public/icons/cond/*.svg`. Overlays redraw on both scene changes and live-state changes.

### Map effects (VFX)

- `src/fx.ts`: one SkSL shader per effect (heal, damage, shield, spell, stars, plus 7 white attack effects) and their durations.
  - The shaders draw in cell units around the region's center, using uniforms `p` (progress 0..1), `cells` (region side), `dir` and `r` (token radius).
  - To check a shader without Owlbear, compile and render it with `canvaskit-wasm` (`CK.RuntimeEffect.Make`).
- `src/background/fx.ts` adds them as local `EFFECT` items and advances `p` with a ~30 fps timer.
  - Owlbear's `time` uniform is Unix seconds, too large for a GPU float to animate with.
  - In Owlbear, a STANDALONE effect's `position` is its top-left corner.
- Triggers:
  - Heal, damage, shield and stars are derived on **each client** by comparing PC/pet state (`live`) and NPC token state with the previous snapshot. No messages are needed.
  - Weapon and spell attacks travel in the roll itself (`RollEntry.charId` + `fx`).
  - Effects that must be seen even when the roll is secret (NPC attacks, class effects) go on `CHANNEL_FX`. `RollFx.from`/`to` are token ids or `pc:<id>`; with `to`, attacks fly toward that token (`playAttackTo`).
  - Players don't see effects on tokens that are hidden from them.
- Every shader receives `uniform vec3 col` (the chosen color). Magic designs (`MAGIC_DESIGNS`) and class effects (`CLASS_FX`) live in `fx.ts`; colors chosen by the player are in `Extras.magicFx` and `Extras.cls.colors`.
- The background also draws target rings (`syncTargets`) in each PC's/NPC's color, and markers for prey, taunt and exploit on NPC tokens. Thralls get a dashed ring and a skull badge on any token (`syncThralls`), even without PF2e data. Create Thrall without a selection opens `ThrallLinker` (link the selection or create circle tokens next to the necromancer, `src/popover/thralls.ts`).

## Conventions

- On Windows/Git Bash, heredocs containing `!` break. Use the Write/Edit tools for file contents instead.
- To remove a metadata key from an Owlbear item draft, assign `undefined`. Owlbear does not persist `delete draft.metadata[key]`.
- Pathbuilder doesn't export weapon traits. Agile, finesse and ranged are guessed from name tables in `pathbuilder.ts`, and the user can override them per weapon (`WeaponFlags` in storage).
