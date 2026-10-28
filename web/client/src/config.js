// App identity for the look kit (appId also keys the no-flash look script via vite.config.js and the prefs key).
// users: false — we have real auth (server sessions) and our own Login view, not the kit's SignIn placeholder.
export const config = {
  appId: "company-ticket",
  title: "Company Bilet",
  users: false,
  languages: ["tr", "en"], // first = default
};
