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
// HARD FILTER — 하나라도 해당하면 NOT_RECOMMENDED
// ──────────────────────────────────────────────────────────
function applyHardFilters(data, score) {
    const reasons = [];
    const { technical, fundamentals, price } = data;
    const reliability = computeDataReliability(data);

    // 1) 데이터 신뢰도 < 40%
    if (reliability.pct < 40) {
        reasons.push('데이터 신뢰도 극히 낮음 (' + reliability.pct + '%)');
    }

    // 2) RSI > 75 (극단적 과열)
    if (technical?.rsi != null && technical.rsi > 75) {
        reasons.push(`RSI ${technical.rsi.toFixed(1)} → 극단적 과열`);
    }

    // 3) ROE < -20% (심각한 자본 훼손)
    const roe = fundamentals?.roe ? parseFloat(fundamentals.roe) : null;
    if (roe != null && roe < -20) {
        reasons.push(`ROE ${roe.toFixed(1)}% → 심각한 자본 훼손`);
    }

    // 4) FCF 심각한 음수 (FCF < -revenue * 0.3)
    const fcf = fundamentals?.freeCashFlow;
    const revenue = fundamentals?.revenue;
    if (fcf != null && revenue != null && revenue > 0 && fcf < -(revenue * 0.3)) {
        reasons.push('FCF 심각한 적자 (매출 대비 -30% 이상)');
    }

    // 5) 52주 고점 대비 -60% 이상 붕괴
    const current = price?.current;
    const high52 = price?.fifty2High;
    if (current != null && high52 != null && high52 > 0) {
        const dropPct = ((current - high52) / high52) * 100;
        if (dropPct < -60) {
            reasons.push(`52주 고점 대비 ${dropPct.toFixed(0)}% 붕괴`);
        }
    }

    // 6) 매출 성장률 < -30%
    const growth = fundamentals?.revenueGrowthYoY ? parseFloat(fundamentals.revenueGrowthYoY) : null;
    if (growth != null && growth < -30) {
        reasons.push(`매출 역성장 ${growth.toFixed(1)}%`);
    }

    return {
        rejected: reasons.length > 0,
        reasons,
    };
}

// ──────────────────────────────────────────────────────────
// BONUS SCORE — 추천 보조 점수 (0~10)
// ──────────────────────────────────────────────────────────
function computeBonusScore(data) {
    const { technical, price, news } = data;
    const reliability = computeDataReliability(data);
    const detail = [];
    let total = 0;

    // 1) EMA20 위치 (0~2)
    const current = price?.current;
    const ema20 = technical?.ema20;
    if (current != null && ema20 != null && ema20 > 0) {
        const ratio = current / ema20;
        if (ratio >= 1.0) {
            total += 2; detail.push('EMA20 위 유지 (2/2)');
        } else if (ratio >= 0.97) {
            total += 1; detail.push('EMA20 근접 (1/2)');
        } else {
            detail.push('EMA20 하회 (0/2)');
        }
    } else {
        detail.push('EMA20: 데이터 없음');
    }

    // 2) 52주 위치 (0~2)
    const high52 = price?.fifty2High;
    const low52 = price?.fifty2Low;
    if (current != null && high52 != null && low52 != null && high52 > low52) {
        const range = high52 - low52;
        const position = (current - low52) / range; // 0=저점, 1=고점
        if (position >= 0.2 && position <= 0.65) {
            total += 2; detail.push(`52주 위치 ${(position * 100).toFixed(0)}% → 적정 구간 (2/2)`);
        } else if (position > 0.65 && position <= 0.85) {
            total += 1; detail.push(`52주 위치 ${(position * 100).toFixed(0)}% → 고점 근접 (1/2)`);
        } else if (position < 0.2) {
            total += 1; detail.push(`52주 위치 ${(position * 100).toFixed(0)}% → 저점 근접 (1/2)`);
        } else {
            detail.push(`52주 위치 ${(position * 100).toFixed(0)}% → 신고가 구간 (0/2)`);
        }
    } else {
        detail.push('52주 범위: 데이터 없음');
    }

    // 3) 뉴스 감성 (0~2) — 간이 키워드 분석
    const newsItems = news || [];
    if (newsItems.length > 0) {
        const negKeywords = ['crash', 'plunge', 'fraud', 'lawsuit', 'downgrade', 'loss', 'decline', 'fall', 'warn', 'risk', 'miss', 'cut', 'layoff', '하락', '급락', '소송', '적자', '위기'];
        const posKeywords = ['surge', 'beat', 'record', 'growth', 'upgrade', 'raise', 'strong', 'profit', 'gain', 'rally', '상승', '신고가', '성장', '흑자'];
        let pos = 0, neg = 0;
        newsItems.forEach(n => {
            const title = (n.title || '').toLowerCase();
            if (posKeywords.some(k => title.includes(k))) pos++;
            if (negKeywords.some(k => title.includes(k))) neg++;
        });
        if (pos > neg + 1) {
            total += 2; detail.push(`뉴스 긍정 우세 (${pos}긍정/${neg}부정) (2/2)`);
        } else if (neg > pos + 1) {
            detail.push(`뉴스 부정 우세 (${pos}긍정/${neg}부정) (0/2)`);
        } else {
            total += 1; detail.push(`뉴스 중립 (${pos}긍정/${neg}부정) (1/2)`);
        }
    } else {
        total += 1; detail.push('뉴스 데이터 없음 → 중립 처리 (1/2)');
    }

    // 4) 거래량 (0~2) — volume vs avgVolume
    const volume = price?.volume;
    const avgVolume = price?.avgVolume;
    if (volume != null && avgVolume != null && avgVolume > 0) {
        const volRatio = volume / avgVolume;
        if (volRatio >= 0.7) {
            total += 2; detail.push(`거래량 정상 (${(volRatio * 100).toFixed(0)}%) (2/2)`);
        } else if (volRatio >= 0.3) {
            total += 1; detail.push(`거래량 약간 부족 (${(volRatio * 100).toFixed(0)}%) (1/2)`);
        } else {
            detail.push(`거래량 극히 부족 (${(volRatio * 100).toFixed(0)}%) (0/2)`);
        }
    } else {
        total += 1; detail.push('거래량 데이터 없음 → 중립 (1/2)');
    }

    // 5) 데이터 신뢰도 (0~2)
    if (reliability.pct >= 80) {
        total += 2; detail.push(`데이터 신뢰도 ${reliability.pct}% (2/2)`);
    } else if (reliability.pct >= 50) {
        total += 1; detail.push(`데이터 신뢰도 ${reliability.pct}% (1/2)`);
    } else {
        detail.push(`데이터 신뢰도 ${reliability.pct}% (0/2)`);
    }

    return { total, detail };
}

