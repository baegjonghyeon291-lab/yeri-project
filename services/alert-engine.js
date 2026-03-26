/**
 * alert-engine.js
 * 웹앱 내부 알림 시스템 — 관심종목 변화 감지 엔진
 *
 * 조건:
 *   1. 가격 ±3% 이상 변동
 *   2. RSI < 30 (과매도) / RSI > 70 (과매수)
 *   3. 뉴스 긍정/부정 감지
 *   4. 추천 상태 변화 (관망→매수 등)
 *
 * 캐시: 10분 dedupe (같은 조건 중복 알림 방지)
 * 출처: /api/alerts/:chatId 엔드포인트를 통해 웹앱에 전달
 */
require('dotenv').config();
const { fetchAllStockData }   = require('./data-fetcher');
const { computeScore }        = require('./analyzer');
const watchlistStore          = require('./watchlist-store');
const { resolveStock }        = require('../utils/ticker-util');

// ── 전역 알림 캐시 ────────────────────────────────────────────
// Map<"chatId:ticker:conditionKey" → timestamp>
const alertDedupeMap = new Map();
const DEDUPE_MS = 10 * 60 * 1000;  // 10분

// 알림 결과 캐시 (웹앱이 GET할 때 반환)
// Map<chatId → { alerts: [], updatedAt: timestamp }>
const alertResultCache = new Map();
const RESULT_CACHE_MS  = 5 * 60 * 1000;  // 5분

// 이전 추천 상태 기록 (변화 감지용)
const prevVerdictMap = new Map(); // "chatId:ticker" → verdict string

// ── 중복 체크 ─────────────────────────────────────────────────
function isDuplicate(chatId, ticker, key) {
    const mapKey = `${chatId}:${ticker}:${key}`;
    const last = alertDedupeMap.get(mapKey);
    if (last && Date.now() - last < DEDUPE_MS) return true;
    alertDedupeMap.set(mapKey, Date.now());
    return false;
}

// 만료된 dedupe 항목 정리
function gcDedupe() {
    const now = Date.now();
    for (const [k, ts] of alertDedupeMap) {
        if (now - ts > DEDUPE_MS * 2) alertDedupeMap.delete(k);
    }
}

// ── 뉴스 감성 분석 ────────────────────────────────────────────
const POS_KW = ['beat', 'surge', 'record', 'growth', 'buy', 'upgrade', 'bullish', '급등', '호실적', '매수', '상향', 'strong', 'profit'];
const NEG_KW = ['miss', 'fall', 'drop', 'downgrade', 'sell', 'bearish', 'layoff', '급락', '어닝쇼크', '매도', '하향', 'lawsuit', 'tariff', 'loss', 'weak'];

function analyzeNews(news = []) {
    let pos = 0, neg = 0;
    for (const a of news.slice(0, 10)) {
        const t = (a.title || '').toLowerCase();
        if (POS_KW.some(k => t.includes(k))) pos++;
        if (NEG_KW.some(k => t.includes(k))) neg++;
    }
    return { pos, neg, total: news.length };
}

