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
function add(userId, { ticker, name, market, currency, uiCurrency, isKorean, quantity, avgPrice, buyDate, memo, tradeReason, targetPrice, lossPrice, viewTerm, alerts }) {
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
        if (market) existing.market = market;
        if (currency) existing.currency = currency;
        if (uiCurrency) existing.uiCurrency = uiCurrency;
        if (isKorean !== undefined) existing.isKorean = isKorean;
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
        market: market || 'US',
        currency: currency || 'USD',
        uiCurrency: uiCurrency || '$',
        isKorean: isKorean || false,
        quantity: qty,
        avgPrice: price,
        buyDate: buyDate || null,
        memo:    memo || null,
        tradeReason: tradeReason || null,
        targetPrice: targetPrice ? Number(targetPrice) : null,
        lossPrice: lossPrice ? Number(lossPrice) : null,
        viewTerm: viewTerm || '단기',
        alerts: alerts || { enabled: false }, // default alert settings
        trades: [],
        addedAt: new Date().toISOString()
    });
    // 최초 등록을 매수 기록으로 추가
    all[id].holdings[all[id].holdings.length - 1].trades.push({
        id: Date.now().toString(),
        type: 'buy',
        date: buyDate || new Date().toISOString().split('T')[0],
        price: price,
        quantity: qty,
        memo: memo || '최초 등록'
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

/** 매수/매도 기록 추가 */
function addTrade(userId, ticker, trade) {
    const { all, id } = getUserData(userId);
    const upper = (ticker || '').toUpperCase();
    const holding = all[id].holdings.find(h => h.ticker === upper);
    if (!holding) return { ok: false, error: '종목을 찾을 수 없습니다.' };

    if (!holding.trades) holding.trades = [];

    const newTrade = {
        id: Date.now().toString(),
        type: trade.type || 'buy', // 'buy' or 'sell'
        date: trade.date || new Date().toISOString().split('T')[0],
        price: Number(trade.price) || 0,
        quantity: Number(trade.quantity) || 0,
        memo: trade.memo || ''
    };

    if (newTrade.price <= 0 || newTrade.quantity <= 0) {
        return { ok: false, error: '가격과 수량은 0보다 커야 합니다.' };
    }

    if (newTrade.type === 'sell' && newTrade.quantity > holding.quantity) {
        return { ok: false, error: '매도 수량이 보유 수량보다 많습니다.' };
    }

    holding.trades.push(newTrade);

    // 보유 수량 및 평단가 재계산
    let currentQty = 0;
    let totalCost = 0;

    // 모든 거래 내역을 시간순으로 정렬하여 재계산
    holding.trades.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime() || Number(a.id) - Number(b.id));

    for (const t of holding.trades) {
        if (t.type === 'buy') {
            totalCost += (t.price * t.quantity);
            currentQty += t.quantity;
        } else if (t.type === 'sell') {
            // 매도 시에는 평단가는 변하지 않고(실현손익 발생), 남은 수량과 보유 원금이 줄어듭니다.
            const avgCost = currentQty > 0 ? (totalCost / currentQty) : 0;
            currentQty -= t.quantity;
            totalCost = currentQty * avgCost;
        }
    }

    if (currentQty <= 0) {
        // 전량 매도 => 포트폴리오에서 삭제? 아니면 0주로 유지?
        // 보통은 삭제하거나 히스토리에만 둡니다. 여기서는 수량/평단을 0으로 설정합니다.
        holding.quantity = 0;
        holding.avgPrice = 0;
    } else {
        holding.quantity = currentQty;
        holding.avgPrice = Math.round((totalCost / currentQty) * 100) / 100;
    }

    save(all);
    return { ok: true, holding };
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

/** 보유종목 전체 교체 (서버 재시작 후 클라이언트 백업에서 복원용) */
function setHoldings(userId, holdings) {
    const { all, id } = getUserData(userId);
    all[id].holdings = Array.isArray(holdings) ? holdings : [];
    save(all);
}

function getLimit() { return MAX_HOLDINGS; }

module.exports = { get, add, update, remove, clear, getSummary, saveSnapshot, getHistory, getLimit, addTrade, setHoldings };
