/**
 * recommendation-engine.js — 데이터 기반 추천 엔진
 * GPT 추론 없이 순수 데이터 필터 + 점수 기반 추천
 */

const { fetchAllStockData, computeDataReliability } = require('./data-fetcher');
const { computeScore } = require('./analyzer');
const { getCompanyDesc } = require('../utils/ticker-util');

// ──────────────────────────────────────────────────────────
// 추천 후보 풀 (인기/대형주 40개)
// ──────────────────────────────────────────────────────────
const RECOMMENDATION_POOL = [
    // Big Tech
    'AAPL', 'MSFT', 'GOOGL', 'AMZN', 'META', 'NFLX',
    // AI / 반도체
    'NVDA', 'AMD', 'AVGO', 'TSM', 'INTC', 'ARM', 'MRVL', 'MU', 'SMCI',
    // EV / 에너지
    'TSLA', 'RIVN', 'NIO',
    // 소프트웨어 / 클라우드
    'PLTR', 'SNOW', 'CRM', 'CRWD', 'PANW',
    // 핀테크 / 금융
    'V', 'MA', 'JPM', 'SQ', 'PYPL', 'SOFI', 'COIN', 'HOOD',
    // 소비 / 커머스
    'UBER', 'DASH', 'SHOP', 'BABA',
    // 바이오
    'LLY', 'NVO',
    // AI 소형주
    'SOUN', 'IONQ', 'BBAI',
    // 기타
    'DELL', 'DUOL',
];

// ──────────────────────────────────────────────────────────
// 추천 캐시 (30분 TTL)
// ──────────────────────────────────────────────────────────
let _recCache = null;
let _recCacheTs = 0;
const REC_CACHE_TTL = 30 * 60 * 1000; // 30분

// ──────────────────────────────────────────────────────────
// 1단계: HARD FILTER — 하나라도 해당하면 즉시 탈락
// ──────────────────────────────────────────────────────────
function applyHardFilters(data, score) {
    const reasons = [];
    const { fundamentals, price } = data;
    const reliability = computeDataReliability(data);

    if (reliability.pct < 40) reasons.push(`데이터 훼손 (${reliability.pct}%)`);

    // 시가총액 < 1B ($10억 미만)
    const mcap = fundamentals?.mktCap;
    if (mcap != null && mcap < 1000000000) reasons.push('소형주 리스크 (시가총액 1B 미만)');

    // ROE < -10%
    const roe = fundamentals?.roe ? parseFloat(fundamentals.roe) : null;
    if (roe != null && roe < -10) reasons.push(`자본 훼손 (ROE ${roe.toFixed(1)}%)`);

    // 매출 성장률 < 0% (역성장)
    const growth = fundamentals?.revenueGrowthYoY ? parseFloat(fundamentals.revenueGrowthYoY) : null;
    if (growth != null && growth < 0) reasons.push(`역성장 (매출 ${growth.toFixed(1)}%)`);

    // FCF < 0 이고 현금 부족
    const fcf = fundamentals?.freeCashFlow;
    const cash = fundamentals?.totalCash;
    const debt = fundamentals?.totalDebt;
    if (fcf != null && fcf < 0) {
        if (cash != null && debt != null && cash < debt) {
            reasons.push('현금 고갈 우려 (적자 전환 + 부채 과다)');
        }
    }

    return { rejected: reasons.length > 0, reasons };
}

