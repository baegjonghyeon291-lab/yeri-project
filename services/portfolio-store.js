/**
 * portfolio-store.js
 * userId 기준 보유종목 영구 저장 (티커, 수량, 평단가)
 * 패턴: watchlist-store.js와 동일 (JSON 파일 기반)
 */
const fs   = require('fs');
const path = require('path');

const DATA_DIR   = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
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
function add(userId, { ticker, name, quantity, avgPrice, buyDate, memo, tradeReason, targetPrice, lossPrice, viewTerm, alerts }) {
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
        if (tradeReason !== undefined) existing.tradeReason = tradeReason;
        if (targetPrice !== undefined) existing.targetPrice = targetPrice;
        if (lossPrice !== undefined) existing.lossPrice = lossPrice;
        if (viewTerm !== undefined) existing.viewTerm = viewTerm;
        if (alerts !== undefined) existing.alerts = alerts;
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
        tradeReason: tradeReason || null,
        targetPrice: targetPrice ? Number(targetPrice) : null,
        lossPrice: lossPrice ? Number(lossPrice) : null,
        viewTerm: viewTerm || '단기',
        alerts: alerts || { enabled: false }, // default alert settings
        addedAt: new Date().toISOString()
    });
    save(all);
    return 'added';
}

/**
 * 종목 수량/평단가 및 메타데이터 수정
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
    if (updates.name !== undefined) holding.name = updates.name;
    if (updates.buyDate !== undefined) holding.buyDate = updates.buyDate;
    if (updates.memo !== undefined) holding.memo = updates.memo;
    
    // 신규 메타데이터 업데이트
    if (updates.tradeReason !== undefined) holding.tradeReason = updates.tradeReason;
    if (updates.targetPrice !== undefined) holding.targetPrice = updates.targetPrice ? Number(updates.targetPrice) : null;
    if (updates.lossPrice !== undefined) holding.lossPrice = updates.lossPrice ? Number(updates.lossPrice) : null;
    if (updates.viewTerm !== undefined) holding.viewTerm = updates.viewTerm;
    if (updates.alerts !== undefined) holding.alerts = updates.alerts;

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
    all[id].history = [];
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

/** 포트폴리오 히스토리 스냅샷 추가 */
function saveSnapshot(userId, snapshotData) {
    const { all, id } = getUserData(userId);
    if (!all[id].history) all[id].history = [];
    
    // 오늘 날짜의 스냅샷이 이미 있으면 덮어쓰기 (하루 1회 갱신 처리용)
    const today = new Date().toISOString().split('T')[0];
    const existingIndex = all[id].history.findIndex(h => h.date && h.date.startsWith(today));
    
    const snapshot = {
        date: new Date().toISOString(),
        ...snapshotData
    };

    if (existingIndex >= 0) {
        all[id].history[existingIndex] = snapshot;
    } else {
        all[id].history.push(snapshot);
    }
    
    // 히스토리 최대 100개(약 3개월치)만 유지
    if (all[id].history.length > 100) {
        all[id].history = all[id].history.slice(-100);
    }
    save(all);
}

/** 포트폴리오 히스토리 조회 */
function getHistory(userId) {
    const { all, id } = getUserData(userId);
    return all[id].history || [];
}

function getLimit() { return MAX_HOLDINGS; }

module.exports = { get, add, update, remove, clear, getSummary, saveSnapshot, getHistory, getLimit };
