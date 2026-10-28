# look — the shared app look

One linked package that gives every web app the same tokens, kit components and a Settings → Appearance section, all driven by the ui-picker picks.

- **Tokens** (`tokens.css`): palette × theme, accent, type, shape, density, motion, depth and icon weight, keyed by `data-*` attributes on `<html>`. ui-picker loads this same file.
- **Kit** (`kit/`): Dialog, Toasts, Navbar, Panel, Select, DatePicker, Settings, undo history, file save/open, i18n, prefs …
- **Table** (`kit/table.js` + `kit/Table.jsx`): text-free sort/select/keyboard behaviour (`useTable`, pure logic in `table-logic.js`) and a thin `<Table>` view with checkbox, grip, sortable headers, bulk bar, context menu.
- **Appearance**: one control per picker foundation. It defaults to the user's picks, and one app can override any of them.
- **No flash**: a Vite plugin puts the look on `<html>` before first paint.

## Quick start (in an app next to `_look/`)

```
npm install ../_look                       # adds "look": "file:../_look" (a symlink)
```

```js
// vite.config.js
import { lookPlugin } from "look/vite";
plugins: [react(), lookPlugin({ appId: config.appId })]

// src/main.jsx
import { setupLook } from "look/kit/setup.js";
import "look/tokens.css";
import "look/kit.css";
setupLook(config, { en: { /* app strings */ }, tr: { /* … */ } });

// anywhere
import { Settings } from "look/kit/Settings.jsx";   // includes <Appearance/>
```

## Commands

| Command | What it does |
|---|---|
| `npm test` | Checks look.js is current, then runs the kit tests |
| `node scripts/sync.mjs` | Regenerates `look.js` from ui-picker and the saved picks |
| `node scripts/sync.mjs --check` | Fails if `look.js` is stale or a pick no longer exists |

## How changes propagate

| You change | Then |
|---|---|
| A token or kit component in `_look/` | Every linked app has it on its next dev/build |
| The picks (re-saved `picks.json`) | Run `node scripts/sync.mjs` |
| A picker foundation option | Add its selector to `tokens.css`, then run `node scripts/sync.mjs` |

`look.js` is generated: edit the picker or `tokens.css`, never `look.js`. The picks file is only read, never written.
Deleting or moving `_look/` breaks every linked app; run `npm install` in an app to re-create its link.
