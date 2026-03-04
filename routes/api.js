const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const db = require('../db');

// ─── Multer setup for background image upload ─────────────────────
const uploadDir = path.join(__dirname, '..', 'public', 'uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        cb(null, 'background' + ext);
    }
});

const upload = multer({
    storage,
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
    fileFilter: (req, file, cb) => {
        const allowed = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
        const ext = path.extname(file.originalname).toLowerCase();
        if (allowed.includes(ext)) {
            cb(null, true);
        } else {
            cb(new Error('只允許上傳圖片檔案 (jpg, png, gif, webp)'));
        }
    }
});

// ─── Auth middleware ───────────────────────────────────────────────
function requireAdmin(req, res, next) {
    const token = req.headers['x-admin-token'] || req.query.token;
    const validToken = db.getSettingValue('admin_session_token');
    if (!token || token !== validToken) {
        return res.status(401).json({ error: '需要管理員權限' });
    }
    next();
}

// ─── Input sanitization ──────────────────────────────────────────
function sanitize(str) {
    if (typeof str !== 'string') return '';
    return str.trim().replace(/[<>]/g, '').substring(0, 100);
}

function sanitizeMessage(str) {
    if (typeof str !== 'string') return '';
    return str.trim().replace(/[<>]/g, '').substring(0, 500);
}

// ═══════════════════════════════════════════════════════════════════
// PUBLIC ROUTES
// ═══════════════════════════════════════════════════════════════════

// Check if admin password is set (for first-time setup)
router.get('/auth/status', (req, res) => {
    res.json({
        passwordSet: db.isAdminPasswordSet()
    });
});

// Admin login / first-time password setup
router.post('/auth/login', (req, res) => {
    const { password } = req.body;
    if (!password || password.length < 4) {
        return res.status(400).json({ error: '密碼至少需要 4 個字元' });
    }

    if (!db.isAdminPasswordSet()) {
        // First time: set password
        db.setAdminPassword(password);
    }

    if (!db.verifyAdminPassword(password)) {
        return res.status(401).json({ error: '密碼錯誤' });
    }

    // Generate a session token
    const crypto = require('crypto');
    const token = crypto.randomBytes(32).toString('hex');
    db.setSettingValue('admin_session_token', token);

    res.json({ token, message: '登入成功' });
});

// Get session status (public)
router.get('/status', (req, res) => {
    const session = db.getActiveSession();
    if (!session) {
        return res.json({
            active: false,
            message: '目前沒有開放報名的場次'
        });
    }

    const count = db.getRegistrationCount(session.id);
    res.json({
        active: true,
        sessionId: session.id,
        title: session.title,
        mainSlots: session.main_slots,
        waitlistSlots: session.waitlist_slots,
        currentCount: count,
        resultsPublished: !!session.results_published,
        status: session.status,
        startTime: db.getSettingValue('session_start_time', null),
        customFields: JSON.parse(db.getSettingValue('custom_fields', '[]'))
    });
});

// Register (public)
router.post('/register', (req, res) => {
    const gameId = sanitize(req.body.gameId);
    const displayName = sanitize(req.body.displayName) || gameId;

    if (!gameId || gameId.length < 1) {
        return res.status(400).json({ error: '請輸入遊戲 ID' });
    }

    const session = db.getActiveSession();
    if (!session) {
        return res.status(400).json({ error: '目前沒有開放報名的場次' });
    }

    // Check duplicate
    const existing = db.getRegistrationByGameId(session.id, gameId);
    if (existing) {
        return res.status(409).json({ error: '此遊戲 ID 已經報名過了', registration: existing });
    }

    // Check if banned
    if (db.isBanned(gameId)) {
        return res.status(403).json({ error: '此遊戲 ID 已被禁止報名' });
    }

    try {
        const result = db.addRegistration(session.id, gameId, displayName);
        const position = db.getRegistrationCount(session.id);
        const count = db.getRegistrationCount(session.id);

        // Save custom field data if provided
        if (req.body.extraData && typeof req.body.extraData === 'object') {
            const extraJson = JSON.stringify(req.body.extraData);
            db.runSql('UPDATE registrations SET extra_data = ? WHERE id = ?', [extraJson, result.id]);
        }

        // Save browser fingerprint
        if (req.body.fingerprint) {
            db.runSql('UPDATE registrations SET fingerprint = ? WHERE id = ?', [sanitize(req.body.fingerprint), result.id]);
        }

        const responseData = {
            message: '報名成功！已收到您的報名資料',
            registrationId: result.id,
            position,
            gameId,
            displayName,
            isLateFlagged: !!result.isLateFlagged,
            lateCount: result.lateCount,
            totalRegistered: count
        };

        // Emit to all connected clients via Socket.IO (will be set up in server.js)
        if (req.app.io) {
            req.app.io.emit('registration:new', {
                gameId,
                displayName,
                position,
                totalRegistered: count,
                isLateFlagged: !!result.isLateFlagged,
                lateCount: result.lateCount,
                registeredAt: db.taipeiNow()
            });
        }

        res.json(responseData);
    } catch (err) {
        if (err.message.includes('UNIQUE constraint')) {
            return res.status(409).json({ error: '此遊戲 ID 已經報名過了' });
        }
        res.status(500).json({ error: '伺服器錯誤，請稍後再試' });
    }
});

