/**
 * analyzer.js — 100% 데이터 기반 점수 시스템
 * GPT 추론 완전 제거, API 데이터 기반 계산만 사용
 * GPT는 classifyQuery() + fallbackChat()에서만 사용
 */
const client = require('./openai-client');

// ──────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────
function fmt(val, prefix = '', suffix = '', fallback = '데이터 없음') {
    return val != null ? `${prefix}${val}${suffix}` : fallback;
}

function fmtPrice(val, currency = '$') {
    if (val == null) return '데이터 없음';
    return `${currency}${parseFloat(val).toLocaleString()}`;
}

function fmtLargeNum(val, currency = '$') {
    if (val == null) return '데이터 없음';
    const abs = Math.abs(val);
    if (abs >= 1e12) return `${currency}${(val / 1e12).toFixed(2)}T`;
    if (abs >= 1e9)  return `${currency}${(val / 1e9).toFixed(2)}B`;
    if (abs >= 1e6)  return `${currency}${(val / 1e6).toFixed(1)}M`;
    return `${currency}${val.toLocaleString()}`;
}

function fmtPct(val) {
    if (val == null) return '데이터 없음';
    return (Number(val) >= 0 ? '+' : '') + Number(val).toFixed(2) + '%';
}

// ──────────────────────────────────────────────────────────
// 뉴스 필터링 및 감성 분류 (기존 유지)
// ──────────────────────────────────────────────────────────
function filterAndAnalyzeNews(news, ticker, companyName) {
    if (!news?.length) return { positive: [], negative: [], neutral: [], filtered: [], total: 0 };

    const positiveKw = ['beat', 'surge', 'record', 'growth', 'buy', 'upgrade', 'bullish',
        'raises', 'expand', 'profit', 'boost', 'gains', 'rally', 'breakthrough', 'partner',
        '급등', '호실적', '매수', '상향', '성장', '흑자', '계약', '수주', '개선', '돌파'];
    const negativeKw = ['miss', 'fall', 'drop', 'downgrade', 'sell', 'bearish', 'layoff',
        'lawsuit', 'tariff', 'penalty', 'warn', 'loss', 'decline', 'cut', 'delay', 'recall',
        '급락', '어닝쇼크', '매도', '하향', '적자', '규제', '소송', '해고', '부진', '하락'];

    const tickerBase = ticker.replace('.KS', '').replace('.KQ', '').toLowerCase();
    const nameTokens = (companyName || '').toLowerCase().split(/\s+/).filter(t => t.length > 2);
    const relevantKw = [tickerBase, ...nameTokens];

    const relevant = news.filter(n => {
        const text = `${n.title || ''} ${n.description || ''}`.toLowerCase();
        return relevantKw.some(kw => text.includes(kw)) || news.length <= 3;
    });
    const pool = relevant.length > 0 ? relevant : news;

    const positive = [], negative = [], neutral = [];
    for (const n of pool.slice(0, 8)) {
        const text = `${n.title || ''} ${n.description || ''}`.toLowerCase();
        const posCount = positiveKw.filter(k => text.includes(k)).length;
        const negCount = negativeKw.filter(k => text.includes(k)).length;
        const item = { date: n.publishedAt || '날짜없음', title: n.title || '', source: n.source || 'Unknown', url: n.url || '' };
        if (posCount > negCount) positive.push(item);
        else if (negCount > posCount) negative.push(item);
        else neutral.push(item);
    }
    return { positive, negative, neutral, filtered: pool, total: pool.length };
}

// ══════════════════════════════════════════════════════════
// 데이터 기반 점수 계산 엔진 (0~10점)
// RSI: 0-2 | PER: 0-2 | ROE: 0-2 | 매출성장률: 0-2 | FCF: 0-2
// ══════════════════════════════════════════════════════════
function computeScore(data) {
    const { technical, fundamentals } = data;
    const detail = [];

    // ── 1. RSI 점수 (0~2) ──
    let rsiScore = null;
    const rsi = technical?.rsi;
    if (rsi != null) {
        if (rsi < 30) { rsiScore = 2; detail.push(`RSI: ${rsi.toFixed(1)} → 과매도 구간 (2/2점)`); }
        else if (rsi <= 50) { rsiScore = 1; detail.push(`RSI: ${rsi.toFixed(1)} → 중립~저평가 (1/2점)`); }
        else if (rsi <= 70) { rsiScore = 1; detail.push(`RSI: ${rsi.toFixed(1)} → 중립 (1/2점)`); }
        else { rsiScore = 0; detail.push(`RSI: ${rsi.toFixed(1)} → 과매수 구간 (0/2점)`); }
    } else {
        rsiScore = null;
        detail.push(`RSI: 데이터 없음`);
    }

    // ── 2. PER 점수 (0~2) ──
    let perScore = null;
    const pe = fundamentals?.peRatio ? parseFloat(fundamentals.peRatio) : null;
    if (pe != null) {
        if (pe < 0) { perScore = 0; detail.push(`PER: ${pe.toFixed(1)} → 적자 (0/2점)`); }
        else if (pe < 15) { perScore = 2; detail.push(`PER: ${pe.toFixed(1)} → 저평가 (2/2점)`); }
        else if (pe <= 30) { perScore = 1; detail.push(`PER: ${pe.toFixed(1)} → 적정 (1/2점)`); }
        else { perScore = 0; detail.push(`PER: ${pe.toFixed(1)} → 고평가 (0/2점)`); }
    } else {
        perScore = null;
        detail.push(`PER: 데이터 없음`);
    }

    // ── 3. ROE 점수 (0~2) ──
    let roeScore = null;
    const roe = fundamentals?.roe ? parseFloat(fundamentals.roe) : null;
    if (roe != null) {
        if (roe > 20) { roeScore = 2; detail.push(`ROE: ${roe.toFixed(1)}% → 우수 (2/2점)`); }
        else if (roe >= 5) { roeScore = 1; detail.push(`ROE: ${roe.toFixed(1)}% → 보통 (1/2점)`); }
        else { roeScore = 0; detail.push(`ROE: ${roe.toFixed(1)}% → 저조 (0/2점)`); }
    } else {
        roeScore = null;
        detail.push(`ROE: 데이터 없음`);
    }

    // ── 4. 매출 성장률 점수 (0~2) ──
    let growthScore = null;
    const growth = fundamentals?.revenueGrowthYoY ? parseFloat(fundamentals.revenueGrowthYoY) : null;
    if (growth != null) {
        if (growth > 20) { growthScore = 2; detail.push(`매출성장: ${growth.toFixed(1)}% → 고성장 (2/2점)`); }
        else if (growth >= 0) { growthScore = 1; detail.push(`매출성장: ${growth.toFixed(1)}% → 안정 (1/2점)`); }
        else { growthScore = 0; detail.push(`매출성장: ${growth.toFixed(1)}% → 역성장 (0/2점)`); }
    } else {
        growthScore = null;
        detail.push(`매출성장: 데이터 없음`);
    }

    // ── 5. FCF 점수 (0~2) ──
    let fcfScore = null;
    const fcf = fundamentals?.freeCashFlow;
    const revenue = fundamentals?.revenue;
    if (fcf != null) {
        const fcfMargin = revenue ? (fcf / revenue * 100) : null;
        if (fcf > 0 && fcfMargin && fcfMargin > 10) { fcfScore = 2; detail.push(`FCF: ${fmtLargeNum(fcf)} (마진 ${fcfMargin.toFixed(1)}%) → 우수 (2/2점)`); }
        else if (fcf > 0) { fcfScore = 1; detail.push(`FCF: ${fmtLargeNum(fcf)} → 양수 (1/2점)`); }
        else { fcfScore = 0; detail.push(`FCF: ${fmtLargeNum(fcf)} → 음수 (0/2점)`); }
    } else {
        fcfScore = null;
        detail.push(`FCF: 데이터 없음`);
    }

    // ── 총점 계산 (데이터 있는 항목만 합산) ──
    const scores = [rsiScore, perScore, roeScore, growthScore, fcfScore];
    const validScores = scores.filter(s => s !== null);
    const total = validScores.reduce((a, b) => a + b, 0);
    const maxPossible = validScores.length * 2;
    const dataCount = validScores.length;
    const missingCount = 5 - dataCount;

    // 10점 만점 환산 (유효 데이터 비율 반영)
    const normalized = maxPossible > 0 ? Math.round((total / maxPossible) * 10) : null;

    // ── 결론 자동 생성 ──
    let verdict, action;
    if (normalized === null) {
        verdict = '⚠️ 판단 불가';
        action = '데이터 부족으로 판단할 수 없습니다.';
    } else if (normalized >= 6) {
        verdict = '✅ 매수 고려';
        action = '데이터 기반 긍정 신호가 우세합니다. 분할 접근을 고려할 수 있습니다.';
    } else if (normalized >= 3) {
        verdict = '⚖️ 관망';
        action = '긍정과 부정 신호가 혼재합니다. 추가 데이터 확인 후 판단하세요.';
    } else {
        verdict = '🔴 리스크 높음';
        action = '부정적 신호가 우세합니다. 신규 진입은 보수적으로 접근하세요.';
    }

    return {
        rsiScore, perScore, roeScore, growthScore, fcfScore,
        total, maxPossible, normalized, dataCount, missingCount,
        verdict, action, detail
    };
}

