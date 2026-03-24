/**
 * watchlist-store.js
 * chatId 기준 관심종목 + 투자 스타일 저장
 *  - 개인채팅: chatId === userId (충돌 없음)
 *  - 단톡방:   chatId 음수값 (완전 분리)
 */
const fs   = require('fs');
const path = require('path');

const DATA_DIR   = path.join(__dirname, '..', 'data');
const STORE_FILE = path.join(DATA_DIR, 'watchlist.json');
const MAX_WATCHLIST = parseInt(process.env.MAX_WATCHLIST || '10', 10);

function ensureDir() {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function load() {
    ensureDir();
    if (!fs.existsSync(STORE_FILE)) return {};
    try { return JSON.parse(fs.readFileSync(STORE_FILE, 'utf8')); }
    catch { return {}; }
}

function save(data) {
    ensureDir();
    fs.writeFileSync(STORE_FILE, JSON.stringify(data, null, 2));
}

// chatId가 저장 키
function getChatData(chatId) {
    const all = load();
    const id  = String(chatId);
    if (!all[id]) all[id] = { tickers: [], style: 'swing' };
    return { all, id };
}

// ─────────────────────────────────────────────
// Public API (모두 chatId 기준)
// ─────────────────────────────────────────────

/** 관심종목 목록 반환 */
function get(chatId) {
    const { all, id } = getChatData(chatId);
    return all[id]?.tickers || [];
}

/** 종목 추가 — true: 추가, false: 중복, 'limit_reached': 한도 초과 */
function add(chatId, ticker) {
    const { all, id } = getChatData(chatId);
    const upper = ticker.toUpperCase();
    if (all[id].tickers.includes(upper)) return false;
    if (all[id].tickers.length >= MAX_WATCHLIST) return 'limit_reached';
    all[id].tickers.push(upper);
    save(all);
    return true;
}

/** 종목 제거 */
function remove(chatId, ticker) {
    const { all, id } = getChatData(chatId);
    const upper  = ticker.toUpperCase();
    const before = all[id].tickers.length;
    all[id].tickers = all[id].tickers.filter(t => t !== upper);
    save(all);
    return all[id].tickers.length < before;
}

/** 투자 스타일 */
function setStyle(chatId, style) {
    const { all, id } = getChatData(chatId);
    all[id].style = style;
    save(all);
}

function getStyle(chatId) {
    const { all, id } = getChatData(chatId);
    return all[id]?.style || 'swing';
}

/** watcher가 순회할 때 사용 — chatId가 키이자 전송 대상 */
function getAllUsers() {
    const all = load();
    return Object.entries(all)
        .filter(([, v]) => v.tickers && v.tickers.length > 0)
        .map(([chatId, v]) => ({
            chatId,
            tickers: v.tickers,
            style:   v.style || 'swing'
        }));
}

function getLimit() { return MAX_WATCHLIST; }

module.exports = { get, add, remove, setStyle, getStyle, getAllUsers, getLimit };