// Get results (public, after published)
router.get('/results', (req, res) => {
    const session = db.getActiveSession();
    if (!session) {
        return res.status(404).json({ error: '沒有進行中的場次' });
    }

    if (!session.results_published) {
        return res.json({ published: false, message: '結果尚未公布' });
    }

    const regs = db.getRegistrations(session.id);
    res.json({
        published: true,
        title: session.title,
        selected: regs.filter(r => r.status === 'selected'),
        waitlist: regs.filter(r => r.status === 'waitlist'),
        rejected: regs.filter(r => r.status === 'rejected')
    });
});

// Check own status
router.get('/my-status/:gameId', (req, res) => {
    const gameId = sanitize(req.params.gameId);
    const session = db.getActiveSession();
    if (!session) {
        return res.json({ registered: false });
    }

    const reg = db.getRegistrationByGameId(session.id, gameId);
    if (!reg) {
        return res.json({ registered: false });
    }

    const position = db.getRegistrationPosition(session.id, gameId);
    res.json({
        registered: true,
        position,
        status: reg.status,
        isLateFlagged: !!reg.is_late_flagged,
        registeredAt: reg.registered_at,
        resultsPublished: !!session.results_published
    });
});

// ═══════════════════════════════════════════════════════════════════
// ADMIN ROUTES
// ═══════════════════════════════════════════════════════════════════

// Get all registrations (admin)
router.get('/admin/registrations', requireAdmin, (req, res) => {
    const session = db.getActiveSession();
    if (!session) {
        return res.json({ registrations: [], session: null });
    }
    const regs = db.getRegistrations(session.id);
    res.json({ registrations: regs, session });
});

// Create new session
router.post('/admin/session', requireAdmin, (req, res) => {
    const title = sanitize(req.body.title);
    const mainSlots = Math.max(1, Math.min(100, parseInt(req.body.mainSlots) || 4));
    const waitlistSlots = Math.max(0, Math.min(100, parseInt(req.body.waitlistSlots) || 2));
    const latePolicy = ['waitlist', 'reject', 'none'].includes(req.body.latePolicy) ? req.body.latePolicy : 'waitlist';
    const startTime = req.body.startTime || null;

    const sessionId = db.createSession(title, mainSlots, waitlistSlots, latePolicy);

    // Save start_time if provided
    if (startTime) {
        db.setSettingValue('session_start_time', startTime);
    }

    if (req.app.io) {
        req.app.io.emit('session:updated', { active: true, title, mainSlots, waitlistSlots, startTime });
    }

    res.json({ sessionId, message: '新場次已建立' });
});

// Close session
router.post('/admin/session/close', requireAdmin, (req, res) => {
    const session = db.getActiveSession();
    if (!session) {
        return res.status(400).json({ error: '沒有進行中的場次' });
    }
    db.closeSession(session.id);

    if (req.app.io) {
        req.app.io.emit('session:updated', { active: false });
    }

    res.json({ message: '場次已關閉' });
});