// ══════════════════════════════════════════════════════════
// 데이터 기반 리포트 생성 (GPT 호출 없음)
// ══════════════════════════════════════════════════════════
function generateDataReport(data, mode = 'full') {
    if (!data.price || data.price.current == null) {
        return `⚠️ **분석 중단**\n종목 가격 데이터를 확보하지 못해 분석이 불가능합니다.`;
    }
    const score = computeScore(data);
    const today = new Date().toLocaleDateString('ko-KR');
    const currency = (data.ticker || '').endsWith('.KS') ? '₩' : '$';
    const name = data.companyName || data.ticker;
    const ticker = data.ticker;
    const f = data.fundamentals || {};
    const t = data.technical || {};
    const p = data.price || {};
    const newsAn = filterAndAnalyzeNews(data.news, ticker, name);

    const lines = [];

    // ━━━━━━ 결론 ━━━━━━
    lines.push(`📊 **${name} (${ticker}) 데이터 분석 리포트**`);
    lines.push(`기준일: ${today}\n`);
    lines.push(`━━━━━━━━━━━━━━━━━━━━━━`);
    lines.push(`📌 **결론: ${score.verdict}** (${score.normalized !== null ? score.normalized + '/10점' : '판단 불가'})`);
    lines.push(`${score.action}`);
    if (score.missingCount > 0) {
        lines.push(`⚠️ ${score.missingCount}개 항목 데이터 없음 → 해당 항목 제외 후 ${score.dataCount}개 기준 계산`);
    }

    // ━━━━━━ 점수 상세 ━━━━━━
    lines.push(`\n━━━━━━━━━━━━━━━━━━━━━━`);
    lines.push(`📋 **점수 상세** (${score.total}/${score.maxPossible} → 환산 ${score.normalized !== null ? score.normalized + '/10' : 'N/A'})`);
    for (const d of score.detail) {
        lines.push(`  • ${d}`);
    }

    // ━━━━━━ 데이터 요약 ━━━━━━
    lines.push(`\n━━━━━━━━━━━━━━━━━━━━━━`);
    lines.push(`💹 **데이터 요약**\n`);

    // 가격
    lines.push(`**현재가:** ${p.current != null ? fmtPrice(p.current, currency) : '데이터 없음'}`);
    lines.push(`**전일비:** ${p.changePct != null ? fmtPct(p.changePct) : '데이터 없음'}`);
    if (p.fifty2High != null) {
        lines.push(`**52주:** 고 ${fmtPrice(p.fifty2High, currency)} / 저 ${fmtPrice(p.fifty2Low, currency)}`);
        if (p.current != null) {
            const pctOf52 = ((p.current - p.fifty2Low) / (p.fifty2High - p.fifty2Low) * 100).toFixed(0);
            lines.push(`**52주 내 위치:** ${pctOf52}% (0%=최저점, 100%=최고점)`);
        }
    }
    const h = data.history || {};
    if (h.change1W != null || h.change1M != null) {
        lines.push(`**기간별 변동:** 1주 ${h.change1W != null ? h.change1W + '%' : 'N/A'} | 1개월 ${h.change1M != null ? h.change1M + '%' : 'N/A'}`);
    }

    // 기술적 지표
    lines.push('');
    lines.push(`**RSI(14):** ${t.rsi != null ? t.rsi.toFixed(1) + ' (' + (t.rsiSignal || '') + ')' : '데이터 없음'}`);
    lines.push(`**MACD:** ${t.macd ? `${t.macd.macd} (Signal: ${t.macd.signal}, Hist: ${t.macd.hist} → ${t.macd.trend})` : '데이터 없음'}`);
    lines.push(`**EMA20:** ${t.ema20 != null ? fmtPrice(t.ema20, currency) : '데이터 없음'} | **EMA50:** ${t.ema50 != null ? fmtPrice(t.ema50, currency) : '데이터 없음'}`);
    lines.push(`**SMA200:** ${t.sma200 != null ? fmtPrice(t.sma200, currency) : '데이터 없음'}`);
    if (data.supportResist) {
        lines.push(`**지지선:** ${fmtPrice(data.supportResist.support, currency)} | **저항선:** ${fmtPrice(data.supportResist.resistance, currency)}`);
    }

    // 재무
    lines.push('');
    lines.push(`**PER:** ${f.peRatio != null ? f.peRatio : '데이터 없음'} | **선행PER:** ${f.forwardPE != null ? f.forwardPE : '데이터 없음'}`);
    lines.push(`**EPS:** ${f.eps != null ? f.eps : '데이터 없음'} | **PBR:** ${f.pbRatio != null ? f.pbRatio : '데이터 없음'}`);
    lines.push(`**ROE:** ${f.roe != null ? f.roe : '데이터 없음'} | **D/E:** ${f.debtToEquity != null ? f.debtToEquity : '데이터 없음'}`);
    lines.push(`**매출:** ${f.revenue != null ? fmtLargeNum(f.revenue, currency) : '데이터 없음'} | **순이익:** ${f.netIncome != null ? fmtLargeNum(f.netIncome, currency) : '데이터 없음'}`);
    lines.push(`**영업이익:** ${f.operatingIncome != null ? fmtLargeNum(f.operatingIncome, currency) : '데이터 없음'}`);
    lines.push(`**FCF:** ${f.freeCashFlow != null ? fmtLargeNum(f.freeCashFlow, currency) : '데이터 없음'}`);
    lines.push(`**매출성장(YoY):** ${f.revenueGrowthYoY != null ? f.revenueGrowthYoY : '데이터 없음'}`);
    lines.push(`**순이익률:** ${f.netMargin != null ? f.netMargin : '데이터 없음'}`);
    if (f.mktCap) lines.push(`**시가총액:** ${fmtLargeNum(f.mktCap, currency)}`);
    if (f.nextEarningsDate) lines.push(`**다음 실적 발표:** ${f.nextEarningsDate}`);

    // 애널리스트
    if (data.analystRatings?.consensus?.targetMean) {
        const c = data.analystRatings.consensus;
        lines.push(`\n**기관 평균 목표가:** ${fmtPrice(parseFloat(c.targetMean).toFixed(2), currency)} (고: ${fmtPrice(c.targetHigh, currency)} / 저: ${fmtPrice(c.targetLow, currency)}) | 컨센서스: ${c.rating || '데이터 없음'}`);
    }

    // ━━━━━━ 해석 (데이터 기반만) ━━━━━━
    lines.push(`\n━━━━━━━━━━━━━━━━━━━━━━`);
    lines.push(`📝 **해석 (데이터 기반)**\n`);

    // 가격 위치 해석
    if (p.current != null && data.supportResist) {
        const sup = data.supportResist.support;
        const res = data.supportResist.resistance;
        if (p.current < sup) lines.push(`• 현재가(${fmtPrice(p.current, currency)})가 지지선(${fmtPrice(sup, currency)}) 아래 → 지지선 이탈 상태`);
        else if (p.current > res) lines.push(`• 현재가(${fmtPrice(p.current, currency)})가 저항선(${fmtPrice(res, currency)}) 위 → 저항 돌파 상태`);
        else lines.push(`• 현재가(${fmtPrice(p.current, currency)})가 지지(${fmtPrice(sup, currency)})~저항(${fmtPrice(res, currency)}) 사이 → 박스권`);
    }

    // EMA 위치 해석
    if (p.current != null && t.ema20 != null) {
        if (p.current > parseFloat(t.ema20)) lines.push(`• 현재가가 EMA20(${fmtPrice(t.ema20, currency)}) 위 → 단기 상승 추세`);
        else lines.push(`• 현재가가 EMA20(${fmtPrice(t.ema20, currency)}) 아래 → 단기 하락 추세`);
    }
    if (p.current != null && t.sma200 != null) {
        if (p.current > parseFloat(t.sma200)) lines.push(`• 현재가가 SMA200(${fmtPrice(t.sma200, currency)}) 위 → 장기 상승 추세`);
        else lines.push(`• 현재가가 SMA200(${fmtPrice(t.sma200, currency)}) 아래 → 장기 하락 추세`);
    }

    // RSI 해석
    if (t.rsi != null) {
        if (t.rsi < 30) lines.push(`• RSI ${t.rsi.toFixed(1)} → 과매도 구간, 반등 가능성 존재`);
        else if (t.rsi > 70) lines.push(`• RSI ${t.rsi.toFixed(1)} → 과매수 구간, 조정 가능성 존재`);
        else lines.push(`• RSI ${t.rsi.toFixed(1)} → 중립 구간`);
    }

    // 재무 해석
    if (f.peRatio != null) {
        const pe = parseFloat(f.peRatio);
        if (pe < 0) lines.push(`• PER ${pe.toFixed(1)} → 현재 적자 상태`);
        else if (pe < 15) lines.push(`• PER ${pe.toFixed(1)} → 저평가 구간`);
        else if (pe > 40) lines.push(`• PER ${pe.toFixed(1)} → 고평가 구간`);
        else lines.push(`• PER ${pe.toFixed(1)} → 적정 밸류에이션`);
    }
    if (f.netIncome != null && f.netIncome < 0) {
        lines.push(`• 순이익 적자: ${fmtLargeNum(f.netIncome, currency)} → 수익성 확보 필요`);
    }
    if (f.freeCashFlow != null && f.freeCashFlow < 0) {
        lines.push(`• FCF 음수: ${fmtLargeNum(f.freeCashFlow, currency)} → 현금 유출 상태`);
    }

    // 뉴스 해석
    if (newsAn.total > 0) {
        lines.push(`• 뉴스 ${newsAn.total}건 (긍정 ${newsAn.positive.length} / 부정 ${newsAn.negative.length} / 중립 ${newsAn.neutral.length})`);
        if (newsAn.positive.length > 0) lines.push(`  🟢 ${newsAn.positive[0].title.slice(0, 60)}`);
        if (newsAn.negative.length > 0) lines.push(`  🔴 ${newsAn.negative[0].title.slice(0, 60)}`);
    } else {
        lines.push(`• 뉴스: 데이터 없음`);
    }

    // ━━━━━━ 리스크 ━━━━━━
    lines.push(`\n━━━━━━━━━━━━━━━━━━━━━━`);
    lines.push(`⚠️ **리스크 (데이터 기반)**\n`);

    const risks = [];
    if (t.rsi != null && t.rsi > 70) risks.push(`RSI ${t.rsi.toFixed(1)} 과매수 → 단기 조정 위험`);
    if (f.peRatio != null && parseFloat(f.peRatio) > 40) risks.push(`PER ${parseFloat(f.peRatio).toFixed(1)} 고평가 → 밸류에이션 부담`);
    if (f.peRatio != null && parseFloat(f.peRatio) < 0) risks.push(`PER 적자 → 수익성 훼손 리스크`);
    if (f.debtToEquity != null && parseFloat(f.debtToEquity) > 150) risks.push(`D/E ${f.debtToEquity} → 부채 비율 높음`);
    if (f.freeCashFlow != null && f.freeCashFlow < 0) risks.push(`FCF 음수 → 현금 유출 지속 시 유동성 리스크`);
    if (f.netMargin != null && parseFloat(f.netMargin) < 0) risks.push(`순이익률 적자 → 수익 구조 불안정`);
    if (f.revenueGrowthYoY != null && parseFloat(f.revenueGrowthYoY) < 0) risks.push(`매출 역성장 (${f.revenueGrowthYoY}) → 성장 둔화`);
    if (p.current != null && data.supportResist?.support && p.current < data.supportResist.support) risks.push(`지지선(${fmtPrice(data.supportResist.support, currency)}) 이탈 → 추가 하락 가능`);
    if (newsAn.negative.length >= 2) risks.push(`부정 뉴스 ${newsAn.negative.length}건 → 단기 악재 집중`);

    if (risks.length === 0) risks.push(`현재 데이터 기준 특이 리스크 미감지`);
    for (const r of risks) lines.push(`• ${r}`);

    // ━━━━━━ 행동 제안 (mode별) ━━━━━━
    if (mode === 'full' || mode === 'buy') {
        lines.push(`\n━━━━━━━━━━━━━━━━━━━━━━`);
        lines.push(`👉 **행동 제안**\n`);

        if (score.normalized !== null && score.normalized >= 6) {
            if (p.current != null && data.supportResist) {
                lines.push(`• 신규 진입: ${fmtPrice(data.supportResist.support, currency)} 부근 1차 분할 진입 고려`);
                lines.push(`• 손절: ${fmtPrice(data.supportResist.support * 0.95, currency)} 이탈 시`);
                lines.push(`• 목표: ${fmtPrice(data.supportResist.resistance, currency)} 부근`);
            } else {
                lines.push(`• 분할 매수 고려 (구체적 지지/저항 데이터 없음)`);
            }
        } else if (score.normalized !== null && score.normalized >= 3) {
            lines.push(`• 신규 진입: 추가 데이터 확인 전 관망 권장`);
            if (t.ema20 != null) lines.push(`• 트리거: EMA20(${fmtPrice(t.ema20, currency)}) 회복 후 재평가`);
            if (data.supportResist) lines.push(`• 주시: 지지선 ${fmtPrice(data.supportResist.support, currency)} 유지 여부`);
        } else {
            lines.push(`• 신규 진입: 데이터 기반 부정 신호 우세, 진입 보류 권장`);
            lines.push(`• 보유자: 손절 기준 재점검 권장`);
        }
    }

    if (mode === 'sell') {
        lines.push(`\n━━━━━━━━━━━━━━━━━━━━━━`);
        lines.push(`👉 **매도 전략**\n`);
        if (p.current != null && data.supportResist) {
            const r = data.supportResist.resistance;
            const s = data.supportResist.support;
            lines.push(`• 1차 목표가: ${fmtPrice(r, currency)} (저항선 부근)`);
            if (p.fifty2High) lines.push(`• 2차 목표가: ${fmtPrice(p.fifty2High, currency)} (52주 고점)`);
            lines.push(`• 손절선: ${fmtPrice(s * 0.95, currency)} 이탈 시`);
        }
        if (t.rsi != null && t.rsi > 65) lines.push(`• RSI ${t.rsi.toFixed(1)} → 과매수 접근, 일부 익절 고려`);
    }

    // ━━━━━━ 데이터 출처 및 신뢰도 ━━━━━━
    lines.push(`\n━━━━━━━━━━━━━━━━━━━━━━`);
    lines.push(`📡 **데이터 신뢰도 및 출처**`);
    if (data.metadata) {
        lines.push(`• **신뢰도: ${data.metadata.confidence}**`);
        if (data.metadata?.reason) {
            lines.push(`• **계산 근거:** ${data.metadata.reason}`);
        }
        lines.push(`• 데이터 출처:`);
        lines.push(`  - 가격: ${data.metadata.sources.price}`);
        lines.push(`  - 기술지표: ${data.metadata.sources.technical}`);
        lines.push(`  - 재무: ${data.metadata.sources.fundamentals}`);
        lines.push(`  - 뉴스/거시: ${data.metadata.sources.news} / ${data.metadata.sources.macro}`);
    } else {
        lines.push(`• 출처: 가격(${p.source || '없음'}) | 재무(${f.source || '없음'})`);
    }

    return lines.join('\n');
}

