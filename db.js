const initSqlJs = require('sql.js');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');

const DB_DIR = path.join(__dirname, 'data');
const DB_PATH = path.join(DB_DIR, 'queue.db');

let db = null;

// ─── Taipei timezone helper ────────────────────────────────────────
function taipeiNow() {
  return new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Taipei' }).replace(' ', 'T');
}

// ─── Helper functions ──────────────────────────────────────────────
function getOne(sql, params = []) {
  const stmt = db.prepare(sql);
  if (params.length) stmt.bind(params);
  let result = null;
  if (stmt.step()) {
    result = stmt.getAsObject();
  }
  stmt.free();
  return result;
}

function getAll(sql, params = []) {
  const stmt = db.prepare(sql);
  if (params.length) stmt.bind(params);
  const results = [];
  while (stmt.step()) {
    results.push(stmt.getAsObject());
  }
  stmt.free();
  return results;
}

function runSql(sql, params = []) {
  db.run(sql, params);
  save();
}

function save() {
  try {
    const data = db.export();
    fs.writeFileSync(DB_PATH, Buffer.from(data));
  } catch (e) {
    console.error('Failed to save database:', e.message);
  }
}

function getLastInsertRowId() {
  const row = getOne('SELECT last_insert_rowid() as id');
  return row ? row.id : 0;
}

// ─── Initialization (async, must be called before using db) ────────
async function initialize() {
  const SQL = await initSqlJs();

  if (!fs.existsSync(DB_DIR)) {
    fs.mkdirSync(DB_DIR, { recursive: true });
  }

  if (fs.existsSync(DB_PATH)) {
    const fileBuffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(fileBuffer);
  } else {
    db = new SQL.Database();
  }

  // Create tables
  db.run(`CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS late_records (
    game_id TEXT PRIMARY KEY,
    display_name TEXT,
    count INTEGER DEFAULT 1,
    last_marked_at TEXT DEFAULT (datetime('now', 'localtime')),
    created_at TEXT DEFAULT (datetime('now', 'localtime'))
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT DEFAULT '',
    main_slots INTEGER DEFAULT 4,
    waitlist_slots INTEGER DEFAULT 2,
    late_policy TEXT DEFAULT 'waitlist',
    status TEXT DEFAULT 'open',
    created_at TEXT DEFAULT (datetime('now', 'localtime')),
    closed_at TEXT,
    results_published INTEGER DEFAULT 0
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS registrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER NOT NULL,
    game_id TEXT NOT NULL,
    display_name TEXT DEFAULT '',
    status TEXT DEFAULT 'pending',
    is_late_flagged INTEGER DEFAULT 0,
    registered_at TEXT DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY (session_id) REFERENCES sessions(id),
    UNIQUE(session_id, game_id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS chat_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER NOT NULL,
    game_id TEXT NOT NULL,
    display_name TEXT DEFAULT '',
    message TEXT NOT NULL,
    is_admin INTEGER DEFAULT 0,
    sent_at TEXT DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY (session_id) REFERENCES sessions(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS banned_users (
    game_id TEXT PRIMARY KEY,
    reason TEXT DEFAULT '',
    banned_at TEXT DEFAULT (datetime('now', 'localtime'))
  )`);

  // Add start_time column if not exists
  try { db.run('ALTER TABLE sessions ADD COLUMN start_time TEXT'); } catch (e) { /* already exists */ }
  // Add extra_data column for custom registration fields
  try { db.run('ALTER TABLE registrations ADD COLUMN extra_data TEXT'); } catch (e) { /* already exists */ }

  save();
  return db;
}

// ─── Settings helpers ──────────────────────────────────────────────
function getSettingValue(key, defaultValue = null) {
  const row = getOne('SELECT value FROM settings WHERE key = ?', [key]);
  return row ? row.value : defaultValue;
}

function setSettingValue(key, value) {
  runSql('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', [key, String(value)]);
}

// ─── Admin password ────────────────────────────────────────────────
function isAdminPasswordSet() {
  return !!getSettingValue('admin_password_hash');
}

function setAdminPassword(plainPassword) {
  const hash = bcrypt.hashSync(plainPassword, 10);
  setSettingValue('admin_password_hash', hash);
}

function verifyAdminPassword(plainPassword) {
  const hash = getSettingValue('admin_password_hash');
  if (!hash) return false;
  return bcrypt.compareSync(plainPassword, hash);
}

