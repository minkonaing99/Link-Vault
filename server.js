const { PORT, DB_NAME, COLLECTION_NAME } = require('./lib/config');
const { connectDb, ensureAdminUser, closeDb } = require('./lib/db');
const { server } = require('./lib/router');

async function start() {
  await connectDb();
  await ensureAdminUser();
  server.listen(PORT, () => {
    console.log(`Link Nest running at http://localhost:${PORT}`);
    console.log(`Using MongoDB database: ${DB_NAME}.${COLLECTION_NAME}`);
    console.log('Auth enabled with cookie sessions, bearer access tokens, and refresh tokens.');
  });
}

start().catch(error => {
  console.error('Failed to start Link Nest:', error);
  process.exit(1);
});

process.on('SIGINT', async () => {
  await closeDb();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await closeDb();
  process.exit(0);
});
