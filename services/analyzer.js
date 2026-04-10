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
    const num = safeNum(val);
    if (num === null) return '데이터 없음';
    const abs = Math.abs(num);
    if (abs >= 1e12) return `${currency}${(num / 1e12).toFixed(2)}T`;
    if (abs >= 1e9)  return `${currency}${(num / 1e9).toFixed(2)}B`;
    if (abs >= 1e6)  return `${currency}${(num / 1e6).toFixed(1)}M`;
    return `${currency}${num.toLocaleString()}`;
}

function fmtPct(val) {
    if (val == null) return '데이터 없음';
    const num = safeNum(val);
    if (num === null) return '데이터 없음';
    return (num >= 0 ? '+' : '') + num.toFixed(2) + '%';
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
        const rsiVal = safeNum(rsi);
        if (rsiVal == null) { rsiScore = null; detail.push(`RSI: 데이터 오류`); }
        else if (rsiVal < 30) { rsiScore = 2; detail.push(`RSI: ${safeFixed(rsiVal, 1)} → 과매도 구간 (2/2점)`); }
        else if (rsiVal <= 50) { rsiScore = 1; detail.push(`RSI: ${safeFixed(rsiVal, 1)} → 중립~저평가 (1/2점)`); }
        else if (rsiVal <= 70) { rsiScore = 1; detail.push(`RSI: ${safeFixed(rsiVal, 1)} → 중립 (1/2점)`); }
        else { rsiScore = 0; detail.push(`RSI: ${safeFixed(rsiVal, 1)} → 과매수 구간 (0/2점)`); }
    } else {
        rsiScore = null;
        detail.push(`RSI: 데이터 없음`);
    }

    // ── 2. PER 점수 (0~2) ──
    let perScore = null;
    const pe = fundamentals?.peRatio ? parseFloat(fundamentals.peRatio) : null;
    if (pe != null) {
        const peVal = safeNum(pe);
        if (peVal == null) { perScore = null; detail.push(`PER: 데이터 오류`); }
        else if (peVal < 0) { perScore = 0; detail.push(`PER: ${safeFixed(peVal, 1)} → 적자 (0/2점)`); }
        else if (peVal < 15) { perScore = 2; detail.push(`PER: ${safeFixed(peVal, 1)} → 저평가 (2/2점)`); }
        else if (peVal <= 30) { perScore = 1; detail.push(`PER: ${safeFixed(peVal, 1)} → 적정 (1/2점)`); }
        else { perScore = 0; detail.push(`PER: ${safeFixed(peVal, 1)} → 고평가 (0/2점)`); }
    } else {
        perScore = null;
        detail.push(`PER: 데이터 없음`);
    }

    // ── 3. ROE 점수 (0~2) ──
    let roeScore = null;
    const roe = fundamentals?.roe ? parseFloat(fundamentals.roe) : null;
    if (roe != null) {
        const roeVal = safeNum(roe);
        if (roeVal == null) { roeScore = null; detail.push(`ROE: 데이터 오류`); }
        else if (roeVal > 20) { roeScore = 2; detail.push(`ROE: ${safeFixed(roeVal, 1)}% → 우수 (2/2점)`); }
        else if (roeVal >= 5) { roeScore = 1; detail.push(`ROE: ${safeFixed(roeVal, 1)}% → 보통 (1/2점)`); }
        else { roeScore = 0; detail.push(`ROE: ${safeFixed(roeVal, 1)}% → 저조 (0/2점)`); }
    } else {
        roeScore = null;
        detail.push(`ROE: 데이터 없음`);
    }

    // ── 4. 매출 성장률 점수 (0~2) ──
    let growthScore = null;
    const growth = fundamentals?.revenueGrowthYoY ? parseFloat(fundamentals.revenueGrowthYoY) : null;
    if (growth != null) {
        const growthVal = safeNum(growth);
        if (growthVal == null) { growthScore = null; detail.push(`매출성장: 데이터 오류`); }
        else if (growthVal > 20) { growthScore = 2; detail.push(`매출성장: ${safeFixed(growthVal, 1)}% → 고성장 (2/2점)`); }
        else if (growthVal >= 0) { growthScore = 1; detail.push(`매출성장: ${safeFixed(growthVal, 1)}% → 안정 (1/2점)`); }
        else { growthScore = 0; detail.push(`매출성장: ${safeFixed(growthVal, 1)}% → 역성장 (0/2점)`); }
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
        if (fcf > 0 && fcfMargin && fcfMargin > 10) { fcfScore = 2; detail.push(`FCF: ${fmtLargeNum(fcf)} (마진 ${safeFixed(fcfMargin, 1)}%) → 우수 (2/2점)`); }
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
    const isKr = (data.ticker || '').endsWith('.KS') || (data.ticker || '').endsWith('.KQ') || data.market === 'KR';
    const currency = isKr ? '₩' : '$';
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
            const pctOf52 = safeFixed((p.current - p.fifty2Low) / (p.fifty2High - p.fifty2Low) * 100, 0, 'N/A');
            lines.push(`**52주 내 위치:** ${pctOf52}% (0%=최저점, 100%=최고점)`);
        }
    }
    const h = data.history || {};
    if (h.change1W != null || h.change1M != null) {
        lines.push(`**기간별 변동:** 1주 ${h.change1W != null ? h.change1W + '%' : 'N/A'} | 1개월 ${h.change1M != null ? h.change1M + '%' : 'N/A'}`);
    }

    // 기술적 지표
    lines.push('');
    lines.push(`**RSI(14):** ${t.rsi != null ? safeFixed(t.rsi, 1) + ' (' + (t.rsiSignal || '') + ')' : '데이터 없음'}`);
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
    lines.push(`**BPS:** ${f.bps != null ? f.bps : '데이터 없음'} | **배당수익률:** ${f.dividendYield != null ? (f.dividendYield * 100).toFixed(2) + '%' : '데이터 없음'}`);
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
        lines.push(`\n**기관 평균 목표가:** ${fmtPrice(safeFixed(parseFloat(c.targetMean), 2, null), currency)} (고: ${fmtPrice(c.targetHigh, currency)} / 저: ${fmtPrice(c.targetLow, currency)}) | 컨센서스: ${c.rating || '데이터 없음'}`);
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
        const rsiVal = safeNum(t.rsi);
        if (rsiVal != null && rsiVal < 30) lines.push(`• RSI ${safeFixed(rsiVal, 1)} → 과매도 구간, 반등 가능성 존재`);
        else if (rsiVal != null && rsiVal > 70) lines.push(`• RSI ${safeFixed(rsiVal, 1)} → 과매수 구간, 조정 가능성 존재`);
        else if (rsiVal != null) lines.push(`• RSI ${safeFixed(rsiVal, 1)} → 중립 구간`);
    }

    // 재무 해석
    if (f.peRatio != null) {
        const pe = safeNum(f.peRatio);
        if (pe != null && pe < 0) lines.push(`• PER ${safeFixed(pe, 1)} → 현재 적자 상태`);
        else if (pe != null && pe < 15) lines.push(`• PER ${safeFixed(pe, 1)} → 저평가 구간`);
        else if (pe != null && pe > 40) lines.push(`• PER ${safeFixed(pe, 1)} → 고평가 구간`);
        else if (pe != null) lines.push(`• PER ${safeFixed(pe, 1)} → 적정 밸류에이션`);
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
    if (t.rsi != null && safeNum(t.rsi) > 70) risks.push(`RSI ${safeFixed(t.rsi, 1)} 과매수 → 단기 조정 위험`);
    if (f.peRatio != null && safeNum(f.peRatio) > 40) risks.push(`PER ${safeFixed(f.peRatio, 1)} 고평가 → 밸류에이션 부담`);
    if (f.peRatio != null && safeNum(f.peRatio) < 0) risks.push(`PER 적자 → 수익성 훼손 리스크`);
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
        if (t.rsi != null && safeNum(t.rsi) > 65) lines.push(`• RSI ${safeFixed(t.rsi, 1)} → 과매수 접근, 일부 익절 고려`);
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

    // ── 산식 요약 (각 점수의 가점/감점 방향) ──
    const reasons = {};
    if (gv != null) reasons.growth = `매출성장률 ${gv > 0 ? '+' : ''}${safeFixed(gv, 1)}% → ${gv > 10 ? '가점' : gv > 0 ? '소폭 가점' : '감점'}`;
    if (rv != null || nm != null) {
        const parts = [];
        if (rv != null) parts.push(`ROE ${safeFixed(rv, 1)}%${rv > 15 ? '(양호)' : rv > 0 ? '(보통)' : '(저조)'}`);
        if (nm != null) parts.push(`순이익률 ${safeFixed(nm, 1)}%${nm > 10 ? '(양호)' : nm > 0 ? '(보통)' : '(적자)'}`);
        reasons.profitability = parts.join(', ');
    }
    if (dev != null || fcfv != null) {
        const parts = [];
        if (dev != null) parts.push(`D/E ${safeFixed(dev, 0)}%${dev > 100 ? '(높음→감점)' : '(양호)'}`);
        if (fcfv != null) parts.push(`FCF ${fcfv > 0 ? '양수(+)' : '음수(−)→감점'}`);
        reasons.stability = parts.join(', ');
    }
    if (pev != null || pbv != null) {
        const parts = [];
        if (pev != null) parts.push(`PER ${safeFixed(pev, 1)}${pev > 35 ? '(부담→감점)' : pev < 15 ? '(저평가→가점)' : '(적정)'}`);
        if (pbv != null) parts.push(`PBR ${safeFixed(pbv, 1)}${pbv > 3 ? '(부담)' : pbv < 1 ? '(저평가→가점)' : ''}`);
        reasons.valuation = parts.join(', ');
    }
    if (rsiv != null) reasons.momentum = `RSI ${safeFixed(rsiv, 1)}${rsiv < 30 ? '(과매도→반등 가능성)' : rsiv > 70 ? '(과매수→조정 유의)' : '(중립 구간)'}(보조지표)`;
    if (newsSentiment != null && newsAnalysis.total > 0) {
        if (newsAnalysis.positive.length === 0 && newsAnalysis.negative.length === 0) {
            reasons.newsSentiment = `긍정/부정 혼재 (총 ${newsAnalysis.total}건)`;
        } else {
            reasons.newsSentiment = `긍정 ${newsAnalysis.positive.length}건 / 부정 ${newsAnalysis.negative.length}건 / 총 ${newsAnalysis.total}건`;
        }
    }

    // ── 종합 (null 제외 평균) ──
    const all = [growth, profitability, stability, valuation, momentum, newsSentiment];
    const valid = all.filter(v => v !== null);
    const overall = valid.length > 0 ? Math.round(valid.reduce((a, b) => a + b, 0) / valid.length) : null;

    return { growth, profitability, stability, valuation, momentum, newsSentiment, overall, reasons };
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
        const majorDocs = ['yahoo', 'seekingalpha', 'motleyfool', 'benzinga', 'zacks', 'investorplace', 'marketwatch'];
        
        let trust = '일반보도';
        if (officialSrc.some(s => src.includes(s))) trust = '주요/공식언론';
        else if (majorDocs.some(s => src.includes(s))) trust = '2차인용';

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
        lines.push(`${k}: ${val} (출처: ${v.source})`);
    }
    if (warnings.length > 0) {
        lines.push(`\n[⚠️ Validation 경고]`);
        warnings.forEach(w => lines.push(w));
    }
    const r = score6.reasons || {};
    lines.push(`\n[6대 부문 룰기반 점수 (0~100) — 산식 요약 포함]`);
    lines.push(`성장성: ${score6.growth ?? '데이터 부족'}${r.growth ? ' — ' + r.growth : ''}`);
    lines.push(`수익성: ${score6.profitability ?? '데이터 부족'}${r.profitability ? ' — ' + r.profitability : ''}`);
    lines.push(`재무안정성: ${score6.stability ?? '데이터 부족'}${r.stability ? ' — ' + r.stability : ''}`);
    lines.push(`밸류에이션: ${score6.valuation ?? '데이터 부족'}${r.valuation ? ' — ' + r.valuation : ''}`);
    lines.push(`모멘텀: ${score6.momentum ?? '데이터 부족'}${r.momentum ? ' — ' + r.momentum : ''} (보조지표, 참고용)`);
    lines.push(`뉴스심리: ${score6.newsSentiment ?? '데이터 부족'}${r.newsSentiment ? ' — ' + r.newsSentiment : ''}`);
    lines.push(`종합: ${score6.overall ?? '데이터 부족'}`);

    if (classifiedNews.length > 0) {
        lines.push(`\n[뉴스 룰기반 분류]`);
        classifiedNews.forEach(cn => {
            lines.push(`- [${cn.type}] ${cn.title} | 강도:${cn.strength} | 신뢰도:${cn.trust} | 지속성:${cn.duration}`);
        });
        // 대표 긍정/부정 뉴스
        const posNews = classifiedNews.find(cn => ['실적','업황','이벤트'].includes(cn.type) && cn.strength !== '약');
        const negNews = classifiedNews.find(cn => cn.strength === '강' || cn.type === '정책');
        if (posNews) lines.push(`대표 긍정 뉴스: ${posNews.title} (${posNews.type}, ${posNews.trust})`);
        if (negNews && negNews !== posNews) lines.push(`대표 부정 뉴스: ${negNews.title} (${negNews.type}, ${negNews.trust})`);
    }

    // 검증 상태 4항목 분리
    const metricCount = Object.values(cleaned).filter(v => !v._removed && v.value != null).length;
    const totalMetrics = Object.keys(cleaned).length;
    const hasMultiSrc = new Set(Object.values(cleaned).filter(v => v.source).map(v => v.source)).size > 1;
    lines.push(`\n[검증 상태 (6항목)]`);
    const isMulti = hasMultiSrc ? '예' : '아니오';
    lines.push(`원천 데이터 신뢰도: ${hasMultiSrc ? '높음' : '보통'}`);
    lines.push(`복수 소스 확보: ${isMulti}`);
    const coverageLevel = metricCount >= totalMetrics * 0.8 ? '높음' : (metricCount >= totalMetrics * 0.5 ? '보통' : '낮음');
    lines.push(`분석 커버리지: ${coverageLevel} (${totalMetrics}개 중 ${metricCount}개 확보)`);
    lines.push(`해석 신뢰도: 낮음 (LLM 기반 해석이므로 검증 필요)`);
    lines.push(`기간 일치성: ${warnings.some(w => w.includes('상이')) ? '불일치 가능' : '확인 불가'}`);
    lines.push(`뉴스 신뢰도: ${classifiedNews.some(cn => cn.trust === '공식발표') ? '일부 공식발표 포함' : '전체 언론보도 기반'}`);

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