// ══════════════════════════════════════════════════════════
// GPT 기반 개별 종목 분석 (AnalyzeStock 시리즈)
// ══════════════════════════════════════════════════════════

// ══════════════════════════════════════════════════════════
// [신규] 1. 정규화 데이터 객체 생성 — normalizeData()
// 각 지표를 { value, source, period, asOfDate } 형태로 통합
// 없는 값은 절대 추론하지 않고 null 유지
// ══════════════════════════════════════════════════════════
function normalizeData(data) {
    const p = data.price || {};
    const f = data.fundamentals || {};
    const t = data.technical || {};
    const pSource = p.source || null;
    const fSource = f.source || null;
    const tSource = t.source || null;

    const n = (value, source, period = null, asOfDate = null) => ({
        value: (value != null && !isNaN(value)) ? value : null,
        source: source || null,
        period: period || null,   // API가 제공하지 않으면 null 그대로
        asOfDate: asOfDate || null // API가 제공하지 않으면 null 그대로
    });

    return {
        price:        n(p.current, pSource),
        changePct:    n(p.changePct, pSource),
        open:         n(p.open, pSource),
        high:         n(p.high, pSource),
        low:          n(p.low, pSource),
        prevClose:    n(p.prevClose, pSource),
        volume:       n(p.volume, pSource),
        fifty2High:   n(p.fifty2High, pSource),
        fifty2Low:    n(p.fifty2Low, pSource),
        per:          n(f.peRatio ? parseFloat(f.peRatio) : null, fSource),
        forwardPE:    n(f.forwardPE ? parseFloat(f.forwardPE) : null, fSource),
        eps:          n(f.eps ? parseFloat(f.eps) : null, fSource),
        pbr:          n(f.pbRatio ? parseFloat(f.pbRatio) : null, fSource),
        roe:          n(f.roe ? parseFloat(f.roe) : null, fSource),
        de:           n(f.debtToEquity ? parseFloat(f.debtToEquity) : null, fSource),
        fcf:          n(f.freeCashFlow, fSource),
        revenue:      n(f.revenue, fSource),
        netIncome:    n(f.netIncome, fSource),
        netMargin:    n(f.netMargin ? parseFloat(f.netMargin) : null, fSource),
        revenueGrowth:n(f.revenueGrowthYoY ? parseFloat(f.revenueGrowthYoY) : null, fSource),
        mktCap:       n(f.mktCap, fSource),
        rsi:          n(t.rsi, tSource),
        ema20:        n(t.ema20 ? parseFloat(t.ema20) : null, tSource),
        ema50:        n(t.ema50 ? parseFloat(t.ema50) : null, tSource),
        sma200:       n(t.sma200 ? parseFloat(t.sma200) : null, tSource),
        macd:         { value: t.macd || null, source: tSource, period: null, asOfDate: null },
    };
}

