/**
 * watcher.js
 * 관심종목 실시간 감시 + 텔레그램 자동 알림
 * - 30분 주기로 모든 유저 watchlist 순회
 * - 신호 감지 시 텔레그램 자동 발송
 * - 6시간 내 동일 신호 재발송 방지 (dedupe)
 */
const { fetchAllStockData } = require('./data-fetcher');
const watchlistStore = require('./watchlist-store');
const { detectSignal, buildAlertMessage } = require('./signal-detector');
const { resolveStock } = require('../utils/ticker-util');
const sessions = require('./session');   // 알림 후 후속질문 컨텍스트 저장
const { logRecommendation } = require('./recommendation-tracker');

const INTERVAL_MS = 30 * 60 * 1000;  // 30분
const DEDUPE_TTL  = 6 * 60 * 60 * 1000; // 6시간

// 중복 신호 방지: Map<"userId:ticker:signalType" → timestamp>
const signalDedupeMap = new Map();

function isDuplicate(chatId, ticker, signalType) {
    const key = `${chatId}:${ticker}:${signalType}`;
    const last = signalDedupeMap.get(key);
    if (last && Date.now() - last < DEDUPE_TTL) return true;
    signalDedupeMap.set(key, Date.now());
    return false;
}

/**
 * 단일 유저의 watchlist 1회 스캔
 */
async function scanUser(bot, { chatId, tickers, style }) {
    if (!chatId || !tickers.length) return;

    for (const ticker of tickers) {
        try {
            const resolved = resolveStock(ticker) || { ticker, name: ticker, market: 'US' };
            const data = await fetchAllStockData(ticker, resolved.name, null);
            const signal = detectSignal(data, style);

            if (!signal) {
                console.log(`[Watcher] ${ticker} (${style}): 신호 없음`);
                continue;
            }

            if (isDuplicate(chatId, ticker, signal.type)) {
                console.log(`[Watcher] ${ticker}: ${signal.type} 신호 - 6시간 내 중복, 스킵`);
                continue;
            }

            const msg = buildAlertMessage(ticker, resolved.name, signal);
            console.log(`[Watcher] ✅ 신호 발송 → user=${userId} ticker=${ticker} type=${signal.type}`);
            await bot.sendMessage(chatId, msg);

            // ★ 추천 기록 저장 (수익률 추적용)
            try {
                logRecommendation({
                    userId,
                    ticker,
                    name:         resolved.name,
                    signalType:   signal.type,         // 'buy_prepare' | 'sell_prepare' | 'watchout' | 'watch'
                    priceAtAlert: data?.price?.current || 0,
                    reason:       signal.reason || '',
                    score:        signal.score  || {}  // computeScore 결과 (있으면)
                });
            } catch (e) {
                console.error('[Watcher] 추천 로그 저장 실패:', e.message);
            }

            // ★ 알림 발송 후 세션에 컨텍스트 저장 (chatId 기준)
            let session = sessions.get(chatId);
            if (!session) session = sessions.create(chatId);
            sessions.update(chatId, {
                lastAnalyzedTicker:   ticker,
                lastAnalyzedName:     resolved.name,
                lastAnalyzedMarket:   resolved.market || 'US',
                lastAnalyzedCorpCode: resolved.corpCode || null,
                lastTickerTime:       Date.now(),
            });
            console.log(`[Watcher] 📌 chatId=${chatId} ticker=${ticker}`);

            // 연속 종목 간 딜레이 (API 레이트리밋 방지)
            await new Promise(r => setTimeout(r, 1500));

        } catch (err) {
            console.error(`[Watcher] ${ticker} 스캔 오류:`, err.message);
        }
    }
}

/**
 * 전체 유저 스캔 1회 실행
 */
async function runScan(bot) {
    const users = watchlistStore.getAllUsers();
    if (!users.length) {
        console.log('[Watcher] 활성 watchlist 유저 없음 - 스킵');
        return;
    }
    console.log(`[Watcher] 🔍 스캔 시작: ${users.length}명, ${new Date().toLocaleTimeString('ko-KR')}`);
    for (const user of users) {
        await scanUser(bot, user);
    }
    console.log('[Watcher] ✅ 스캔 완료');
}

/**
 * Watcher 시작 (index.js에서 호출)
 */
function startWatcher(bot) {
    console.log(`[Watcher] 🟢 시작 - ${INTERVAL_MS / 60000}분 주기 감시`);

    // 봇 시작 후 2분 뒤 첫 스캔 (봇이 완전히 준비될 시간)
    setTimeout(() => runScan(bot), 2 * 60 * 1000);

    setInterval(() => runScan(bot), INTERVAL_MS);
}

module.exports = { startWatcher };
