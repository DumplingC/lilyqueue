const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const helmet = require('helmet');
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

// ─── Security Middleware ──────────────────────────────────────────
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.socket.io", "https://fonts.googleapis.com"],
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

// ─── Static files ─────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));

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

io.on('connection', (socket) => {
    connectedClients++;
    io.emit('clients:count', connectedClients);

    // Join a room based on registration
    socket.on('join:registered', (data) => {
        if (data && data.gameId) {
            socket.gameId = data.gameId;
            socket.displayName = data.displayName || data.gameId;
            socket.join('registered');
        }
    });

    // Admin join
    socket.on('join:admin', (data) => {
        const validToken = db.getSettingValue('admin_session_token');
        if (data && data.token === validToken) {
            socket.join('admin');
            socket.isAdmin = true;
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
            displayName = '🎮 主辦人';
            isAdmin = true;
        } else if (socket.gameId) {
            // Verify the user is registered
            const reg = db.getRegistrationByGameId(session.id, socket.gameId);
            if (!reg) return; // Not registered, ignore
            gameId = socket.gameId;
            displayName = socket.displayName || socket.gameId;
            isAdmin = false;
        } else {
            return; // Not authenticated
        }

        const msgId = db.addChatMessage(session.id, gameId, displayName, message, isAdmin);

        const chatMsg = {
            id: msgId,
            gameId,
            displayName,
            message,
            isAdmin,
            sentAt: new Date().toISOString()
        };

        // Broadcast to registered users and admins
        io.to('registered').emit('chat:message', chatMsg);
        io.to('admin').emit('chat:message', chatMsg);
    });

    socket.on('disconnect', () => {
        connectedClients = Math.max(0, connectedClients - 1);
        io.emit('clients:count', connectedClients);
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