// ══════════════════════════════════════════════════════════
// [신규] 2. Validation 로직 — validateData()
// source 없는 값 제거 / null·NaN 체크 / 이상치 감지 / 다중소스 충돌
// ══════════════════════════════════════════════════════════
function validateData(normalized, data) {
    const warnings = [];
    const cleaned = {};

    for (const [key, entry] of Object.entries(normalized)) {
        // source 없는 값 제거
        if (!entry.source) {
            cleaned[key] = { ...entry, value: null, _removed: true };
            continue;
        }
        // null/NaN 체크
        if (key !== 'macd' && (entry.value === null || (typeof entry.value === 'number' && isNaN(entry.value)))) {
            cleaned[key] = { ...entry, value: null };
            continue;
        }
        // 이상치: changePct ±50% 초과
        if (key === 'changePct' && entry.value != null && Math.abs(entry.value) > 50) {
            warnings.push(`⚠️ ${key}: ${entry.value}% — 변동률 이상치 감지 (±50% 초과)`);
        }
        // 이상치: PER 음수 or >1000
        if (key === 'per' && entry.value != null && (entry.value > 1000 || entry.value < -1000)) {
            warnings.push(`⚠️ PER: ${entry.value} — 이상치 감지`);
        }
        cleaned[key] = entry;
    }

    // 기간 혼용 경고 (재무=연간/TTM vs 기술=일봉)
    const hasFundamental = ['per','eps','roe','de','fcf'].some(k => cleaned[k]?.value != null);
    const hasTechnical = ['rsi','ema20','ema50'].some(k => cleaned[k]?.value != null);
    if (hasFundamental && hasTechnical) {
        warnings.push('※ 재무 지표(연간/TTM 기준)와 기술 지표(일봉 기준)의 데이터 기간이 상이할 수 있습니다.');
    }

    return { cleaned, warnings };
}