// Delete session entirely
router.delete('/admin/session', requireAdmin, (req, res) => {
    const session = db.getActiveSession();
    if (!session) {
        return res.status(400).json({ error: '沒有進行中的場次' });
    }
    db.deleteSession(session.id);

    if (req.app.io) {
        req.app.io.emit('session:updated', { active: false });
    }

    res.json({ message: '場次已刪除' });
});

// Reset all statuses to pending (cancel auto-select)
router.post('/admin/reset-statuses', requireAdmin, (req, res) => {
    const session = db.getActiveSession();
    if (!session) {
        return res.status(400).json({ error: '沒有進行中的場次' });
    }
    db.resetAllStatuses(session.id);

    if (req.app.io) {
        const regs = db.getRegistrations(session.id);
        req.app.io.emit('registrations:updated', { registrations: regs });

        const sysMsg = {
            gameId: 'SYSTEM',
            displayName: '系統',
            message: '⏳ 管理員已重設所有審核狀態',
            isSystem: true,
            sentAt: db.taipeiNow()
        };
        req.app.io.to('registered').emit('chat:message', sysMsg);
        req.app.io.to('admin').emit('chat:message', sysMsg);
    }

    res.json({ message: '已重設所有報名狀態' });
});

// Update session settings
router.put('/admin/session', requireAdmin, (req, res) => {
    const session = db.getActiveSession();
    if (!session) {
        return res.status(400).json({ error: '沒有進行中的場次' });
    }

    const updates = {};
    if (req.body.title !== undefined) updates.title = sanitize(req.body.title);
    if (req.body.mainSlots !== undefined) updates.main_slots = Math.max(1, Math.min(100, parseInt(req.body.mainSlots) || 4));
    if (req.body.waitlistSlots !== undefined) updates.waitlist_slots = Math.max(0, Math.min(100, parseInt(req.body.waitlistSlots) || 2));
    if (req.body.latePolicy !== undefined && ['waitlist', 'reject', 'none'].includes(req.body.latePolicy)) {
        updates.late_policy = req.body.latePolicy;
    }

    db.updateSession(session.id, updates);

    if (req.app.io) {
        const updatedSession = db.getActiveSession();
        req.app.io.emit('session:updated', {
            active: true,
            title: updatedSession.title,
            mainSlots: updatedSession.main_slots,
            waitlistSlots: updatedSession.waitlist_slots
        });
    }

    res.json({ message: '設定已更新' });
});

// Set registration status (manual select)
router.post('/admin/select', requireAdmin, (req, res) => {
    const { registrationId, status } = req.body;
    if (!registrationId || !['selected', 'waitlist', 'rejected', 'pending'].includes(status)) {
        return res.status(400).json({ error: '無效的參數' });
    }
    db.updateRegistrationStatus(registrationId, status);
    console.log(`[STATUS] Registration #${registrationId} -> ${status}`);

    const session = db.getActiveSession();
    if (req.app.io && session) {
        const regs = db.getRegistrations(session.id);
        req.app.io.emit('registrations:updated', { registrations: regs });
        console.log(`[EMIT] registrations:updated sent to all sockets (${regs.length} registrations)`);

        // Find the registration to get display name
        const reg = regs.find(r => r.id === registrationId);
        if (reg) {
            const statusLabels = {
                selected: '正選', waitlist: '備取', rejected: '未錄取', pending: '等待審核'
            };
            const statusIcons = {
                selected: '🎉', waitlist: '📋', rejected: '❌', pending: '⏳'
            };
            const label = statusLabels[status] || status;
            const icon = statusIcons[status] || '📢';
            const name = reg.display_name || reg.game_id;

            // System chat announcement
            const sysMsg = {
                gameId: 'SYSTEM',
                displayName: '系統',
                message: `${icon} ${name} 已被設為${label}`,
                isSystem: true,
                sentAt: db.taipeiNow()
            };
            req.app.io.to('registered').emit('chat:message', sysMsg);
            req.app.io.to('admin').emit('chat:message', sysMsg);
        }

        // Check if slots are full
        const selectedCount = regs.filter(r => r.status === 'selected').length;
        const waitlistCount = regs.filter(r => r.status === 'waitlist').length;
        const totalFilled = selectedCount + waitlistCount;
        const totalSlots = (session.main_slots || 0) + (session.waitlist_slots || 0);

        if (totalFilled >= totalSlots && status === 'selected' || status === 'waitlist') {
            // Only announce when we just hit full
            if (totalFilled === totalSlots) {
                const fullMsg = {
                    gameId: 'SYSTEM',
                    displayName: '系統',
                    message: `📢 名額已滿！正選 ${selectedCount} 人 + 備取 ${waitlistCount} 人`,
                    isSystem: true,
                    sentAt: db.taipeiNow()
                };
                req.app.io.to('registered').emit('chat:message', fullMsg);
                req.app.io.to('admin').emit('chat:message', fullMsg);
            }
        }
    }

    res.json({ message: '狀態已更新' });
});

