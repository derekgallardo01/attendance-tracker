// Sentry must be initialized before all other imports
require('./src/instrument');

const app = require('./src/app');
const CONFIG = require('./src/config');
const log = require('./src/lib/logger');

const server = app.listen(CONFIG.port, () => log.info('server started', { port: CONFIG.port }));

// Cap how long any single request may run before the socket is destroyed, so a
// stuck handler (hung upstream, slow query) can't hold a connection forever.
// Slightly above the longest outbound timeout so genuine slow calls still land.
server.requestTimeout = Number(process.env.REQUEST_TIMEOUT_MS) || 30000;
server.headersTimeout = server.requestTimeout + 5000;
