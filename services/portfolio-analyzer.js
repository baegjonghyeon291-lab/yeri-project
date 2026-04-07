/**
 * portfolio-analyzer.js
 * 보유종목별 7팩터 룰 기반 점수화 → 상태 배지 → 전략 문구 + 이유 자동 생성
 */

// ══════════════════════════════════════════════════════════
// 유틸리티
// ══════════════════════════════════════════════════════════
function safeNum(v) {
    if (v == null) return null;
    const n = Number(v);
    return isNaN(n) ? null : n;
}

function clamp(v, min = 0, max = 100) {
    return Math.max(min, Math.min(max, v));
}

// ══════════════════════════════════════════════════════════
// 7팩터 점수 산정 (각 0~100)
// ══════════════════════════════════════════════════════════

/** 1. 추세 (Trend) — 현재가 vs EMA20/50, EMA정렬 */
function scoreTrend(data) {
    const price = safeNum(data.price?.current);
    const ema20 = safeNum(data.technical?.ema20);
    const ema50 = safeNum(data.technical?.ema50);
    const reasons = [];
    let score = 50; // 기본 중립

    if (price == null) return { score: null, reasons: ['가격 데이터 없음'] };

    if (ema20 != null) {
        if (price > ema20) { score += 15; reasons.push('EMA20 상회'); }
        else { score -= 15; reasons.push('EMA20 하회'); }
    }
    if (ema50 != null) {
        if (price > ema50) { score += 10; reasons.push('EMA50 상회'); }
        else { score -= 10; reasons.push('EMA50 하회'); }
    }
    if (ema20 != null && ema50 != null) {
        if (ema20 > ema50) { score += 10; reasons.push('상승 정렬'); }
        else { score -= 10; reasons.push('하락 정렬'); }
    }

    const changePct = safeNum(data.price?.changePct);
    if (changePct != null) {
        if (changePct > 2) { score += 5; reasons.push(`전일비 +${changePct.toFixed(1)}%`); }
        else if (changePct < -2) { score -= 5; reasons.push(`전일비 ${changePct.toFixed(1)}%`); }
    }

    return { score: clamp(score), reasons };
}

/** 2. 모멘텀 (Momentum) — RSI, MACD */
function scoreMomentum(data) {
    const rsi = safeNum(data.technical?.rsi);
    const macdHist = safeNum(data.technical?.macd_hist);
    const reasons = [];
    let score = 50;

    if (rsi == null && macdHist == null) return { score: null, reasons: ['모멘텀 데이터 없음'] };

    if (rsi != null) {
        if (rsi >= 70) { score -= 15; reasons.push(`RSI ${rsi.toFixed(0)} 과매수`); }
        else if (rsi >= 60) { score += 5; reasons.push(`RSI ${rsi.toFixed(0)} 강세`); }
        else if (rsi <= 30) { score -= 10; reasons.push(`RSI ${rsi.toFixed(0)} 과매도`); }
        else if (rsi <= 40) { score -= 5; reasons.push(`RSI ${rsi.toFixed(0)} 약세`); }
        else { score += 0; reasons.push(`RSI ${rsi.toFixed(0)} 중립`); }
    }
    if (macdHist != null) {
        if (macdHist > 0) { score += 10; reasons.push('MACD 양수'); }
        else { score -= 10; reasons.push('MACD 음수'); }
    }

    return { score: clamp(score), reasons };
}

/** 3. 재무건전성 (Financial Health) — D/E, ROE, FCF */
function scoreFinancial(data) {
    const f = data.fundamentals || {};
    const de = safeNum(f.debtToEquity);
    const roe = safeNum(f.roe);
    const fcf = safeNum(f.freeCashFlow);
    const reasons = [];
    let score = 50;
    let hasData = false;

    if (de != null) {
        hasData = true;
        if (de < 50) { score += 15; reasons.push(`D/E ${de.toFixed(0)}% 안정`); }
        else if (de < 100) { score += 5; reasons.push(`D/E ${de.toFixed(0)}% 적정`); }
        else if (de < 200) { score -= 5; reasons.push(`D/E ${de.toFixed(0)}% 부담`); }
        else { score -= 15; reasons.push(`D/E ${de.toFixed(0)}% 위험`); }
    }
    if (roe != null) {
        hasData = true;
        const roePct = roe > 1 ? roe : roe * 100; // handle both 0.15 and 15 formats
        if (roePct > 20) { score += 10; reasons.push(`ROE ${roePct.toFixed(1)}% 우수`); }
        else if (roePct > 10) { score += 5; reasons.push(`ROE ${roePct.toFixed(1)}% 양호`); }
        else if (roePct > 0) { score -= 0; reasons.push(`ROE ${roePct.toFixed(1)}%`); }
        else { score -= 10; reasons.push(`ROE ${roePct.toFixed(1)}% 적자`); }
    }
    if (fcf != null) {
        hasData = true;
        if (fcf > 0) { score += 5; reasons.push('FCF 양수'); }
        else { score -= 10; reasons.push('FCF 음수'); }
    }

    if (!hasData) return { score: null, reasons: ['재무 데이터 없음'] };
    return { score: clamp(score), reasons };
}