// Auto-select by time
router.post('/admin/auto-select', requireAdmin, (req, res) => {
    const session = db.getActiveSession();
    if (!session) {
        return res.status(400).json({ error: '沒有進行中的場次' });
    }

    const regs = db.autoSelectByTime(session.id);

    if (req.app.io) {
        req.app.io.emit('registrations:updated', { registrations: regs });
    }

    res.json({ registrations: regs, message: '已按報名時間自動錄取' });
});

// Mark as late
router.post('/admin/late/:gameId', requireAdmin, (req, res) => {
    const gameId = sanitize(req.params.gameId);
    const displayName = sanitize(req.body.displayName);
    db.markLate(gameId, displayName);
    res.json({ message: `已標記 ${gameId} 為遲到` });
});

// Remove late record
router.delete('/admin/late/:gameId', requireAdmin, (req, res) => {
    const gameId = sanitize(req.params.gameId);
    db.removeLateRecord(gameId);
    res.json({ message: `已移除 ${gameId} 的遲到紀錄` });
});

// Get all late records
router.get('/admin/late-records', requireAdmin, (req, res) => {
    const records = db.getAllLateRecords();
    res.json({ records });
});

// Publish results
router.post('/admin/publish', requireAdmin, (req, res) => {
    const session = db.getActiveSession();
    if (!session) {
        return res.status(400).json({ error: '沒有進行中的場次' });
    }
    db.updateSession(session.id, { results_published: 1 });

    if (req.app.io) {
        const regs = db.getRegistrations(session.id);
        req.app.io.emit('results:published', {
            title: session.title,
            selected: regs.filter(r => r.status === 'selected'),
            waitlist: regs.filter(r => r.status === 'waitlist'),
            rejected: regs.filter(r => r.status === 'rejected')
        });
    }

    res.json({ message: '結果已公布' });
});

// Admin announcement
router.post('/admin/announce', requireAdmin, (req, res) => {
    const message = sanitizeMessage(req.body.message);
    if (!message) {
        return res.status(400).json({ error: '請輸入公告內容' });
    }
    if (req.app.io) {
        req.app.io.emit('admin:announcement', {
            message,
            sentAt: db.taipeiNow()
        });
    }
    res.json({ message: '公告已發送' });
});

// Upload background image
router.post('/admin/upload-bg', requireAdmin, upload.single('background'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: '請選擇圖片檔案' });
    }
    const bgUrl = '/uploads/' + req.file.filename + '?t=' + Date.now();
    db.setSettingValue('background_image', bgUrl);

    if (req.app.io) {
        req.app.io.emit('background:updated', { url: bgUrl });
    }

    res.json({ url: bgUrl, message: '背景圖片已上傳' });
});

// Get background image and settings
router.get('/background', (req, res) => {
    const bgUrl = db.getSettingValue('background_image');
    const bgPosition = db.getSettingValue('background_position', 'center center');
    const bgSize = db.getSettingValue('background_size', 'cover');
    res.json({ url: bgUrl, position: bgPosition, size: bgSize });
});

// Save background settings (position/size)
router.put('/admin/background-settings', requireAdmin, (req, res) => {
    if (req.body.position) db.setSettingValue('background_position', sanitize(req.body.position));
    if (req.body.size) db.setSettingValue('background_size', sanitize(req.body.size));
    if (req.app.io) {
        const bgUrl = db.getSettingValue('background_image');
        const bgPosition = db.getSettingValue('background_position', 'center center');
        const bgSize = db.getSettingValue('background_size', 'cover');
        req.app.io.emit('background:updated', { url: bgUrl, position: bgPosition, size: bgSize });
    }
    res.json({ message: '背景設定已更新' });
});