// ── 단일 종목 알림 체크 ──────────────────────────────────────
async function checkTicker(chatId, ticker) {
    const alerts = [];
    try {
        const resolved = resolveStock(ticker) || { ticker, name: ticker };
        const data = await fetchAllStockData(resolved.ticker, resolved.name);
        const score = computeScore(data);
        const price = data.price?.current;
        const changePct = data.price?.changePct;
        const rsi = data.technical?.rsi;
        const currency = ticker.endsWith('.KS') ? '₩' : '$';
        const priceStr = price ? `${currency}${price.toLocaleString()}` : 'N/A';

        // ── 조건 1: 가격 ±3% ────────────────────────────────
        if (changePct != null && Math.abs(changePct) >= 3) {
            const dir = changePct > 0 ? '상승' : '하락';
            const emoji = changePct > 0 ? '📈' : '📉';
            const key = `price_${changePct > 0 ? 'up' : 'dn'}_3pct`;
            if (!isDuplicate(chatId, ticker, key)) {
                alerts.push({
                    type: 'price',
                    level: Math.abs(changePct) >= 5 ? 'high' : 'medium',
                    emoji,
                    title: `${ticker} 가격 급${dir}`,
                    desc: `전일 대비 ${changePct > 0 ? '+' : ''}${changePct.toFixed(2)}% (현재 ${priceStr})`,
                    ticker,
                    name: resolved.name,
                });
            }
        }

        // ── 조건 2: RSI ──────────────────────────────────────
        if (rsi != null) {
            if (rsi < 30 && !isDuplicate(chatId, ticker, 'rsi_oversold')) {
                alerts.push({
                    type: 'rsi',
                    level: 'HIGH',
                    emoji: '🟢',
                    title: `${ticker} RSI 과매도`,
                    desc: `RSI ${rsi.toFixed(1)} — 저점 매수 기회 가능성`,
                    ticker,
                    name: resolved.name,
                });
            } else if (rsi > 70 && !isDuplicate(chatId, ticker, 'rsi_overbought')) {
                alerts.push({
                    type: 'rsi',
                    level: rsi > 80 ? 'HIGH' : 'MEDIUM',
                    emoji: '🔴',
                    title: `${ticker} RSI 과매수`,
                    desc: `RSI ${rsi.toFixed(1)} — 단기 조정 주의`,
                    ticker,
                    name: resolved.name,
                });
            }
        }

        // ── 조건 3: 뉴스 ────────────────────────────────────
        const { pos, neg, total } = analyzeNews(data.news);
        if (total > 0) {
            if (pos >= 2 && !isDuplicate(chatId, ticker, `news_pos_${pos}`)) {
                alerts.push({
                    type: 'news',
                    level: 'MEDIUM',
                    emoji: '📰',
                    title: `${ticker} 긍정 뉴스 ${pos}건`,
                    desc: `최근 ${total}건 중 긍정 ${pos}건 / 부정 ${neg}건`,
                    ticker,
                    name: resolved.name,
                });
            } else if (neg >= 2 && !isDuplicate(chatId, ticker, `news_neg_${neg}`)) {
                alerts.push({
                    type: 'news',
                    level: neg >= 3 ? 'HIGH' : 'MEDIUM',
                    emoji: '⚠️',
                    title: `${ticker} 부정 뉴스 ${neg}건`,
                    desc: `최근 ${total}건 중 부정 ${neg}건 — 리스크 모니터링 필요`,
                    ticker,
                    name: resolved.name,
                });
            }
        }

        // ── 조건 4: 추천 상태 변화 ──────────────────────────
        const prevKey = `${chatId}:${ticker}`;
        const prevVerdict = prevVerdictMap.get(prevKey);
        const curVerdict = score.verdict;

        if (prevVerdict && prevVerdict !== curVerdict) {
            const key = `verdict_${curVerdict}`;
            if (!isDuplicate(chatId, ticker, key)) {
                const isPositive = curVerdict.includes('긍정');
                alerts.push({
                    type: 'verdict',
                    level: isPositive ? 'MEDIUM' : 'HIGH',
                    emoji: isPositive ? '✅' : '⚠️',
                    title: `${ticker} 추천 상태 변화`,
                    desc: `${prevVerdict} → ${curVerdict} (AI점수: ${score.total}/40)`,
                    ticker,
                    name: resolved.name,
                });
            }
        }
        prevVerdictMap.set(prevKey, curVerdict);

        // ── 현재 상태 요약 ───────────────────────────────────
        return {
            ticker,
            name: resolved.name,
            price,
            priceStr,
            changePct,
            rsi,
            score: score.total,
            verdict: curVerdict,
            suggestedAction: score.suggestedAction,
            priceSource: data.price?.source || '-',
            alerts,
        };
    } catch (e) {
        console.warn(`[AlertEngine] ${ticker} 체크 실패: ${e.message}`);
        return { ticker, name: ticker, alerts, error: e.message };
    }
}

// ── 전체 watchlist 스캔 ──────────────────────────────────────
async function scanWatchlist(chatId) {
    // 캐시 확인
    const cached = alertResultCache.get(chatId);
    if (cached && Date.now() - cached.updatedAt < RESULT_CACHE_MS) {
        return cached;
    }

    const tickers = watchlistStore.get(chatId);
    if (!tickers.length) {
        const result = { chatId, alerts: [], stocks: [], updatedAt: Date.now() };
        alertResultCache.set(chatId, result);
        return result;
    }

    console.log(`[AlertEngine] ${chatId} watchlist ${tickers.length}종목 스캔`);
    const stockResults = [];
    const allAlerts = [];

    // 순차 처리 (API rate limit 보호)
    for (const ticker of tickers) {
        const result = await checkTicker(chatId, ticker);
        stockResults.push(result);
        allAlerts.push(...result.alerts);
        if (tickers.length > 1) await new Promise(r => setTimeout(r, 500));
    }

    // 알림 정렬 (high → medium → low)
    const levelOrder = { HIGH: 0, MEDIUM: 1, INFO: 2 };
    allAlerts.sort((a, b) => (levelOrder[a.level] ?? 2) - (levelOrder[b.level] ?? 2));

    gcDedupe();

    const result = {
        chatId,
        alerts: allAlerts,
        stocks: stockResults,
        alertCount: allAlerts.length,
        updatedAt: Date.now(),
    };
    alertResultCache.set(chatId, result);
    return result;
}

// ── 캐시 직접 무효화 (강제 새로고침용) ───────────────────────
function invalidateCache(chatId) {
    alertResultCache.delete(chatId);
}

module.exports = { scanWatchlist, checkTicker, invalidateCache };