// ──────────────────────────────────────────────────────────
// COMPUTE RECOMMENDATION SCORE — 단일 종목 종합 추천 평가
// ──────────────────────────────────────────────────────────
function computeRecommendationScore(data) {
    const base = computeScore(data);
    const bonus = computeBonusScore(data);
    const hard = applyHardFilters(data, base);

    const baseScore = base.normalized ?? 0;
    const bonusScore = bonus.total;
    const totalScore = baseScore + bonusScore;

    // 등급 결정
    let grade;
    if (hard.rejected) {
        grade = 'NOT_RECOMMENDED';
    } else if (totalScore >= 14) {
        grade = 'STRONG_PICK';
    } else if (totalScore >= 9) {
        grade = 'WATCHLIST';
    } else {
        grade = 'NOT_RECOMMENDED';
    }

    // 이유 자동 생성 (데이터 기반 1~3줄)
    let reason;
    if (hard.rejected) {
        reason = hard.reasons.join(', ');
    } else {
        const positives = [];
        const negatives = [];
        if (base.rsiScore >= 1) positives.push('RSI 적정');
        if (base.roeScore >= 1) positives.push('ROE 양호');
        if (base.fcfScore >= 1) positives.push('현금흐름 안정');
        if (base.growthScore >= 2) positives.push('고성장');
        if (base.perScore >= 1) positives.push('밸류에이션 적정');
        if (base.rsiScore === 0 && base.rsiScore !== null) negatives.push('RSI 과열');
        if (base.growthScore === 0 && base.growthScore !== null) negatives.push('역성장');
        if (base.fcfScore === 0 && base.fcfScore !== null) negatives.push('FCF 음수');

        if (positives.length > 0 && negatives.length > 0) {
            reason = `${positives.join(', ')} / 주의: ${negatives.join(', ')}`;
        } else if (positives.length > 0) {
            reason = positives.join(', ');
        } else if (negatives.length > 0) {
            reason = `주의: ${negatives.join(', ')}`;
        } else {
            reason = '데이터 기반 종합 평가';
        }
    }

    return {
        baseScore, bonusScore, totalScore, grade, reason,
        hardReject: hard.rejected,
        rejectReasons: hard.reasons,
        baseDetail: base.detail,
        bonusDetail: bonus.detail,
        verdict: base.verdict,
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

    // 등급별 분류 + 정렬
    const strongPicks = results
        .filter(r => r.grade === 'STRONG_PICK')
        .sort((a, b) => b.totalScore - a.totalScore)
        .slice(0, 3);

    const watchlist = results
        .filter(r => r.grade === 'WATCHLIST')
        .sort((a, b) => b.totalScore - a.totalScore)
        .slice(0, 5);

    const excluded = results
        .filter(r => r.grade === 'NOT_RECOMMENDED' && r.hardReject)
        .sort((a, b) => a.totalScore - b.totalScore)
        .slice(0, 5);

    const output = {
        strongPicks: strongPicks.map(formatResult),
        watchlist: watchlist.map(formatResult),
        excluded: excluded.map(r => ({
            ticker: r.ticker,
            name: r.name,
            desc: r.desc,
            reason: r.reason,
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
    console.log(`[RecEngine] 스캔 완료: ${strongPicks.length} STRONG + ${watchlist.length} WATCH + ${excluded.length} EXCLUDED (${output.meta.elapsedMs}ms)`);

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
        baseScore: r.baseScore,
        bonusScore: r.bonusScore,
        grade: r.grade,
        confidence: r.totalScore >= 16 ? 'HIGH' : r.totalScore >= 12 ? 'MED' : 'LOW',
        reason: r.reason,
        verdict: r.verdict,
    };
}

module.exports = {
    computeRecommendationScore,
    generateRecommendations,
    RECOMMENDATION_POOL,
};