// Remove background image
router.delete('/admin/background', requireAdmin, (req, res) => {
    db.setSettingValue('background_image', '');
    if (req.app.io) {
        req.app.io.emit('background:updated', { url: '' });
    }
    res.json({ message: '背景圖片已移除' });
});

// ─── Theme Settings ───────────────────────────────────────────────
router.get('/theme', (req, res) => {
    const raw = db.getSettingValue('theme_settings', '{}');
    try {
        res.json(JSON.parse(raw));
    } catch (e) {
        res.json({});
    }
});

router.put('/admin/theme', requireAdmin, (req, res) => {
    const theme = {
        accentColor: req.body.accentColor || '',
        bgPrimary: req.body.bgPrimary || '',
        bgSecondary: req.body.bgSecondary || '',
        fontSizeTitle: req.body.fontSizeTitle || '',
        fontSizeBody: req.body.fontSizeBody || '',
        fontSizeChat: req.body.fontSizeChat || '',
        fontSizeLabel: req.body.fontSizeLabel || ''
    };
    db.setSettingValue('theme_settings', JSON.stringify(theme));

    if (req.app.io) {
        req.app.io.emit('theme:updated', theme);
    }

    res.json({ message: '主題設定已儲存' });
});

// Get chat messages (public, for registered users)
router.get('/chat', (req, res) => {
    const session = db.getActiveSession();
    if (!session) {
        return res.json({ messages: [] });
    }
    const messages = db.getChatMessages(session.id);
    res.json({ messages });
});

// Get chat messages (admin)
router.get('/admin/chat', requireAdmin, (req, res) => {
    const session = db.getActiveSession();
    if (!session) {
        return res.json({ messages: [] });
    }
    const messages = db.getChatMessages(session.id);
    res.json({ messages });
});

// Clear chat messages (admin)
router.delete('/admin/chat', requireAdmin, (req, res) => {
    const session = db.getActiveSession();
    if (session) {
        db.clearChatMessages(session.id);
    }
    if (req.app.io) {
        req.app.io.to('registered').emit('chat:cleared');
        req.app.io.to('admin').emit('chat:cleared');
    }
    res.json({ message: '對話紀錄已清除' });
});

// Reset admin password
router.post('/admin/reset-password', requireAdmin, (req, res) => {
    const { newPassword } = req.body;
    if (!newPassword || newPassword.length < 4) {
        return res.status(400).json({ error: '密碼至少需要 4 個字元' });
    }
    db.setAdminPassword(newPassword);
    res.json({ message: '密碼已更新' });
});

// ─── Custom Registration Fields ───────────────────────────────────
router.get('/admin/custom-fields', requireAdmin, (req, res) => {
    const fields = JSON.parse(db.getSettingValue('custom_fields', '[]'));
    res.json({ fields });
});

router.put('/admin/custom-fields', requireAdmin, (req, res) => {
    const { fields } = req.body;
    if (!Array.isArray(fields)) return res.status(400).json({ error: '欄位格式錯誤' });
    // Validate and sanitize
    const clean = fields.slice(0, 10).map(f => ({
        name: sanitize(f.name || '').substring(0, 50),
        type: ['text', 'select'].includes(f.type) ? f.type : 'text',
        required: !!f.required,
        options: Array.isArray(f.options) ? f.options.map(o => sanitize(o).substring(0, 50)).slice(0, 20) : []
    })).filter(f => f.name);
    db.setSettingValue('custom_fields', JSON.stringify(clean));
    res.json({ message: '自訂欄位已儲存', fields: clean });
});

// ─── Attention Alert ──────────────────────────────────────────────
router.post('/admin/attention', requireAdmin, (req, res) => {
    if (req.app.io) {
        req.app.io.to('registered').emit('admin:attention');
    }
    res.json({ message: '已發送注意提醒' });
});

// ─── Multi-ID Detection (fingerprint) ─────────────────────────────
router.get('/admin/suspicious', requireAdmin, (req, res) => {
    try {
        const rows = db.querySql(`
            SELECT fingerprint, GROUP_CONCAT(DISTINCT game_id) as game_ids, COUNT(DISTINCT game_id) as id_count
            FROM registrations
            WHERE fingerprint IS NOT NULL AND fingerprint != ''
            GROUP BY fingerprint
            HAVING COUNT(DISTINCT game_id) > 1
            ORDER BY id_count DESC
        `);
        res.json({ suspicious: rows || [] });
    } catch (e) {
        res.json({ suspicious: [] });
    }
});