/** 4. 밸류에이션 (Valuation) — PER, PBR */
function scoreValuation(data) {
    const f = data.fundamentals || {};
    const per = safeNum(f.peRatio ?? f.pe);
    const pbr = safeNum(f.pbRatio);
    const reasons = [];
    let score = 50;
    let hasData = false;

    if (per != null) {
        hasData = true;
        if (per < 0) { score -= 10; reasons.push('PER 적자'); }
        else if (per < 15) { score += 15; reasons.push(`PER ${per.toFixed(1)} 저평가`); }
        else if (per < 25) { score += 5; reasons.push(`PER ${per.toFixed(1)} 적정`); }
        else if (per < 40) { score -= 5; reasons.push(`PER ${per.toFixed(1)} 부담`); }
        else { score -= 15; reasons.push(`PER ${per.toFixed(1)} 고평가`); }
    }
    if (pbr != null) {
        hasData = true;
        if (pbr < 1) { score += 10; reasons.push(`PBR ${pbr.toFixed(1)} 저평가`); }
        else if (pbr < 3) { score += 0; }
        else { score -= 10; reasons.push(`PBR ${pbr.toFixed(1)} 부담`); }
    }

    if (!hasData) return { score: null, reasons: ['밸류 데이터 없음'] };
    return { score: clamp(score), reasons };
}

/** 5. 뉴스심리 (Sentiment) — 뉴스 긍정/부정 키워드 */
function scoreSentiment(data) {
    const news = data.news || [];
    if (!news.length) return { score: null, reasons: ['뉴스 데이터 없음'] };

    const posKw = ['beat', 'surge', 'soar', 'upgrade', 'bullish', 'record', 'growth', 'strong', 'raise', 'positive', 'outperform', 'buy', '호재', '상승', '호실적', '강세'];
    const negKw = ['miss', 'drop', 'fall', 'downgrade', 'bearish', 'weak', 'cut', 'negative', 'risk', 'decline', 'sell', 'warning', 'layoff', '악재', '하락', '적자', '약세', '리스크'];

    let posCount = 0, negCount = 0;
    for (const n of news.slice(0, 8)) {
        const text = `${n.title || ''} ${n.description || ''}`.toLowerCase();
        if (posKw.some(k => text.includes(k))) posCount++;
        if (negKw.some(k => text.includes(k))) negCount++;
    }

    const reasons = [];
    let score = 50;
    if (posCount > negCount + 1) { score += 20; reasons.push(`뉴스 긍정(${posCount}건 vs 부정${negCount}건)`); }
    else if (posCount > negCount) { score += 10; reasons.push(`뉴스 소폭 긍정`); }
    else if (negCount > posCount + 1) { score -= 20; reasons.push(`뉴스 부정(부정${negCount}건 vs 긍정${posCount}건)`); }
    else if (negCount > posCount) { score -= 10; reasons.push(`뉴스 소폭 부정`); }
    else { reasons.push('뉴스 혼재'); }

    return { score: clamp(score), reasons };
}

/** 6. 변동성/리스크 (Volatility) — 전일비, 52주 고저 대비 위치 */
function scoreVolatility(data) {
    const changePct = safeNum(data.price?.changePct);
    const high52 = safeNum(data.fundamentals?.['52WeekHigh']);
    const low52 = safeNum(data.fundamentals?.['52WeekLow']);
    const price = safeNum(data.price?.current);
    const reasons = [];
    let score = 60; // 낮은 변동성이 좋으므로 기본 60
    let hasData = false;

    if (changePct != null) {
        hasData = true;
        const abs = Math.abs(changePct);
        if (abs > 5) { score -= 20; reasons.push(`변동성 높음(${changePct > 0 ? '+' : ''}${changePct.toFixed(1)}%)`); }
        else if (abs > 3) { score -= 10; reasons.push(`변동성 보통`); }
        else { reasons.push('변동성 낮음'); }
    }

    if (price != null && high52 != null && low52 != null && high52 > low52) {
        hasData = true;
        const position = (price - low52) / (high52 - low52); // 0=52주 저점, 1=52주 고점
        if (position > 0.9) { score -= 10; reasons.push('52주 고점 근접'); }
        else if (position < 0.2) { score -= 5; reasons.push('52주 저점 근접'); }
    }

    if (!hasData) return { score: null, reasons: ['변동성 데이터 없음'] };
    return { score: clamp(score), reasons };
}