// ──────────────────────────────────────────────────────────
// 2단계: SCORE FILTER — 마진, FCF, 부채비율, 성장성, 거래량 (최대 15점)
// ──────────────────────────────────────────────────────────
function computeBonusScore(data) {
    const { technical, fundamentals, price } = data;
    const detail = [];
    let total = 0;

    // 1. 매출 성장률 (0~3)
    const growth = fundamentals?.revenueGrowthYoY ? parseFloat(fundamentals.revenueGrowthYoY) : null;
    if (growth != null) {
        if (growth > 30) { total += 3; detail.push('초고성장(>30%) +3점'); }
        else if (growth > 15) { total += 2; detail.push('고성장(>15%) +2점'); }
        else if (growth > 0) { total += 1; detail.push('안정적성장(>0%) +1점'); }
        else { detail.push('역성장 0점'); }
    } else { detail.push('성장률 없음 0점'); }

    // 2. 마진 (순이익률) (0~3)
    const margin = fundamentals?.netMargin ? parseFloat(fundamentals.netMargin) : null;
    if (margin != null) {
        if (margin > 20) { total += 3; detail.push('초고수익성(>20%) +3점'); }
        else if (margin > 10) { total += 2; detail.push('고수익성(>10%) +2점'); }
        else if (margin > 0) { total += 1; detail.push('수익성(>0%) +1점'); }
        else { detail.push('적자(마진) 0점'); }
    } else { detail.push('마진 없음 0점'); }

    // 3. FCF (0~3)
    const fcf = fundamentals?.freeCashFlow;
    const rev = fundamentals?.revenue;
    if (fcf != null && rev != null && rev > 0) {
        const fcfMargin = (fcf / rev) * 100;
        if (fcfMargin > 15) { total += 3; detail.push('풍부한FCF(>15%) +3점'); }
        else if (fcfMargin > 5) { total += 2; detail.push('안정적FCF(>5%) +2점'); }
        else if (fcfMargin > 0) { total += 1; detail.push('흑자FCF +1점'); }
        else { detail.push('적자FCF 0점'); }
    } else { detail.push('FCF 없음 0점'); }

    // 4. 부채비율 (Debt to Equity) (0~3)
    const dte = fundamentals?.debtToEquity ? parseFloat(fundamentals.debtToEquity) : null;
    if (dte != null) {
        if (dte < 50) { total += 3; detail.push('우량재무(Debt<50%) +3점'); }
        else if (dte < 100) { total += 2; detail.push('건전재무(Debt<100%) +2점'); }
        else if (dte < 200) { total += 1; detail.push('보통재무(Debt<200%) +1점'); }
        else { detail.push('위험재무 0점'); }
    } else { detail.push('부채비율 없음 0점'); }

    // 5. 상승 추세 (가격 > EMA20 장기 유지 및 거래량 지지) (0~3)
    const cur = price?.current;
    const ema20 = technical?.ema20;
    const vol = price?.volume;
    const avgVol = technical?.avgVolume;
    if (cur != null && ema20 != null && cur > ema20) {
        if (vol && avgVol && vol > avgVol * 1.2) {
            total += 3; detail.push('강한상승추세(거래량수반) +3점');
        } else {
            total += 2; detail.push('상승추세(EMA20↑) +2점');
        }
    } else if (cur != null && ema20 != null && cur > ema20 * 0.95) {
        total += 1; detail.push('보합추세 +1점');
    } else { detail.push('하락추세 0점'); }

    return { total, detail };
}

// ──────────────────────────────────────────────────────────
// 3단계: COMPUTE RECOMMENDATION SCORE — 종합 등급 (STRONG_PICK 전용)
// ──────────────────────────────────────────────────────────
function computeRecommendationScore(data) {
    const hard = applyHardFilters(data);
    const scoreFilter = computeBonusScore(data);
    const totalScore = scoreFilter.total; // 0 ~ 15

    let grade = 'NOT_RECOMMENDED';
    let reason = '';

    if (hard.rejected) {
        reason = hard.reasons.join(', ');
    } else {
        // STRONG_PICK 조건: 총점 11점 이상이면서 핵심 필터 흑자 조건 만족 시
        if (totalScore >= 10) {
            grade = 'STRONG_PICK';
            const f = data.fundamentals || {};
            const roe = f.roe ? parseFloat(f.roe).toFixed(1) : '';
            const g = f.revenueGrowthYoY ? parseFloat(f.revenueGrowthYoY).toFixed(1) : '';
            reason = `고성장(${g}%) + 튼튼한 수익성(ROE ${roe}%) + 안정적 수급 구조`;
        } else {
            reason = '수익성은 양호하나 성장/추세 모멘텀 다소 부족';
        }
    }

    return {
        totalScore, grade, reason,
        hardReject: hard.rejected,
        rejectReasons: hard.reasons,
        bonusDetail: scoreFilter.detail,
    };
}

