require('dotenv').config();
const path = require('path');

module.exports = {
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '4000', 10),
  databaseUrl: process.env.DATABASE_URL || 'postgres://romarick:romarick@127.0.0.1:5433/romaricks_vintage',
  sessionSecret: process.env.SESSION_SECRET || 'dev-secret-change-me',
  clientOrigin: process.env.CLIENT_ORIGIN || 'http://127.0.0.1:5173',
  pgBin: process.env.PG_BIN || '',
  backupDir: path.resolve(__dirname, '..', process.env.BACKUP_DIR || 'backups'),
  uploadDir: path.resolve(__dirname, '..', 'uploads'),
};