/** 7. 데이터 신뢰도 (Reliability) — 확보된 데이터 항목 수 */
function scoreReliability(data) {
    const checks = [
        data.price?.current != null,
        data.price?.changePct != null,
        data.technical?.rsi != null,
        data.technical?.ema20 != null,
        data.technical?.ema50 != null,
        data.fundamentals?.peRatio != null || data.fundamentals?.pe != null,
        data.fundamentals?.roe != null,
        data.fundamentals?.debtToEquity != null,
        data.fundamentals?.freeCashFlow != null,
        (data.news || []).length > 0,
    ];
    const confirmed = checks.filter(Boolean).length;
    const total = checks.length;
    const score = Math.round((confirmed / total) * 100);
    const reasons = [`데이터 ${confirmed}/${total}개 확보`];
    if (score < 40) reasons.push('데이터 부족 — 판단 신뢰도 낮음');
    return { score: clamp(score), reasons };
}

// ══════════════════════════════════════════════════════════
// 종합 분석: 7팩터 → 상태 배지 → 전략 문구 → 이유
// ══════════════════════════════════════════════════════════

const BADGE_MAP = [
    { min: 70, badge: '상승우세', emoji: '📈', action: '추가매수 참고' },
    { min: 50, badge: '보통',     emoji: '➡️', action: '보유' },
    { min: 30, badge: '주의',     emoji: '⚠️', action: '관망' },
    { min: 0,  badge: '경고',     emoji: '🚨', action: '비중축소 검토' },
];

const STRATEGY_TEMPLATES = {
    '상승우세': [
        '추세가 유지되고 있어 조정 시 분할 추가매수 검토가 가능합니다.',
        '실적/뉴스/기술 흐름이 양호해 보유 유지 또는 추가 접근을 고려할 수 있습니다.',
        '현재 데이터 기준 상승 우세 흐름이라 눌림목 구간에서 추가매수 참고가 가능합니다.',
    ],
    '보통': [
        '뚜렷한 방향성 없이 횡보 중이므로 추가 신호 확인 후 대응이 권장됩니다.',
        '추세는 유지되지만 추가매수는 눌림목 확인 후 접근이 바람직합니다.',
        '현재 중립 구간이므로 보유 유지하며 추세 변화를 지켜보는 것이 좋겠습니다.',
    ],
    '주의': [
        '단기 모멘텀이 약화되고 있어 추가매수보다 관망이 유리할 수 있습니다.',
        '일부 지표에서 약세 신호가 포착되어 비중 점검이 필요해 보입니다.',
        '현재 데이터 기준 하락 가능성이 높아 보여 관망 또는 일부 정리가 유리할 수 있습니다.',
    ],
    '경고': [
        '단기 하락 추세가 이어지고 있어 비중 축소 또는 매도 검토가 필요합니다.',
        'EMA 하회와 약한 모멘텀, 부정적 흐름으로 하락 리스크가 커 보입니다.',
        '복수 지표에서 약세 신호가 감지되어 즉시 포트폴리오 점검을 권장합니다.',
    ],
};

/**
 * analyzeHolding(stockData, holding)
 * @param stockData — fetchAllStockData() 결과
 * @param holding   — { ticker, name, quantity, avgPrice, ... }
 * @returns { scores, overall, badge, emoji, action, strategy, reasons }
 */