const STOCK_PROMPT_TEMPLATE = `당신은 데이터 기반 투자 참고 도구 "예리"입니다.
제공된 <RawData>를 바탕으로 반드시 아래 마크다운 구조를 정확히 지켜 분석 참고자료를 작성하세요.

[🚨 핵심 규칙 — 반드시 준수]
1. 오직 <RawData> 수치만 사용. 없는 정보는 "데이터 부족"으로 표시. 추론/추정 금지.
2. source 없는 수치는 출력 금지.
3. period/asOfDate 추론 금지. 없으면 표시하지 않거나 "미제공".
4. 표현 강도 제한: "~가능성이 높다"(X) → "~유의 필요", "~가능성 존재", "~해석될 수 있음" 수준으로 보수적 서술.
5. 한줄 요약은 핵심 축 최대 2개만 사용. 여러 지표를 한 문장에 나열하지 말 것.
6. 지지선/저항선/목표가 등 가격 수준을 언급할 때 반드시 산출 근거를 명시.
   - 허용 근거: EMA20/EMA50/SMA200, 전일 고저가, 최근 N일 고저점, 피벗포인트
   - <RawData>에 해당 값이 없으면 가격 수준 언급 금지.
   - 예: "EMA20 $40.92 (TwelveData) 부근이 단기 지지선으로 해석될 수 있음"
7. 팩트와 해석 분리. 숫자 하나로 단정 금지.
8. RSI/MACD 등 기술지표는 보조 참고. 고평가/저평가 직접 근거 금지.
9. 재무+기술 혼용 시 "데이터 기간 상이 가능" 단서 필수.
10. 6대 점수는 <RawData>의 산식 요약을 그대로 인용. 직접 점수 생성 금지.
11. 길이 제한: 간결하고 핵심만.

# 📊 [종목명] 분석 리포트

## 🎯 한줄 요약
(핵심 축 2개만 선택하여 보수적이고 자연스러운 문장으로 작성. 예: "FCF 음수 지속"(X) → "음수 현금흐름 부담"(O))

## 📋 핵심 팩트
(⚠️ 모바일 가독성을 위해 절대 표를 생성하지 말고, 아래 형태의 세로형 리스트로 작성하세요)
(⚠️ 숫자 포맷 엄수: 금액 -$1.25B / 비율 153.0% / 배수 24.4배 / 가격 $39.98 / 보조지표 37.2 형식으로 소수점 통일)
- 현재가: (포맷팅된 값) (출처: <RawData> 출처)
- 전일비: (포맷팅된 값)% (출처: <RawData> 출처)
- PER: (포맷팅된 값)배 (출처: <RawData> 출처)
- EPS: (포맷팅된 값) (출처: <RawData> 출처)
- ROE: (포맷팅된 값)% (출처: <RawData> 출처)
- D/E (부채비율): (포맷팅된 값)% (출처: <RawData> 출처)
- FCF: (포맷팅된 값) (출처: <RawData> 출처)
- RSI(14): (포맷팅된 값) (출처: <RawData> 출처)

## 📈 상승 가능성 요인
1. [실적/재무] (근거 수치 + 출처) — ⚠️ 제한: (한계점)
2. [뉴스/재료] (내용) — ⚠️ 제한: (신뢰도/지속성)
3. [차트/수급] (근거 + 출처, 보조지표 명시) — ⚠️ 제한: (기술지표 한계)

## 📉 하락 리스크 요인
1. [실적/재무] (근거 수치 + 출처) — ⚠️ 제한: (한계점)
2. [뉴스/재료] (악재) — ⚠️ 제한: (신뢰도/지속성)
3. [차트/수급] (근거 + 출처, 보조지표 명시) — ⚠️ 제한: (기술지표 한계)

## 📰 뉴스 심리 분석
<RawData>의 뉴스 분류 결과를 인용. (긍정/부정이 집계되지 않은 경우 "긍정/부정 혼재 또는 뚜렷한 특징 없음"으로 단순화할 것)
- 대표 긍정 뉴스: (한국어 1줄 요약) — (출처)
- 대표 부정 뉴스: (한국어 1줄 요약) — (출처)
→ 종합 심리: (긍정/부정/중립) + 왜 이 판단인지 1줄 근거
(* 영문 원문 제목은 노출하지 않고 오직 한국어 1줄 요약만 표시)

## 💯 6대 부문 점수 (0~100점)
⚠️ 점수는 수집된 원천 데이터 기준으로 계산되었습니다.
- 🚀 **성장성**: [점수]점 — [산식 요약 인용]
- 💰 **수익성**: [점수]점 — [산식 요약 인용]
- 🛡️ **재무안정성**: [점수]점 — [산식 요약 인용]
- 📊 **밸류에이션**: [점수]점 — [산식 요약 인용]
- 🏄 **모멘텀**: [점수]점 — [산식 요약 인용] (보조지표 한정)
- 📰 **뉴스심리**: [점수]점 — [산식 요약 인용] (※점수 산식 결과가 0건으로 보이면 "뉴스 텍스트 마이닝 기반 심리 분석" 등 실제 상황에 맞게 텍스트 압축할 것)
- 🏆 **종합**: [평균]점 ([80점 이상 긍정 / 60점 이상 보통 / 60점 미만 주의] 라벨 추가)

## ⚠️ 해석 주의사항
- (기간 혼용 여부)
- (기술지표는 보조 참고용)
- (데이터 부족 항목으로 정확도 제한)

## 💡 종합 판단
- **🚀 한줄 액션**: (보수적 표현: "~유의 필요", "~검토 가능", "~고려해볼 수 있음")
- **🎯 핵심 액션**: [관망 권장 / 보수적 접근 / 분할 검토 가능 / 리스크 주의] 택 1 + 이유 1~2줄
- **핵심 이유**: (결론의 핵심 근거 1줄)
- **⏱️ 진입 타이밍**: (<RawData>의 EMA/SMA 기반 가격 수준만 인용. 없으면 "판단 근거 부족")
- **🔭 목표 관점**: 단기 (1주~1개월) / 중기 (3~6개월)
- **💡 동종 업계 관심 종목**: (같은 섹터 2~3개 + 한 줄 비교)

## 🔍 검증 상태
- **원천 데이터 신뢰도**: (<RawData>의 표기 인용. 예: 높음 / 보통)
- **복수 소스 확보**: (예 / 아니오)
- **분석 커버리지**: (<RawData>의 분석 커버리지 인용. 예: 높음 (26개 중 25개 확보))
- **해석 신뢰도**: 낮음 (LLM 기반 해석이므로 독립 검증 필요)
- **기간 일치성**: (<RawData>의 기간 일치성 인용)
- **뉴스 신뢰도**: (<RawData>의 뉴스 신뢰도 인용)
- ⚠️ 본 분석은 API 데이터 기반 자동 생성이며, 투자 결정의 근거가 아닙니다. 전문가 상담 및 추가 검증을 권장합니다.

## 🛒 매수/매도 참고
⚠️ 아래는 투자 권유가 아닌 조건형 참고 의견입니다. (최대한 문장을 압축할 것)
- **매수 검토**: (예: EMA20 $40.92 회복 또는 지지선 $39.98 안착 시)
- **매도/주의**: (예: $37.98 이탈 지속 시)
- ⚠️ 직접 권유 금지. 항상 조건형으로 짧게 서술.

## 🤖 AI 참고 의견
(행동 원칙 중심으로 2~3문장 이내 작성. 종합 판단 반복 피하기. 예: "추격 매수보다 관망이 우세합니다.", "매수 조건 충족 시 분할 접근을 검토해볼 수 있습니다.")
⚠️ 단정형 투자 권유 금지. 본 의견은 API 데이터 기반 자동 생성이며 참고용입니다.
`;

