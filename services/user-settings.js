/**
 * user-settings.js
 * 유저별 알림/브리핑 시간 설정 영속 저장
 * ./data/user_settings.json
 */
const fs   = require('fs');
const path = require('path');

const DATA_DIR    = path.join(__dirname, '..', 'data');
const SETTINGS_FILE = path.join(DATA_DIR, 'user_settings.json');

const DEFAULTS = {
    briefingTime:    '08:30',   // HH:MM (유저 로컬 기준)
    briefingEnabled: true,
    alertTimes:      [],        // [] = watcher 기본 30분 주기
    alertEnabled:    true,
    timezone:        'Asia/Seoul',
    onboardingDone:  false,
    mode:            'advanced', // 'beginner' | 'advanced'
};

function load() {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    if (!fs.existsSync(SETTINGS_FILE)) return {};
    try { return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')); }
    catch { return {}; }
}

function save(all) {
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(all, null, 2));
}

function get(chatId) {
    const all = load();
    return { ...DEFAULTS, ...(all[String(chatId)] || {}) };
}

function set(chatId, patch) {
    const all = load();
    const id  = String(chatId);
    all[id]   = { ...(all[id] || {}), ...patch };
    save(all);
    return all[id];
}

function getAll() {
    const all = load();
    return Object.entries(all).map(([chatId, s]) => ({ chatId, ...{ ...DEFAULTS, ...s } }));
}

// HH:MM 형식 검사
function parseTime(str) {
    const m = (str || '').trim().match(/^(\d{1,2}):(\d{2})$/);
    if (!m) return null;
    const h = parseInt(m[1], 10), min = parseInt(m[2], 10);
    if (h < 0 || h > 23 || min < 0 || min > 59) return null;
    return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

// 유효 timezone 목록 (일부)
const SUPPORTED_TZ = [
    'Asia/Seoul', 'Asia/Tokyo', 'Asia/Shanghai',
    'America/New_York', 'America/Los_Angeles', 'America/Chicago',
    'Europe/London', 'Europe/Berlin', 'UTC'
];

function isValidTZ(tz) {
    return SUPPORTED_TZ.some(t => t.toLowerCase() === tz.toLowerCase());
}

function resolveTZ(tz) {
    return SUPPORTED_TZ.find(t => t.toLowerCase() === tz.toLowerCase()) || null;
}

// 유저의 현재 로컬 HH:MM 계산
function getCurrentLocalTime(timezone) {
    try {
        const now = new Date();
        const opts = { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: timezone };
        return new Intl.DateTimeFormat('ko-KR', opts).format(now); // "HH:MM"
    } catch {
        // fallback: KST
        const kst = new Date(Date.now() + 9 * 3600 * 1000);
        const h   = String(kst.getUTCHours()).padStart(2, '0');
        const m   = String(kst.getUTCMinutes()).padStart(2, '0');
        return `${h}:${m}`;
    }
}

module.exports = { get, set, getAll, parseTime, isValidTZ, resolveTZ, getCurrentLocalTime, SUPPORTED_TZ, DEFAULTS };
