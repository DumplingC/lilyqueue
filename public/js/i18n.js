// ─── i18n Translation System ──────────────────────────────────────
const i18n = {
    'zh-TW': {
        // Header
        systemName: '🎮 莉刻報名系統',
        loading: '載入中...',
        // Status
        statusOpen: '報名中',
        statusClosed: '報名已結束',
        statusFull: '已額滿',
        connecting: '連線中...',
        // Registration
        registerTitle: '報名',
        gameIdLabel: '遊戲 ID',
        gameIdPlaceholder: '輸入你的遊戲 ID',
        displayNameLabel: '顯示名稱（選填）',
        displayNamePlaceholder: '在聊天室中顯示的名稱',
        registerBtn: '🚀 確認報名',
        registering: '報名中...',
        registerSuccess: '報名資料已送出，等待管理員審核',
        registerFail: '報名失敗',
        networkError: '網路錯誤，請稍後再試',
        enterGameId: '請輸入遊戲 ID',
        // Status display
        yourGameId: '遊戲 ID：',
        yourPosition: '你的順位',
        statusPending: '⏳ 審核中',
        statusSelected: '✅ 正選',
        statusWaitlist: '📋 備取',
        statusRejected: '❌ 未錄取',
        lateWarning: '⚠️ 你有遲到紀錄，可能影響錄取優先順序',
        // Slots
        slotsLabel: '名額',
        mainSlots: '正選',
        waitlistSlots: '備取',
        registered: '已報名',
        // Chat
        chatTab: '💬 聊天',
        onlineTab: '👥 在線',
        chatPlaceholder: '輸入訊息...',
        sendBtn: '發送',
        noChatMessages: '還沒有訊息，來打個招呼吧！',
        chatCleared: '對話紀錄已被管理員清除',
        // Notifications
        adminAnnouncement: '📢 公告',
        adminPrivateMsg: '💌 管理員私訊',
        privateOnly: '僅你可見',
        attentionAlert: '🔔 管理員提醒：準備開始！',
        attentionNotif: '管理員提醒大家準備開始！',
        // Results
        resultsTitle: '📊 錄取結果',
        selectedPlayers: '✅ 正選',
        waitlistPlayers: '📋 備取',
        rejectedPlayers: '❌ 未錄取',
        noResults: '尚無結果',
        // Connection
        reconnecting: '重新連線中...',
        kicked: '⚠️ 您已被管理員移出聊天室',
        banned: '🚫 你已被管理員封禁',
        // Mute
        muted: '🔇 已靜音',
        unmuted: '🔊 已開啟聲音',
        // Countdown
        countdownLabel: '⏱️ 倒數計時',
        // Closed
        closedTitle: '⏸️ 目前沒有開放報名',
        closedMsg: '請等待管理員開啟新場次',
        // Capacity
        almostFull: '⚠️ 名額即將額滿！剩餘 {n} 個名額',
        full: '🈵 名額已滿！',
        // Online status
        statusOnline: '🟢 在線',
        statusAway: '🟡 暫離',
        statusBusy: '🔴 稍等一下',
        // Typing
        typing: '{name} 正在輸入...',
        // Form validation
        gameIdHint: '英數字 2-50 字元',
        // Celebration
        selectedCelebration: '🎉 恭喜！你已被正選錄取！'
    },
    'en': {
        systemName: '🎮 Lily Queue',
        loading: 'Loading...',
        statusOpen: 'Open',
        statusClosed: 'Closed',
        statusFull: 'Full',
        connecting: 'Connecting...',
        registerTitle: 'Register',
        gameIdLabel: 'Game ID',
        gameIdPlaceholder: 'Enter your Game ID',
        displayNameLabel: 'Display Name (optional)',
        displayNamePlaceholder: 'Name shown in chat',
        registerBtn: '🚀 Register',
        registering: 'Registering...',
        registerSuccess: 'Registration submitted. Awaiting admin review.',
        registerFail: 'Registration failed',
        networkError: 'Network error. Please try again later.',
        enterGameId: 'Please enter your Game ID',
        yourGameId: 'Game ID: ',
        yourPosition: 'Your Position',
        statusPending: '⏳ Pending',
        statusSelected: '✅ Selected',
        statusWaitlist: '📋 Waitlisted',
        statusRejected: '❌ Not Selected',
        lateWarning: '⚠️ You have a late record, which may affect your priority',
        slotsLabel: 'Slots',
        mainSlots: 'Main',
        waitlistSlots: 'Waitlist',
        registered: 'Registered',
        chatTab: '💬 Chat',
        onlineTab: '👥 Online',
        chatPlaceholder: 'Type a message...',
        sendBtn: 'Send',
        noChatMessages: 'No messages yet. Say hello!',
        chatCleared: 'Chat history was cleared by admin.',
        adminAnnouncement: '📢 Announcement',
        adminPrivateMsg: '💌 Admin DM',
        privateOnly: 'Only you can see this',
        attentionAlert: '🔔 Heads up: Get ready!',
        attentionNotif: 'The admin is calling for attention!',
        resultsTitle: '📊 Results',
        selectedPlayers: '✅ Selected',
        waitlistPlayers: '📋 Waitlisted',
        rejectedPlayers: '❌ Not Selected',
        noResults: 'No results yet',
        reconnecting: 'Reconnecting...',
        kicked: '⚠️ You have been removed by the admin',
        banned: '🚫 You have been banned by the admin',
        muted: '🔇 Muted',
        unmuted: '🔊 Sound on',
        countdownLabel: '⏱️ Countdown',
        closedTitle: '⏸️ Not Currently Open',
        closedMsg: 'Please wait for the admin to start a new session.',
        almostFull: '⚠️ Almost full! Only {n} spot(s) left',
        full: '🈵 All spots taken!',
        statusOnline: '🟢 Online',
        statusAway: '🟡 Away',
        statusBusy: '🔴 Busy',
        typing: '{name} is typing...',
        gameIdHint: '2-50 alphanumeric characters',
        selectedCelebration: '🎉 Congrats! You have been selected!'
    },
    'ja': {
        systemName: '🎮 Lily Queue',
        loading: '読み込み中...',
        statusOpen: '受付中',
        statusClosed: '受付終了',
        statusFull: '満員',
        connecting: '接続中...',
        registerTitle: 'エントリー',
        gameIdLabel: 'ゲームID',
        gameIdPlaceholder: 'ゲームIDを入力',
        displayNameLabel: '表示名（任意）',
        displayNamePlaceholder: 'チャットで表示される名前',
        registerBtn: '🚀 エントリーする',
        registering: 'エントリー中...',
        registerSuccess: 'エントリーを送信しました。管理者の承認をお待ちください。',
        registerFail: 'エントリーに失敗しました',
        networkError: 'ネットワークエラーです。しばらくしてからもう一度お試しください。',
        enterGameId: 'ゲームIDを入力してください',
        yourGameId: 'ゲームID：',
        yourPosition: 'あなたの順番',
        statusPending: '⏳ 審査中',
        statusSelected: '✅ 当選',
        statusWaitlist: '📋 補欠',
        statusRejected: '❌ 落選',
        lateWarning: '⚠️ 遅刻記録があり、選考に影響する可能性があります',
        slotsLabel: '定員',
        mainSlots: '本選',
        waitlistSlots: '補欠',
        registered: 'エントリー済',
        chatTab: '💬 チャット',
        onlineTab: '👥 オンライン',
        chatPlaceholder: 'メッセージを入力...',
        sendBtn: '送信',
        noChatMessages: 'まだメッセージがありません。挨拶してみましょう！',
        chatCleared: 'チャット履歴は管理者によって消去されました。',
        adminAnnouncement: '📢 お知らせ',
        adminPrivateMsg: '💌 管理者からのDM',
        privateOnly: 'あなただけに表示',
        attentionAlert: '🔔 注目：準備してください！',
        attentionNotif: '管理者が注目を呼びかけています！',
        resultsTitle: '📊 抽選結果',
        selectedPlayers: '✅ 当選',
        waitlistPlayers: '📋 補欠',
        rejectedPlayers: '❌ 落選',
        noResults: '結果はまだありません',
        reconnecting: '再接続中...',
        kicked: '⚠️ 管理者によって退出させられました',
        banned: '🚫 管理者によってBANされました',
        muted: '🔇 ミュート中',
        unmuted: '🔊 サウンドON',
        countdownLabel: '⏱️ カウントダウン',
        closedTitle: '⏸️ 現在受付を行っていません',
        closedMsg: '管理者が新しいセッションを開始するまでお待ちください。',
        almostFull: '⚠️ まもなく満員！残り{n}枠',
        full: '🈵 定員に達しました！',
        statusOnline: '🟢 オンライン',
        statusAway: '🟡 離席中',
        statusBusy: '🔴 取り込み中',
        typing: '{name}が入力中...',
        gameIdHint: '2〜50文字の英数字',
        selectedCelebration: '🎉 おめでとうございます！当選しました！'
    }
};

// Get current language (default: zh-TW)
function getLang() {
    return localStorage.getItem('queue_lang') || 'zh-TW';
}

function setLang(lang) {
    localStorage.setItem('queue_lang', lang);
}

function t(key, replacements) {
    const lang = getLang();
    let text = (i18n[lang] && i18n[lang][key]) || (i18n['zh-TW'] && i18n['zh-TW'][key]) || key;
    if (replacements) {
        Object.keys(replacements).forEach(k => {
            text = text.replace(`{${k}}`, replacements[k]);
        });
    }
    return text;
}

// Export for use in other scripts
if (typeof window !== 'undefined') {
    window.i18n = i18n;
    window.getLang = getLang;
    window.setLang = setLang;
    window.t = t;
}