const STOCK_PROMPT_TEMPLATE_KR = STOCK_PROMPT_TEMPLATE.replace(
`## 📋 핵심 팩트
(⚠️ 모바일 가독성을 위해 절대 표를 생성하지 말고, 아래 형태의 세로형 리스트로 작성하세요)
(⚠️ 숫자 포맷 엄수: 금액 -$1.25B / 비율 153.0% / 배수 24.4배 / 가격 $39.98 / 보조지표 37.2 형식으로 소수점 통일)
- 현재가: (포맷팅된 값) (출처: <RawData> 출처)
- 전일비: (포맷팅된 값)% (출처: <RawData> 출처)
- PER: (포맷팅된 값)배 (출처: <RawData> 출처)
- EPS: (포맷팅된 값) (출처: <RawData> 출처)
- ROE: (포맷팅된 값)% (출처: <RawData> 출처)
- D/E (부채비율): (포맷팅된 값)% (출처: <RawData> 출처)
- FCF: (포맷팅된 값) (출처: <RawData> 출처)
- RSI(14): (포맷팅된 값) (출처: <RawData> 출처)`,
`## 📋 핵심 팩트
(⚠️ 모바일 가독성을 위해 절대 표를 생성하지 말고, 아래 형태의 세로형 리스트로 작성하세요)
(⚠️ 숫자 포맷 엄수: 금액 ₩53,100 / 비율 153.0% / 배수 24.4배 / 보조지표 37.2 형식으로 소수점 통일)
- 현재가: (포맷팅된 값) (출처: <RawData> 출처)
- 전일비: (포맷팅된 값)% (출처: <RawData> 출처)
- 시가총액: (포맷팅된 값) (출처: <RawData> 출처)
- PER: (포맷팅된 값)배 (출처: <RawData> 출처)
- PBR: (포맷팅된 값)배 (출처: <RawData> 출처)
- EPS: (포맷팅된 값) (출처: <RawData> 출처)
- BPS: (포맷팅된 값) (출처: <RawData> 출처)
- ROE: (포맷팅된 값)% (출처: <RawData> 출처)
- 부채비율: (포맷팅된 값)% (출처: <RawData> 출처)
- 배당수익률: (포맷팅된 값)% (출처: <RawData> 출처)
- RSI(14): (포맷팅된 값) (출처: <RawData> 출처)`);