// ──────────────────────────────────────────────────────────
// GENERATE RECOMMENDATIONS — 후보 풀 스캔 → 등급별 분류
// ──────────────────────────────────────────────────────────
async function generateRecommendations() {
    // 캐시 확인
    if (_recCache && Date.now() - _recCacheTs < REC_CACHE_TTL) {
        console.log('[RecEngine] 캐시 반환 (TTL 내)');
        return _recCache;
    }

    console.log(`[RecEngine] 후보 ${RECOMMENDATION_POOL.length}개 스캔 시작...`);
    const startTime = Date.now();

    // 병렬로 데이터 가져오기 (5개씩 배치)
    const results = [];
    const batchSize = 5;
    for (let i = 0; i < RECOMMENDATION_POOL.length; i += batchSize) {
        const batch = RECOMMENDATION_POOL.slice(i, i + batchSize);
        const batchResults = await Promise.all(
            batch.map(async (ticker) => {
                try {
                    const data = await fetchAllStockData(ticker);
                    const rec = computeRecommendationScore(data);
                    return {
                        ticker,
                        name: data.companyName || ticker,
                        desc: getCompanyDesc(ticker) || null,
                        price: data.price?.current || null,
                        changePct: data.price?.changePercent || null,
                        ...rec,
                    };
                } catch (err) {
                    console.warn(`[RecEngine] ${ticker} 실패:`, err.message);
                    return null;
                }
            })
        );
        results.push(...batchResults.filter(Boolean));
    }

    // 최종 3단계: STRONG_PICK만 최대 3개 선별
    const strongPicks = results
        .filter(r => r.grade === 'STRONG_PICK')
        .sort((a, b) => b.totalScore - a.totalScore)
        .slice(0, 3);

    const excluded = results
        .filter(r => r.grade === 'NOT_RECOMMENDED')
        .sort((a, b) => b.totalScore - a.totalScore); // 점수순 정렬(상대적으로 아쉬운 건 위로)

    const output = {
        strongPicks: strongPicks.map(formatResult),
        watchlist: [], // UI에서 더이상 WATCHLIST를 취급하지 않으므로 비워둠
        excluded: excluded.map(r => ({
            ticker: r.ticker,
            name: r.name,
            desc: r.desc,
            reason: r.reason,
            totalScore: r.totalScore,
            bonusDetail: r.bonusDetail
        })),
        meta: {
            scannedCount: results.length,
            timestamp: new Date().toISOString(),
            elapsedMs: Date.now() - startTime,
        },
    };

    // 캐시 저장
    _recCache = output;
    _recCacheTs = Date.now();
    console.log(`[RecEngine] 스캔 완료: ${strongPicks.length} STRONG + ${excluded.length} EXCLUDED (${output.meta.elapsedMs}ms)`);

    return output;
}

function formatResult(r) {
    return {
        ticker: r.ticker,
        name: r.name,
        desc: r.desc,
        price: r.price,
        changePct: r.changePct,
        totalScore: r.totalScore,
        bonusDetail: r.bonusDetail,
        grade: r.grade,
        confidence: r.totalScore >= 12 ? 'HIGH' : r.totalScore >= 10 ? 'MED' : 'LOW',
        reason: r.reason,
    };
}

module.exports = {
    computeRecommendationScore,
    generateRecommendations,
    RECOMMENDATION_POOL,
};