// ─── Session History ──────────────────────────────────────────────
router.get('/admin/history', requireAdmin, (req, res) => {
    const sessions = db.getAllSessions();
    const result = sessions.map(s => ({
        ...s,
        regCount: db.getRegistrationCount(s.id)
    }));
    res.json({ sessions: result });
});

router.get('/admin/history/:id/registrations', requireAdmin, (req, res) => {
    const sessionId = parseInt(req.params.id);
    const regs = db.getRegistrations(sessionId);
    res.json({ registrations: regs });
});

// ─── CSV Export ───────────────────────────────────────────────────
router.get('/admin/export-csv', requireAdmin, (req, res) => {
    const session = db.getActiveSession();
    if (!session) return res.status(400).json({ error: '沒有活躍場次' });

    const regs = db.getRegistrations(session.id);
    const statusMap = { pending: '審核中', selected: '正選', waitlist: '備取', rejected: '未錄取' };

    // BOM for UTF-8 Excel compatibility
    let csv = '\ufeff序號,遊戲ID,顯示名稱,狀態,報名時間,遲到\n';
    regs.forEach((r, i) => {
        csv += `${i + 1},"${r.game_id}","${r.display_name}",${statusMap[r.status] || r.status},"${r.registered_at}",${r.is_late_flagged ? '是' : '否'}\n`;
    });

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="registrations_${session.id}.csv"`);
    res.send(csv);
});

// ─── Private Message ──────────────────────────────────────────────
router.post('/admin/private-message', requireAdmin, (req, res) => {
    const { gameId, message } = req.body;
    if (!gameId || !message) return res.status(400).json({ error: '缺少 gameId 或 message' });

    if (req.app.io) {
        for (const [, socket] of req.app.io.sockets.sockets) {
            if (socket.gameId === gameId) {
                socket.emit('admin:private-message', {
                    message: message.trim().substring(0, 500),
                    sentAt: db.taipeiNow()
                });
                break;
            }
        }
    }
    res.json({ message: '私訊已發送' });
});

// ─── Kick / Ban ───────────────────────────────────────────────────
router.post('/admin/kick', requireAdmin, (req, res) => {
    const { gameId } = req.body;
    if (!gameId) return res.status(400).json({ error: '缺少 gameId' });

    if (req.app.io) {
        // Find the socket for this user and kick them
        const io = req.app.io;
        for (const [, socket] of io.sockets.sockets) {
            if (socket.gameId === gameId) {
                socket.emit('user:kicked');
                socket.leave('registered');
                socket.disconnect(true);
                break;
            }
        }
        // System announcement
        const sysMsg = {
            gameId: 'SYSTEM', displayName: '系統',
            message: `⚠️ ${gameId} 已被管理員移出`,
            isSystem: true, sentAt: db.taipeiNow()
        };
        io.to('registered').emit('chat:message', sysMsg);
        io.to('admin').emit('chat:message', sysMsg);
    }
    res.json({ message: '已踢除用戶' });
});

router.post('/admin/ban', requireAdmin, (req, res) => {
    const { gameId, reason } = req.body;
    if (!gameId) return res.status(400).json({ error: '缺少 gameId' });
    db.banUser(gameId, reason);

    // Also kick if currently connected
    if (req.app.io) {
        for (const [, socket] of req.app.io.sockets.sockets) {
            if (socket.gameId === gameId) {
                socket.emit('user:kicked');
                socket.leave('registered');
                socket.disconnect(true);
                break;
            }
        }
    }
    res.json({ message: '已封禁用戶' });
});

router.post('/admin/unban', requireAdmin, (req, res) => {
    const { gameId } = req.body;
    if (!gameId) return res.status(400).json({ error: '缺少 gameId' });
    db.unbanUser(gameId);
    res.json({ message: '已解除封禁' });
});

router.get('/admin/banned', requireAdmin, (req, res) => {
    res.json({ banned: db.getBannedUsers() });
});

module.exports = router;
