// Boot: check env, migrate (inside createApp), bootstrap users + seed halls, listen.
import { createApp, dbUrlProblem, DEFAULT_DB_URL } from './app.js';
import { bootstrap } from './bootstrap.js';

const env = process.env;
const problem = dbUrlProblem(env);
if (problem) {
  console.error(problem);
  process.exit(1);
}
const { app, db } = await createApp({ dbUrl: env.DATABASE_URL || DEFAULT_DB_URL, authToken: env.DATABASE_AUTH_TOKEN || undefined, env });
await bootstrap(db, env);
const host = env.HOST || '127.0.0.1';
const port = Number(env.PORT || 5140);
app.listen(port, host, () => console.log(`company_ticket listening on http://${host}:${port}`));
