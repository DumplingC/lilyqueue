const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const path = require('path');
const os = require('os');
const db = require('./db');
const apiRoutes = require('./routes/api');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: false }, // Same-origin only
    pingTimeout: 60000,
    pingInterval: 25000
});

// Store io instance on app for route access
app.io = io;

// ─── Security & Performance Middleware ────────────────────────────
app.use(compression());
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "'unsafe-inline'", "https://unpkg.com"],
            styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
            fontSrc: ["'self'", "https://fonts.gstatic.com"],
            imgSrc: ["'self'", "data:", "blob:"],
            connectSrc: ["'self'", "ws:", "wss:"]
        }
    }
}));

// Rate limiting
const generalLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 60,
    message: { error: '請求過於頻繁，請稍後再試' }
});

const registerLimiter = rateLimit({
    windowMs: 1 * 60 * 1000,
    max: 5,
    message: { error: '報名請求過於頻繁，請稍後再試' }
});

const loginLimiter = rateLimit({
    windowMs: 5 * 60 * 1000,
    max: 10,
    message: { error: '登入嘗試過於頻繁，請 5 分鐘後再試' }
});

app.use('/api/', generalLimiter);
app.use('/api/register', registerLimiter);
app.use('/api/auth/login', loginLimiter);

// ─── Body parsing ─────────────────────────────────────────────────
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));

// ─── Static files (with cache) ────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public'), {
    maxAge: '1h',
    etag: true
}));

// ─── API Routes ───────────────────────────────────────────────────
app.use('/api', apiRoutes);

// Server info endpoint (returns correct URL for both local and Render)
app.get('/api/server-info', (req, res) => {
    // On Render, use the public URL; locally, use LAN IP
    if (process.env.RENDER_EXTERNAL_URL) {
        res.json({ url: process.env.RENDER_EXTERNAL_URL });
    } else {
        const localIP = getLocalIP();
        const port = PORT;
        res.json({ ip: localIP, port, url: `http://${localIP}:${port}` });
    }
});

// ─── Socket.IO ────────────────────────────────────────────────────
let connectedClients = 0;
const onlineUsers = new Map(); // socketId -> { gameId, displayName, userStatus }

function broadcastOnlineList() {
    const session = db.getActiveSession();
    const list = [];
    for (const [, user] of onlineUsers) {
        let regStatus = 'pending';
        if (session) {
            const reg = db.getRegistrationByGameId(session.id, user.gameId);
            if (reg) regStatus = reg.status || 'pending';
        }
        list.push({
            gameId: user.gameId,
            displayName: user.displayName,
            userStatus: user.userStatus || '在線',
            regStatus
        });
    }
    io.to('registered').emit('onlineList:updated', list);
    io.to('admin').emit('onlineList:updated', list);
}

io.on('connection', (socket) => {
    connectedClients++;
    io.emit('clients:count', connectedClients);

    // Join a room based on registration
    socket.on('join:registered', (data) => {
        if (data && data.gameId) {
            socket.gameId = data.gameId;
            socket.displayName = data.displayName || data.gameId;
            socket.join('registered');

            // Validate: check if this gameId actually registered
            const session = db.getActiveSession();
            if (session) {
                const reg = db.getRegistrationByGameId(session.id, data.gameId);
                if (!reg) {
                    socket.leave('registered');
                    return;
                }
            }

            onlineUsers.set(socket.id, {
                gameId: data.gameId,
                displayName: data.displayName || data.gameId,
                userStatus: '在線'
            });
            broadcastOnlineList();

            // System join message
            const joinMsg = {
                id: 0,
                gameId: 'SYSTEM',
                displayName: '系統',
                message: `📥 ${data.displayName || data.gameId} 加入了聊天室`,
                isAdmin: false,
                isSystem: true,
                sentAt: db.taipeiNow()
            };
            io.to('registered').emit('chat:message', joinMsg);
            io.to('admin').emit('chat:message', joinMsg);
        }
    });

    // User status change (暫離, 在線, etc.)
    socket.on('user:status-change', (data) => {
        if (data && data.status && onlineUsers.has(socket.id)) {
            const allowed = ['在線', '暫離', '稍等一下'];
            const status = allowed.includes(data.status) ? data.status : '在線';
            onlineUsers.get(socket.id).userStatus = status;
            broadcastOnlineList();
        }
    });

    // Typing indicator
    socket.on('chat:typing', (isTyping) => {
        if (socket.gameId && onlineUsers.has(socket.id)) {
            socket.to('registered').emit('chat:typing', {
                displayName: socket.displayName || socket.gameId,
                isTyping: !!isTyping
            });
        }
    });

    // ─── Voice Broadcast (Admin → Users) ──────────────────────────
    socket.on('voice:start', () => {
        if (!socket.isAdmin) return;
        io.to('registered').emit('voice:start');
    });

    socket.on('voice:data', (audioData) => {
        if (!socket.isAdmin) return;
        // Relay binary audio data to all registered users
        io.to('registered').emit('voice:data', audioData);
    });

    socket.on('voice:stop', () => {
        if (!socket.isAdmin) return;
        io.to('registered').emit('voice:stop');
    });

    // Admin join
    socket.on('join:admin', (data) => {
        const validToken = db.getSettingValue('admin_session_token');
        if (data && data.token === validToken) {
            socket.join('admin');
            socket.isAdmin = true;
            if (data.displayName) {
                socket.adminDisplayName = data.displayName.trim().substring(0, 30);
            }
            broadcastOnlineList();
        }
    });

    // Admin set custom display name
    socket.on('admin:set-name', (data) => {
        if (socket.isAdmin && data && data.name) {
            socket.adminDisplayName = data.name.trim().replace(/[<>]/g, '').substring(0, 30);
        }
    });

    // Chat message
    socket.on('chat:message', (data) => {
        if (!data || !data.message || !data.message.trim()) return;

        const session = db.getActiveSession();
        if (!session) return;

        const message = data.message.trim().replace(/[<>]/g, '').substring(0, 500);
        let gameId, displayName, isAdmin;

        if (socket.isAdmin) {
            gameId = 'ADMIN';
            displayName = socket.adminDisplayName || '🎮 主辦人';
            isAdmin = true;
        } else if (socket.gameId) {
            const reg = db.getRegistrationByGameId(session.id, socket.gameId);
            if (!reg) return;
            gameId = socket.gameId;
            displayName = socket.displayName || socket.gameId;
            isAdmin = false;
            var regStatus = reg.status || 'pending';
        } else {
            return;
        }

        const msgId = db.addChatMessage(session.id, gameId, displayName, message, isAdmin);

        const chatMsg = {
            id: msgId,
            gameId,
            displayName,
            message,
            isAdmin,
            regStatus: regStatus || null,
            sentAt: db.taipeiNow()
        };

        io.to('registered').emit('chat:message', chatMsg);
        io.to('admin').emit('chat:message', chatMsg);
    });

    socket.on('disconnect', () => {
        connectedClients = Math.max(0, connectedClients - 1);
        io.emit('clients:count', connectedClients);
        if (onlineUsers.has(socket.id)) {
            const user = onlineUsers.get(socket.id);
            onlineUsers.delete(socket.id);
            broadcastOnlineList();

            // System leave message
            const leaveMsg = {
                id: 0,
                gameId: 'SYSTEM',
                displayName: '系統',
                message: `📤 ${user.displayName} 離開了聊天室`,
                isAdmin: false,
                isSystem: true,
                sentAt: db.taipeiNow()
            };
            io.to('registered').emit('chat:message', leaveMsg);
            io.to('admin').emit('chat:message', leaveMsg);
        }
    });
});

