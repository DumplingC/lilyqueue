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
        resultsPublished: false
    };

    // ─── Socket.IO connection ─────────────────────────────────────────
    const socket = io({ transports: ['websocket', 'polling'] });

    // ─── DOM Elements ─────────────────────────────────────────────────
    const $ = (sel) => document.querySelector(sel);
    const statusDot = $('#statusDot');
    const statusText = $('#statusText');
    const slotCounter = $('#slotCounter');
    const progressFill = $('#progressFill');
    const sessionTitle = $('#sessionTitle');
    const registerCard = $('#registerCard');
    const successCard = $('#successCard');
    const closedCard = $('#closedCard');
    const resultsCard = $('#resultsCard');
    const chatCard = $('#chatCard');
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

            if (state.registered) {
                registerCard.style.display = 'none';
                successCard.style.display = '';
                closedCard.style.display = 'none';
                chatCard.style.display = '';
            } else {
                registerCard.style.display = '';
                successCard.style.display = 'none';
                closedCard.style.display = 'none';
                chatCard.style.display = 'none';
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
            successCard.style.display = 'none';
            closedCard.style.display = '';
            chatCard.style.display = 'none';
            resultsCard.style.display = 'none';
        }
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
                successCard.style.display = '';
                chatCard.style.display = '';

                $('#registeredGameId').textContent = `遊戲 ID：${state.gameId}`;
                $('#positionNum').textContent = data.position;

                if (data.isLateFlagged) {
                    $('#lateWarning').style.display = '';
                }

                if (data.resultsPublished) {
                    const myStatusDisplay = $('#myStatusDisplay');
                    const badge = $('#myStatusBadge');
                    myStatusDisplay.style.display = '';

                    const statusMap = {
                        selected: { text: '🎉 正選錄取', class: 'badge-selected' },
                        waitlist: { text: '📋 備取', class: 'badge-waitlist' },
                        rejected: { text: '❌ 未錄取', class: 'badge-rejected' },
                        pending: { text: '⏳ 等待中', class: 'badge-pending' }
                    };
                    const s = statusMap[data.status] || statusMap.pending;
                    badge.textContent = s.text;
                    badge.className = `badge ${s.class}`;
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
            const res = await fetch('/api/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ gameId, displayName })
            });
            const data = await res.json();

            if (!res.ok) {
                showToast(data.error || '報名失敗', 'error');
                submitBtn.disabled = false;
                submitBtn.innerHTML = '<span>🚀</span> 確認報名';
                return;
            }

            // Success!
            state.registered = true;
            state.gameId = gameId;
            state.displayName = displayName || gameId;
            saveState();

            registerCard.style.display = 'none';
            successCard.style.display = '';
            chatCard.style.display = '';

            $('#registeredGameId').textContent = `遊戲 ID：${gameId}`;
            $('#positionNum').textContent = data.position;

            if (data.isLateFlagged) {
                $('#lateWarning').style.display = '';
            }

            showToast(data.message);

            // Join chat
            socket.emit('join:registered', { gameId: state.gameId, displayName: state.displayName });

            // Load existing chat messages
            loadChatMessages();

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

                // Also update own status
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

    // ─── Chat ─────────────────────────────────────────────────────────
    const chatMessages = $('#chatMessages');
    const chatInput = $('#chatInput');
    const chatSendBtn = $('#chatSendBtn');
    const chatEmpty = $('#chatEmpty');

    async function loadChatMessages() {
        // Load existing messages via a simple trick: listen for socket events
        // Since we're public, we'll get messages via socket only
    }

    function addChatMessage(msg) {
        if (chatEmpty) chatEmpty.style.display = 'none';

        const div = document.createElement('div');
        div.className = `chat-msg ${msg.isAdmin ? 'is-admin' : ''}`;
        div.innerHTML = `
      <div class="chat-meta">
        <span class="chat-name">${escapeHtml(msg.displayName)}</span>
        <span class="chat-time">${formatTime(msg.sentAt)}</span>
      </div>
      <div class="chat-text">${escapeHtml(msg.message)}</div>
    `;
        chatMessages.appendChild(div);
        chatMessages.scrollTop = chatMessages.scrollHeight;
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

    // ─── Socket events ───────────────────────────────────────────────
    socket.on('connect', () => {
        loadStatus();
        loadBackground();
        if (state.registered && state.gameId) {
            socket.emit('join:registered', { gameId: state.gameId, displayName: state.displayName });
        }
    });

    socket.on('disconnect', () => {
        statusDot.className = 'status-dot offline';
        statusText.textContent = '連線中斷';
    });

    socket.on('session:updated', (data) => {
        loadStatus();
    });

    socket.on('registration:new', (data) => {
        loadStatus();
    });

    socket.on('registrations:updated', () => {
        if (state.registered) checkMyStatus();
    });

    socket.on('results:published', (data) => {
        state.resultsPublished = true;
        loadResults();
        showToast('🎉 錄取結果已公布！');
    });

    socket.on('background:updated', (data) => {
        if (data.url) {
            document.body.style.backgroundImage = `url(${data.url})`;
            document.body.classList.add('has-bg-image');
        } else {
            document.body.style.backgroundImage = '';
            document.body.classList.remove('has-bg-image');
        }
    });

    socket.on('chat:message', (msg) => {
        addChatMessage(msg);
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
            const d = new Date(isoStr);
            if (isNaN(d.getTime())) {
                // Try parsing as local time string from SQLite
                return isoStr.split(' ').pop() || isoStr;
            }
            return d.toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        } catch (e) {
            return isoStr;
        }
    }

    // ─── Init ─────────────────────────────────────────────────────────
    restoreState();
    loadStatus();
    loadBackground();
})();
