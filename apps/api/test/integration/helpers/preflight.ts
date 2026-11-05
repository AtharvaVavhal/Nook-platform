import { ensureIsolatedDatabase } from './isolation.js';

// Import this module first in every integration test file. Top-level await means no other module in the
// file is evaluated, and no test can start, until the database identity is verified and the suite lock is
// held. If any check fails the import throws and the file does not run.
await ensureIsolatedDatabase();
