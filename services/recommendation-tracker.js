/**
 * recommendation-tracker.js
 * 추천 기록 저장 + 1/3/7/30일 수익률 추적 + 성공/실패 판정
 * 저장 위치: ./data/recommendation_log.json
 */

const fs   = require('fs');
const path = require('path');
const { fetchAllStockData } = require('./data-fetcher');

const DATA_DIR  = path.join(__dirname, '..', 'data');
const LOG_FILE  = path.join(DATA_DIR, 'recommendation_log.json');

// 추적 기준 일수
const TRACK_DAYS = [1, 3, 7, 30];

// ─────────────────────────────────────────────
// 파일 I/O
// ─────────────────────────────────────────────
function load() {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    if (!fs.existsSync(LOG_FILE)) return [];
    try { return JSON.parse(fs.readFileSync(LOG_FILE, 'utf8')); }
    catch { return []; }
}

function save(logs) {
    fs.writeFileSync(LOG_FILE, JSON.stringify(logs, null, 2));
}

// ─────────────────────────────────────────────
// 추천 저장
// ─────────────────────────────────────────────
/**
 * @param {object} opts
 * @param {string} opts.userId
 * @param {string} opts.ticker
 * @param {string} opts.name
 * @param {string} opts.signalType   - 'buy_prepare' | 'sell_prepare' | 'watchout' | 'hold' | 'watch'
 * @param {number} opts.priceAtAlert
 * @param {string} opts.reason       - 신호 근거 요약
 * @param {object} opts.score        - { total, techScore, fundScore, newsScore, macroScore, suggestedAction }
 */
function logRecommendation({ userId, ticker, name, signalType, priceAtAlert, reason, score }) {
    const logs = load();
    const entry = {
        id:              `${ticker}_${Date.now()}`,
        userId:          String(userId),
        ticker,
        name:            name || ticker,
        signalType,                        // 'buy_prepare' | 'sell_prepare' | 'hold' | 'watch'
        action:          score?.suggestedAction || '-',
        priceAtAlert:    parseFloat(priceAtAlert) || 0,
        reason:          reason || '',
        score: {
            total:     score?.total      || 0,
            tech:      score?.techScore  || 0,
            fund:      score?.fundScore  || 0,
            news:      score?.newsScore  || 0,
            macro:     score?.macroScore || 0,
        },
        createdAt:       new Date().toISOString(),
        // 나중에 채워질 필드
        performance: {}  // { '1d': {...}, '3d': {...}, '7d': {...}, '30d': {...} }
    };
    logs.push(entry);
    save(logs);
    console.log(`[RecTracker] ✅ 추천 저장: ${ticker} @${priceAtAlert} action=${entry.action}`);
    return entry;
}

// ─────────────────────────────────────────────
// 성공/실패 판정
// ─────────────────────────────────────────────
function judgeResult(signalType, returnPct) {
    const r = parseFloat(returnPct);
    if (signalType === 'buy_prepare' || signalType === 'hold') {
        if (r >= 5)       return { result: '✅ 성공', label: `+${r.toFixed(1)}% 달성` };
        if (r >= 1)       return { result: '🟡 부분성공', label: `+${r.toFixed(1)}%` };
        if (r >= -3)      return { result: '⚖️ 중립', label: `${r.toFixed(1)}%` };
        return             { result: '❌ 실패', label: `${r.toFixed(1)}% 하락` };
    }
    if (signalType === 'sell_prepare' || signalType === 'watchout') {
        if (r <= -5)      return { result: '✅ 성공', label: `${r.toFixed(1)}% 하락 예측` };
        if (r <= -1)      return { result: '🟡 부분성공', label: `${r.toFixed(1)}%` };
        if (r <= 3)       return { result: '⚖️ 중립', label: `${r.toFixed(1)}%` };
        return             { result: '❌ 실패', label: `+${r.toFixed(1)}% 상승 (예측 실패)` };
    }
    // 'watch' / 관망
    if (Math.abs(r) <= 5) return { result: '✅ 성공', label: `횡보 ${r.toFixed(1)}%` };
    return                  { result: '⚖️ 중립', label: `${r.toFixed(1)}%` };
}

