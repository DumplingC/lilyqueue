/* ═══════════════════════════════════════════════════════════════════
   Admin Panel — Client-side JavaScript
   ═══════════════════════════════════════════════════════════════════ */

(function () {
    'use strict';

    // ─── State ────────────────────────────────────────────────────────
    let adminToken = localStorage.getItem('admin_token') || null;
    let currentSession = null;
    let registrations = [];
    let soundEnabled = localStorage.getItem('sound_enabled') !== 'false';
    let socket = null;

    // ─── DOM helpers ──────────────────────────────────────────────────
    const $ = (sel) => document.querySelector(sel);
    const $$ = (sel) => document.querySelectorAll(sel);

    // ─── API helper ───────────────────────────────────────────────────
    async function api(url, options = {}) {
        const headers = { ...options.headers };
        if (adminToken) headers['X-Admin-Token'] = adminToken;
        if (options.body && typeof options.body === 'object' && !(options.body instanceof FormData)) {
            headers['Content-Type'] = 'application/json';
            options.body = JSON.stringify(options.body);
        }
        const res = await fetch('/api' + url, { ...options, headers });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Request failed');
        return data;
    }

    // ─── Toast ────────────────────────────────────────────────────────
    function showToast(message, type = 'success') {
        const existing = document.querySelector('.toast');
        if (existing) existing.remove();
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.innerHTML = `
      <div class="toast-content">
        <span class="toast-icon">${type === 'success' ? '✅' : '❌'}</span>
        <span class="toast-message">${escapeHtml(message)}</span>
      </div>
    `;
        document.body.appendChild(toast);
        setTimeout(() => {
            toast.classList.add('hiding');
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }

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
            if (isNaN(d.getTime())) return isoStr.split(' ').pop() || isoStr;
            return d.toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        } catch (e) {
            return isoStr;
        }
    }

    // ─── Notification sound ───────────────────────────────────────────
    function playNotifSound() {
        if (!soundEnabled) return;
        try {
            const ctx = new (window.AudioContext || window.webkitAudioContext)();
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.frequency.value = 800;
            osc.type = 'sine';
            gain.gain.setValueAtTime(0.3, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
            osc.start(ctx.currentTime);
            osc.stop(ctx.currentTime + 0.3);
        } catch (e) { /* ignore */ }
    }

    // ─── Tab system ───────────────────────────────────────────────────
    $$('.tab').forEach(tab => {
        tab.addEventListener('click', () => {
            $$('.tab').forEach(t => t.classList.remove('active'));
            $$('.tab-content').forEach(c => c.classList.remove('active'));
            tab.classList.add('active');
            $(`#tab-${tab.dataset.tab}`).classList.add('active');
        });
    });

    // ═══════════════════════════════════════════════════════════════════
    // LOGIN
    // ═══════════════════════════════════════════════════════════════════
    async function checkAuth() {
        try {
            const data = await fetch('/api/auth/status').then(r => r.json());
            if (data.passwordSet) {
                $('#loginHint').textContent = '請輸入管理員密碼';
            } else {
                $('#loginHint').textContent = '首次使用，請設定管理員密碼';
            }
        } catch (e) {
            $('#loginHint').textContent = '無法連線到伺服器';
        }

        // Try auto-login with saved token
        if (adminToken) {
            try {
                await api('/admin/registrations');
                showDashboard();
                return;
            } catch (e) {
                adminToken = null;
                localStorage.removeItem('admin_token');
            }
        }
    }

    $('#loginForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const password = $('#loginPassword').value;
        try {
            const data = await fetch('/api/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password })
            }).then(r => r.json());

            if (data.token) {
                adminToken = data.token;
                localStorage.setItem('admin_token', adminToken);
                showToast('登入成功');
                showDashboard();
            } else {
                showToast(data.error || '登入失敗', 'error');
            }
        } catch (err) {
            showToast('登入失敗', 'error');
        }
    });

    function showDashboard() {
        $('#loginScreen').style.display = 'none';
        $('#adminDashboard').style.display = '';
        initSocket();
        loadSessionData();
        loadBackground();
        loadLateRecords();
        setupShareUrl();
    }

    // ═══════════════════════════════════════════════════════════════════
    // SOCKET
    // ═══════════════════════════════════════════════════════════════════
    function initSocket() {
        socket = io({ transports: ['websocket', 'polling'] });

        socket.on('connect', () => {
            socket.emit('join:admin', { token: adminToken });
        });

        socket.on('clients:count', (count) => {
            $('#clientCount').textContent = count;
        });

        socket.on('registration:new', (data) => {
            playNotifSound();
            loadSessionData();
            showToast(`新報名：${data.displayName || data.gameId}`);
        });

        socket.on('registrations:updated', (data) => {
            if (data && data.registrations) {
                registrations = data.registrations;
                renderRegistrations();
                updateStats();
            }
        });

        socket.on('session:updated', () => {
            loadSessionData();
        });

        socket.on('chat:message', (msg) => {
            addAdminChatMessage(msg);
        });

        socket.on('background:updated', (data) => {
            if (data.url) {
                document.body.style.backgroundImage = `url(${data.url})`;
                document.body.classList.add('has-bg-image');
                showBgPreview(data.url);
            } else {
                document.body.style.backgroundImage = '';
                document.body.classList.remove('has-bg-image');
                hideBgPreview();
            }
        });
    }

    // ═══════════════════════════════════════════════════════════════════
    // SESSION MANAGEMENT
    // ═══════════════════════════════════════════════════════════════════
    async function loadSessionData() {
        try {
            const data = await api('/admin/registrations');
            currentSession = data.session;
            registrations = data.registrations || [];

            if (currentSession) {
                $('#noSessionView').style.display = 'none';
                $('#activeSessionView').style.display = '';
                $('#sessionStatusBadge').textContent = '報名中';
                $('#sessionStatusBadge').className = 'badge badge-open';

                $('#editMainSlots').value = currentSession.main_slots;
                $('#editWaitlistSlots').value = currentSession.waitlist_slots;
                $('#editLatePolicy').value = currentSession.late_policy;

                const total = currentSession.main_slots + currentSession.waitlist_slots;
                const count = registrations.length;
                $('#adminSlotCounter').innerHTML = `已報名 <strong>${count}</strong> / 正選 ${currentSession.main_slots} ＋備取 ${currentSession.waitlist_slots}`;
                const pct = total > 0 ? Math.min(100, (count / total) * 100) : 0;
                $('#adminProgressFill').style.width = pct + '%';
            } else {
                $('#noSessionView').style.display = '';
                $('#activeSessionView').style.display = 'none';
                $('#sessionStatusBadge').textContent = '閒置';
                $('#sessionStatusBadge').className = 'badge badge-closed';
            }

            renderRegistrations();
            updateStats();
        } catch (e) {
            showToast('載入資料失敗: ' + e.message, 'error');
        }
    }

    // Create session
    $('#createSessionBtn').addEventListener('click', async () => {
        try {
            await api('/admin/session', {
                method: 'POST',
                body: {
                    title: $('#newTitle').value,
                    mainSlots: parseInt($('#newMainSlots').value) || 4,
                    waitlistSlots: parseInt($('#newWaitlistSlots').value) || 2,
                    latePolicy: $('#newLatePolicy').value
                }
            });
            showToast('場次已建立，開始接受報名！');
            loadSessionData();
        } catch (e) {
            showToast(e.message, 'error');
        }
    });

    // Close session
    $('#closeSessionBtn').addEventListener('click', async () => {
        if (!confirm('確定要關閉報名嗎？')) return;
        try {
            await api('/admin/session/close', { method: 'POST' });
            showToast('場次已關閉');
            loadSessionData();
        } catch (e) {
            showToast(e.message, 'error');
        }
    });

    // Update session settings
    $('#updateSessionBtn').addEventListener('click', async () => {
        try {
            await api('/admin/session', {
                method: 'PUT',
                body: {
                    mainSlots: parseInt($('#editMainSlots').value),
                    waitlistSlots: parseInt($('#editWaitlistSlots').value),
                    latePolicy: $('#editLatePolicy').value
                }
            });
            showToast('設定已更新');
            loadSessionData();
        } catch (e) {
            showToast(e.message, 'error');
        }
    });

    // Auto select
    $('#autoSelectBtn').addEventListener('click', async () => {
        try {
            const data = await api('/admin/auto-select', { method: 'POST' });
            registrations = data.registrations;
            renderRegistrations();
            updateStats();
            showToast('已按報名時間自動錄取');
        } catch (e) {
            showToast(e.message, 'error');
        }
    });

    // Publish results
    $('#publishBtn').addEventListener('click', async () => {
        if (!confirm('確定要公布結果嗎？公布後所有人都會看到。')) return;
        try {
            await api('/admin/publish', { method: 'POST' });
            showToast('結果已公布！');
        } catch (e) {
            showToast(e.message, 'error');
        }
    });

    // ═══════════════════════════════════════════════════════════════════
    // REGISTRATIONS TABLE
    // ═══════════════════════════════════════════════════════════════════
    function renderRegistrations() {
        const container = $('#registrationsList');
        const badge = $('#regCountBadge');
        badge.textContent = `${registrations.length} 人`;

        if (registrations.length === 0) {
            container.innerHTML = '<div class="empty-state"><div class="empty-icon">📭</div><p>還沒有人報名</p></div>';
            return;
        }

        let html = `
      <table class="reg-table">
        <thead>
          <tr>
            <th>#</th>
            <th>遊戲 ID</th>
            <th>顯示名稱</th>
            <th>報名時間</th>
            <th>狀態</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
    `;

        registrations.forEach((reg, idx) => {
            const lateTag = reg.is_late_flagged ? `<span class="badge-late">⚠ 遲到 ×${reg.late_count || 1}</span>` : '';
            html += `
        <tr data-id="${reg.id}">
          <td class="rank">${idx + 1}</td>
          <td class="game-id">${escapeHtml(reg.game_id)} ${lateTag}</td>
          <td>${escapeHtml(reg.display_name)}</td>
          <td class="timestamp">${formatTime(reg.registered_at)}</td>
          <td>
            <select class="status-select" data-reg-id="${reg.id}" onchange="window._changeStatus(${reg.id}, this.value)">
              <option value="pending" ${reg.status === 'pending' ? 'selected' : ''}>⏳ 等待</option>
              <option value="selected" ${reg.status === 'selected' ? 'selected' : ''}>✅ 正選</option>
              <option value="waitlist" ${reg.status === 'waitlist' ? 'selected' : ''}>📋 備取</option>
              <option value="rejected" ${reg.status === 'rejected' ? 'selected' : ''}>❌ 未錄取</option>
            </select>
          </td>
          <td>
            <button class="btn btn-xs btn-outline" onclick="window._markLate('${escapeHtml(reg.game_id)}', '${escapeHtml(reg.display_name)}')" title="標記遲到">
              ⚠️
            </button>
          </td>
        </tr>
      `;
        });

        html += '</tbody></table>';
        container.innerHTML = html;
    }

    // Global functions for inline handlers
    window._changeStatus = async function (regId, status) {
        try {
            await api('/admin/select', {
                method: 'POST',
                body: { registrationId: regId, status }
            });
            // The socket event will refresh the list
        } catch (e) {
            showToast(e.message, 'error');
            loadSessionData(); // Refresh on error
        }
    };

    window._markLate = async function (gameId, displayName) {
        if (!confirm(`確定要標記 ${displayName || gameId} 為遲到嗎？`)) return;
        try {
            await api(`/admin/late/${encodeURIComponent(gameId)}`, {
                method: 'POST',
                body: { displayName }
            });
            showToast(`已標記 ${gameId} 為遲到`);
            loadSessionData();
            loadLateRecords();
        } catch (e) {
            showToast(e.message, 'error');
        }
    };

    // ─── Stats ────────────────────────────────────────────────────────
    function updateStats() {
        const total = registrations.length;
        const selected = registrations.filter(r => r.status === 'selected').length;
        const waitlist = registrations.filter(r => r.status === 'waitlist').length;
        const late = registrations.filter(r => r.is_late_flagged).length;

        $('#statTotal').textContent = total;
        $('#statSelected').textContent = selected;
        $('#statWaitlist').textContent = waitlist;
        $('#statLate').textContent = late;
    }

    // ─── Copy roster ──────────────────────────────────────────────────
    $('#copyRosterBtn').addEventListener('click', () => {
        const selected = registrations.filter(r => r.status === 'selected');
        if (selected.length === 0) {
            showToast('沒有已錄取的人', 'error');
            return;
        }
        const text = selected.map((r, i) => `${i + 1}. ${r.display_name || r.game_id} (${r.game_id})`).join('\n');
        copyToClipboard('📋 正選名單\n' + text);
    });

    $('#copyAllBtn').addEventListener('click', () => {
        if (registrations.length === 0) {
            showToast('沒有報名資料', 'error');
            return;
        }
        let text = '';
        const selected = registrations.filter(r => r.status === 'selected');
        const waitlist = registrations.filter(r => r.status === 'waitlist');
        const rejected = registrations.filter(r => r.status === 'rejected');
        const pending = registrations.filter(r => r.status === 'pending');

        if (selected.length) text += '📋 正選名單\n' + selected.map((r, i) => `${i + 1}. ${r.display_name || r.game_id} (${r.game_id})`).join('\n') + '\n\n';
        if (waitlist.length) text += '📋 備取名單\n' + waitlist.map((r, i) => `${i + 1}. ${r.display_name || r.game_id} (${r.game_id})`).join('\n') + '\n\n';
        if (rejected.length) text += '❌ 未錄取\n' + rejected.map((r, i) => `${i + 1}. ${r.display_name || r.game_id} (${r.game_id})`).join('\n') + '\n\n';
        if (pending.length) text += '⏳ 等待中\n' + pending.map((r, i) => `${i + 1}. ${r.display_name || r.game_id} (${r.game_id})`).join('\n');

        copyToClipboard(text.trim());
    });

    function copyToClipboard(text) {
        navigator.clipboard.writeText(text).then(() => {
            showToast('已複製到剪貼簿');
        }).catch(() => {
            // Fallback
            const ta = document.createElement('textarea');
            ta.value = text;
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            document.body.removeChild(ta);
            showToast('已複製到剪貼簿');
        });
    }

    // ═══════════════════════════════════════════════════════════════════
    // CHAT
    // ═══════════════════════════════════════════════════════════════════
    const adminChatMessages = $('#adminChatMessages');
    const adminChatInput = $('#adminChatInput');

    function addAdminChatMessage(msg) {
        const empty = $('#adminChatEmpty');
        if (empty) empty.style.display = 'none';

        const div = document.createElement('div');
        div.className = `chat-msg ${msg.isAdmin ? 'is-admin' : ''}`;
        div.innerHTML = `
      <div class="chat-meta">
        <span class="chat-name">${escapeHtml(msg.displayName)}</span>
        <span class="chat-time">${formatTime(msg.sentAt)}</span>
      </div>
      <div class="chat-text">${escapeHtml(msg.message)}</div>
    `;
        adminChatMessages.appendChild(div);
        adminChatMessages.scrollTop = adminChatMessages.scrollHeight;
    }

    function sendAdminChat() {
        const msg = adminChatInput.value.trim();
        if (!msg || !socket) return;
        socket.emit('chat:message', { message: msg });
        adminChatInput.value = '';
    }

    $('#adminChatSendBtn').addEventListener('click', sendAdminChat);
    adminChatInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') sendAdminChat();
    });

    // Load existing chat messages
    async function loadChatMessages() {
        try {
            const data = await api('/admin/chat');
            if (data.messages && data.messages.length > 0) {
                const empty = $('#adminChatEmpty');
                if (empty) empty.style.display = 'none';
                data.messages.forEach(msg => {
                    addAdminChatMessage({
                        ...msg,
                        isAdmin: !!msg.is_admin,
                        displayName: msg.display_name,
                        sentAt: msg.sent_at
                    });
                });
            }
        } catch (e) { /* ignore */ }
    }

    // ═══════════════════════════════════════════════════════════════════
    // BACKGROUND IMAGE
    // ═══════════════════════════════════════════════════════════════════
    const bgUploadArea = $('#bgUploadArea');
    const bgFileInput = $('#bgFileInput');

    bgUploadArea.addEventListener('click', () => bgFileInput.click());
    bgUploadArea.addEventListener('dragover', (e) => {
        e.preventDefault();
        bgUploadArea.style.borderColor = 'var(--accent-primary)';
        bgUploadArea.style.background = 'var(--bg-glass)';
    });
    bgUploadArea.addEventListener('dragleave', () => {
        bgUploadArea.style.borderColor = '';
        bgUploadArea.style.background = '';
    });
    bgUploadArea.addEventListener('drop', (e) => {
        e.preventDefault();
        bgUploadArea.style.borderColor = '';
        bgUploadArea.style.background = '';
        if (e.dataTransfer.files.length) {
            uploadBackground(e.dataTransfer.files[0]);
        }
    });

    bgFileInput.addEventListener('change', () => {
        if (bgFileInput.files.length) {
            uploadBackground(bgFileInput.files[0]);
        }
    });

    async function uploadBackground(file) {
        const formData = new FormData();
        formData.append('background', file);
        try {
            const res = await fetch('/api/admin/upload-bg', {
                method: 'POST',
                headers: { 'X-Admin-Token': adminToken },
                body: formData
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error);
            showToast('背景圖片已上傳');
            showBgPreview(data.url);
        } catch (e) {
            showToast(e.message, 'error');
        }
    }

    function showBgPreview(url) {
        $('#currentBgPreview').style.display = '';
        $('#bgPreviewImg').src = url;
    }

    function hideBgPreview() {
        $('#currentBgPreview').style.display = 'none';
    }

    $('#removeBgBtn').addEventListener('click', async () => {
        try {
            await api('/admin/background', { method: 'DELETE' });
            showToast('背景圖片已移除');
            hideBgPreview();
        } catch (e) {
            showToast(e.message, 'error');
        }
    });

    async function loadBackground() {
        try {
            const data = await fetch('/api/background').then(r => r.json());
            if (data.url) {
                document.body.style.backgroundImage = `url(${data.url})`;
                document.body.classList.add('has-bg-image');
                showBgPreview(data.url);
            }
        } catch (e) { /* ignore */ }
    }

    // ═══════════════════════════════════════════════════════════════════
    // LATE RECORDS
    // ═══════════════════════════════════════════════════════════════════
    async function loadLateRecords() {
        try {
            const data = await api('/admin/late-records');
            const container = $('#lateRecordsList');

            if (!data.records || data.records.length === 0) {
                container.innerHTML = '<div class="empty-state"><p style="font-size: 0.85rem;">沒有遲到紀錄</p></div>';
                return;
            }

            let html = '';
            data.records.forEach(rec => {
                html += `
          <div class="late-item">
            <div class="late-info">
              <span style="font-weight: 600; font-size: 0.9rem;">${escapeHtml(rec.display_name || rec.game_id)}</span>
              <span class="late-count">遲到 ${rec.count} 次</span>
            </div>
            <button class="btn btn-xs btn-outline" onclick="window._removeLate('${escapeHtml(rec.game_id)}')" title="移除紀錄">
              🗑️
            </button>
          </div>
        `;
            });
            container.innerHTML = html;
        } catch (e) { /* ignore */ }
    }

    window._removeLate = async function (gameId) {
        if (!confirm(`確定要移除 ${gameId} 的遲到紀錄嗎？`)) return;
        try {
            await api(`/admin/late/${encodeURIComponent(gameId)}`, { method: 'DELETE' });
            showToast('已移除遲到紀錄');
            loadLateRecords();
        } catch (e) {
            showToast(e.message, 'error');
        }
    };

    // ═══════════════════════════════════════════════════════════════════
    // SETTINGS
    // ═══════════════════════════════════════════════════════════════════
    // Sound toggle
    const soundToggle = $('#soundToggle');
    soundToggle.textContent = soundEnabled ? '🔔' : '🔕';
    soundToggle.addEventListener('click', () => {
        soundEnabled = !soundEnabled;
        localStorage.setItem('sound_enabled', soundEnabled);
        soundToggle.textContent = soundEnabled ? '🔔' : '🔕';
    });

    // Change password
    $('#changePasswordBtn').addEventListener('click', async () => {
        const pw = $('#newPassword').value;
        if (!pw || pw.length < 4) {
            showToast('密碼至少需要 4 個字元', 'error');
            return;
        }
        try {
            await api('/admin/reset-password', {
                method: 'POST',
                body: { newPassword: pw }
            });
            showToast('密碼已更新');
            $('#newPassword').value = '';
        } catch (e) {
            showToast(e.message, 'error');
        }
    });

    // ─── Share URL ────────────────────────────────────────────────────
    async function setupShareUrl() {
        try {
            const data = await fetch('/api/server-info').then(r => r.json());
            $('#shareUrl').textContent = data.url;
        } catch (e) {
            // Fallback to current origin
            $('#shareUrl').textContent = window.location.origin;
        }
    }

    $('#copyUrlBtn').addEventListener('click', () => {
        const url = $('#shareUrl').textContent;
        copyToClipboard(url);
        showToast('已複製報名連結');
    });

    // ─── Init ─────────────────────────────────────────────────────────
    checkAuth();

})();
