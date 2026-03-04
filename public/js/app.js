/* ═══════════════════════════════════════════════════════════════════
   Public Registration Page — Client-side JavaScript
   ═══════════════════════════════════════════════════════════════════ */

(function () {
    'use strict';

    // ─── State ────────────────────────────────────────────────────────
    let state = {
        registered: false,
        gameId: null,
        displayName: null,
        sessionActive: false,
        resultsPublished: false,
        myStatus: 'pending',
        muted: localStorage.getItem('queue_muted') === 'true'
    };

    // ─── Browser Fingerprint ──────────────────────────────────────────
    function generateFingerprint() {
        const raw = [
            screen.width, screen.height, screen.colorDepth,
            Intl.DateTimeFormat().resolvedOptions().timeZone,
            navigator.language,
            navigator.platform,
            navigator.hardwareConcurrency || 0,
            new Date().getTimezoneOffset()
        ].join('|');
        // Simple hash
        let hash = 0;
        for (let i = 0; i < raw.length; i++) {
            hash = ((hash << 5) - hash) + raw.charCodeAt(i);
            hash |= 0;
        }
        return Math.abs(hash).toString(36);
    }
    const browserFingerprint = generateFingerprint();

    // ─── Browser Notifications ─────────────────────────────────────────
    function requestNotifPermission() {
        if ('Notification' in window && Notification.permission === 'default') {
            Notification.requestPermission();
        }
    }

    function sendBrowserNotif(title, body) {
        if ('Notification' in window && Notification.permission === 'granted') {
            try {
                new Notification(title, { body, icon: '🎮', tag: 'lily-queue' });
            } catch (e) { /* mobile might not support */ }
        }
    }

    // ─── Sound Effects (Web Audio API) ────────────────────────────────
    let audioCtx = null;
    function getAudioCtx() {
        if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        return audioCtx;
    }

    function playTone(freq, duration, delay = 0) {
        const ctx = getAudioCtx();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.frequency.value = freq;
        osc.type = 'sine';
        const startTime = ctx.currentTime + delay;
        gain.gain.setValueAtTime(0.3, startTime);
        gain.gain.exponentialRampToValueAtTime(0.01, startTime + duration);
        osc.start(startTime);
        osc.stop(startTime + duration);
    }

    function playSound(type) {
        try {
            if (type === 'chat') {
                // Short gentle ping
                playTone(800, 0.15);
            } else if (type === 'announce') {
                // Rising two-tone
                playTone(600, 0.15);
                playTone(900, 0.2, 0.15);
            } else if (type === 'alarm') {
                // Urgent triple-tone alarm
                playTone(800, 0.2);
                playTone(1000, 0.2, 0.25);
                playTone(1200, 0.3, 0.5);
            }
        } catch (e) { /* audio not supported */ }
    }

    // ─── Confetti Animation ───────────────────────────────────────────
    function launchConfetti() {
        const emojis = ['🎉', '🎊', '✨', '🌟', '⭐', '🎮'];
        const container = document.createElement('div');
        container.className = 'confetti-container';
        document.body.appendChild(container);
        for (let i = 0; i < 40; i++) {
            const span = document.createElement('span');
            span.className = 'confetti-piece';
            span.textContent = emojis[Math.floor(Math.random() * emojis.length)];
            span.style.left = Math.random() * 100 + '%';
            span.style.animationDelay = Math.random() * 0.5 + 's';
            span.style.animationDuration = (1.5 + Math.random() * 1.5) + 's';
            container.appendChild(span);
        }
        setTimeout(() => container.remove(), 3500);
    }

    // ─── Socket.IO connection ─────────────────────────────────────────
    const socket = io({ transports: ['websocket', 'polling'] });

    // Reconnect overlay
    function showReconnectOverlay() {
        let overlay = document.getElementById('reconnectOverlay');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'reconnectOverlay';
            overlay.innerHTML = '<div class="reconnect-box"><span class="spinner"></span> 重新連線中...</div>';
            document.body.appendChild(overlay);
        }
        overlay.style.display = 'flex';
    }
    function hideReconnectOverlay() {
        const overlay = document.getElementById('reconnectOverlay');
        if (overlay) overlay.style.display = 'none';
    }

    socket.on('disconnect', () => showReconnectOverlay());
    socket.on('connect', () => {
        hideReconnectOverlay();
        // Re-join room if was registered
        if (state.registered && state.gameId) {
            socket.emit('join:registered', { gameId: state.gameId, displayName: state.displayName });
        }
    });

    // ─── DOM Elements ─────────────────────────────────────────────────
    const $ = (sel) => document.querySelector(sel);
    const statusDot = $('#statusDot');
    const statusText = $('#statusText');
    const slotCounter = $('#slotCounter');
    const progressFill = $('#progressFill');
    const sessionTitle = $('#sessionTitle');
    const registerCard = $('#registerCard');
    const statusDisplayCard = $('#statusDisplayCard');
    const closedCard = $('#closedCard');
    const resultsCard = $('#resultsCard');
    const chatColumn = $('#chatColumn');
    const registerForm = $('#registerForm');
    const gameIdInput = $('#gameId');
    const displayNameInput = $('#displayName');
    const submitBtn = $('#submitBtn');

    // ─── Restore state from sessionStorage ────────────────────────────
    function restoreState() {
        const saved = sessionStorage.getItem('queue_state');
        if (saved) {
            try {
                const parsed = JSON.parse(saved);
                if (parsed.gameId) {
                    state.registered = true;
                    state.gameId = parsed.gameId;
                    state.displayName = parsed.displayName;
                }
            } catch (e) { /* ignore */ }
        }
    }

    function saveState() {
        sessionStorage.setItem('queue_state', JSON.stringify({
            gameId: state.gameId,
            displayName: state.displayName
        }));
    }

    // ─── Toast notifications ──────────────────────────────────────────
    function showToast(message, type = 'success') {
        const existing = document.querySelector('.toast');
        if (existing) existing.remove();

        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.innerHTML = `
      <div class="toast-content">
        <span class="toast-icon">${type === 'success' ? '✅' : '❌'}</span>
        <span class="toast-message">${message}</span>
      </div>
    `;
        document.body.appendChild(toast);
        setTimeout(() => {
            toast.classList.add('hiding');
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }

    // ─── Background image ────────────────────────────────────────────
    async function loadBackground() {
        try {
            const res = await fetch('/api/background');
            const data = await res.json();
            if (data.url) {
                document.body.style.backgroundImage = `url(${data.url})`;
                document.body.style.backgroundPosition = data.position || 'center center';
                document.body.style.backgroundSize = data.size || 'cover';
                document.body.classList.add('has-bg-image');
            }
        } catch (e) { /* ignore */ }
    }

    // ─── Load session status ──────────────────────────────────────────
    async function loadStatus() {
        try {
            const res = await fetch('/api/status');
            const data = await res.json();
            updateStatusDisplay(data);

            if (state.registered && data.active) {
                await checkMyStatus();
            }
        } catch (e) {
            statusText.textContent = '連線失敗';
            statusDot.className = 'status-dot offline';
        }
    }

    function updateStatusDisplay(data) {
        state.sessionActive = data.active;
        state.resultsPublished = data.resultsPublished;

        if (data.active) {
            statusDot.className = 'status-dot online';
            statusText.textContent = '報名中';
            sessionTitle.textContent = data.title || '莉刻報名';
            slotCounter.innerHTML = `已報名 <strong>${data.currentCount || 0}</strong> / 正選 ${data.mainSlots} ＋備取 ${data.waitlistSlots}`;

            const total = data.mainSlots + data.waitlistSlots;
            const pct = total > 0 ? Math.min(100, ((data.currentCount || 0) / total) * 100) : 0;
            progressFill.style.width = pct + '%';

            // Countdown timer
            startCountdown(data.startTime);

            // Render custom registration fields
            renderCustomFields(data.customFields || []);
            if (state.registered) {
                registerCard.style.display = 'none';
                statusDisplayCard.style.display = '';
                closedCard.style.display = 'none';
                chatColumn.style.display = '';
            } else {
                registerCard.style.display = '';
                statusDisplayCard.style.display = 'none';
                closedCard.style.display = 'none';
                chatColumn.style.display = 'none';
            }

            if (data.resultsPublished) {
                loadResults();
            } else {
                resultsCard.style.display = 'none';
            }
        } else {
            statusDot.className = 'status-dot offline';
            statusText.textContent = '未開放';
            sessionTitle.textContent = '等待主辦人開啟報名';
            slotCounter.textContent = '--';
            progressFill.style.width = '0%';

            registerCard.style.display = 'none';
            statusDisplayCard.style.display = 'none';
            closedCard.style.display = '';
            chatColumn.style.display = 'none';
            resultsCard.style.display = 'none';
        }
    }

    // ─── Update my status display ─────────────────────────────────────
    function updateMyStatusUI(status) {
        state.myStatus = status;
        const statusIcon = $('#statusIcon');
        const statusTitle = $('#statusTitle');
        const statusMessage = $('#statusMessage');
        const badge = $('#myStatusBadge');

        const statusMap = {
            pending: {
                icon: '⏳', title: '等待管理員審核',
                message: '已收到您的報名資料，請等待主辦人審核',
                badge: '⏳ 審核中', badgeClass: 'badge badge-pending'
            },
            selected: {
                icon: '🎉', title: '報名成功！已錄取',
                message: '恭喜！您已被錄取為正選',
                badge: '✅ 正選錄取', badgeClass: 'badge badge-selected'
            },
            waitlist: {
                icon: '📋', title: '備取中',
                message: '您目前列為備取，請等待最終結果',
                badge: '📋 備取', badgeClass: 'badge badge-waitlist'
            },
            rejected: {
                icon: '❌', title: '未錄取',
                message: '很抱歉，本次未被錄取',
                badge: '❌ 未錄取', badgeClass: 'badge badge-rejected'
            }
        };

        const s = statusMap[status] || statusMap.pending;
        statusIcon.textContent = s.icon;
        statusTitle.textContent = s.title;
        statusMessage.textContent = s.message;
        badge.textContent = s.badge;
        badge.className = s.badgeClass;
    }

    // ─── Check own status ─────────────────────────────────────────────
    async function checkMyStatus() {
        if (!state.gameId) return;
        try {
            const res = await fetch(`/api/my-status/${encodeURIComponent(state.gameId)}`);
            const data = await res.json();

            if (data.registered) {
                state.registered = true;
                registerCard.style.display = 'none';
                statusDisplayCard.style.display = '';
                chatColumn.style.display = '';
                $('#registeredGameId').textContent = `遊戲 ID：${state.gameId}`;
                $('#positionNum').textContent = data.position;

                if (data.isLateFlagged) {
                    $('#lateWarning').style.display = '';
                }

                // Update status display (with toast if changed)
                const prevStatus = state.myStatus;
                updateMyStatusUI(data.status);
                if (prevStatus && prevStatus !== data.status) {
                    const toastMap = {
                        selected: t('selectedCelebration'),
                        waitlist: '📋 您目前列為備取，請等待最終結果',
                        rejected: '❌ 很抱歉，本次未被錄取',
                        pending: '⏳ 您的審核狀態已變更為等待中'
                    };
                    const msg = toastMap[data.status] || '您的審核狀態已更新';
                    showToast(msg);
                    sendBrowserNotif(t('systemName'), msg);
                    // Celebration for selected!
                    if (data.status === 'selected') {
                        launchConfetti();
                        setTimeout(() => launchConfetti(), 800);
                    }
                }

                // Join chat room
                socket.emit('join:registered', { gameId: state.gameId, displayName: state.displayName });
            } else {
                // No longer registered (new session maybe)
                state.registered = false;
                state.gameId = null;
                sessionStorage.removeItem('queue_state');
                loadStatus();
            }
        } catch (e) { /* ignore */ }
    }

    // ─── Custom Fields Rendering ──────────────────────────────────
    function renderCustomFields(fields) {
        let container = $('#customFieldsContainer');
        if (!container) {
            container = document.createElement('div');
            container.id = 'customFieldsContainer';
            // Insert before the submit button
            submitBtn.parentElement.insertBefore(container, submitBtn);
        }
        if (!fields || fields.length === 0) {
            container.innerHTML = '';
            return;
        }
        let html = '';
        fields.forEach(f => {
            if (f.type === 'select') {
                const opts = (f.options || []).map(o => `<option value="${o}">${o}</option>`).join('');
                html += `<div class="form-group">
                    <label>${f.name}${f.required ? ' *' : ''}</label>
                    <select class="form-input custom-field" data-name="${f.name}" ${f.required ? 'required' : ''}>
                        <option value="">請選擇</option>${opts}
                    </select>
                </div>`;
            } else {
                html += `<div class="form-group">
                    <label>${f.name}${f.required ? ' *' : ''}</label>
                    <input type="text" class="form-input custom-field" data-name="${f.name}" ${f.required ? 'required' : ''} placeholder="請輸入${f.name}">
                </div>`;
            }
        });
        container.innerHTML = html;
    }

    // ─── Registration form ────────────────────────────────────────────
    registerForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const gameId = gameIdInput.value.trim();
        const displayName = displayNameInput.value.trim();

        if (!gameId) {
            showToast('請輸入遊戲 ID', 'error');
            return;
        }

        submitBtn.disabled = true;
        submitBtn.innerHTML = '<span class="spinner"></span> 報名中...';

        try {
            // Collect custom field data
            const extraData = {};
            document.querySelectorAll('.custom-field').forEach(el => {
                extraData[el.dataset.name] = el.value.trim();
            });

            const res = await fetch('/api/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ gameId, displayName, extraData, fingerprint: browserFingerprint })
            });
            const data = await res.json();

            if (!res.ok) {
                showToast(data.error || '報名失敗', 'error');
                submitBtn.disabled = false;
                submitBtn.innerHTML = '<span>🚀</span> 確認報名';
                return;
            }

            // Success - show reviewing state
            state.registered = true;
            state.gameId = gameId;
            state.displayName = displayName || gameId;
            saveState();

            registerCard.style.display = 'none';
            statusDisplayCard.style.display = '';
            chatColumn.style.display = '';

            $('#registeredGameId').textContent = `遊戲 ID：${gameId}`;
            $('#positionNum').textContent = data.position;
            updateMyStatusUI('pending'); // Show "waiting for review"

            if (data.isLateFlagged) {
                $('#lateWarning').style.display = '';
            }

            showToast('報名資料已送出，等待管理員審核');
            launchConfetti();

            // Join chat
            socket.emit('join:registered', { gameId: state.gameId, displayName: state.displayName });

        } catch (err) {
            showToast('網路錯誤，請稍後再試', 'error');
            submitBtn.disabled = false;
            submitBtn.innerHTML = '<span>🚀</span> 確認報名';
        }
    });

    // ─── Results ──────────────────────────────────────────────────────
    async function loadResults() {
        try {
            const res = await fetch('/api/results');
            const data = await res.json();

            if (data.published) {
                resultsCard.style.display = '';
                const content = $('#resultsContent');
                content.innerHTML = '';

                if (data.selected && data.selected.length > 0) {
                    content.innerHTML += renderResultGroup('🎉 正選名單', data.selected, 'selected');
                }
                if (data.waitlist && data.waitlist.length > 0) {
                    content.innerHTML += renderResultGroup('📋 備取名單', data.waitlist, 'waitlist');
                }

                await checkMyStatus();
            }
        } catch (e) { /* ignore */ }
    }

    function renderResultGroup(title, items, type) {
        let html = `<div class="results-group"><h4>${title}</h4>`;
        items.forEach((item, i) => {
            const lateTag = item.is_late_flagged ? ' <span class="badge-late">⚠ 遲到</span>' : '';
            html += `
        <div class="result-item">
          <span class="rank">${i + 1}</span>
          <span class="name">${escapeHtml(item.display_name || item.game_id)}${lateTag}</span>
          <span class="time">${formatTime(item.registered_at)}</span>
        </div>`;
        });
        html += '</div>';
        return html;
    }

    // ─── Online List ─────────────────────────────────────────────────────
    const regStatusLabels = {
        selected: '正選', waitlist: '備取', pending: '審核中', rejected: '未錄取'
    };

    function updateOnlineList(users) {
        const container = $('#onlineList');
        const badge = $('#onlineCountBadge');
        if (!users || users.length === 0) {
            container.innerHTML = '<p class="online-empty">暫無在線用戶</p>';
            if (badge) badge.textContent = '0';
            return;
        }

        if (badge) badge.textContent = users.length;

        let html = '';
        users.forEach(user => {
            const statusIcon = user.userStatus === '在線' ? '🟢' : user.userStatus === '暫離' ? '🟡' : '🔴';
            const regLabel = regStatusLabels[user.regStatus] || '審核中';
            const regClass = user.regStatus === 'selected' ? 'reg-selected' : user.regStatus === 'rejected' ? 'reg-rejected' : '';
            html += `
              <div class="online-user">
                <span class="online-status-icon">${statusIcon}</span>
                <span class="online-name">${escapeHtml(user.displayName)}</span>
                <span class="online-reg-tag ${regClass}">${regLabel}</span>
              </div>`;
        });
        container.innerHTML = html;
    }

    // ─── Chat ─────────────────────────────────────────────────────────
    const chatMessages = $('#chatMessages');
    const chatInput = $('#chatInput');
    const chatSendBtn = $('#chatSendBtn');
    const chatEmpty = $('#chatEmpty');

    function highlightMentions(text) {
        // Only match @mentions with safe alphanumeric/CJK characters
        return text.replace(/@([\w\u4e00-\u9fff\u3040-\u30ff]+)/g, (match, name) => {
            const isMe = state.displayName && name === state.displayName;
            return `<span class="mention${isMe ? ' mention-me' : ''}">${match}</span>`;
        });
    }

    function addChatMessage(msg) {
        if (chatEmpty) chatEmpty.style.display = 'none';

        const div = document.createElement('div');
        const isSystem = msg.isSystem || msg.gameId === 'SYSTEM';
        div.className = `chat-msg ${msg.isAdmin ? 'is-admin' : ''} ${isSystem ? 'is-system' : ''}`;

        if (isSystem) {
            div.innerHTML = `<div class="chat-system-text">${escapeHtml(msg.message)}</div>`;
        } else {
            const statusTag = msg.regStatus && !msg.isAdmin
                ? ` <span class="online-reg-tag ${msg.regStatus === 'selected' ? 'reg-selected' : msg.regStatus === 'rejected' ? 'reg-rejected' : ''}">${regStatusLabels[msg.regStatus] || '審核中'}</span>`
                : '';
            div.innerHTML = `
          <div class="chat-meta">
            <span class="chat-name">${escapeHtml(msg.displayName)}${statusTag}</span>
            <span class="chat-time">${formatTime(msg.sentAt || msg.sent_at)}</span>
          </div>
          <div class="chat-text">${highlightMentions(escapeHtml(msg.message))}</div>
        `;
        }
        chatMessages.appendChild(div);
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }

    async function loadChatHistory() {
        try {
            const res = await fetch('/api/chat');
            const data = await res.json();
            chatMessages.innerHTML = '';
            if (data.messages && data.messages.length > 0) {
                data.messages.forEach(msg => addChatMessage(msg));
            } else {
                chatMessages.innerHTML = `<div class="empty-state" id="chatEmpty"><p style="font-size: 0.8rem;">還沒有訊息，來打個招呼吧！</p></div>`;
            }
        } catch (e) { /* ignore */ }
    }

    function sendChat() {
        const msg = chatInput.value.trim();
        if (!msg || !state.registered) return;
        socket.emit('chat:message', { message: msg });
        chatInput.value = '';
    }

    chatSendBtn.addEventListener('click', sendChat);
    chatInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') sendChat();
    });

    // ─── Typing Indicator ─────────────────────────────────────────────
    let typingTimeout = null;
    let isTyping = false;
    chatInput.addEventListener('input', () => {
        if (!isTyping && state.registered) {
            isTyping = true;
            socket.emit('chat:typing', true);
        }
        clearTimeout(typingTimeout);
        typingTimeout = setTimeout(() => {
            isTyping = false;
            socket.emit('chat:typing', false);
        }, 2000);
    });

    // Show typing indicator from others
    const typingIndicator = document.createElement('div');
    typingIndicator.className = 'typing-indicator';
    typingIndicator.style.display = 'none';
    const chatInputRow = document.querySelector('.chat-input-row');
    if (chatInputRow) chatInputRow.parentElement.insertBefore(typingIndicator, chatInputRow);
    const typingUsers = new Map();

    socket.on('chat:typing', (data) => {
        if (data.isTyping) {
            typingUsers.set(data.displayName, Date.now());
        } else {
            typingUsers.delete(data.displayName);
        }
        const names = [...typingUsers.keys()];
        if (names.length > 0) {
            typingIndicator.textContent = names.length === 1
                ? t('typing', { name: names[0] })
                : `${names.slice(0, 2).join(', ')} ${t('typing', { name: '' }).replace('{name}', '').trim()}`;
            typingIndicator.style.display = '';
        } else {
            typingIndicator.style.display = 'none';
        }
    });

    // Auto-clear stale typing indicators
    setInterval(() => {
        const now = Date.now();
        for (const [name, ts] of typingUsers) {
            if (now - ts > 5000) typingUsers.delete(name);
        }
        if (typingUsers.size === 0) typingIndicator.style.display = 'none';
    }, 3000);

    // ─── Emoji Picker ────────────────────────────────────────────────
    const EMOJIS = ['😀', '😂', '😍', '🤣', '😎', '🤔', '😢', '😡', '👍', '👎', '👋', '🙏', '🎉', '🔥', '❤️', '🎮', '🏆', '⭐', '💪', '🤩', '🙃', '🥱', '😴', '🌟', '👀', '💬', '✅', '❌', '⚠️', '💡'];

    const emojiBtn = $('#emojiBtn');
    const emojiPicker = $('#emojiPicker');

    if (emojiBtn && emojiPicker) {
        emojiPicker.innerHTML = EMOJIS.map(e => `<span class="emoji-item">${e}</span>`).join('');

        emojiBtn.addEventListener('click', () => {
            emojiPicker.classList.toggle('open');
        });

        emojiPicker.addEventListener('click', (e) => {
            if (e.target.classList.contains('emoji-item')) {
                chatInput.value += e.target.textContent;
                chatInput.focus();
                emojiPicker.classList.remove('open');
            }
        });

        // Close picker when clicking outside
        document.addEventListener('click', (e) => {
            if (!emojiBtn.contains(e.target) && !emojiPicker.contains(e.target)) {
                emojiPicker.classList.remove('open');
            }
        });
    }

    // ─── User status selector ─────────────────────────────────────────
    const myUserStatus = $('#myUserStatus');
    if (myUserStatus) {
        myUserStatus.addEventListener('change', () => {
            socket.emit('user:status-change', { status: myUserStatus.value });
        });
    }

    // ─── Socket events ───────────────────────────────────────────────
    socket.on('connect', () => {
        loadStatus();
        loadBackground();
        if (state.registered && state.gameId) {
            socket.emit('join:registered', { gameId: state.gameId, displayName: state.displayName });
            loadChatHistory();
        }
    });

    socket.on('disconnect', () => {
        statusDot.className = 'status-dot offline';
        statusText.textContent = '連線中斷';
    });

    socket.on('session:updated', () => {
        loadStatus();
    });

    socket.on('registration:new', () => {
        loadStatus();
    });

    socket.on('registrations:updated', () => {
        console.log('[SOCKET] registrations:updated received, registered=', state.registered);
        if (state.registered) checkMyStatus();
        loadStatus();
    });

    socket.on('results:published', () => {
        state.resultsPublished = true;
        loadResults();
        showToast('🎉 錄取結果已公布！');
    });

    socket.on('background:updated', (data) => {
        if (data.url) {
            document.body.style.backgroundImage = `url(${data.url})`;
            document.body.style.backgroundPosition = data.position || 'center center';
            document.body.style.backgroundSize = data.size || 'cover';
            document.body.classList.add('has-bg-image');
        } else {
            document.body.style.backgroundImage = '';
            document.body.classList.remove('has-bg-image');
        }
    });

    socket.on('chat:message', (msg) => {
        addChatMessage(msg);
        // Play sound if page is in background and not muted
        if (document.hidden && !state.muted && !msg.isSystem) {
            playSound('chat');
        }
    });

    socket.on('onlineList:updated', (users) => {
        updateOnlineList(users);
    });

    socket.on('admin:announcement', (data) => {
        const banner = $('#announcementBanner');
        const text = $('#announcementText');
        text.textContent = data.message;
        banner.style.display = '';
        banner.classList.add('announcement-flash');
        setTimeout(() => banner.classList.remove('announcement-flash'), 1000);
        sendBrowserNotif('📢 公告', data.message);
        if (!state.muted) playSound('announce');
    });

    socket.on('admin:attention', () => {
        playSound('alarm');
        sendBrowserNotif('🔔 注意！', '管理員提醒大家準備開始！');
        showToast('🔔 管理員提醒：準備開始！');
    });

    socket.on('user:kicked', () => {
        showToast('⚠️ 您已被管理員移出聊天室', 'error');
        state.registered = false;
        state.gameId = null;
        sessionStorage.removeItem('queue_state');
        loadStatus();
    });

    socket.on('admin:private-message', (data) => {
        // Show in chat as a private whisper message
        if (chatEmpty) chatEmpty.style.display = 'none';
        const div = document.createElement('div');
        div.className = 'chat-msg is-private';
        div.innerHTML = `
          <div class="chat-meta">
            <span class="chat-name">💌 管理員私訊</span>
            <span class="chat-time">${formatTime(data.sentAt)}</span>
          </div>
          <div class="chat-text">${escapeHtml(data.message)}</div>
          <div class="chat-private-tag">僅你可見</div>
        `;
        chatMessages.appendChild(div);
        chatMessages.scrollTop = chatMessages.scrollHeight;
        sendBrowserNotif('💌 管理員私訊', data.message);
        if (!state.muted) playSound('announce');
    });

    socket.on('chat:cleared', () => {
        chatMessages.innerHTML = `<div class="empty-state" id="chatEmpty"><p style="font-size: 0.8rem;">對話紀錄已被管理員清除</p></div>`;
    });

    // ─── Utilities ────────────────────────────────────────────────────
    function escapeHtml(str) {
        if (!str) return '';
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    function formatTime(isoStr) {
        if (!isoStr) return '';
        try {
            // Try parsing as ISO or local time string
            const d = new Date(isoStr);
            if (!isNaN(d.getTime())) {
                return d.toLocaleTimeString('zh-TW', {
                    hour: '2-digit', minute: '2-digit', second: '2-digit',
                    timeZone: 'Asia/Taipei'
                });
            }
            // Fallback for SQLite format "YYYY-MM-DD HH:MM:SS"
            return isoStr.split(/[T ]/).pop() || isoStr;
        } catch (e) {
            return isoStr;
        }
    }

    // ─── Chat Tab Switching ────────────────────────────────────────────
    document.querySelectorAll('.chat-tab[data-tab]').forEach(tab => {
        tab.addEventListener('click', () => {
            const target = tab.dataset.tab;
            if (!target) return;
            document.querySelectorAll('.chat-tab[data-tab]').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            document.querySelectorAll('.chat-tab-content').forEach(c => c.classList.remove('active'));
            const panel = target === 'messages' ? $('#tabMessages') : $('#tabOnline');
            if (panel) panel.classList.add('active');
        });
    });

    // ─── Theme Loader ─────────────────────────────────────────────────
    function applyTheme(theme) {
        const root = document.documentElement;
        if (theme.accentColor) {
            root.style.setProperty('--accent-primary', theme.accentColor);
            root.style.setProperty('--accent-primary-light', theme.accentColor + 'cc');
            root.style.setProperty('--border-color', theme.accentColor + '33');
            root.style.setProperty('--border-color-light', theme.accentColor + '1a');
            root.style.setProperty('--border-glow', theme.accentColor + '66');
        }
        if (theme.bgPrimary) root.style.setProperty('--bg-primary', theme.bgPrimary);
        if (theme.bgSecondary) root.style.setProperty('--bg-secondary', theme.bgSecondary);
        if (theme.fontSizeTitle) root.style.setProperty('--font-size-title', theme.fontSizeTitle + 'rem');
        if (theme.fontSizeBody) root.style.setProperty('--font-size-body', theme.fontSizeBody + 'rem');
        if (theme.fontSizeChat) root.style.setProperty('--font-size-chat', theme.fontSizeChat + 'rem');
        if (theme.fontSizeLabel) root.style.setProperty('--font-size-label', theme.fontSizeLabel + 'rem');
        // System name
        const sysName = theme.systemName || '🎮 莉刻報名系統';
        const nameEl = document.getElementById('userSystemName');
        if (nameEl) nameEl.textContent = sysName;
        document.title = sysName;
    }

    async function loadTheme() {
        try {
            const theme = await fetch('/api/theme').then(r => r.json());
            applyTheme(theme);
        } catch (e) { /* use default */ }
    }

    // Listen for real-time theme changes
    socket.on('theme:updated', applyTheme);

    // ─── Countdown Timer ────────────────────────────────────────────────
    let countdownInterval = null;

    function startCountdown(startTimeStr) {
        const timerEl = $('#countdownTimer');
        const textEl = $('#countdownText');
        if (countdownInterval) clearInterval(countdownInterval);

        if (!startTimeStr) {
            timerEl.style.display = 'none';
            return;
        }

        timerEl.style.display = '';
        const target = new Date(startTimeStr).getTime();

        function update() {
            const now = Date.now();
            const diff = target - now;
            if (diff <= 0) {
                textEl.textContent = '已開始！';
                clearInterval(countdownInterval);
                return;
            }
            const h = Math.floor(diff / 3600000);
            const m = Math.floor((diff % 3600000) / 60000);
            const s = Math.floor((diff % 60000) / 1000);
            textEl.textContent = `${h > 0 ? h + ':' : ''}${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
        }

        update();
        countdownInterval = setInterval(update, 1000);
    }

    // ─── Mute Toggle ──────────────────────────────────────────────────
    const muteBtn = $('#muteToggleBtn');
    if (muteBtn) {
        muteBtn.textContent = state.muted ? '🔇' : '🔊';
        muteBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            state.muted = !state.muted;
            localStorage.setItem('queue_muted', state.muted);
            muteBtn.textContent = state.muted ? '🔇' : '🔊';
            showToast(state.muted ? t('muted') : t('unmuted'));
        });
    }

    // ─── Language Switching ───────────────────────────────────────────
    function applyLanguage() {
        const lang = getLang();
        document.documentElement.lang = lang === 'zh-TW' ? 'zh-TW' : lang;

        // Update static UI text
        const statusEl = $('#statusText');
        if (statusEl && statusEl.textContent === '連線中...' || statusEl && statusEl.textContent === 'Connecting...' || statusEl && statusEl.textContent === '接続中...') {
            statusEl.textContent = t('connecting');
        }

        // Chat placeholder
        const chatInput = document.getElementById('chatInput');
        if (chatInput) chatInput.placeholder = t('chatPlaceholder');

        // Chat send button
        const chatSend = document.getElementById('chatSendBtn');
        if (chatSend) chatSend.textContent = t('sendBtn');

        // Chat tab
        const chatTabBtns = document.querySelectorAll('.chat-tab[data-tab="messages"]');
        chatTabBtns.forEach(b => b.textContent = t('chatTab'));

        // Register button
        const regBtn = document.getElementById('registerSubmit');
        if (regBtn && !regBtn.disabled) regBtn.innerHTML = t('registerBtn');

        // Closed card
        const closedTitle = document.querySelector('#closedCard h2');
        if (closedTitle) closedTitle.textContent = t('closedTitle');
        const closedMsg = document.querySelector('#closedCard p');
        if (closedMsg) closedMsg.textContent = t('closedMsg');

        // Lang switcher value
        const langSwitch = $('#langSwitcher');
        if (langSwitch) langSwitch.value = lang;
    }

    // Language switcher handler
    const langSwitcher = $('#langSwitcher');
    if (langSwitcher) {
        langSwitcher.value = getLang();
        langSwitcher.addEventListener('change', () => {
            setLang(langSwitcher.value);
            applyLanguage();
            loadStatus(); // reload to re-render with new language
        });
    }

    // ─── Dark/Light Mode Toggle ───────────────────────────────────────
    function getPreferredTheme() {
        const saved = localStorage.getItem('queue_theme');
        if (saved) return saved;
        return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
    }

    function applyColorTheme(theme) {
        document.documentElement.setAttribute('data-theme', theme);
        const btn = document.getElementById('themeToggleBtn');
        if (btn) btn.textContent = theme === 'light' ? '☀️' : '🌙';
    }

    const themeToggle = document.getElementById('themeToggleBtn');
    if (themeToggle) {
        themeToggle.addEventListener('click', () => {
            const current = document.documentElement.getAttribute('data-theme') || 'dark';
            const next = current === 'dark' ? 'light' : 'dark';
            localStorage.setItem('queue_theme', next);
            applyColorTheme(next);
        });
    }

    // Listen for system theme changes
    window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', (e) => {
        if (!localStorage.getItem('queue_theme')) {
            applyColorTheme(e.matches ? 'light' : 'dark');
        }
    });

    // ─── Init ─────────────────────────────────────────────────────────
    applyColorTheme(getPreferredTheme());
    restoreState();
    loadStatus();
    loadBackground();
    loadTheme();
    requestNotifPermission();
    applyLanguage();
})();