// ══════════════════════════════════════════════════════════
// [신규] 3. 6대 부문 룰기반 점수 — computeScore6()
// 성장성 / 수익성 / 재무안정성 / 밸류에이션 / 모멘텀 / 뉴스심리
// 각 0~100점, 데이터 없으면 null (GPT 추정 불가)
// ══════════════════════════════════════════════════════════
function computeScore6(cleaned, newsAnalysis) {
    const s = (val) => val != null ? val : null;

    // ── 성장성 (매출성장률 기반) ──
    let growth = null;
    const gv = cleaned.revenueGrowth?.value;
    if (gv != null) {
        if (gv > 30) growth = 90;
        else if (gv > 20) growth = 75;
        else if (gv > 10) growth = 60;
        else if (gv > 0) growth = 45;
        else if (gv > -10) growth = 25;
        else growth = 10;
    }

    // ── 수익성 (ROE + 순이익률 기반) ──
    let profitability = null;
    const rv = cleaned.roe?.value;
    const nm = cleaned.netMargin?.value;
    if (rv != null || nm != null) {
        let score = 0, count = 0;
        if (rv != null) {
            if (rv > 20) score += 80; else if (rv > 10) score += 60; else if (rv > 0) score += 40; else score += 15;
            count++;
        }
        if (nm != null) {
            if (nm > 20) score += 85; else if (nm > 10) score += 65; else if (nm > 0) score += 40; else score += 10;
            count++;
        }
        profitability = Math.round(score / count);
    }

    // ── 재무안정성 (D/E + FCF 기반) ──
    let stability = null;
    const dev = cleaned.de?.value;
    const fcfv = cleaned.fcf?.value;
    if (dev != null || fcfv != null) {
        let score = 0, count = 0;
        if (dev != null) {
            if (dev < 30) score += 90; else if (dev < 60) score += 70; else if (dev < 100) score += 50; else if (dev < 150) score += 30; else score += 10;
            count++;
        }
        if (fcfv != null) {
            if (fcfv > 0) score += 70; else score += 15;
            count++;
        }
        stability = Math.round(score / count);
    }

    // ── 밸류에이션 (PER + PBR 기반) ──
    let valuation = null;
    const pev = cleaned.per?.value;
    const pbv = cleaned.pbr?.value;
    if (pev != null || pbv != null) {
        let score = 0, count = 0;
        if (pev != null) {
            if (pev < 0) score += 10; // 적자
            else if (pev < 12) score += 90;
            else if (pev < 20) score += 70;
            else if (pev < 35) score += 50;
            else if (pev < 60) score += 30;
            else score += 10;
            count++;
        }
        if (pbv != null) {
            if (pbv < 1) score += 85; else if (pbv < 3) score += 60; else if (pbv < 5) score += 40; else score += 15;
            count++;
        }
        valuation = Math.round(score / count);
    }

    // ── 모멘텀 (RSI 기반, 보조지표 한정) ──
    let momentum = null;
    const rsiv = cleaned.rsi?.value;
    if (rsiv != null) {
        if (rsiv < 25) momentum = 85; // 과매도 → 반등 가능성
        else if (rsiv < 40) momentum = 70;
        else if (rsiv < 60) momentum = 55;
        else if (rsiv < 75) momentum = 40;
        else momentum = 20; // 과매수
    }

    // ── 뉴스심리 (룰기반 분류 결과 활용) ──
    let newsSentiment = null;
    if (newsAnalysis && newsAnalysis.total > 0) {
        const pos = newsAnalysis.positive.length;
        const neg = newsAnalysis.negative.length;
        const total = newsAnalysis.total;
        const ratio = (pos - neg) / total; // -1 ~ +1
        newsSentiment = Math.round(50 + ratio * 40); // 10~90 범위
        newsSentiment = Math.max(10, Math.min(90, newsSentiment));
    }

    // ── 종합 (null 제외 평균) ──
    const all = [growth, profitability, stability, valuation, momentum, newsSentiment];
    const valid = all.filter(v => v !== null);
    const overall = valid.length > 0 ? Math.round(valid.reduce((a, b) => a + b, 0) / valid.length) : null;

    return { growth, profitability, stability, valuation, momentum, newsSentiment, overall };
}

// ══════════════════════════════════════════════════════════
// [신규] 4. 뉴스 룰기반 분류 — classifyNewsItems()
// type / strength / trust / duration
// ══════════════════════════════════════════════════════════
function classifyNewsItems(news) {
    if (!news?.length) return [];

    const typeKw = {
        '실적': ['earning', 'revenue', 'profit', 'eps', 'beat', 'miss', '실적', '매출', '영업이익'],
        '정책': ['regulation', 'policy', 'tariff', 'sanction', 'government', 'fed', '규제', '정책', '관세'],
        '수급': ['buy', 'sell', 'volume', 'flow', 'institutional', '매수', '매도', '수급', '외국인'],
        '업황': ['industry', 'sector', 'demand', 'supply', 'market share', '업황', '시장', '수요'],
        '이벤트': ['launch', 'merger', 'acquisition', 'patent', 'partnership', 'ipo', '출시', '인수', '특허', '합병'],
    };

    return news.slice(0, 8).map(n => {
        const text = `${n.title || ''} ${n.description || ''}`.toLowerCase();

        // type 분류
        let type = '기타';
        for (const [t, kws] of Object.entries(typeKw)) {
            if (kws.some(k => text.includes(k))) { type = t; break; }
        }

        // strength (키워드 밀도)
        const allKw = Object.values(typeKw).flat();
        const matchCount = allKw.filter(k => text.includes(k)).length;
        const strength = matchCount >= 3 ? '강' : matchCount >= 1 ? '중' : '약';

        // trust (source 기반)
        const src = (n.source || '').toLowerCase();
        const officialSrc = ['reuters', 'bloomberg', 'sec', 'wsj', 'cnbc', 'official', '공시', '금감원'];
        const trust = officialSrc.some(s => src.includes(s)) ? '공식발표' : '언론보도';

        // duration (키워드 기반 추정)
        const shortKw = ['today', 'intraday', 'flash', '속보', '단기'];
        const midKw = ['outlook', 'forecast', 'guidance', '전망', '중기', '성장'];
        const hasShort = shortKw.some(k => text.includes(k));
        const hasMid = midKw.some(k => text.includes(k));
        const duration = hasMid ? '중기(1개월+)' : hasShort ? '일시적' : '단기(1주)';

        return { title: n.title, source: n.source, type, strength, trust, duration };
    });
}

// ══════════════════════════════════════════════════════════
// [신규] 5. 검증된 컨텍스트 빌더 — buildVerifiedContext()
// raw → normalize → validate → score6 → classifyNews → 로그 출력
// ══════════════════════════════════════════════════════════
function buildVerifiedContext(data) {
    const normalized = normalizeData(data);
    const { cleaned, warnings } = validateData(normalized, data);
    const newsAn = filterAndAnalyzeNews(data.news, data.ticker, data.companyName);
    const score6 = computeScore6(cleaned, newsAn);
    const classifiedNews = classifyNewsItems(data.news);

    // ── 테스트 로그 출력 ──
    console.log(`\n[Analyzer/Verify] ═══ 정규화 데이터 ═══`);
    for (const [k, v] of Object.entries(cleaned)) {
        if (v.value != null) console.log(`  ${k}: ${typeof v.value === 'object' ? JSON.stringify(v.value) : v.value} (source: ${v.source})`);
    }
    console.log(`[Analyzer/Verify] ═══ Validation 결과 ═══`);
    if (warnings.length === 0) console.log('  ✅ 이상 없음');
    warnings.forEach(w => console.log(`  ${w}`));
    console.log(`[Analyzer/Verify] ═══ 6대 부문 점수 ═══`);
    console.log(`  성장성: ${score6.growth ?? 'N/A'} | 수익성: ${score6.profitability ?? 'N/A'} | 재무안정성: ${score6.stability ?? 'N/A'}`);
    console.log(`  밸류에이션: ${score6.valuation ?? 'N/A'} | 모멘텀: ${score6.momentum ?? 'N/A'} | 뉴스심리: ${score6.newsSentiment ?? 'N/A'}`);
    console.log(`  종합: ${score6.overall ?? 'N/A'}`);

    // ── LLM 컨텍스트 문자열 생성 ──
    const lines = [];
    lines.push(`[검증된 데이터 — source 없는 값은 제거됨]`);
    for (const [k, v] of Object.entries(cleaned)) {
        if (v._removed || v.value == null) continue;
        const val = typeof v.value === 'object' ? JSON.stringify(v.value) : v.value;
        lines.push(`${k}: ${val} (source: ${v.source})`);
    }
    if (warnings.length > 0) {
        lines.push(`\n[⚠️ Validation 경고]`);
        warnings.forEach(w => lines.push(w));
    }
    lines.push(`\n[6대 부문 룰기반 점수 (0~100)]`);
    lines.push(`성장성: ${score6.growth ?? '데이터 부족'}`);
    lines.push(`수익성: ${score6.profitability ?? '데이터 부족'}`);
    lines.push(`재무안정성: ${score6.stability ?? '데이터 부족'}`);
    lines.push(`밸류에이션: ${score6.valuation ?? '데이터 부족'}`);
    lines.push(`모멘텀: ${score6.momentum ?? '데이터 부족'} (보조지표 기반, 참고용)`);
    lines.push(`뉴스심리: ${score6.newsSentiment ?? '데이터 부족'}`);
    lines.push(`종합: ${score6.overall ?? '데이터 부족'}`);

    if (classifiedNews.length > 0) {
        lines.push(`\n[뉴스 룰기반 분류]`);
        classifiedNews.forEach(cn => {
            lines.push(`- [${cn.type}] ${cn.title} | 강도:${cn.strength} | 신뢰도:${cn.trust} | 지속성:${cn.duration}`);
        });
    }

    return lines.join('\n');
}

