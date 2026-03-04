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
        loadChatMessages();
        setupShareUrl();
    }

    // ═══════════════════════════════════════════════════════════════════
    // SOCKET
    // ═══════════════════════════════════════════════════════════════════
    function initSocket() {
        socket = io({ transports: ['websocket', 'polling'] });

        socket.on('connect', () => {
            const savedName = localStorage.getItem('admin_display_name');
            socket.emit('join:admin', { token: adminToken, displayName: savedName || '' });
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

        socket.on('chat:cleared', () => {
            adminChatMessages.innerHTML = '<div class="empty-state" id="adminChatEmpty"><p style="font-size: 0.8rem;">對話紀錄已清除</p></div>';
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
                    latePolicy: $('#newLatePolicy').value,
                    startTime: $('#newStartTime').value || null
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

    $('#deleteSessionBtn').addEventListener('click', async () => {
        if (!confirm('確定要刪除此場次？所有報名資料和聊天紀錄將被永久刪除！')) return;
        if (!confirm('再次確認：刪除後無法復原，是否繼續？')) return;
        try {
            await api('/admin/session', { method: 'DELETE' });
            showToast('場次已刪除');
            loadSessionData();
        } catch (e) {
            showToast(e.message, 'error');
        }
    });

    $('#resetStatusesBtn').addEventListener('click', async () => {
        if (!confirm('確定要重設所有報名狀態為「審核中」嗎？')) return;
        try {
            await api('/admin/reset-statuses', { method: 'POST' });
            showToast('已重設所有報名狀態');
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
            <div style="display:flex;gap:4px;align-items:center;">
              <select class="status-select" data-reg-id="${reg.id}" style="flex:1;">
                <option value="pending" ${reg.status === 'pending' ? 'selected' : ''}>⏳ 等待</option>
                <option value="selected" ${reg.status === 'selected' ? 'selected' : ''}>✅ 正選</option>
                <option value="waitlist" ${reg.status === 'waitlist' ? 'selected' : ''}>📋 備取</option>
                <option value="rejected" ${reg.status === 'rejected' ? 'selected' : ''}>❌ 未錄取</option>
              </select>
              <button class="btn btn-xs btn-success apply-status-btn" data-reg-id="${reg.id}" title="套用">✓</button>
            </div>
          </td>
          <td>
            <div style="display:flex;gap:3px;">
              <button class="btn btn-xs btn-outline mark-late-btn" data-game-id="${escapeHtml(reg.game_id)}" data-display-name="${escapeHtml(reg.display_name)}" title="標記遲到">⚠️</button>
              <button class="btn btn-xs btn-outline kick-btn" data-game-id="${escapeHtml(reg.game_id)}" title="踢除">🚪</button>
              <button class="btn btn-xs btn-outline ban-btn" data-game-id="${escapeHtml(reg.game_id)}" title="封禁" style="color:var(--accent-danger);">🚫</button>
              <button class="btn btn-xs btn-outline pm-btn" data-game-id="${escapeHtml(reg.game_id)}" title="私訊">💬</button>
            </div>
          </td>
        </tr>
      `;
        });

        html += '</tbody></table>';
        container.innerHTML = html;

        // Attach event listeners via delegation
        container.querySelectorAll('.apply-status-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                const regId = parseInt(btn.dataset.regId);
                const select = container.querySelector(`select[data-reg-id="${regId}"]`);
                if (!select) return;
                const status = select.value;
                const statusLabels = { pending: '⏳ 等待', selected: '✅ 正選', waitlist: '📋 備取', rejected: '❌ 未錄取' };
                btn.disabled = true;
                btn.textContent = '...';
                try {
                    await api('/admin/select', {
                        method: 'POST',
                        body: { registrationId: regId, status }
                    });
                    showToast(`已更新為 ${statusLabels[status] || status}`);
                    btn.textContent = '✓';
                    btn.disabled = false;
                } catch (e) {
                    showToast(e.message, 'error');
                    btn.textContent = '✓';
                    btn.disabled = false;
                    loadSessionData();
                }
            });
        });

        container.querySelectorAll('.mark-late-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                const gameId = btn.dataset.gameId;
                const displayName = btn.dataset.displayName;
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
            });
        });

        container.querySelectorAll('.kick-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                const gameId = btn.dataset.gameId;
                if (!confirm(`確定要踢除 ${gameId} 嗎？`)) return;
                try {
                    await api('/admin/kick', { method: 'POST', body: { gameId } });
                    showToast(`已踢除 ${gameId}`);
                } catch (e) {
                    showToast(e.message, 'error');
                }
            });
        });

        container.querySelectorAll('.ban-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                const gameId = btn.dataset.gameId;
                if (!confirm(`確定要封禁 ${gameId} 嗎？封禁後將無法再報名。`)) return;
                try {
                    await api('/admin/ban', { method: 'POST', body: { gameId } });
                    showToast(`已封禁 ${gameId}`);
                } catch (e) {
                    showToast(e.message, 'error');
                }
            });
        });

        container.querySelectorAll('.pm-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                const gameId = btn.dataset.gameId;
                const msg = prompt(`輸入要私訊給 ${gameId} 的訊息：`);
                if (!msg) return;
                try {
                    await api('/admin/private-message', { method: 'POST', body: { gameId, message: msg } });
                    showToast(`已發送私訊給 ${gameId}`);
                } catch (e) {
                    showToast(e.message, 'error');
                }
            });
        });
    }

    // ─── CSV Export ───────────────────────────────────────────────────
    $('#exportCsvBtn').addEventListener('click', () => {
        window.open(`/api/admin/export-csv?token=${adminToken}`, '_blank');
    });

    // ─── Session History ──────────────────────────────────────────────
    async function loadSessionHistory() {
        try {
            const data = await api('/admin/history');
            const container = $('#sessionHistoryList');

            if (!data.sessions || data.sessions.length === 0) {
                container.innerHTML = '<div class="empty-state"><p style="font-size:0.85rem;">尚無場次紀錄</p></div>';
                return;
            }

            const statusMap = { open: '🟢 進行中', closed: '🔴 已關閉' };
            let html = '';
            data.sessions.forEach(s => {
                html += `
                <div class="card" style="margin-bottom:8px; padding:12px;">
                    <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:6px;">
                        <div>
                            <strong>${escapeHtml(s.title || '未命名場次')}</strong>
                            <span style="font-size:0.75rem; color:var(--text-muted); margin-left:8px;">#${s.id}</span>
                        </div>
                        <div style="display:flex; gap:6px; align-items:center;">
                            <span style="font-size:0.75rem;">${statusMap[s.status] || s.status}</span>
                            <span style="font-size:0.75rem; color:var(--text-muted);">${s.regCount} 人</span>
                            <button class="btn btn-xs btn-outline expand-history-btn" data-session-id="${s.id}">📋 詳情</button>
                        </div>
                    </div>
                    <div style="font-size:0.72rem; color:var(--text-muted); margin-top:4px;">
                        建立：${s.created_at || '-'} ${s.closed_at ? `| 關閉：${s.closed_at}` : ''}
                        | 正選 ${s.main_slots} / 備取 ${s.waitlist_slots}
                    </div>
                    <div class="history-detail" id="historyDetail-${s.id}" style="display:none; margin-top:8px;"></div>
                </div>`;
            });
            container.innerHTML = html;

            // Expand buttons
            container.querySelectorAll('.expand-history-btn').forEach(btn => {
                btn.addEventListener('click', async () => {
                    const sid = parseInt(btn.dataset.sessionId);
                    const detail = $(`#historyDetail-${sid}`);
                    if (detail.style.display !== 'none') {
                        detail.style.display = 'none';
                        return;
                    }
                    try {
                        const data = await api(`/admin/history/${sid}/registrations`);
                        if (!data.registrations || data.registrations.length === 0) {
                            detail.innerHTML = '<p style="font-size:0.8rem;color:var(--text-muted);">無報名紀錄</p>';
                        } else {
                            const statusLabels = { pending: '⏳', selected: '✅', waitlist: '📋', rejected: '❌' };
                            let tbl = '<table class="reg-table" style="font-size:0.78rem;"><thead><tr><th>#</th><th>ID</th><th>名稱</th><th>狀態</th></tr></thead><tbody>';
                            data.registrations.forEach((r, i) => {
                                tbl += `<tr><td>${i + 1}</td><td>${escapeHtml(r.game_id)}</td><td>${escapeHtml(r.display_name)}</td><td>${statusLabels[r.status] || r.status}</td></tr>`;
                            });
                            tbl += '</tbody></table>';
                            detail.innerHTML = tbl;
                        }
                        detail.style.display = '';
                    } catch (e) {
                        detail.innerHTML = '<p style="color:var(--accent-danger);">載入失敗</p>';
                        detail.style.display = '';
                    }
                });
            });
        } catch (e) { /* ignore */ }
    }

    // Load history when switching to history tab
    document.querySelectorAll('.tab').forEach(tab => {
        tab.addEventListener('click', () => {
            if (tab.dataset.tab === 'history') loadSessionHistory();
        });
    });

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

    // Admin display name
    const adminNameInput = $('#adminDisplayName');
    if (adminNameInput) {
        const savedName = localStorage.getItem('admin_display_name');
        if (savedName) adminNameInput.value = savedName;

        function updateAdminName() {
            const name = adminNameInput.value.trim();
            localStorage.setItem('admin_display_name', name);
            if (socket) socket.emit('admin:set-name', { name: name || '🎮 主辦人' });
        }
        adminNameInput.addEventListener('blur', updateAdminName);
        adminNameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') updateAdminName(); });
    }

    // Admin emoji picker
    const EMOJIS = ['😀', '😂', '😍', '🤣', '😎', '🤔', '😢', '😡', '👍', '👎', '👋', '🙏', '🎉', '🔥', '❤️', '🎮', '🏆', '⭐', '💪', '🤩', '🙃', '🥱', '😴', '🌟', '👀', '💬', '✅', '❌', '⚠️', '💡'];
    const adminEmojiBtn = $('#adminEmojiBtn');
    const adminEmojiPicker = $('#adminEmojiPicker');

    if (adminEmojiBtn && adminEmojiPicker) {
        adminEmojiPicker.innerHTML = EMOJIS.map(e => `<span class="emoji-item">${e}</span>`).join('');

        adminEmojiBtn.addEventListener('click', () => {
            adminEmojiPicker.classList.toggle('open');
        });

        adminEmojiPicker.addEventListener('click', (e) => {
            if (e.target.classList.contains('emoji-item')) {
                adminChatInput.value += e.target.textContent;
                adminChatInput.focus();
                adminEmojiPicker.classList.remove('open');
            }
        });

        document.addEventListener('click', (e) => {
            if (!adminEmojiBtn.contains(e.target) && !adminEmojiPicker.contains(e.target)) {
                adminEmojiPicker.classList.remove('open');
            }
        });
    }

    function addAdminChatMessage(msg) {
        const empty = $('#adminChatEmpty');
        if (empty) empty.style.display = 'none';

        const div = document.createElement('div');
        const isSystem = msg.isSystem || msg.gameId === 'SYSTEM';
        div.className = `chat-msg ${msg.isAdmin ? 'is-admin' : ''} ${isSystem ? 'is-system' : ''}`;

        if (isSystem) {
            div.innerHTML = `<div class="chat-system-text">${escapeHtml(msg.message)}</div>`;
        } else {
            const regLabels = { selected: '正選', waitlist: '備取', pending: '審核中', rejected: '未錄取' };
            const statusTag = msg.regStatus && !msg.isAdmin
                ? ` <span class="online-reg-tag ${msg.regStatus === 'selected' ? 'reg-selected' : msg.regStatus === 'rejected' ? 'reg-rejected' : ''}">${regLabels[msg.regStatus] || '審核中'}</span>`
                : '';
            div.innerHTML = `
          <div class="chat-meta">
            <span class="chat-name">${escapeHtml(msg.displayName)}${statusTag}</span>
            <span class="chat-time">${formatTime(msg.sentAt)}</span>
          </div>
          <div class="chat-text">${escapeHtml(msg.message)}</div>
        `;
        }
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

    // Clear chat
    $('#clearChatBtn').addEventListener('click', async () => {
        if (!confirm('確定要清除所有對話紀錄嗎？')) return;
        try {
            await api('/admin/chat', { method: 'DELETE' });
            showToast('對話紀錄已清除');
        } catch (e) {
            showToast(e.message, 'error');
        }
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

    // ─── Client-side image compression to WebP ─────────────────────────
    function compressToWebP(file, maxWidth = 1920, quality = 0.8) {
        return new Promise((resolve) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                let w = img.width, h = img.height;
                if (w > maxWidth) { h = Math.round(h * maxWidth / w); w = maxWidth; }
                canvas.width = w;
                canvas.height = h;
                canvas.getContext('2d').drawImage(img, 0, 0, w, h);
                canvas.toBlob((blob) => resolve(blob), 'image/webp', quality);
            };
            img.src = URL.createObjectURL(file);
        });
    }

    async function uploadBackground(file) {
        try {
            showToast('正在壓縮圖片...');
            const webpBlob = await compressToWebP(file);
            const formData = new FormData();
            formData.append('background', webpBlob, 'bg.webp');
            const res = await fetch('/api/admin/upload-bg', {
                method: 'POST',
                headers: { 'X-Admin-Token': adminToken },
                body: formData
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error);
            showToast('背景圖片已上傳（WebP 壓縮）');
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

    // ─── Canvas-based Crop (no external deps) ─────────────────────────
    const cropCanvas = $('#cropCanvas');
    const cropCtx = cropCanvas ? cropCanvas.getContext('2d') : null;
    let cropSourceImg = null;
    let cropSelection = null; // {x, y, w, h} in image coords
    let cropDragging = false;
    let cropStart = null;

    function drawCropCanvas() {
        if (!cropCtx || !cropSourceImg) return;
        const cw = cropCanvas.width, ch = cropCanvas.height;
        cropCtx.clearRect(0, 0, cw, ch);
        cropCtx.drawImage(cropSourceImg, 0, 0, cw, ch);

        if (cropSelection && cropSelection.w > 0 && cropSelection.h > 0) {
            // Darken outside selection
            cropCtx.fillStyle = 'rgba(0,0,0,0.5)';
            cropCtx.fillRect(0, 0, cw, cropSelection.y); // top
            cropCtx.fillRect(0, cropSelection.y + cropSelection.h, cw, ch - cropSelection.y - cropSelection.h); // bottom
            cropCtx.fillRect(0, cropSelection.y, cropSelection.x, cropSelection.h); // left
            cropCtx.fillRect(cropSelection.x + cropSelection.w, cropSelection.y, cw - cropSelection.x - cropSelection.w, cropSelection.h); // right

            // Selection border
            cropCtx.strokeStyle = '#fff';
            cropCtx.lineWidth = 2;
            cropCtx.setLineDash([6, 3]);
            cropCtx.strokeRect(cropSelection.x, cropSelection.y, cropSelection.w, cropSelection.h);
            cropCtx.setLineDash([]);

            // Grid lines (thirds)
            cropCtx.strokeStyle = 'rgba(255,255,255,0.3)';
            cropCtx.lineWidth = 1;
            for (let i = 1; i <= 2; i++) {
                cropCtx.beginPath();
                cropCtx.moveTo(cropSelection.x + cropSelection.w * i / 3, cropSelection.y);
                cropCtx.lineTo(cropSelection.x + cropSelection.w * i / 3, cropSelection.y + cropSelection.h);
                cropCtx.stroke();
                cropCtx.beginPath();
                cropCtx.moveTo(cropSelection.x, cropSelection.y + cropSelection.h * i / 3);
                cropCtx.lineTo(cropSelection.x + cropSelection.w, cropSelection.y + cropSelection.h * i / 3);
                cropCtx.stroke();
            }
        }
    }

    function getCanvasPos(e) {
        const rect = cropCanvas.getBoundingClientRect();
        const touch = e.touches ? e.touches[0] : e;
        return {
            x: (touch.clientX - rect.left) * (cropCanvas.width / rect.width),
            y: (touch.clientY - rect.top) * (cropCanvas.height / rect.height)
        };
    }

    if (cropCanvas) {
        cropCanvas.addEventListener('mousedown', (e) => {
            cropDragging = true;
            cropStart = getCanvasPos(e);
            cropSelection = { x: cropStart.x, y: cropStart.y, w: 0, h: 0 };
        });
        cropCanvas.addEventListener('mousemove', (e) => {
            if (!cropDragging || !cropStart) return;
            const pos = getCanvasPos(e);
            cropSelection = {
                x: Math.min(cropStart.x, pos.x),
                y: Math.min(cropStart.y, pos.y),
                w: Math.abs(pos.x - cropStart.x),
                h: Math.abs(pos.y - cropStart.y)
            };
            drawCropCanvas();
        });
        cropCanvas.addEventListener('mouseup', () => { cropDragging = false; });
        cropCanvas.addEventListener('mouseleave', () => { cropDragging = false; });

        // Touch support
        cropCanvas.addEventListener('touchstart', (e) => {
            e.preventDefault();
            cropDragging = true;
            cropStart = getCanvasPos(e);
            cropSelection = { x: cropStart.x, y: cropStart.y, w: 0, h: 0 };
        });
        cropCanvas.addEventListener('touchmove', (e) => {
            e.preventDefault();
            if (!cropDragging || !cropStart) return;
            const pos = getCanvasPos(e);
            cropSelection = {
                x: Math.min(cropStart.x, pos.x),
                y: Math.min(cropStart.y, pos.y),
                w: Math.abs(pos.x - cropStart.x),
                h: Math.abs(pos.y - cropStart.y)
            };
            drawCropCanvas();
        });
        cropCanvas.addEventListener('touchend', () => { cropDragging = false; });
    }

    $('#cropBgBtn').addEventListener('click', () => {
        const previewImg = $('#bgPreviewImg');
        if (!previewImg || !previewImg.src || previewImg.src === window.location.href) {
            showToast('請先上傳背景圖片', 'error');
            return;
        }
        const modal = $('#cropModal');
        modal.style.display = 'flex';
        cropSelection = null;

        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
            cropSourceImg = img;
            // Scale canvas to fit modal (max 760px wide) while keeping aspect ratio
            const maxW = 760;
            let w = img.width, h = img.height;
            if (w > maxW) { h = Math.round(h * maxW / w); w = maxW; }
            cropCanvas.width = w;
            cropCanvas.height = h;
            drawCropCanvas();
        };
        img.src = previewImg.src;
    });

    $('#cropCancelBtn').addEventListener('click', () => {
        $('#cropModal').style.display = 'none';
        cropSourceImg = null;
        cropSelection = null;
    });

    $('#cropResetBtn').addEventListener('click', () => {
        cropSelection = null;
        drawCropCanvas();
    });

    $('#cropApplyBtn').addEventListener('click', async () => {
        if (!cropSourceImg || !cropSelection || cropSelection.w < 10 || cropSelection.h < 10) {
            showToast('請先拖曳選取裁切區域', 'error');
            return;
        }
        try {
            // Scale selection back to original image coordinates
            const scaleX = cropSourceImg.width / cropCanvas.width;
            const scaleY = cropSourceImg.height / cropCanvas.height;
            const sx = cropSelection.x * scaleX;
            const sy = cropSelection.y * scaleY;
            const sw = cropSelection.w * scaleX;
            const sh = cropSelection.h * scaleY;

            const outCanvas = document.createElement('canvas');
            outCanvas.width = Math.min(sw, 1920);
            outCanvas.height = Math.round(Math.min(sw, 1920) * sh / sw);
            outCanvas.getContext('2d').drawImage(cropSourceImg, sx, sy, sw, sh, 0, 0, outCanvas.width, outCanvas.height);

            outCanvas.toBlob(async (blob) => {
                const formData = new FormData();
                formData.append('background', blob, 'cropped-bg.webp');
                try {
                    const res = await fetch('/api/admin/upload-bg', {
                        method: 'POST',
                        headers: { 'X-Admin-Token': adminToken },
                        body: formData
                    });
                    const data = await res.json();
                    if (!res.ok) throw new Error(data.error);
                    showToast('裁切後的圖片已套用');
                    showBgPreview(data.url);
                } catch (e) {
                    showToast(e.message, 'error');
                }
            }, 'image/webp', 0.85);
        } catch (e) {
            showToast('裁切失敗', 'error');
        }
        $('#cropModal').style.display = 'none';
        cropSourceImg = null;
        cropSelection = null;
    });

    // Save background settings (position/size)
    $('#saveBgSettingsBtn').addEventListener('click', async () => {
        const posX = $('#bgPosX').value;
        const posY = $('#bgPosY').value;
        const size = $('#bgSizeSelect').value;
        try {
            await api('/admin/background-settings', {
                method: 'PUT',
                body: { position: `${posX} ${posY}`, size }
            });
            showToast('背景設定已儲存');
        } catch (e) {
            showToast(e.message, 'error');
        }
    });

    async function loadBackground() {
        try {
            const data = await fetch('/api/background').then(r => r.json());
            if (data.url) {
                document.body.style.backgroundImage = `url(${data.url})`;
                document.body.style.backgroundPosition = data.position || 'center center';
                document.body.style.backgroundSize = data.size || 'cover';
                document.body.classList.add('has-bg-image');
                showBgPreview(data.url);
                // Set editor values
                if (data.position) {
                    const [posX, posY] = data.position.split(' ');
                    if ($('#bgPosX')) $('#bgPosX').value = posX || 'center';
                    if ($('#bgPosY')) $('#bgPosY').value = posY || 'center';
                }
                if (data.size && $('#bgSizeSelect')) {
                    $('#bgSizeSelect').value = data.size;
                }
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

    // ─── Announcement ─────────────────────────────────────────────────
    $('#announceBtn').addEventListener('click', async () => {
        const msg = $('#announceInput').value.trim();
        if (!msg) { showToast('請輸入公告內容', 'error'); return; }
        try {
            await api('/admin/announce', { method: 'POST', body: { message: msg } });
            showToast('公告已發送');
            $('#announceInput').value = '';
        } catch (e) {
            showToast(e.message, 'error');
        }
    });

    // Quick templates
    $$('.announce-tpl').forEach(btn => {
        btn.addEventListener('click', () => {
            $('#announceInput').value = btn.textContent.trim();
        });
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

    // ═══════════════════════════════════════════════════════════════════
    // THEME SETTINGS
    // ═══════════════════════════════════════════════════════════════════
    const defaultTheme = {
        accentColor: '#7c5cff',
        bgPrimary: '#0a0a1a',
        bgSecondary: '#12122a',
        fontSizeTitle: '1.5',
        fontSizeBody: '0.9',
        fontSizeChat: '0.85',
        fontSizeLabel: '0.75'
    };

    function applyTheme(theme) {
        const root = document.documentElement;
        if (theme.accentColor) {
            root.style.setProperty('--accent-primary', theme.accentColor);
            // Generate lighter/darker variants
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
    }

    function updateThemeUI(theme) {
        const t = { ...defaultTheme, ...theme };
        // Swatches
        document.querySelectorAll('.theme-swatch').forEach(s => {
            s.classList.toggle('active', s.dataset.color === t.accentColor);
        });
        $('#themeCustomColor').value = t.accentColor;
        $('#themeBgPrimary').value = t.bgPrimary;
        $('#themeBgSecondary').value = t.bgSecondary;
        $('#themeBgPrimaryVal').textContent = t.bgPrimary;
        $('#themeBgSecondaryVal').textContent = t.bgSecondary;
        // Sliders
        $('#fontSizeTitle').value = t.fontSizeTitle;
        $('#fontSizeBody').value = t.fontSizeBody;
        $('#fontSizeChat').value = t.fontSizeChat;
        $('#fontSizeLabel').value = t.fontSizeLabel;
        $('#fontTitleVal').textContent = t.fontSizeTitle + 'rem';
        $('#fontBodyVal').textContent = t.fontSizeBody + 'rem';
        $('#fontChatVal').textContent = t.fontSizeChat + 'rem';
        $('#fontLabelVal').textContent = t.fontSizeLabel + 'rem';
    }

    function getThemeFromUI() {
        return {
            accentColor: $('#themeCustomColor').value,
            bgPrimary: $('#themeBgPrimary').value,
            bgSecondary: $('#themeBgSecondary').value,
            fontSizeTitle: $('#fontSizeTitle').value,
            fontSizeBody: $('#fontSizeBody').value,
            fontSizeChat: $('#fontSizeChat').value,
            fontSizeLabel: $('#fontSizeLabel').value
        };
    }

    async function loadTheme() {
        try {
            const theme = await fetch('/api/theme').then(r => r.json());
            updateThemeUI(theme);
            applyTheme(theme);
        } catch (e) { /* use default */ }
    }

    // Swatch click
    document.querySelectorAll('.theme-swatch').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.theme-swatch').forEach(s => s.classList.remove('active'));
            btn.classList.add('active');
            $('#themeCustomColor').value = btn.dataset.color;
            applyTheme(getThemeFromUI()); // live preview
        });
    });

    // Custom color
    $('#themeCustomColor').addEventListener('input', (e) => {
        document.querySelectorAll('.theme-swatch').forEach(s => s.classList.remove('active'));
        applyTheme(getThemeFromUI());
    });

    // BG colors
    $('#themeBgPrimary').addEventListener('input', () => {
        $('#themeBgPrimaryVal').textContent = $('#themeBgPrimary').value;
        applyTheme(getThemeFromUI());
    });
    $('#themeBgSecondary').addEventListener('input', () => {
        $('#themeBgSecondaryVal').textContent = $('#themeBgSecondary').value;
        applyTheme(getThemeFromUI());
    });

    // Font size sliders
    ['Title', 'Body', 'Chat', 'Label'].forEach(name => {
        const slider = $(`#fontSize${name}`);
        const label = $(`#font${name}Val`);
        slider.addEventListener('input', () => {
            label.textContent = slider.value + 'rem';
            applyTheme(getThemeFromUI());
        });
    });

    // Save
    $('#saveThemeBtn').addEventListener('click', async () => {
        try {
            await api('/admin/theme', { method: 'PUT', body: getThemeFromUI() });
            showToast('主題設定已儲存');
        } catch (e) {
            showToast(e.message, 'error');
        }
    });

    // Reset
    $('#resetThemeBtn').addEventListener('click', async () => {
        if (!confirm('確定要重設為預設主題？')) return;
        try {
            await api('/admin/theme', { method: 'PUT', body: defaultTheme });
            updateThemeUI(defaultTheme);
            applyTheme(defaultTheme);
            showToast('已重設為預設主題');
        } catch (e) {
            showToast(e.message, 'error');
        }
    });

    // ─── Init ─────────────────────────────────────────────────────────
    checkAuth();
    loadTheme();

})();
