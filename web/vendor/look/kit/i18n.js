import { usePrefs } from "./prefs.js";
import { translate } from "./strings.js";

export { dict, translate, extendDict } from "./strings.js";

export function useT() {
  const { lang } = usePrefs();
  return (key, vars) => translate(lang, key, vars);
}