function buildContextForLLM(data) {
    const rawReport = generateDataReport(data, 'full');
    const verifiedContext = buildVerifiedContext(data);
    let newsContext = '';
    if (data.news && data.news.length > 0) {
        newsContext = '\n[📰 최신 뉴스 (최대 5건)]\n' + data.news.slice(0, 5).map(n => `- [${n.source}] ${n.title} (${n.publishedAt})`).join('\n');
    }
    return `<RawData>\n${rawReport}\n\n[검증 데이터 및 룰기반 점수]\n${verifiedContext}\n${newsContext}\n</RawData>`;
}

const STOCK_PROMPT_TEMPLATE = `당신은 최고 수준의 데이터 기반 투자 애널리스트 "예리"입니다.
제공된 <RawData>를 바탕으로 반드시 다음 마크다운 구조를 '정확히' 지켜서 분석 리포트를 작성하세요.

[🚨 핵심 규칙 — 반드시 준수]
1. 오직 <RawData> 수치만 사용. 없는 정보는 절대 추론/추정/생성 금지. "데이터 부족"으로 표시.
2. source 없는 수치는 출력 금지: <RawData>에 source가 명시된 수치만 사용 가능. source 필드가 없거나 "없음"인 항목은 결과에서 제외.
3. period(기준기간) 추론 금지: <RawData>에 period 정보가 없으면 "TTM", "연간", "분기" 등의 기준기간을 절대 추측하지 마세요. 표시하지 않거나 필요 시 "기준기간 미제공"으로만 처리.
4. asOfDate(기준일) 추론 금지: <RawData>에 날짜 정보가 없으면 날짜를 절대 만들어내지 마세요. 표시하지 않거나 필요 시 "기준일 미제공"으로만 처리.
5. 수치 인용 시 <RawData>에 실제 존재하는 필드만 표기. 예: "PER 25.3 (Finnhub)" — source만 있으므로 source만 괄호에 쓸 것.
6. 재무 지표와 기술 지표는 데이터 산출 기간이 서로 다를 수 있음 → 한 문장에 함께 쓸 때 "※ 데이터 기간이 상이할 수 있음" 단서 필수.
7. 팩트와 해석 분리: 숫자 하나로 단정 결론 금지. "PER 40 → 고평가"(X) → "PER 40으로 업종 평균 대비 높은 편이며, 고평가 가능성이 있음"(O)
8. RSI, MACD 등 기술지표는 보조지표로만 사용. 저평가/고평가 결론의 직접 근거로 연결 금지.
9. 핵심 지표가 2개 이상 소스에서 제공될 경우, 값 차이가 크면 "⚠️ 데이터 기준 차이 존재" 경고 표기.
10. 최종 문장은 확정형("~이다") 대신 확률형("~가능성이 높다", "~으로 판단된다") 표현 사용.
11. 점수는 <RawData>의 "점수 상세" 섹션 값을 그대로 인용. 직접 점수를 만들지 말 것.
12. 길이 제한: 간결하고 핵심만. 불필요한 인사말/부연 금지.

# 📊 [종목명] 분석 리포트

## 🎯 한줄 요약
(이 종목의 현재 상태를 확률형 표현으로 한 줄 요약)

## 📋 핵심 팩트 (해석 없이 수치만)
| 항목 | 값 | 출처(source) |
|------|------|------|
| 현재가 | (<RawData>의 값) | (<RawData>의 source) |
| 전일비 | (<RawData>의 값)% | (<RawData>의 source) |
| PER | (<RawData>의 값 또는 데이터 부족) | (<RawData>의 source) |
| EPS | (<RawData>의 값 또는 데이터 부족) | (<RawData>의 source) |
| ROE | (<RawData>의 값 또는 데이터 부족) | (<RawData>의 source) |
| D/E | (<RawData>의 값 또는 데이터 부족) | (<RawData>의 source) |
| FCF | (<RawData>의 값 또는 데이터 부족) | (<RawData>의 source) |
| RSI(14) | (<RawData>의 값 또는 데이터 부족) | (<RawData>의 source) |
⚠️ "출처" 칸은 반드시 <RawData>에 표기된 source 값만 사용. 없으면 비워두세요.
⚠️ 2개 이상 소스에서 같은 지표의 값이 다르면 "데이터 기준 차이 존재" 경고 표시

## 📈 상승 가능성 요인
1. [실적/재무] (근거 수치 + 출처 인용) — ⚠️ 제한: (이 해석의 한계점)
2. [뉴스/재료] (핵심 내용) — ⚠️ 제한: (뉴스 신뢰도/지속성 평가)
3. [차트/수급] (근거 수치 + 출처 인용, 보조지표임을 명시) — ⚠️ 제한: (기술지표의 한계)

## 📉 하락 리스크 요인
1. [실적/재무] (근거 수치 + 출처 인용) — ⚠️ 제한: (이 해석의 한계점)
2. [뉴스/재료] (핵심 악재) — ⚠️ 제한: (뉴스 신뢰도/지속성 평가)
3. [차트/수급] (근거 수치 + 출처 인용, 보조지표임을 명시) — ⚠️ 제한: (기술지표의 한계)

## 📰 뉴스 심리 분석
각 뉴스를 아래 4가지로 분류:
- **유형**: 실적/정책/수급/업황/이벤트
- **강도**: 강/중/약
- **신뢰도**: 공식발표/언론보도/루머
- **지속성**: 일시적/단기(1주)/중기(1개월+)
→ 종합 심리: (긍정/부정/중립) + 근거 1줄

## 💯 6대 부문 점수 (0~100점)
⚠️ <RawData>의 "점수 상세" 섹션에 계산된 값 기반으로 인용. 직접 만들지 마세요.
- 🚀 **성장성**: [점수]점 — 근거: (매출성장률, EPS 추이 등 <RawData> 인용)
- 💰 **수익성**: [점수]점 — 근거: (ROE, 순이익률 등 <RawData> 인용)
- 🛡️ **재무안정성**: [점수]점 — 근거: (D/E, FCF, 부채비율 등 <RawData> 인용)
- 📊 **밸류에이션**: [점수]점 — 근거: (PER, PBR 등 <RawData> 인용)
- 🏄 **모멘텀**: [점수]점 — 근거: (RSI, EMA 등 <RawData> 인용, 보조지표 한정)
- 📰 **뉴스심리**: [점수]점 — 근거: (뉴스 긍/부정 비율 등)
- 🏆 **종합**: [평균]점

## ⚠️ 해석 주의사항
- (서로 다른 기간 데이터가 섞인 경우 명시)
- (기술지표는 보조 참고용이며 투자 결정의 직접 근거가 아님)
- (데이터 부족 항목이 있는 경우 분석 정확도 제한 명시)

## 💡 종합 판단
- **🚀 한줄 액션**: (확률형 표현으로 작성)
- **🎯 핵심 액션**: [매수 고려 / 관망 권장 / 리스크 주의] 중 택 1 + 이유 1~2줄 (확률형)
- **⏱️ 진입 타이밍**: (확률형 가이드)
- **🔭 목표 관점**: 단기 (1주~1개월) / 중기 (3~6개월)
- **💡 동종 업계 관심 종목**: (같은 섹터 2~3개 + 한 줄 비교)

## 🔍 검증 상태
- **데이터 신뢰도**: [높음/중간/낮음] — (<RawData>의 신뢰도 값 인용)
- **분석 커버리지**: 확보 [N]개 / 미확보 [N]개 항목
- ⚠️ 본 분석은 API 기반 자동 생성이며, 투자 결정 전 반드시 전문가 상담 및 추가 검증을 권장합니다.
`;

async function analyzeStock(data, useDeep = false, tone = 'normal') {
    const prompt = `${STOCK_PROMPT_TEMPLATE}\n\n${buildContextForLLM(data)}`;
    return callOpenAI(prompt, useDeep, tone);
}

