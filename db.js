const Database = require('better-sqlite3');
const path = require('path');
const bcrypt = require('bcryptjs');

const DB_PATH = path.join(__dirname, 'data', 'queue.db');

// Ensure data directory exists
const fs = require('fs');
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db = new Database(DB_PATH);

// Enable WAL mode for better performance
db.pragma('journal_mode = WAL');

// ─── Schema ────────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS late_records (
    game_id TEXT PRIMARY KEY,
    display_name TEXT,
    count INTEGER DEFAULT 1,
    last_marked_at TEXT DEFAULT (datetime('now', 'localtime')),
    created_at TEXT DEFAULT (datetime('now', 'localtime'))
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT DEFAULT '',
    main_slots INTEGER DEFAULT 4,
    waitlist_slots INTEGER DEFAULT 2,
    late_policy TEXT DEFAULT 'waitlist',
    status TEXT DEFAULT 'open',
    created_at TEXT DEFAULT (datetime('now', 'localtime')),
    closed_at TEXT,
    results_published INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS registrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER NOT NULL,
    game_id TEXT NOT NULL,
    display_name TEXT DEFAULT '',
    status TEXT DEFAULT 'pending',
    is_late_flagged INTEGER DEFAULT 0,
    registered_at TEXT DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY (session_id) REFERENCES sessions(id),
    UNIQUE(session_id, game_id)
  );

  CREATE TABLE IF NOT EXISTS chat_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER NOT NULL,
    game_id TEXT NOT NULL,
    display_name TEXT DEFAULT '',
    message TEXT NOT NULL,
    is_admin INTEGER DEFAULT 0,
    sent_at TEXT DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY (session_id) REFERENCES sessions(id)
  );
`);

// ─── Settings helpers ──────────────────────────────────────────────
const getSetting = db.prepare('SELECT value FROM settings WHERE key = ?');
const setSetting = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');

function getSettingValue(key, defaultValue = null) {
  const row = getSetting.get(key);
  return row ? row.value : defaultValue;
}

function setSettingValue(key, value) {
  setSetting.run(key, String(value));
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
  // Close any currently open sessions first
  db.prepare("UPDATE sessions SET status = 'closed', closed_at = datetime('now', 'localtime') WHERE status = 'open'").run();
  
  const result = db.prepare(
    'INSERT INTO sessions (title, main_slots, waitlist_slots, late_policy) VALUES (?, ?, ?, ?)'
  ).run(title || '', mainSlots || 4, waitlistSlots || 2, latePolicy || 'waitlist');
  
  return result.lastInsertRowid;
}

function getActiveSession() {
  return db.prepare("SELECT * FROM sessions WHERE status = 'open' ORDER BY id DESC LIMIT 1").get();
}

function closeSession(sessionId) {
  db.prepare("UPDATE sessions SET status = 'closed', closed_at = datetime('now', 'localtime') WHERE id = ?").run(sessionId);
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
  db.prepare(`UPDATE sessions SET ${updates.join(', ')} WHERE id = ?`).run(...values);
}

// ─── Registration management ──────────────────────────────────────
function addRegistration(sessionId, gameId, displayName) {
  const lateRecord = getLateRecord(gameId);
  const isLateFlagged = lateRecord ? 1 : 0;
  
  const result = db.prepare(
    'INSERT INTO registrations (session_id, game_id, display_name, is_late_flagged) VALUES (?, ?, ?, ?)'
  ).run(sessionId, gameId, displayName || gameId, isLateFlagged);
  
  return {
    id: result.lastInsertRowid,
    isLateFlagged,
    lateCount: lateRecord ? lateRecord.count : 0
  };
}

function getRegistrations(sessionId) {
  const regs = db.prepare(
    'SELECT r.*, lr.count as late_count FROM registrations r LEFT JOIN late_records lr ON r.game_id = lr.game_id WHERE r.session_id = ? ORDER BY r.registered_at ASC'
  ).all(sessionId);
  return regs;
}

function getRegistrationByGameId(sessionId, gameId) {
  return db.prepare(
    'SELECT * FROM registrations WHERE session_id = ? AND game_id = ?'
  ).get(sessionId, gameId);
}

function updateRegistrationStatus(regId, status) {
  db.prepare('UPDATE registrations SET status = ? WHERE id = ?').run(status, regId);
}

function getRegistrationCount(sessionId) {
  const row = db.prepare('SELECT COUNT(*) as count FROM registrations WHERE session_id = ?').get(sessionId);
  return row.count;
}

function getRegistrationPosition(sessionId, gameId) {
  const rows = db.prepare(
    'SELECT game_id FROM registrations WHERE session_id = ? ORDER BY registered_at ASC'
  ).all(sessionId);
  const idx = rows.findIndex(r => r.game_id === gameId);
  return idx >= 0 ? idx + 1 : -1;
}

// ─── Auto-select by time order ────────────────────────────────────
function autoSelectByTime(sessionId) {
  const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
  if (!session) return [];

  const regs = db.prepare(
    'SELECT * FROM registrations WHERE session_id = ? ORDER BY registered_at ASC'
  ).all(sessionId);

  // Reset all to pending first
  db.prepare("UPDATE registrations SET status = 'pending' WHERE session_id = ?").run(sessionId);

  let mainCount = 0;
  let waitlistCount = 0;
  const latePolicy = session.late_policy; // 'waitlist' | 'reject'
  const latePending = []; // late people deferred

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
  return db.prepare('SELECT * FROM late_records WHERE game_id = ?').get(gameId);
}

function markLate(gameId, displayName) {
  const existing = getLateRecord(gameId);
  if (existing) {
    db.prepare(
      "UPDATE late_records SET count = count + 1, last_marked_at = datetime('now', 'localtime'), display_name = COALESCE(?, display_name) WHERE game_id = ?"
    ).run(displayName, gameId);
  } else {
    db.prepare(
      'INSERT INTO late_records (game_id, display_name) VALUES (?, ?)'
    ).run(gameId, displayName || gameId);
  }
  // Also flag in current session registration
  const session = getActiveSession();
  if (session) {
    db.prepare(
      'UPDATE registrations SET is_late_flagged = 1 WHERE session_id = ? AND game_id = ?'
    ).run(session.id, gameId);
  }
}

function removeLateRecord(gameId) {
  db.prepare('DELETE FROM late_records WHERE game_id = ?').run(gameId);
}

function getAllLateRecords() {
  return db.prepare('SELECT * FROM late_records ORDER BY last_marked_at DESC').all();
}

// ─── Chat ──────────────────────────────────────────────────────────
function addChatMessage(sessionId, gameId, displayName, message, isAdmin = false) {
  const result = db.prepare(
    'INSERT INTO chat_messages (session_id, game_id, display_name, message, is_admin) VALUES (?, ?, ?, ?, ?)'
  ).run(sessionId, gameId, displayName, message, isAdmin ? 1 : 0);
  return result.lastInsertRowid;
}

function getChatMessages(sessionId, limit = 100) {
  return db.prepare(
    'SELECT * FROM chat_messages WHERE session_id = ? ORDER BY sent_at ASC LIMIT ?'
  ).all(sessionId, limit);
}

// ─── Cleanup ───────────────────────────────────────────────────────
function closeDatabase() {
  db.close();
}

module.exports = {
  db,
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
  closeDatabase
};
