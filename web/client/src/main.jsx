import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import { config } from "./config.js";
import { dict } from "./strings.js";
import { setupLook } from "look/kit/setup.js";
import "look/tokens.css";
import "look/kit.css";
import "./app.css";

// tokens + kit + Settings → Appearance come from the shared `look` package (live ../../../_look or vendor/look)
setupLook(config, dict);
createRoot(document.getElementById("root")).render(<App />);