// ─────────────────────────────────────────────
// 단일 항목 성과 업데이트
// ─────────────────────────────────────────────
async function updatePerformance(entry) {
    try {
        const data = await fetchAllStockData(entry.ticker, entry.name, null);
        const curPrice = data?.price?.current;
        if (!curPrice || !entry.priceAtAlert) return;

        const returnPct = ((curPrice - entry.priceAtAlert) / entry.priceAtAlert * 100).toFixed(2);
        const createdAt = new Date(entry.createdAt).getTime();
        const daysElapsed = (Date.now() - createdAt) / (1000 * 60 * 60 * 24);

        for (const d of TRACK_DAYS) {
            if (daysElapsed < d - 0.5) continue; // 아직 해당 기간 안 됨
            if (entry.performance[`${d}d`]?.locked) continue; // 이미 확정된 기간

            const judgment = judgeResult(entry.signalType, returnPct);
            entry.performance[`${d}d`] = {
                priceAtCheck: parseFloat(curPrice),
                returnPct:    parseFloat(returnPct),
                checkedAt:    new Date().toISOString(),
                ...judgment,
                locked:       daysElapsed >= d + 1  // 1일 여유 후 확정
            };
        }
        return entry;
    } catch (err) {
        console.error(`[RecTracker] updatePerformance ${entry.ticker}:`, err.message);
    }
}

// ─────────────────────────────────────────────
// 전체 미확정 항목 일괄 추적
// ─────────────────────────────────────────────
async function runTracker() {
    const logs = load();
    let updated = 0;
    for (const entry of logs) {
        const needsUpdate = TRACK_DAYS.some(d =>
            !entry.performance[`${d}d`]?.locked &&
            (Date.now() - new Date(entry.createdAt).getTime()) >= d * 86400000 * 0.9
        );
        if (!needsUpdate) continue;
        await updatePerformance(entry);
        updated++;
        await new Promise(r => setTimeout(r, 1000));
    }
    if (updated) save(logs);
    console.log(`[RecTracker] 추적 완료: ${updated}건 업데이트`);
    return logs;
}

// ─────────────────────────────────────────────
// 성과 리포트 텍스트 생성
// ─────────────────────────────────────────────
function buildPerformanceReport(userId) {
    const logs = load();
    const userLogs = userId
        ? logs.filter(e => e.userId === String(userId))
        : logs;

    if (!userLogs.length) return '📋 아직 추적 중인 추천 기록이 없습니다.';

    // 성과 통계
    let success = 0, fail = 0, neutral = 0, total = 0;
    const recentLines = [];

    for (const e of userLogs.slice(-20).reverse()) {
        const latestPerf = ['30d', '7d', '3d', '1d']
            .map(k => e.performance[k])
            .find(p => p);

        let perfStr = '추적 중...';
        if (latestPerf) {
            perfStr = `${latestPerf.result} (${latestPerf.returnPct > 0 ? '+' : ''}${latestPerf.returnPct}%)`;
            if (latestPerf.result.includes('성공')) success++;
            else if (latestPerf.result.includes('실패')) fail++;
            else neutral++;
            total++;
        }

        const d = new Date(e.createdAt).toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' });
        recentLines.push(`• [${d}] **${e.ticker}** @$${e.priceAtAlert} → ${e.action} → ${perfStr}`);
    }

    const winRate = total > 0 ? ((success / total) * 100).toFixed(0) : 'N/A';

    return `📊 **추천 성과 리포트**\n\n` +
        `총 추적: ${userLogs.length}건 | 완료: ${total}건\n` +
        `✅ 성공: ${success} | ❌ 실패: ${fail} | ⚖️ 중립: ${neutral}\n` +
        `승률: **${winRate}%**\n\n` +
        `**최근 추천 내역:**\n${recentLines.join('\n')}\n\n` +
        `_1/3/7/30일 기준 자동 추적 중_`;
}

// ─────────────────────────────────────────────
// 스케줄러 시작 (index.js에서 호출)
// ─────────────────────────────────────────────
function startPerformanceTracker() {
    console.log('[RecTracker] 🟢 성과 추적 스케줄러 시작 (6시간마다)');
    runTracker(); // 즉시 1회 실행
    setInterval(runTracker, 6 * 60 * 60 * 1000); // 6시간마다
}

module.exports = {
    logRecommendation,
    buildPerformanceReport,
    startPerformanceTracker,
    runTracker,
    load
};
