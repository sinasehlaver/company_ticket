import { app } from "./app.js";
import { initPrefs, applyPrefs } from "./prefs.js";
import { extendDict } from "./i18n.js";

// Call once in main.jsx before rendering: setupLook(config, { en: {...}, tr: {...} }).
// config: { appId, title, users?, languages? } (the app's src/config.js). dict: the app's own strings, merged over the kit's.
export function setupLook(config, dict) {
  Object.assign(app, config);
  if (dict) extendDict(dict);
  initPrefs();
  applyPrefs();
}