// 질문의 속성에 따라 최종 판단(추천 액션)의 뉘앙스를 강조해주되, 구조는 동일하게 유지
async function analyzeStockCasual(data, useDeep = false, tone = 'normal') {
    return analyzeStock(data, useDeep, tone);
}

async function analyzeStockBuyTiming(data, useDeep = false, tone = 'normal') {
    const prompt = `${STOCK_PROMPT_TEMPLATE}\n[💡 추가 지시] '💡 최종 투자 관점 및 판단' 셀에서 단기 매수 적절성(Buy Timing)과 목표가/손절가를 명확히 짚어주세요.\n\n${buildContextForLLM(data)}`;
    return callOpenAI(prompt, useDeep, tone);
}

async function analyzeStockSellTiming(data, useDeep = false, tone = 'normal') {
    const prompt = `${STOCK_PROMPT_TEMPLATE}\n[💡 추가 지시] '💡 최종 투자 관점 및 판단' 셀에서 매도 및 익절/손절(Sell Timing) 관점을 중점적으로 짚어주세요.\n\n${buildContextForLLM(data)}`;
    return callOpenAI(prompt, useDeep, tone);
}

async function analyzeStockRisk(data, useDeep = false, tone = 'normal') {
    const prompt = `${STOCK_PROMPT_TEMPLATE}\n[💡 추가 지시] '📉 하락 요인 및 리스크' 섹션을 가장 상세히 분석하세요.\n\n${buildContextForLLM(data)}`;
    return callOpenAI(prompt, useDeep, tone);
}

async function analyzeStockEarnings(data, useDeep = false, tone = 'normal') {
    const prompt = `${STOCK_PROMPT_TEMPLATE}\n[💡 추가 지시] 분석 시 최신 실적(EPS, 매출) 데이터의 퀄리티와 안정성 비중을 높여서 해석하세요.\n\n${buildContextForLLM(data)}`;
    return callOpenAI(prompt, useDeep, tone);
}

async function analyzeStockOverheat(data, useDeep = false, tone = 'normal') {
    const prompt = `${STOCK_PROMPT_TEMPLATE}\n[💡 추가 지시] 기술적 지표(RSI, 볼린저밴드 기준 과매수/과매도 등)에 집중하여 '현재 단기 고점(과열) 여부'를 강조하세요.\n\n${buildContextForLLM(data)}`;
    return callOpenAI(prompt, useDeep, tone);
}

async function analyzeStockValuation(data, useDeep = false, tone = 'normal') {
    const prompt = `${STOCK_PROMPT_TEMPLATE}\n[💡 추가 지시] 펀더멘털 측면의 밸류에이션(PER, PBR 등 고평가/저평가 여부)을 중심으로 종합판단을 내리세요.\n\n${buildContextForLLM(data)}`;
    return callOpenAI(prompt, useDeep, tone);
}

async function analyzeStockComparison(data1, data2, useDeep = false, tone = 'normal') {
    if (!data1.price?.current || !data2.price?.current) return `⚠️ **분석 중단**\n한쪽 종목 가격 데이터를 확보하지 못하여 비교할 수 없습니다.`;
    const today = new Date().toLocaleDateString('ko-KR');
    const score1 = computeScore(data1);
    const score2 = computeScore(data2);
    const nameA = data1.companyName || data1.ticker;
    const nameB = data2.companyName || data2.ticker;
    const cA = (data1.ticker || '').endsWith('.KS') ? '₩' : '$';
    const cB = (data2.ticker || '').endsWith('.KS') ? '₩' : '$';
    const f1 = data1.fundamentals || {};
    const f2 = data2.fundamentals || {};
    const t1 = data1.technical || {};
    const t2 = data2.technical || {};

    const lines = [];
    lines.push(`📊 **${nameA} vs ${nameB} 비교 분석**`);
    lines.push(`기준일: ${today}\n`);

    // 결론
    if (score1.normalized != null && score2.normalized != null) {
        const winner = score1.normalized > score2.normalized ? nameA : score2.normalized > score1.normalized ? nameB : '동률';
        lines.push(`📌 **결론:** ${winner === '동률' ? '두 종목 점수 동일' : `${winner}가 데이터 기준 우위`} (${nameA}: ${score1.normalized}/10 vs ${nameB}: ${score2.normalized}/10)\n`);
    }

    lines.push(`━━━━━━━━━━━━━━━━━━━━━━`);
    lines.push(`**가격:**`);
    lines.push(`• ${nameA}: ${data1.price?.current != null ? fmtPrice(data1.price.current, cA) : '데이터 없음'} (${data1.price?.changePct != null ? fmtPct(data1.price.changePct) : '데이터 없음'})`);
    lines.push(`• ${nameB}: ${data2.price?.current != null ? fmtPrice(data2.price.current, cB) : '데이터 없음'} (${data2.price?.changePct != null ? fmtPct(data2.price.changePct) : '데이터 없음'})\n`);

    lines.push(`**기술적 지표:**`);
    lines.push(`• ${nameA}: RSI ${t1.rsi != null ? t1.rsi.toFixed(1) : '데이터 없음'} | EMA20 ${t1.ema20 != null ? fmtPrice(t1.ema20, cA) : '데이터 없음'}`);
    lines.push(`• ${nameB}: RSI ${t2.rsi != null ? t2.rsi.toFixed(1) : '데이터 없음'} | EMA20 ${t2.ema20 != null ? fmtPrice(t2.ema20, cB) : '데이터 없음'}\n`);

    lines.push(`**재무:**`);
    lines.push(`• ${nameA}: PER ${f1.peRatio ?? '데이터 없음'} | ROE ${f1.roe ?? '데이터 없음'} | 매출성장 ${f1.revenueGrowthYoY ?? '데이터 없음'}`);
    lines.push(`• ${nameB}: PER ${f2.peRatio ?? '데이터 없음'} | ROE ${f2.roe ?? '데이터 없음'} | 매출성장 ${f2.revenueGrowthYoY ?? '데이터 없음'}\n`);

    lines.push(`**점수 비교:**`);
    lines.push(`• ${nameA}: ${score1.detail.join(' | ')}`);
    lines.push(`• ${nameB}: ${score2.detail.join(' | ')}`);

    lines.push(`\n━━━━━━━━━━━━━━━━━━━━━━`);
    lines.push(`📡 **데이터 신뢰도 및 출처**`);
    if (data1.metadata) {
        lines.push(`• **신뢰도:** [${nameA}] ${data1.metadata.confidence} | [${nameB}] ${data2.metadata.confidence}`);
        lines.push(`• **계산 근거:** [${nameA}] ${data1.metadata.reason} | [${nameB}] ${data2.metadata.reason}`);
        lines.push(`• **출처:** [${nameA}] 가격(${data1.metadata.sources.price})/재무(${data1.metadata.sources.fundamentals}) | [${nameB}] 가격(${data2.metadata.sources.price})/재무(${data2.metadata.sources.fundamentals})`);
    } else {
        lines.push(`• 출처: [${nameA}] 가격(${data1.price?.source || '없음'}) | [${nameB}] 가격(${data2.price?.source || '없음'})`);
    }
    return lines.join('\n');
}

// ══════════════════════════════════════════════════════════
// GPT 유지: Market, Sector, ETF, Portfolio, Recommendation
// (개별 종목 데이터가 아닌 시장 전체 해석이므로 GPT 유지)
// ══════════════════════════════════════════════════════════