// ─── Session management ───────────────────────────────────────────
function createSession(title, mainSlots, waitlistSlots, latePolicy) {
  const now = taipeiNow();
  // Close any currently open sessions first
  runSql("UPDATE sessions SET status = 'closed', closed_at = ? WHERE status = 'open'", [now]);

  runSql(
    'INSERT INTO sessions (title, main_slots, waitlist_slots, late_policy, created_at) VALUES (?, ?, ?, ?, ?)',
    [title || '', mainSlots || 4, waitlistSlots || 2, latePolicy || 'waitlist', now]
  );

  return getLastInsertRowId();
}

function getActiveSession() {
  return getOne("SELECT * FROM sessions WHERE status = 'open' ORDER BY id DESC LIMIT 1");
}

function getAllSessions() {
  return getAll('SELECT * FROM sessions ORDER BY id DESC');
}

function closeSession(sessionId) {
  runSql("UPDATE sessions SET status = 'closed', closed_at = ? WHERE id = ?", [taipeiNow(), sessionId]);
}

function deleteSession(sessionId) {
  runSql('DELETE FROM chat_messages WHERE session_id = ?', [sessionId]);
  runSql('DELETE FROM registrations WHERE session_id = ?', [sessionId]);
  runSql('DELETE FROM sessions WHERE id = ?', [sessionId]);
}

function resetAllStatuses(sessionId) {
  runSql("UPDATE registrations SET status = 'pending' WHERE session_id = ?", [sessionId]);
}

function updateSession(sessionId, fields) {
  const allowed = ['title', 'main_slots', 'waitlist_slots', 'late_policy', 'results_published'];
  const updates = [];
  const values = [];
  for (const [key, val] of Object.entries(fields)) {
    if (allowed.includes(key)) {
      updates.push(`${key} = ?`);
      values.push(val);
    }
  }
  if (updates.length === 0) return;
  values.push(sessionId);
  runSql(`UPDATE sessions SET ${updates.join(', ')} WHERE id = ?`, values);
}

// ─── Registration management ──────────────────────────────────────
function addRegistration(sessionId, gameId, displayName) {
  const lateRecord = getLateRecord(gameId);
  const isLateFlagged = lateRecord ? 1 : 0;

  runSql(
    'INSERT INTO registrations (session_id, game_id, display_name, is_late_flagged, registered_at) VALUES (?, ?, ?, ?, ?)',
    [sessionId, gameId, displayName || gameId, isLateFlagged, taipeiNow()]
  );

  const id = getLastInsertRowId();
  return {
    id,
    isLateFlagged,
    lateCount: lateRecord ? lateRecord.count : 0
  };
}

function getRegistrations(sessionId) {
  return getAll(
    'SELECT r.*, lr.count as late_count FROM registrations r LEFT JOIN late_records lr ON r.game_id = lr.game_id WHERE r.session_id = ? ORDER BY r.registered_at ASC',
    [sessionId]
  );
}

function getRegistrationByGameId(sessionId, gameId) {
  return getOne(
    'SELECT * FROM registrations WHERE session_id = ? AND game_id = ?',
    [sessionId, gameId]
  );
}

function updateRegistrationStatus(regId, status) {
  runSql('UPDATE registrations SET status = ? WHERE id = ?', [status, regId]);
}

function getRegistrationCount(sessionId) {
  const row = getOne('SELECT COUNT(*) as count FROM registrations WHERE session_id = ?', [sessionId]);
  return row ? row.count : 0;
}

function getRegistrationPosition(sessionId, gameId) {
  const rows = getAll(
    'SELECT game_id FROM registrations WHERE session_id = ? ORDER BY registered_at ASC',
    [sessionId]
  );
  const idx = rows.findIndex(r => r.game_id === gameId);
  return idx >= 0 ? idx + 1 : -1;
}