function getPromptTemplate(data) {
    const isKr = (data.ticker || '').endsWith('.KS') || (data.ticker || '').endsWith('.KQ') || data.market === 'KR';
    return isKr ? STOCK_PROMPT_TEMPLATE_KR : STOCK_PROMPT_TEMPLATE;
}

async function analyzeStock(data, useDeep = false, tone = 'normal') {
    const prompt = `${getPromptTemplate(data)}\n\n${buildContextForLLM(data)}`;
    return callOpenAI(prompt, useDeep, tone);
}

// 질문의 속성에 따라 최종 판단(추천 액션)의 뉘앙스를 강조해주되, 구조는 동일하게 유지
async function analyzeStockCasual(data, useDeep = false, tone = 'normal') {
    return analyzeStock(data, useDeep, tone);
}

async function analyzeStockBuyTiming(data, useDeep = false, tone = 'normal') {
    const prompt = `${getPromptTemplate(data)}\n[💡 추가 지시] '💡 최종 투자 관점 및 판단' 셀에서 단기 매수 적절성(Buy Timing)과 목표가/손절가를 명확히 짚어주세요.\n\n${buildContextForLLM(data)}`;
    return callOpenAI(prompt, useDeep, tone);
}

async function analyzeStockSellTiming(data, useDeep = false, tone = 'normal') {
    const prompt = `${getPromptTemplate(data)}\n[💡 추가 지시] '💡 최종 투자 관점 및 판단' 셀에서 매도 및 익절/손절(Sell Timing) 관점을 중점적으로 짚어주세요.\n\n${buildContextForLLM(data)}`;
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
    const isKrA = (data1.ticker || '').endsWith('.KS') || (data1.ticker || '').endsWith('.KQ') || data1.market === 'KR';
    const isKrB = (data2.ticker || '').endsWith('.KS') || (data2.ticker || '').endsWith('.KQ') || data2.market === 'KR';
    const cA = isKrA ? '₩' : '$';
    const cB = isKrB ? '₩' : '$';
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
    lines.push(`• ${nameA}: RSI ${t1.rsi != null ? safeFixed(t1.rsi, 1) : '데이터 없음'} | EMA20 ${t1.ema20 != null ? fmtPrice(t1.ema20, cA) : '데이터 없음'}`);
    lines.push(`• ${nameB}: RSI ${t2.rsi != null ? safeFixed(t2.rsi, 1) : '데이터 없음'} | EMA20 ${t2.ema20 != null ? fmtPrice(t2.ema20, cB) : '데이터 없음'}\n`);

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
    const prompt = `시장 전체 분석. 데이터만 사용, 추론 금지.\n[기준일: ${today}]\nS&P500: ${indices?.['S&P 500']?.current || '확인불가'} (${safeFixed(indices?.['S&P 500']?.changePct, 2, '확인불가')}%)\nNASDAQ: ${indices?.['NASDAQ']?.current || '확인불가'} (${safeFixed(indices?.['NASDAQ']?.changePct, 2, '확인불가')}%)\n금리: ${macro?.federalFundsRate ?? '확인불가'}% | VIX: ${macro?.vix ?? '확인불가'}\n뉴스:\n${newsText || '없음'}\n\n간결하게 요약: 1) 시장 현황 2) 거시경제 영향 3) 리스크 4) 전략. '확인불가'로 나오는 지표는 브리핑에서 절대 언급하지 말고 제외할 것.`;
    return callOpenAI(prompt, useDeep, tone);
}

