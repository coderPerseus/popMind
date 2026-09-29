// Dev-only: POPMIND_USER_DATA_DIR points an unpackaged build at its own data folder, so a dev instance can run
// next to the installed app without sharing (and migrating) its databases. Imported first in main.ts so it runs
// before any module reads app paths.
import { app } from 'electron'

const override = process.env.POPMIND_USER_DATA_DIR?.trim()
if (override && !app.isPackaged) {
  app.setPath('userData', override)
}