// ─── Auto-select by time order ────────────────────────────────────
function autoSelectByTime(sessionId) {
  const session = getOne('SELECT * FROM sessions WHERE id = ?', [sessionId]);
  if (!session) return [];

  const regs = getAll(
    'SELECT * FROM registrations WHERE session_id = ? ORDER BY registered_at ASC',
    [sessionId]
  );

  // Reset all to pending first
  runSql("UPDATE registrations SET status = 'pending' WHERE session_id = ?", [sessionId]);

  let mainCount = 0;
  let waitlistCount = 0;
  const latePolicy = session.late_policy;
  const latePending = [];

  for (const reg of regs) {
    const lateRecord = getLateRecord(reg.game_id);
    if (lateRecord && latePolicy !== 'none') {
      latePending.push(reg);
      continue;
    }

    if (mainCount < session.main_slots) {
      updateRegistrationStatus(reg.id, 'selected');
      mainCount++;
    } else if (waitlistCount < session.waitlist_slots) {
      updateRegistrationStatus(reg.id, 'waitlist');
      waitlistCount++;
    } else {
      updateRegistrationStatus(reg.id, 'rejected');
    }
  }

  // Handle late people
  for (const reg of latePending) {
    if (latePolicy === 'reject') {
      updateRegistrationStatus(reg.id, 'rejected');
    } else if (latePolicy === 'waitlist') {
      if (waitlistCount < session.waitlist_slots) {
        updateRegistrationStatus(reg.id, 'waitlist');
        waitlistCount++;
      } else {
        updateRegistrationStatus(reg.id, 'rejected');
      }
    }
  }

  return getRegistrations(sessionId);
}

// ─── Late records ──────────────────────────────────────────────────
function getLateRecord(gameId) {
  return getOne('SELECT * FROM late_records WHERE game_id = ?', [gameId]);
}

function markLate(gameId, displayName) {
  const now = taipeiNow();
  const existing = getLateRecord(gameId);
  if (existing) {
    runSql(
      'UPDATE late_records SET count = count + 1, last_marked_at = ?, display_name = COALESCE(?, display_name) WHERE game_id = ?',
      [now, displayName, gameId]
    );
  } else {
    runSql(
      'INSERT INTO late_records (game_id, display_name, last_marked_at, created_at) VALUES (?, ?, ?, ?)',
      [gameId, displayName || gameId, now, now]
    );
  }
  // Also flag in current session registration
  const session = getActiveSession();
  if (session) {
    runSql(
      'UPDATE registrations SET is_late_flagged = 1 WHERE session_id = ? AND game_id = ?',
      [session.id, gameId]
    );
  }
}

function removeLateRecord(gameId) {
  runSql('DELETE FROM late_records WHERE game_id = ?', [gameId]);
}

function getAllLateRecords() {
  return getAll('SELECT * FROM late_records ORDER BY last_marked_at DESC');
}

// ─── Chat ──────────────────────────────────────────────────────────
function addChatMessage(sessionId, gameId, displayName, message, isAdmin = false) {
  runSql(
    'INSERT INTO chat_messages (session_id, game_id, display_name, message, is_admin, sent_at) VALUES (?, ?, ?, ?, ?, ?)',
    [sessionId, gameId, displayName, message, isAdmin ? 1 : 0, taipeiNow()]
  );
  return getLastInsertRowId();
}

function getChatMessages(sessionId, limit = 100) {
  return getAll(
    'SELECT * FROM chat_messages WHERE session_id = ? ORDER BY sent_at ASC LIMIT ?',
    [sessionId, limit]
  );
}

function clearChatMessages(sessionId) {
  runSql('DELETE FROM chat_messages WHERE session_id = ?', [sessionId]);
}

// ─── Cleanup ───────────────────────────────────────────────────────
function closeDatabase() {
  if (db) {
    save();
    db.close();
  }
}

module.exports = {
  initialize,
  taipeiNow,
  runSql,
  getSettingValue,
  setSettingValue,
  isAdminPasswordSet,
  setAdminPassword,
  verifyAdminPassword,
  createSession,
  getActiveSession,
  closeSession,
  updateSession,
  addRegistration,
  getRegistrations,
  getRegistrationByGameId,
  updateRegistrationStatus,
  getRegistrationCount,
  getRegistrationPosition,
  autoSelectByTime,
  getLateRecord,
  markLate,
  removeLateRecord,
  getAllLateRecords,
  addChatMessage,
  getChatMessages,
  clearChatMessages,
  deleteSession,
  resetAllStatuses,
  getAllSessions,
  banUser: (gameId, reason) => { runSql('INSERT OR REPLACE INTO banned_users (game_id, reason, banned_at) VALUES (?, ?, ?)', [gameId, reason || '', taipeiNow()]); },
  unbanUser: (gameId) => { runSql('DELETE FROM banned_users WHERE game_id = ?', [gameId]); },
  isBanned: (gameId) => !!getOne('SELECT game_id FROM banned_users WHERE game_id = ?', [gameId]),
  getBannedUsers: () => getAll('SELECT * FROM banned_users ORDER BY banned_at DESC'),
  closeDatabase
};
