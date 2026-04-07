/**
 * portfolio-store.js
 * userId 기준 보유종목 영구 저장 (티커, 수량, 평단가)
 * 패턴: watchlist-store.js와 동일 (JSON 파일 기반)
 */
const fs   = require('fs');
const path = require('path');

const DATA_DIR   = path.join(__dirname, '..', 'data');
const STORE_FILE = path.join(DATA_DIR, 'portfolio.json');
const MAX_HOLDINGS = 20;

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

function getUserData(userId) {
    const all = load();
    const id  = String(userId);
    if (!all[id]) all[id] = { holdings: [] };
    return { all, id };
}

// ─────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────

/** 보유종목 배열 반환 */
function get(userId) {
    const { all, id } = getUserData(userId);
    return all[id]?.holdings || [];
}

/**
 * 종목 추가
 * - 이미 보유한 종목이면 수량/평단가를 가중평균으로 합산
 * - 신규 종목이면 추가
 * @returns 'added' | 'merged' | 'limit_reached'
 */
function add(userId, { ticker, name, quantity, avgPrice, buyDate, memo }) {
    const { all, id } = getUserData(userId);
    const upper = (ticker || '').toUpperCase();
    const qty   = Number(quantity) || 0;
    const price = Number(avgPrice) || 0;

    if (qty <= 0) return 'invalid_quantity';
    if (price <= 0) return 'invalid_price';

    const existing = all[id].holdings.find(h => h.ticker === upper);
    if (existing) {
        // 가중평균 합산: 새 평단가 = (기존총액 + 추가총액) / (기존수량 + 추가수량)
        const totalCost = (existing.quantity * existing.avgPrice) + (qty * price);
        const totalQty  = existing.quantity + qty;
        existing.avgPrice = Math.round((totalCost / totalQty) * 100) / 100;
        existing.quantity = totalQty;
        if (name) existing.name = name;
        save(all);
        return 'merged';
    }

    if (all[id].holdings.length >= MAX_HOLDINGS) return 'limit_reached';

    all[id].holdings.push({
        ticker: upper,
        name:   name || upper,
        quantity: qty,
        avgPrice: price,
        buyDate: buyDate || null,
        memo:    memo || null,
        addedAt: new Date().toISOString()
    });
    save(all);
    return 'added';
}

/**
 * 종목 수량/평단가 수정
 * @returns true (성공) | false (종목 없음)
 */
function update(userId, ticker, updates) {
    const { all, id } = getUserData(userId);
    const upper = (ticker || '').toUpperCase();
    const holding = all[id].holdings.find(h => h.ticker === upper);
    if (!holding) return false;

    if (updates.quantity != null && Number(updates.quantity) > 0) {
        holding.quantity = Number(updates.quantity);
    }
    if (updates.avgPrice != null && Number(updates.avgPrice) > 0) {
        holding.avgPrice = Number(updates.avgPrice);
    }
    if (updates.name) holding.name = updates.name;
    if (updates.buyDate !== undefined) holding.buyDate = updates.buyDate;
    if (updates.memo !== undefined) holding.memo = updates.memo;

    save(all);
    return true;
}

/** 종목 삭제 */
function remove(userId, ticker) {
    const { all, id } = getUserData(userId);
    const upper  = (ticker || '').toUpperCase();
    const before = all[id].holdings.length;
    all[id].holdings = all[id].holdings.filter(h => h.ticker !== upper);
    save(all);
    return all[id].holdings.length < before;
}

/** 전체 초기화 */
function clear(userId) {
    const { all, id } = getUserData(userId);
    all[id].holdings = [];
    save(all);
}

/** 보유 요약 (종목 수, 총 투자금) */
function getSummary(userId) {
    const holdings = get(userId);
    const totalInvested = holdings.reduce((sum, h) => sum + (h.quantity * h.avgPrice), 0);
    return {
        holdingCount: holdings.length,
        totalInvested: Math.round(totalInvested * 100) / 100,
        tickers: holdings.map(h => h.ticker)
    };
}

function getLimit() { return MAX_HOLDINGS; }

module.exports = { get, add, update, remove, clear, getSummary, getLimit };