function analyzeHolding(stockData, holding) {
    const trend      = scoreTrend(stockData);
    const momentum   = scoreMomentum(stockData);
    const financial  = scoreFinancial(stockData);
    const valuation  = scoreValuation(stockData);
    const sentiment  = scoreSentiment(stockData);
    const volatility = scoreVolatility(stockData);
    const reliability = scoreReliability(stockData);

    const factors = { trend, momentum, financial, valuation, sentiment, volatility, reliability };
    const scores = {
        trend: trend.score,
        momentum: momentum.score,
        financial: financial.score,
        valuation: valuation.score,
        sentiment: sentiment.score,
        volatility: volatility.score,
        reliability: reliability.score,
    };

    // 종합 점수 (null 제외 가중 평균, reliability 가중치 낮게)
    const weights = { trend: 2, momentum: 1.5, financial: 1, valuation: 1, sentiment: 1.5, volatility: 1, reliability: 0.5 };
    let totalWeight = 0, totalScore = 0;
    for (const [key, weight] of Object.entries(weights)) {
        if (scores[key] != null) {
            totalScore += scores[key] * weight;
            totalWeight += weight;
        }
    }
    const overall = totalWeight > 0 ? Math.round(totalScore / totalWeight) : null;

    // 상태 배지
    let badgeInfo = BADGE_MAP[BADGE_MAP.length - 1]; // default: 경고
    if (overall != null) {
        for (const b of BADGE_MAP) {
            if (overall >= b.min) { badgeInfo = b; break; }
        }
    }

    // 핵심 이유 추출 — 영향력 높은 팩터의 이유를 모아서 정렬
    const allReasons = [];
    for (const [key, factor] of Object.entries(factors)) {
        if (key === 'reliability') continue; // 신뢰도는 이유에서 제외
        for (const r of factor.reasons) {
            if (r.includes('데이터 없음') || r === '변동성 낮음' || r === '뉴스 혼재') continue;
            allReasons.push(r);
        }
    }
    // 상위 3개 이유 (부정적 → 긍정적 순)
    const reasons = allReasons.slice(0, 3);

    // 전략 문구 선택
    const templates = STRATEGY_TEMPLATES[badgeInfo.badge] || STRATEGY_TEMPLATES['보통'];
    const strategy = templates[Math.floor(Math.random() * templates.length)];

    // 보유 손익 반영 추가 문구
    let profitNote = '';
    const currentPrice = safeNum(stockData.price?.current);
    if (currentPrice != null && holding.avgPrice > 0) {
        const pnlPct = ((currentPrice / holding.avgPrice) - 1) * 100;
        if (pnlPct > 30 && badgeInfo.badge !== '경고') {
            profitNote = ' 수익률이 높아 일부 익절도 검토 가능합니다.';
        } else if (pnlPct < -15 && badgeInfo.badge === '경고') {
            profitNote = ' 손실 확대 방지를 위한 손절 기준 설정을 권장합니다.';
        }
    }

    return {
        scores,
        overall,
        badge: badgeInfo.badge,
        emoji: badgeInfo.emoji,
        action: badgeInfo.action,
        strategy: strategy + profitNote,
        reasons,
    };
}

/**
 * buildPortfolioSummary(holdingsWithStatus)
 * 포트폴리오 전체 요약 생성
 */
function buildPortfolioSummary(holdingsWithStatus) {
    const summary = {
        bullishCount: 0,
        normalCount: 0,
        cautionCount: 0,
        warningCount: 0,
        riskTop3: [],
        strongTop3: [],
        needCheckTop3: [],
    };

    const sorted = [...holdingsWithStatus].sort((a, b) => (a.status?.overall ?? 50) - (b.status?.overall ?? 50));

    for (const h of holdingsWithStatus) {
        const badge = h.status?.badge;
        if (badge === '상승우세') summary.bullishCount++;
        else if (badge === '보통') summary.normalCount++;
        else if (badge === '주의') summary.cautionCount++;
        else if (badge === '경고') summary.warningCount++;
    }

    // 리스크 TOP3 (점수 낮은 순)
    summary.riskTop3 = sorted.slice(0, 3)
        .filter(h => h.status?.overall != null && h.status.overall < 50)
        .map(h => ({ ticker: h.ticker, name: h.name, score: h.status.overall, badge: h.status.badge }));

    // 강세 TOP3 (점수 높은 순)
    summary.strongTop3 = sorted.reverse().slice(0, 3)
        .filter(h => h.status?.overall != null && h.status.overall >= 50)
        .map(h => ({ ticker: h.ticker, name: h.name, score: h.status.overall, badge: h.status.badge }));

    // 점검 필요 (주의 + 경고)
    summary.needCheckTop3 = holdingsWithStatus
        .filter(h => h.status?.badge === '주의' || h.status?.badge === '경고')
        .slice(0, 3)
        .map(h => ({ ticker: h.ticker, name: h.name, badge: h.status.badge, reason: (h.status.reasons || [])[0] || '' }));

    return summary;
}

module.exports = { analyzeHolding, buildPortfolioSummary };