async function analyzeSector(sectorData, useDeep = false, tone = 'normal') {
    const { sector, stocks } = sectorData;
    const today = new Date().toLocaleDateString('ko-KR');
    const stockLines = stocks.map(s => {
        const sc = computeScore(s);
        return `${s.ticker}: 점수 ${sc.normalized}/10 | RSI ${safeFixed(s.technical?.rsi, 1, 'N/A')} | PER ${s.fundamentals?.peRatio || 'N/A'}`;
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
        const pnlPct = p.avgPrice > 0 ? safeFixed((p.currentPrice / p.avgPrice - 1) * 100, 2, '0') : '0';
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

// ══════════════════════════════════════════════════════════
// 7-MODE 의도 분류기
// ══════════════════════════════════════════════════════════
async function classifyQuery(message) {
    const response = await client.responses.create({
        model: 'gpt-4o-mini',
        instructions: '주식 질문 의도 분류기. JSON만 응답.',
        input: `다음 사용자 메시지의 의도를 분류하라: "${message}"

JSON만 응답:
{
  "type": "stock" | "market" | "sector" | "etf" | "portfolio" | "general",
  "output_mode": "analysis_report" | "reason_answer" | "comparison_answer" | "fact_answer" | "concept_answer" | "strategy_answer" | "chat_answer",
  "intent": "full_analysis" | "buy_timing" | "sell_timing" | "risk_check" | "earnings_check" | "overheat_check" | "valuation_check" | "compare_stocks" | "sector_analysis" | "recommendation" | "etf_analysis" | "portfolio_analysis" | "fallback",
  "ticker": "AAPL" | null,
  "name": "Apple" | null,
  "market": "US" | "KR",
  "sectorKey": null
}

output_mode 분류 (가장 중요!):

1. analysis_report: 종목 전체 분석 요청. "분석해줘", "전망", "전체 분석" 같은 명시적 단어가 있을 때만.
   예: "테슬라 분석해줘", "TSLA 전망"

2. reason_answer: 이유/원인 질문.
   예: "왜 올라?", "왜 내릴까?", "테슬라 왜 빠졌어?"

3. comparison_answer: 비교 질문.
   예: "엔비디아랑 테슬라 비교해줘", "AAPL vs MSFT"

4. fact_answer: 가격/수치/사실/데이터 질문. 절대 분석 리포트 금지.
   예: "테슬라 저번달 얼마?", "현재가?", "PER 몇?", "시총?", "EPS 얼마?", "얼마나 올랐어?"

5. concept_answer: 개념/용어 설명.
   예: "PER가 뭐야?", "공매도 뜻", "RSI란?"

6. strategy_answer: 전략/판단/타이밍/평가 질문.
   예: "지금 들어가도 돼?", "언제 사?", "매수 타이밍?", "손절할까?"
   *** 핵심: 종목명 + "괜찮아?/어때?/살만해?/위험해?/지금 어때?/들어가도 돼?" 같은 판단요청은 반드시 strategy_answer!
   예: "테슬라 괜찮아?" -> strategy_answer (chat_answer 아님!)
   예: "엔비디아 어때?" -> strategy_answer (chat_answer 아님!)
   예: "아이리스 위험해?" -> strategy_answer (chat_answer 아님!)

7. chat_answer: 종목명이 없는 순수 일반 대화/인사만.
   예: "안녕", "뭐 할 수 있어?", "고마워"
   *** 종목명이 포함된 질문이면 절대 chat_answer 아님!

type 분류:
- 종목명/티커 포함 -> type:"stock"
- ETF -> type:"etf"
- "시장 어때" -> type:"market"
- "반도체 섹터" -> type:"sector"
- 종목+수량 -> type:"portfolio"
- 일반 대화 -> type:"general"

*** 티커 추출 주의사항 (매우 중요):
"IREN ROE", "LUNR 실적" 처럼 알 수 없는 영문자/단어가 포함되어 있다면, 그것이 비주류 종목의 티커(ticker)일 확률이 거의 100%입니다. 반드시 ticker 필드에 추출하세요! (예: "IREN ROE" -> ticker: "IREN")

intent 분류:
- "분석해줘" -> intent:"full_analysis"
- "언제 사" -> intent:"buy_timing"
- "언제 팔" -> intent:"sell_timing"
- "위험" -> intent:"risk_check"
- "실적" -> intent:"earnings_check"
- "과열" -> intent:"overheat_check"
- "비싸" -> intent:"valuation_check"
- "vs","비교" -> intent:"compare_stocks"
- "추천" -> intent:"recommendation"
- 일반 -> intent:"fallback"`,
        max_output_tokens: 350,
    });
    try {
        const text = response.output_text.trim();
        const parsed = JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] || text);
        // output_mode 없으면 intent 기반으로 추론
        if (!parsed.output_mode) {
            if (parsed.intent === 'full_analysis') parsed.output_mode = 'analysis_report';
            else if (parsed.intent === 'compare_stocks') parsed.output_mode = 'comparison_answer';
            else if (['buy_timing', 'sell_timing', 'risk_check', 'overheat_check'].includes(parsed.intent)) parsed.output_mode = 'strategy_answer';
            else if (parsed.intent === 'fallback') parsed.output_mode = 'chat_answer';
            else parsed.output_mode = 'fact_answer';
        }

        // ★★ 결정론적 티커 오버라이드 — GPT가 잘못 매칭해도 방어 ★★
        // 메시지에 명시적 대문자 티커(2~5자)가 있으면 resolveStock으로 확인 후 강제 적용
        const { resolveStock } = require('../utils/ticker-util');
        const tickerMatch = message.match(/\b([A-Z]{2,5})\b/);
        if (tickerMatch) {
            const explicitTicker = tickerMatch[1];
            const resolved = resolveStock(explicitTicker);
            if (resolved && resolved.ticker !== parsed.ticker) {
                console.log(`[classifyQuery] ★ 티커 오버라이드: GPT="${parsed.ticker}" → 실제="${resolved.ticker}" (메시지에 "${explicitTicker}" 명시)`);
                parsed.ticker = resolved.ticker;
                parsed.name = resolved.name;
                parsed.market = resolved.market || 'US';
                if (parsed.type === 'general') parsed.type = 'stock';
            }
        }
        // 코드 레벨 강제 교정 — GPT가 잘못 분류해도 방어
        const STRATEGY_KEYWORDS = ['괜찮아', '어때', '어떄', '살만해', '살만한가', '위험해', '위험한가', '지금 어때', '들어가도 돼', '들어가도 될까', '살까', '해도 돼', '해도 될까', '사도 돼', '사도 될까', '팔까', '매수해', '매도해', '괜찮을까', '어떨까', '좋아?', '좋을까', '나을까', '나아?', '비싸', '더 가', '어딸까', '할까'];
        const lowerMsg = message.toLowerCase();
        const hasStrategyKeyword = STRATEGY_KEYWORDS.some(k => lowerMsg.includes(k));

        // chat_answer인데 종목명이거나 전략 키워드가 있으면 교정
        if (parsed.output_mode === 'chat_answer' && (parsed.type === 'stock' || hasStrategyKeyword)) {
            parsed.output_mode = 'strategy_answer';
            console.log(`[classifyQuery] ⚠️ chat_answer → strategy_answer 강제 교정 (keyword match)`);
        }
        // 종목+판단 키워드 조합이면 analysis_report가 아닌 한 strategy 우선
        if (hasStrategyKeyword && parsed.type === 'stock' && parsed.output_mode !== 'analysis_report') {
            parsed.output_mode = 'strategy_answer';
        }
        return parsed;
    } catch {
        return { type: 'general', intent: 'fallback', output_mode: 'chat_answer', ticker: null, name: null, market: 'US', sectorKey: null };
    }
}

// ══════════════════════════════════════════════════════════
// 숫자 안전 포맷 유틸리티 (toFixed 크래시 완전 방지)
// ══════════════════════════════════════════════════════════
function safeNum(value) {
    if (value == null) return null;
    if (typeof value === 'number') return isNaN(value) ? null : value;
    const n = Number(value);
    return isNaN(n) ? null : n;
}

function safeFixed(value, decimals = 2, fallback = '데이터 없음') {
    const n = safeNum(value);
    if (n === null) return fallback;
    return n.toFixed(decimals);
}

function formatSafe(value, decimals = 2, prefix = '', suffix = '') {
    if (value == null) return null;
    const num = safeNum(value);
    if (num === null) return typeof value === 'string' ? `${prefix}${value}${suffix}` : null;
    return `${prefix}${num.toFixed(decimals)}${suffix}`;
}

// ══════════════════════════════════════════════════════════
// 모드별 경량 응답 함수 (분석 리포트 아님!)
// ══════════════════════════════════════════════════════════

function buildStockContext(stockData) {
    const ticker = stockData.ticker || '';
    const name = stockData.companyName || ticker;
    const isKR = ticker.endsWith('.KS') || ticker.endsWith('.KQ');
    const currency = isKR ? '₩' : '$';
    const priceVal = stockData.price?.current;
    const price = priceVal != null ? `${currency}${Number(priceVal).toLocaleString()}` : '데이터 없음';
    const changePct = formatSafe(stockData.price?.changePct, 2, stockData.price?.changePct > 0 ? '+' : '', '%') || '';
    const f = stockData.fundamentals || {};
    const t = stockData.technical || {};
    const p = stockData.price || {};
    const newsText = (stockData.news || []).slice(0, 5).map(n => `- ${n.title} (${n.source})`).join('\n');

    const delayInfo = isKR ? '20분 지연' : 'Cboe BATS 실시간 / 기타 15분 지연';
    const fetchTimeObj = new Date(stockData.fetchedAt || Date.now());
    
    // 한국 시간(KST) 문자열 생성 (포맷: YYYY-MM-DD HH:mm:ss)
    const kstString = new Intl.DateTimeFormat('ko-KR', {
        timeZone: 'Asia/Seoul',
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        hour12: false
    }).format(fetchTimeObj);
    
    const dataQuality = stockData._dataWarning 
        ? stockData._dataWarning 
        : `✅ 신뢰도 높음 (가격, 주요 재무, 기술적 지표 모두 확보됨)`;

    return [
        `[종목] ${name} (${ticker})`,
        `현재가: ${price} ${changePct}`,
        f.marketCap != null ? `시가총액: ${formatSafe(f.marketCap / 1e9, 1, '$', 'B') || '데이터 없음'}` : '',
        formatSafe(f.pe != null ? f.pe : f.peRatio, 1, 'PER: ') || '',
        formatSafe(f.eps, 2, 'EPS: $') || '',
        f.roe != null ? (formatSafe(f.roe * 100, 1, 'ROE: ', '%') || '') : '',
        f.debtToEquity != null ? (formatSafe(f.debtToEquity, 1, 'D/E: ', '%') || '') : '',
        f.freeCashFlow != null ? `FCF: ${formatSafe(f.freeCashFlow / 1e9, 2, '$', 'B') || '데이터 없음'}` : '',
        f.dividendYield != null ? (formatSafe(f.dividendYield * 100, 2, '배당수익률: ', '%') || '') : '',
        f.pbRatio != null ? formatSafe(f.pbRatio, 2, 'PBR: ') : '',
        f.revenueGrowthYoY != null ? (formatSafe(f.revenueGrowthYoY * 100, 1, '매출성장률: ', '%') || '') : '',
        f.netMargin != null ? (formatSafe(f.netMargin * 100, 1, '순이익률: ', '%') || '') : '',
        f['52WeekHigh'] != null ? `52주 최고: $${f['52WeekHigh']}` : '',
        f['52WeekLow'] != null ? `52주 최저: $${f['52WeekLow']}` : '',
        formatSafe(t.rsi, 1, 'RSI(14): ') || '',
        formatSafe(t.ema20, 2, 'EMA20: $') || '',
        newsText ? `\n[최신 뉴스]\n${newsText}` : '',
        `\n[❗타이밍 및 시세 안내 - 반드시 응답에 포함할 것]`,
        `- 시세 기준: ${delayInfo}`,
        `- 조회 시점: ${kstString}`,
        `- 데이터 신뢰도: ${dataQuality}`,
        `*(답변 시 가격 뒤에 괄호로 시세 지연 정보를 명시하고, 문장 끝에 조회 시간과 신뢰도를 짧게 한 줄로 추가하세요.)*`
    ].filter(Boolean).join('\n');
}

function identifyMetricCategory(text) {
    const textUpper = text.toUpperCase();
    if (textUpper.includes('PER') || text.includes('주가수익비율')) return 'PER';
    if (textUpper.includes('PBR') || text.includes('주가순자산비율')) return 'PBR';
    if (textUpper.includes('ROE') || text.includes('자기자본이익률')) return 'ROE';
    if (textUpper.includes('EPS') || text.includes('주당순이익')) return 'EPS';
    if (text.includes('배당')) return 'DIVIDEND';
    if (textUpper.includes('FCF') || text.includes('자유현금흐름') || text.includes('현금흐름')) return 'FCF';
    if (textUpper.includes('D/E') || text.includes('부채비율') || textUpper.includes('DEBT')) return 'DEBT';
    return null;
}

/** fact_answer: 가격/수치/사실만 짧게 답변 */
async function answerFact(question, stockData, tone = 'normal') {
    const name = stockData.companyName || stockData.ticker;
    const ticker = stockData.ticker;

    // 1) 지표 중심 심층 탐색 (Deep Metric Retrieval)
    const metricCategory = identifyMetricCategory(question);
    if (metricCategory) {
        const { fetchDeepMetric } = require('./data-fetcher');
        const deepResult = await fetchDeepMetric(ticker, metricCategory);
        
        if (deepResult.status === 'SUCCESS') {
            return `${name}(${ticker})의 ${deepResult.formattedText}`;
        }
        if (deepResult.status === 'NO_DIVIDEND') {
            return `${name}(${ticker})은(는) ${deepResult.formattedText}`;
        }
        // NO_DATA인 경우 아래의 GPT Fallback 로직으로 넘어감
    }

    const ctx = buildStockContext(stockData);

    // 데이터 가용성 요약 생성 — GPT가 대체 지표를 안내할 수 있도록
    const f = stockData.fundamentals || {};
    const t = stockData.technical || {};
    const p = stockData.price || {};
    const availability = [];
    const unavailable = [];

    if (p.current != null) availability.push('현재가'); else unavailable.push('현재가');
    if (p.changePct != null) availability.push('전일대비 등락률'); else unavailable.push('전일대비 등락률');
    if (f.eps != null) availability.push('EPS'); else unavailable.push('EPS');
    if (f.pe != null || f.peRatio != null) availability.push('PER'); else unavailable.push('PER');
    if (f.roe != null) availability.push('ROE'); else unavailable.push('ROE');
    if (f.debtToEquity != null) availability.push('D/E(부채비율)'); else unavailable.push('D/E(부채비율)');
    if (f.freeCashFlow != null) availability.push('FCF'); else unavailable.push('FCF');
    if (f.marketCap != null) availability.push('시가총액'); else unavailable.push('시가총액');
    if (f.dividendYield != null) availability.push('배당수익률'); else unavailable.push('배당수익률');
    if (f.pbRatio != null) availability.push('PBR'); else unavailable.push('PBR');
    if (f.revenueGrowthYoY != null) availability.push('매출성장률'); else unavailable.push('매출성장률');
    if (f.netMargin != null) availability.push('순이익률'); else unavailable.push('순이익률');
    if (t.rsi != null) availability.push('RSI'); else unavailable.push('RSI');
    if (t.ema20 != null) availability.push('EMA20'); else unavailable.push('EMA20');

    const availStr = availability.length > 0 ? `확인 가능: ${availability.join(', ')}` : '확인 가능한 지표 없음';
    const unavailStr = unavailable.length > 0 ? `확인 불가: ${unavailable.join(', ')}` : '';

    const prompt = `사용자가 투자 비서 "예리"에게 종목의 특정 수치/사실을 물었습니다.
아래 데이터에서 해당 수치만 정확히 찾아 2~4줄로 간결하게 답하세요.
절대 전체 분석 리포트를 작성하지 마세요. 묻는 수치/사실만 답하세요.

중요 규칙:
- 질문한 지표 데이터가 있으면 → 해당 수치를 정확히 답변 (간결하게)
- 질문한 지표 데이터가 없으면 → "현재 연결된 데이터 소스 기준으로 해당 지표를 확인하지 못했습니다." 라고 안내한 뒤,
  확인 가능한 대체 지표 2~3개를 짧게 추천 (예: "대신 PER, EPS, FCF는 확인 가능합니다.")
- "데이터 없음"이라고만 쓰지 마세요. 사용자가 다음 행동을 할 수 있도록 안내하세요.

마지막에: "더 자세한 분석이 필요하시면 '${name} 분석해줘'라고 말씀해 주세요!"

[데이터 가용성]
${availStr}
${unavailStr}

${ctx}

사용자 질문: "${question}"`;
    return callOpenAI(prompt, false, tone);
}

/** reason_answer: 왜 오르는지/내리는지 이유만 답변 */
async function answerReason(question, stockData, tone = 'normal') {
    const name = stockData.companyName || stockData.ticker;
    const ctx = buildStockContext(stockData);
    const prompt = `사용자가 투자 비서 "예리"에게 종목의 상승/하락 이유를 물었습니다.
아래 데이터와 뉴스를 참고하여 핵심 이유 2~3가지만 짧게 요약하세요 (5~8줄).
절대 전체 분석 리포트를 작성하지 마세요. 이유/원인만 답하세요.
마지막에: "더 자세한 분석이 필요하시면 '${name} 분석해줘'라고 말씀해 주세요!"

${ctx}

사용자 질문: "${question}"`;
    return callOpenAI(prompt, false, tone);
}

/** concept_answer: 용어/개념 설명만 답변 */
async function answerConcept(question, tone = 'normal') {
    const prompt = `사용자가 투자 비서 "예리"에게 투자 용어/개념을 물었습니다.
해당 용어의 뜻을 3~5줄로 쉽게 설명하세요.
절대 종목 분석 리포트를 작성하지 마세요. 용어 설명만 하세요.
예시를 들어 설명하면 좋습니다.

사용자 질문: "${question}"`;
    return callOpenAI(prompt, false, tone);
}

/** comparison_followup_answer: 비교 질문에 대한 간단한 팩트/전략형 후속 논평 */
async function answerComparisonFollowup(question, dataA, dataB, tone = 'normal') {
    const nameA = dataA.companyName || dataA.ticker;
    const nameB = dataB.companyName || dataB.ticker;
    const ctxA = buildStockContext(dataA);
    const ctxB = buildStockContext(dataB);
    const prompt = `사용자가 투자 비서 "예리"에게 두 종목(${nameA}, ${nameB})을 비교분석한 뒤 추가 질문을 했습니다.
아래 두 종목의 최신 데이터를 참고하여 질문에 4~6줄로 예리하게 답하세요.
"더 안전한 건?" 이나 "가성비는?" 같은 상대적 질문이라면 반드시 두 종목을 비교해서 짧게 논평하세요.

[ ${nameA} 데이터 ]
${ctxA}

[ ${nameB} 데이터 ]
${ctxB}

사용자 질문: "${question}"`;
    return callOpenAI(prompt, false, tone);
}

/** strategy_answer: 전략/판단/타이밍 의견 답변 */
async function answerStrategy(question, stockData, tone = 'normal') {
    const name = stockData.companyName || stockData.ticker;
    const ctx = buildStockContext(stockData);
    
    const prompt = `사용자가 투자 비서 "예리"에게 매수/매도 타이밍, 돌파 가능성, 향후 전망 등을 물었습니다.
아래 데이터를 참고하여 강력하고 결론이 명확한 전략을 답하세요. 애매한 표현을 뺀 "전문가의 3단 요약 브리핑" 형태를 지향하되, 기계적인 번호 매기기(예: 1. 🧮 [계산])나 템플릿 문구를 그대로 노출하지 말고 매번 자연스럽고 세련된 대화형 문단으로 출력하세요.

[🚨 필수 내포 구조 (단락은 나누되 문맥은 자연스럽게 연결할 것)]
0. 모바일 가독성: 첫 문장은 반드시 가장 핵심이 되는 요약 결론 한 줄로 시작하세요.

1. [계산 블록] 보유 정보 반영 (평단가, 수량, 목표가 포함 시):
   다음 3가지 손익을 헷갈리지 않게, 서술형 혹은 간결한 불릿으로 표현하세요.
   - 현재 시점 평가이익 (수익률과 액수 명시)
   - 목표가 도달 시 총 평가이익액
   - 현재 → 목표가까지 남은 추가 상승률과 추가 이익액

2. [결론 블록] 돌파/타이밍 요약 ("언제 갈까?" 등 미래 시점 질문 반영):
   - 목표가 및 돌파 시기 전망: [단기/중기/장기] 시계열 중 가장 유력한 시점을 선택해 서술
   - 돌파/달성 가능성: [낮음/보통/높음] 수준 등을 문장 속에 자연스레 녹여 평가 이유와 함께 1문장 서술

3. [조건 블록] 시나리오 및 리스크 (※ 절대 과장 금지, 오직 제공된 데이터 기반):
   - 상승 모멘텀: 거래량 지표, 저항 돌파, 특정 주요 뉴스 등 제공 데이터 내의 팩트만 사용해 1가지 제시
   - 하락 리스크: 지지선 이탈 또는 악재 기반 대응/손절 시나리오 1가지 제시

[신뢰도 표시 (맨 아래 필수 분리)]
   - 데이터 신뢰도: [낮음/보통/높음]
   - 전망 신뢰도: [낮음/보통/높음] (과대표시 금지! 예측 질문일수록 '단기 변동성' 등을 이유로 '보통'이나 '낮음'으로 깐깐하게 산정)

[다이나믹 CTA (마무리 한 줄)]
   - 대화 흐름에 맞게 "구체적인 매도 기준선도 잡아드릴까요?" 같은 한 문장으로 부드럽게 대화를 넘깁니다.

[데이터 및 지표]
${ctx}

사용자 질문: "${question}"`;

    return callOpenAI(prompt, false, tone);
}

/** answerStockQuestion: 범용 간결 Q&A (이전 버전 호환) */
async function answerStockQuestion(question, stockData, tone = 'normal') {
    return answerFact(question, stockData, tone);
}

module.exports = { analyzeStock, analyzeStockBuyTiming, analyzeStockSellTiming, analyzeStockRisk, analyzeStockEarnings, analyzeStockCasual, analyzeStockOverheat, analyzeStockValuation, analyzeStockComparison, analyzeETF, analyzePortfolio, analyzeRecommendation, analyzeMarket, analyzeSector, classifyQuery, fallbackChat, answerStockQuestion, answerFact, answerReason, answerConcept, answerStrategy, answerComparisonFollowup, computeScore, normalizeData, validateData, computeScore6, classifyNewsItems, buildVerifiedContext };
