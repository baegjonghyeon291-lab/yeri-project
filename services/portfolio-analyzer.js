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
    { min: 75, badge: '상승 우세', emoji: '📈', action: '추가매수 참고' },
    { min: 55, badge: '보통',     emoji: '➡️', action: '보유' },
    { min: 40, badge: '주의',     emoji: '⚠️', action: '관망' },
    { min: 25, badge: '경고',     emoji: '🚨', action: '비중축소 검토' },
    { min: -100, badge: '리스크 높음', emoji: '💀', action: '즉각 점검' },
];

const STRATEGY_TEMPLATES = {
    '상승 우세': [
        '추세가 강하게 유지되고 있어 눌림목에서 분할 추가매수를 검토해볼 만합니다.',
        '실적/수급/기술적 흐름이 모두 양호합니다. 긍정적 관점을 유지하세요.',
    ],
    '보통': [
        '뚜렷한 방향성 없이 횡보 중입니다. 무리한 매수보다는 관망이 유리합니다.',
        '중립 구간에 머물러 있습니다. 주요 지지/저항선 돌파 여부를 지켜보세요.',
    ],
    '주의': [
        '단기 모멘텀이 꺾이면서 약세 신호가 포착되었습니다. 비중 확대는 피하세요.',
        '변동성이 커지며 추세가 둔화되고 있습니다. 보수적 접근이 필요합니다.',
    ],
    '경고': [
        '단기 하락 추세가 뚜렷합니다. 추가 하락에 대비해 비중 축소를 검토해 보세요.',
        '주요 지표들이 부정적입니다. 추가 매수보다는 리스크 관리에 집중하는 것이 좋습니다.',
    ],
    '리스크 높음': [
        '하락 가속화 구간입니다. 포트폴리오 비중 점검과 리스크 대응을 권장합니다.',
        '대부분의 지표가 심각한 약세를 가리킵니다. 손절매 등 보수적 대응 기준을 점검해 보세요.',
    ]
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
    let overall = totalWeight > 0 ? Math.round(totalScore / totalWeight) : null;

    // [손익 기반 페널티] 보유 종목이 크게 물려있다면 펀더멘탈/기수가 좋아도 고위험/주의로 강등
    const currentPriceForPenalty = safeNum(stockData.price?.current);
    if (overall != null && currentPriceForPenalty != null && holding.avgPrice > 0) {
        const pnlPct = ((currentPriceForPenalty / holding.avgPrice) - 1) * 100;
        if (pnlPct <= -30) {
            overall -= 30; // -30% 이상 손실이면 매우 강한 페널티
        } else if (pnlPct <= -15) {
            overall -= 15;
        }
        if (overall < 0) overall = 0;
    }

    // 상태 배지
    let badgeInfo = BADGE_MAP[BADGE_MAP.length - 1]; // default: 리스크 높음
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

    // 보유 손익 반영 기민한 문구 수정
    let profitNote = '';
    const currentPrice = safeNum(stockData.price?.current);
    if (currentPrice != null && holding.avgPrice > 0) {
        const pnlPct = ((currentPrice / holding.avgPrice) - 1) * 100;
        
        if (pnlPct > 20 && (badgeInfo.badge === '주의' || badgeInfo.badge === '경고' || badgeInfo.badge === '리스크 높음')) {
            // 큰 수익 중인데 상태가 악화되는 경우
            strategy = '단기 하락/추세 훼손 신호가 발생했습니다. 수익이 큰 상태이므로 일부 이익 실현(수익 보호)을 우선적으로 검토하는 것이 유리할 수 있습니다.';
            profitNote = '';
        } else {
            if (pnlPct > 30 && badgeInfo.badge !== '경고' && badgeInfo.badge !== '리스크 높음') {
                profitNote = ' (수익률이 높아 수익 실현 전략도 고려 가능)';
            } else if (pnlPct < -15 && (badgeInfo.badge === '경고' || badgeInfo.badge === '리스크 높음')) {
                profitNote = ' (손실 확대 방지를 위한 보수적 대응 권장)';
            }
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
        .map(h => ({ ticker: h.ticker, name: h.name, score: h.status.overall, badge: h.status.badge, reason: h.status?.reasons?.length > 0 ? h.status.reasons.join(", ") : "종합 평가 지표 하락" }));

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

/** 포트폴리오 비중 분석 */
function analyzeAllocation(holdings, totalValue) {
    if (!totalValue || holdings.length === 0) return null;
    let overConcentrated = [];
    let allocations = holdings.map(h => {
        const value = h.currentValue || (h.quantity * (h.currentPrice || h.avgPrice));
        const weight = (value / totalValue) * 100;
        if (weight >= 30) overConcentrated.push({ ticker: h.ticker, weight });
        return { ticker: h.ticker, weight: Number(weight.toFixed(1)) };
    });
    return {
        overConcentrated,
        details: allocations.sort((a,b) => b.weight - a.weight)
    };
}

/** 포트폴리오 건강도 점수 */
function calculateHealthScore(holdingsWithStatus, allocations, summary) {
    if (holdingsWithStatus.length === 0) return { score: 0, label: '데이터 없음', strengths: [], weaknesses: [] };
    
    let totalScore = 0;
    // 종합 점수의 평균
    const overallScores = holdingsWithStatus.map(h => h.status?.overall).filter(s => s != null);
    const avgOverall = overallScores.length ? overallScores.reduce((a,b)=>a+b,0) / overallScores.length : 50;
    
    totalScore += avgOverall * 0.5; // 종목 상태 50%
    
    // 분산도 (최대 비중 종목이 너무 크면 페널티)
    let maxWeight = 0;
    if (allocations?.details?.length > 0) {
        maxWeight = allocations.details[0].weight;
    }
    const diversityScore = Math.max(0, 100 - (maxWeight > 30 ? (maxWeight - 30) * 2 : 0));
    totalScore += diversityScore * 0.3; // 분산도 30%
    
    // 이익 상태 (손익 상태)
    const profitCount = holdingsWithStatus.filter(h => (h.profitLoss || 0) > 0).length;
    const profitScore = (profitCount / holdingsWithStatus.length) * 100;
    totalScore += profitScore * 0.2; // 수익 종목 비율 20%
    
    const score = Math.round(totalScore);
    let label = '위험';
    if (score >= 80) label = '우수';
    else if (score >= 60) label = '양호';
    else if (score >= 40) label = '보통';
    else if (score >= 20) label = '주의';

    const strengths = [];
    const weaknesses = [];

    if (profitScore >= 70) strengths.push('수익성 양호');
    if (diversityScore >= 80) strengths.push('분산 투자 우수');
    if (avgOverall >= 70) strengths.push('종목 모멘텀/추세 긍정적');

    if (maxWeight >= 40) weaknesses.push('특정 종목 과집중');
    if (summary.warningCount > 0) weaknesses.push(`경고 종목 ${summary.warningCount}개 존재`);
    if (profitScore <= 30) weaknesses.push('손실 종목 과다');

    return { score, label, strengths, weaknesses };
}

/** 자동 리밸런싱 제안 */
function calculateRebalancing(allocations, health, summary) {
    const suggestions = [];
    if (allocations?.overConcentrated?.length > 0) {
        const t = allocations.overConcentrated.map(a => a.ticker).join(', ');
        suggestions.push(`🔴 [리스크 관리] ${t}의 비중이 30%를 초과해 특정 종목 하락 시 전체 타격이 큽니다. 일부 익절/손절을 통한 비중 축소를 검토하세요.`);
    }
    if (summary.warningCount >= 1 || summary.riskTop3?.length > 0) {
        const t = summary.riskTop3?.map(r=>r.ticker).join(', ') || '보유하신 위험 종목';
        suggestions.push(`🔴 [비중 축소] ${t} 등은 단기 하락 추세나 펀더멘탈 악화가 우려되므로 추가 매수보다 비중을 줄여 리스크를 낮추세요.`);
    }
    if (summary.strongTop3?.length > 0) {
        const t = summary.strongTop3?.map(s=>s.ticker).join(', ');
        suggestions.push(`🟢 [추가 매수] ${t} 등 상승 우세 종목은 현재 모멘텀과 실적 지표가 양호하므로 눌림목 발생 시 비중을 늘려보는 것을 참고하세요.`);
    }
    if (health.score < 50 && summary.strongTop3?.length === 0) {
        suggestions.push(`⚠️ [관망 유지] 포트폴리오 전반의 모멘텀이 약합니다. 확실한 반등 신호가 나오기 전까지는 신규 매수를 자제하고 현금을 확보하세요.`);
    }
    if (suggestions.length === 0) {
        suggestions.push(`✅ [현행 유지] 펀더멘탈과 수익 상태가 양호합니다. 현재의 비중을 유지하며 시장 흐름에 편승하세요.`);
    }
    return suggestions;
}

/** 일일 브리핑/한줄 요약 위젯 데이터 추가 */
function buildDailyBriefing(summary, health, holdings) {
    // 총 손익 정보
    const totalInvested = holdings.reduce((sum, h) => sum + (h.investedAmount || 0), 0);
    const totalValue = holdings.reduce((sum, h) => sum + (h.currentValue || h.investedAmount || 0), 0);
    const profitLossPct = totalInvested > 0 ? ((totalValue / totalInvested) - 1) * 100 : 0;
    const plClass = profitLossPct >= 0 ? '+' : '';

    const strongTicker = summary.strongTop3[0]?.ticker || '-';
    const riskTicker = summary.riskTop3[0]?.ticker || '-';
    
    // 단순화된 한줄 결론
    let oneLiner = '';
    if (health.score >= 70) oneLiner = `수익 구간을 즐기되, ${riskTicker} 등은 리스크 점검이 필요합니다.`;
    else if (health.score >= 40) oneLiner = `시장 방향성 탐색 구간입니다. 비중 관리에 신경쓰세요.`;
    else oneLiner = `포트폴리오 변동성이 큽니다. 보수적인 리밸런싱이 필요해 보입니다.`;

    const widget = `오늘 상태: ${health.label} | 손익 ${plClass}${profitLossPct.toFixed(1)}% | 리스크 체크: ${riskTicker}`;

    return {
        text: `[ 일일 포트폴리오 브리핑 ]\n- 종합 상태: ${health.label} (가중 평균 ${health.score}점)\n- 총 평가손익: ${plClass}${profitLossPct.toFixed(1)}%\n- 오늘 가장 강세인 종목: ${strongTicker}\n- 단기 추세 약화/점검 요망 종목: ${riskTicker !== '-' ? `${riskTicker} (${summary.riskTop3[0]?.reason})` : '-'}\n- 한줄 결론: ${oneLiner}`,
        widget,
        oneLiner
    };
}

module.exports = { analyzeHolding, buildPortfolioSummary, analyzeAllocation, calculateHealthScore, calculateRebalancing, buildDailyBriefing };