async function callOpenAI(userContent, useDeepModel = false, tone = 'normal') {
    const MODEL_DEFAULT = process.env.OPENAI_MODEL_DEFAULT || 'gpt-4.1';
    const MODEL_DEEP    = process.env.OPENAI_MODEL_DEEP    || 'o3';
    const model = useDeepModel ? MODEL_DEEP : MODEL_DEFAULT;
    console.log(`[Analyzer] Model: ${model}, Tone: ${tone}`);
    try {
        const response = await client.responses.create({
            model,
            instructions: `당신은 "예리"라는 이름의 전문 AI 투자 비서입니다. 데이터 기반으로만 답변하세요. 추론이나 추측 금지.`,
            input: userContent,
            max_output_tokens: useDeepModel ? 4000 : 3000,
        });
        return response.output_text;
    } catch (err) {
        console.error(`❌ [callOpenAI] Failed! Model: ${model}, Status: ${err.status}, Message: ${err.message}`);
        throw err;
    }
}

// Market/Sector/ETF/Portfolio/Recommendation — GPT 유지 (시장 전체 분석)
async function analyzeMarket(data, useDeep = false, tone = 'normal') {
    const { indices, macro, news } = data;
    if (!indices || !macro || macro.vix == null) {
        return `⚠️ **브리핑 중단**\n거시 경제 데이터(FRED/Yahoo)를 가져오지 못해 시장 브리핑을 생성할 수 없습니다. 잠시 후 다시 시도해주세요.`;
    }
    const newsText = (news || []).slice(0, 6).map(n => `- [${n.publishedAt}] ${n.title}`).join('\n');
    const today = new Date().toLocaleDateString('ko-KR');
    const prompt = `시장 전체 분석. 데이터만 사용, 추론 금지.\n[기준일: ${today}]\nS&P500: ${indices?.['S&P 500']?.current || '확인불가'} (${indices?.['S&P 500']?.changePct?.toFixed(2) || '확인불가'}%)\nNASDAQ: ${indices?.['NASDAQ']?.current || '확인불가'} (${indices?.['NASDAQ']?.changePct?.toFixed(2) || '확인불가'}%)\n금리: ${macro?.federalFundsRate ?? '확인불가'}% | VIX: ${macro?.vix ?? '확인불가'}\n뉴스:\n${newsText || '없음'}\n\n간결하게 요약: 1) 시장 현황 2) 거시경제 영향 3) 리스크 4) 전략. '확인불가'로 나오는 지표는 브리핑에서 절대 언급하지 말고 제외할 것.`;
    return callOpenAI(prompt, useDeep, tone);
}

async function analyzeSector(sectorData, useDeep = false, tone = 'normal') {
    const { sector, stocks } = sectorData;
    const today = new Date().toLocaleDateString('ko-KR');
    const stockLines = stocks.map(s => {
        const sc = computeScore(s);
        return `${s.ticker}: 점수 ${sc.normalized}/10 | RSI ${s.technical?.rsi?.toFixed(1) || 'N/A'} | PER ${s.fundamentals?.peRatio || 'N/A'}`;
    }).join('\n');
    const prompt = `[${sector}] 섹터 분석. 데이터만 사용.\n[기준일: ${today}]\n${stockLines}\n\n간결 요약: 1) 섹터 현황 2) 대표 종목 점수 3) 리스크 4) 접근 전략`;
    return callOpenAI(prompt, useDeep, tone);
}

async function analyzeETF(data, useDeep = false, tone = 'normal', etfMeta = {}) {
    return generateDataReport(data, 'full');
}

async function analyzePortfolio(portfolioItems, useDeep = false, tone = 'normal') {
    const today = new Date().toLocaleDateString('ko-KR');
    const portfolioText = portfolioItems.map(p => {
        const pnlPct = p.avgPrice > 0 ? ((p.currentPrice / p.avgPrice - 1) * 100).toFixed(2) : '0';
        return `- ${p.name || p.ticker}: ${p.quantity}주 (평단 ${p.avgPrice} → 현재 ${p.currentPrice || 'N/A'}) | 비중 ${p.weight}% | 수익률 ${pnlPct}%`;
    }).join('\n');
    const prompt = `포트폴리오 분석. 데이터 기반만. 추론 금지.\n[기준일: ${today}]\n${portfolioText}\n\n간결 요약: 1) 전체 현황 2) 섹터 집중도 3) 리스크 4) 리밸런싱 제안`;
    return callOpenAI(prompt, useDeep, tone);
}

async function analyzeRecommendation(marketData, useDeep = false, tone = 'normal', userStyle = '스윙') {
    const { indices, macro, news } = marketData;
    const newsText = (news || []).slice(0, 5).map(n => `- [${n.publishedAt}] ${n.title}`).join('\n');
    const today = new Date().toLocaleDateString('ko-KR');
    const prompt = `종목 추천. 데이터 기반 엄격 필터. 추론 금지.\n[기준일: ${today}] [스타일: ${userStyle}]\n시장: ${JSON.stringify(indices || {})}\n거시: 금리 ${macro?.federalFundsRate || 'N/A'}% | VIX ${macro?.vix || 'N/A'}\n뉴스:\n${newsText}\n\nRSI 30-65, PER<40, 매출성장 양수인 종목만 추천. 없으면 "추천 종목 없음" 출력.`;
    return callOpenAI(prompt, useDeep, tone);
}

// ══════════════════════════════════════════════════════════
// FALLBACK CHAT + CLASSIFY — GPT 유지
// ══════════════════════════════════════════════════════════

async function fallbackChat(message, tone = 'normal') {
    const prompt = `사용자가 투자 비서 "예리"에게 보낸 일반 대화입니다.\n사용자 메시지: "${message}"\n짧게 2~4줄로 자연스럽게 답변하세요. 투자 분석은 하지 마세요.`;
    return callOpenAI(prompt, false, tone);
}

async function classifyQuery(message) {
    const response = await client.responses.create({
        model: 'gpt-4o-mini',
        instructions: '주식 질문 분류기. JSON만 응답. intent 필드를 반드시 포함하라.',
        input: `다음 텍스트의 의도를 분류하라: "${message}"

JSON만 응답:
{
  "type": "stock" | "market" | "sector" | "etf" | "portfolio" | "general",
  "intent": "full_analysis" | "buy_timing" | "sell_timing" | "risk_check" | "earnings_check" | "overheat_check" | "valuation_check" | "compare_stocks" | "sector_analysis" | "recommendation" | "etf_analysis" | "portfolio_analysis" | "fallback",
  "ticker": "AAPL" | null,
  "name": "Apple" | null,
  "market": "US" | "KR",
  "sectorKey": null
}

type 분류:
- 종목명/티커 포함 → type:"stock"
- ETF (QQQ, SPY 등) → type:"etf"
- "시장 어때", "나스닥" → type:"market"
- "반도체", "AI섹터" → type:"sector"
- 종목+숫자 패턴 → type:"portfolio"
- 일반 대화 → type:"general"

intent 분류:
- "어때", "분석해줘", "전망" → intent:"full_analysis"
- "언제 사", "매수" → intent:"buy_timing"
- "언제 팔", "목표가" → intent:"sell_timing"
- "위험", "리스크" → intent:"risk_check"
- "실적", "어닝" → intent:"earnings_check"
- "과열", "너무 올랐" → intent:"overheat_check"
- "비싸", "고평가", "PER" → intent:"valuation_check"
- "vs", "비교" → intent:"compare_stocks"
- "추천", "뭐 살까" → intent:"recommendation"
- 일반 대화 → intent:"fallback"`,
        max_output_tokens: 300,
    });
    try {
        const text = response.output_text.trim();
        return JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] || text);
    } catch {
        return { type: 'general', intent: 'fallback', ticker: null, name: null, market: 'US', sectorKey: null };
    }
}

module.exports = { analyzeStock, analyzeStockBuyTiming, analyzeStockSellTiming, analyzeStockRisk, analyzeStockEarnings, analyzeStockCasual, analyzeStockOverheat, analyzeStockValuation, analyzeStockComparison, analyzeETF, analyzePortfolio, analyzeRecommendation, analyzeMarket, analyzeSector, classifyQuery, fallbackChat, computeScore, normalizeData, validateData, computeScore6, classifyNewsItems, buildVerifiedContext };
