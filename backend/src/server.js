import { createApp } from './app.js';
import { ensureAdmin } from './bootstrap.js';
import { assertConfig, config } from './config.js';
import { pool } from './db.js';
import { mailMode } from './services/mailer.js';
import { startScheduler } from './services/scheduler.js';

async function waitForDatabase(retries = 30) {
  for (let i = 1; i <= retries; i++) {
    try {
      await pool.query('SELECT 1 FROM users LIMIT 1');
      return;
    } catch (err) {
      if (i === retries) throw err;
      console.log(`[démarrage] Base de données pas encore prête (${err.code || err.message}), nouvel essai…`);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}

async function main() {
  assertConfig();
  await waitForDatabase();
  await ensureAdmin();

  const app = createApp();
  const scheduler = startScheduler();
  const server = app.listen(config.port, () => {
    console.log(`[démarrage] API HPO Visio sur le port ${config.port} (${config.env})`);
    console.log(`[démarrage] Annuaire : ${config.directoryProvider} · Mots de passe : ${config.authProvider} · E-mails : ${mailMode}`);
  });

  const stop = async () => {
    if (scheduler) clearInterval(scheduler);
    server.close();
    await pool.end().catch(() => {});
    process.exit(0);
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}

main().catch((err) => {
  console.error('[démarrage] échec :', err.message);
  process.exit(1);
});