// ─── Error handling ───────────────────────────────────────────────
app.use((err, req, res, next) => {
    console.error('Server error:', err.message);
    res.status(500).json({ error: '伺服器內部錯誤' });
});

// ─── Get local IP ─────────────────────────────────────────────────
function getLocalIP() {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal) {
                return iface.address;
            }
        }
    }
    return '127.0.0.1';
}

// ─── Start server ─────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;

async function start() {
    // Initialize database (sql.js loads WASM asynchronously)
    await db.initialize();
    console.log('✅ 資料庫已載入');

    server.listen(PORT, '0.0.0.0', () => {
        const localIP = getLocalIP();
        console.log('');
        console.log('╔══════════════════════════════════════════════════════╗');
        console.log('║        🎮 遊戲報名排隊系統 已啟動！                  ║');
        console.log('╠══════════════════════════════════════════════════════╣');
        console.log(`║  管理員面板:  http://localhost:${PORT}/admin          ║`);
        console.log(`║  報名頁面:    http://${localIP}:${PORT}              ║`);
        console.log('╠══════════════════════════════════════════════════════╣');
        console.log('║  把上面的「報名頁面」網址分享給其他玩家即可！        ║');
        console.log('║  按 Ctrl+C 關閉系統                                 ║');
        console.log('╚══════════════════════════════════════════════════════╝');
        console.log('');
    });
}

start().catch(err => {
    console.error('啟動失敗:', err);
    process.exit(1);
});

// ─── Scheduled Auto-Open/Close ────────────────────────────────────
setInterval(() => {
    try {
        const now = new Date(db.taipeiNow().replace(' ', 'T') + '+08:00');

        // Check scheduled close
        const closeTime = db.getSettingValue('scheduled_close', '');
        if (closeTime) {
            const closeDate = new Date(closeTime);
            if (now >= closeDate) {
                const session = db.getActiveSession();
                if (session) {
                    db.endSession(session.id);
                    db.setSettingValue('scheduled_close', '');
                    io.emit('session:ended');
                    console.log('⏰ 已自動結束報名場次');
                }
            }
        }

        // Check scheduled open
        const openTime = db.getSettingValue('scheduled_open', '');
        const openData = db.getSettingValue('scheduled_open_data', '{}');
        if (openTime) {
            const openDate = new Date(openTime);
            if (now >= openDate) {
                const session = db.getActiveSession();
                if (!session) {
                    try {
                        const data = JSON.parse(openData);
                        db.createSession(
                            data.title || '自動場次',
                            data.mainSlots || 4,
                            data.waitlistSlots || 2
                        );
                        db.setSettingValue('scheduled_open', '');
                        db.setSettingValue('scheduled_open_data', '{}');
                        io.emit('session:created');
                        console.log('⏰ 已自動開啟報名場次');
                    } catch (e) { /* ignore */ }
                }
            }
        }
    } catch (e) { /* ignore */ }
}, 30 * 1000); // Check every 30 seconds

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\n正在關閉系統...');
    db.closeDatabase();
    server.close(() => {
        console.log('系統已安全關閉');
        process.exit(0);
    });
});

process.on('SIGTERM', () => {
    db.closeDatabase();
    server.close(() => process.exit(0));
});
