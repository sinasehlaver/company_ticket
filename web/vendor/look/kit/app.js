// The app's identity, for the kit. main.jsx calls setupLook(config) (kit/setup.js) before rendering.
// No imports here on purpose: prefs/i18n/Navbar read it and setup.js writes it without an import cycle.
export const app = { appId: "app", title: "App", users: false, languages: ["en"] };
