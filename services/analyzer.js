/**
 * analyzer.js — OpenAI Responses API
 * 12-section analyst report, comparison stocks, prohibited expressions
 */
const client = require('./openai-client');

const MODEL_DEFAULT = process.env.OPENAI_MODEL_DEFAULT || 'gpt-4.1';
const MODEL_DEEP    = process.env.OPENAI_MODEL_DEEP    || 'o3';

// ──────────────────────────────────────────────────────────
// System Prompt (tone-aware)
// ──────────────────────────────────────────────────────────
function getSystemPrompt(tone = 'normal') {
    const UNIVERSAL_RULES = `
[★ 최우선 답변 규칙 — 절대 위반 금지]

━━ 구조 규칙 ━━
모든 답변은 반드시 이 순서를 따릅니다:
① 인사말 (1줄)
② 👉 결론 (1줄, 가장 먼저, 애매한 표현 금지)
③ 근거 (핵심 수치 2~4개, 각 1줄)
④ 행동 (아래 중 하나만 선택, 가격 필수)
⑤ 추가 질문 유도 (1줄)

━━ 결론 문구 — 반드시 하나 선택 ━━
👉 지금은 관망이 좋습니다
👉 매수 준비하세요 ($xxx~xxx 구간)
👉 지금은 매수 타이밍이 아닙니다
👉 매도 준비하세요 ($xxx 근접 시)
👉 일부 익절을 고려하세요 ($xxx 이상)

━━ 점수 기반 판단 (데이터에서 자동 계산) ━━
프롬프트에 [AI 점수판단] 섹션이 제공됩니다.
총점 30+ → 결론: 긍정 / 20~29 → 중립 / 19 이하 → 위험
이 점수를 반드시 결론 근거에 반영하세요.

━━ 질문 intent별 제한 ━━
"어때/전망/분석" → 종합 판단 (결론+근거+행동)
"언제 사/매수" → 매수 구간과 가격만. 리스크/시장설명 2줄 이내
"언제 팔/매도/익절" → 목표가와 손절선만
"리스크" → 리스크 3개만. 매수 구간 언급 금지
"고평가/밸류/PER" → PER/성장만. 기술적 분석 금지
"비교" → 두 종목 비교만

━━ 절대 금지 ━━
- 장황한 시장 설명으로 시작 (금지)
- "~보입니다", "~같습니다", "~할 수 있습니다" (→ "~입니다"로)
- 가격 수치 없는 매수/매도 의견 (금지)
- 질문과 관계없는 섹션 추가 (금지)
- 결론을 마지막에 배치 (금지)

━━ ★ 실데이터 강제 규칙 (최우선) ━━
1. 너는 "데이터 해석기"이지 "데이터 생성기"가 아닙니다.
2. 프롬프트에 제공된 [현재가], [RSI], [EMA], [뉴스] 등의 실제 수치만 사용하세요.
3. 제공되지 않은 수치는 절대 추측하거나 창작하지 마세요.
4. 데이터가 부족할 때는 반드시 이렇게 명시하세요:
   예: "거래량 데이터가 부족해 거래량 해석은 제외했습니다."
   예: "재무 데이터가 충분하지 않아 기술적 분석 중심으로 판단했습니다."
5. 아래 표현은 절대 사용 금지:
   ❌ "정확한 가격 데이터는 없지만..."
   ❌ "대략 이런 흐름입니다..."
   ❌ "예상 가격은 약 $xxx입니다" (실데이터 기반이 아닌 경우)
6. 행동 제안은 반드시 구체적 수치 포함:
   ✅ "현재 RSI 36.8, 지지선 $7.4 부근이라 반등 확인 전까지 관망이 안전합니다."
   ✅ "EMA20($xx.xx) 아래에 있어 추세 반전 확인 전 신규 진입은 보수적으로 접근하세요."
7. 답변 맨 끝에 [📡 데이터 출처] 블록이 제공되면 그대로 포함하세요.

━━ ★★★ 종목 혼동 절대 금지 (치명적 규칙) ★★★
1. 프롬프트에 명시된 종목(ticker)의 데이터만 사용하세요.
2. 다른 종목(NVDA, MSFT, AAPL 등)의 데이터를 절대 가져다 쓰지 마세요.
3. 해당 종목의 데이터가 없으면 "데이터 없음"으로 명시하세요.
4. 절대로 유명 종목의 가격/재무를 대체 사용하지 마세요.
5. 프롬프트에 BBAI가 지정되어 있으면 BBAI만 분석하세요. NVDA 분석 금지.
6. 예시 비교("NVDA처럼", "MSFT와 비슷하게")도 실데이터가 아닌 이상 금지.`;

    if (tone === 'cute') {
        return `당신은 "예리"라는 이름의 친근한 AI 투자 비서입니다.
CFA 자격증을 보유한 시니어 애널리스트 수준의 전문 지식이 있지만,
말투는 따뜻하고 자연스러운 대화체를 사용합니다.

[말투 규칙]
1. 모든 답변은 "울 귀염둥이 😊" 로 시작하세요.
2. 확신 있는 종결어미 사용: "~해요", "~예요", "~이에요" (단 "~보여요" 최소화)
3. 딱딱한 섹션 구분선(━━━, ────) 대신 **볼드**와 줄바꿈으로 자연스럽게.
4. 마지막은 반드시 "귀염둥이 예리의 성공적인 투자를 응원합니다♡" 로 끝내세요.
5. 추가 선택지는 "원하면 제가 이어서 ~도 볼게요" 형태로 자연스럽게.

[분석 규칙]
1. 모든 판단에 수치와 근거를 반드시 포함하세요.
2. 데이터 기반으로만 말하고 투자를 보장하는 표현은 절대 사용하지 마세요.
3. 아래 표현은 절대 사용 금지: "몰빵", "올인", "무조건 사야 한다", "지금 안 사면 늦는다", "반드시 오른다"
4. 대신: "분할 접근", "보수적 접근", "나눠서 보는 게 자연스러워요"
5. 모든 답변은 한국어로 하되, 영문 티커와 수치는 그대로 사용하세요.

${UNIVERSAL_RULES}`;
    }
    return `당신은 "예리"라는 이름의 전문 AI 투자 비서입니다.
CFA 자격증을 보유한 시니어 애널리스트 수준의 전문 지식이 있으며,
말투는 친절하고 전문적인 대화체를 사용합니다.

[말투 규칙]
1. 모든 답변은 "안녕하세요 🙂" 로 시작하세요.
2. 확신 있는 종결어미 사용: "~입니다", "~추천합니다", "~가 맞습니다" (단 "~보입니다" 최소화)
3. 딱딱한 섹션 구분선(━━━, ────) 대신 **볼드**와 줄바꿈으로 자연스럽게.
4. 마지막은 반드시 "성공적인 투자를 응원합니다 🙂" 로 끝내세요.
5. 추가 선택지는 "원하시면 ~도 분석해 드리겠습니다" 형태로 정중하게.

[분석 규칙]
1. 모든 판단에 수치와 근거를 반드시 포함하세요.
2. 데이터 기반으로만 말하고 투자를 보장하는 표현은 절대 사용하지 마세요.
3. 아래 표현은 절대 사용 금지: "몰빵", "올인", "무조건 사야 한다", "지금 안 사면 늦는다", "반드시 오른다"
4. 대신: "분할 접근", "보수적 접근", "나눠서 보는 것이 적절합니다"
5. 모든 답변은 한국어로 하되, 영문 티커와 수치는 그대로 사용하세요.

${UNIVERSAL_RULES}`;
}

// Tone-dependent strings
function toneStrings(tone) {
    if (tone === 'cute') return {
        opener: '울 귀염둥이 😊',
        ending: '귀염둥이 예리의 성공적인 투자를 응원합니다♡',
        followUp: '원하면 제가',
        followUpEnd: '까지 이어서 볼게요.',
        style: '~보여요, ~있어요, ~시각이 많아요, ~자연스러워요'
    };
    return {
        opener: '안녕하세요 🙂',
        ending: '성공적인 투자를 응원합니다 🙂',
        followUp: '원하시면',
        followUpEnd: '도 분석해 드리겠습니다.',
        style: '~보입니다, ~시각이 많습니다, ~적절합니다'
    };
}

// ──────────────────────────────────────────────────────────
// AI 점수 계산 엔진 — 기술/펀더멘털/뉴스/시장 각 0~10점
// ──────────────────────────────────────────────────────────
function computeScore(data) {
    const { technical, fundamentals, news, macro, history } = data;
    let techScore = 5;  // 기본값 중립
    let fundScore = 5;
    let newsScore = 5;
    let macroScore = 5;
    const detail = [];

    // ── 기술 점수 (0~10) ──
    if (technical) {
        const rsi = technical.rsi;
        const macdHist = technical.macd ? parseFloat(technical.macd.hist) : null;
        const price = data.price?.current;
        const ema50 = technical.ema50 ? parseFloat(technical.ema50) : null;
        const sma200 = technical.sma200 ? parseFloat(technical.sma200) : null;
        let t = 5;
        if (rsi != null) {
            if (rsi < 30) t += 2;       // 과매도 → 매수 신호
            else if (rsi < 45) t += 1;
            else if (rsi > 70) t -= 2;  // 과매수 → 위험
            else if (rsi > 60) t -= 1;
        }
        if (macdHist != null) {
            if (macdHist > 0) t += 1;   // 상승 모멘텀
            else t -= 1;
        }
        if (price && ema50) {
            if (price > ema50) t += 1;  // 50일선 위
            else t -= 1;
        }
        if (price && sma200) {
            if (price > sma200) t += 1; // 200일선 위
            else t -= 1;
        }
        techScore = Math.max(0, Math.min(10, t));
        detail.push(`기술 ${techScore}/10 (RSI:${rsi?.toFixed(1)||'N/A'}, MACD:${macdHist > 0 ? '↑' : '↓'}, EMA50:${price && ema50 ? (price > ema50 ? '위' : '아래') : 'N/A'})`);
    }

    // ── 펀더멘털 점수 (0~10) ──
    if (fundamentals) {
        let f = 5;
        const pe = fundamentals.peRatio ? parseFloat(fundamentals.peRatio) : null;
        const roe = fundamentals.roe ? parseFloat(fundamentals.roe) : null;
        const growth = fundamentals.revenueGrowthYoY ? parseFloat(fundamentals.revenueGrowthYoY) : null;
        const netMargin = fundamentals.netMargin ? parseFloat(fundamentals.netMargin) : null;
        if (pe != null) {
            if (pe < 15) f += 2;    // 저평가
            else if (pe < 25) f += 1;
            else if (pe > 40) f -= 2; // 고평가
            else if (pe > 30) f -= 1;
        }
        if (roe != null) {
            if (roe > 20) f += 1;
            else if (roe < 5) f -= 1;
        }
        if (growth != null) {
            if (growth > 20) f += 1;
            else if (growth < 0) f -= 1;
        }
        if (netMargin != null) {
            if (netMargin > 20) f += 1;
            else if (netMargin < 0) f -= 1;
        }
        fundScore = Math.max(0, Math.min(10, f));
        detail.push(`펀더멘털 ${fundScore}/10 (PER:${pe?.toFixed(1)||'N/A'}, ROE:${roe?.toFixed(1)||'N/A'}%, 성장:${growth?.toFixed(1)||'N/A'}%)`);
    } else {
        detail.push(`펀더멘털 ${fundScore}/10 (데이터 없음 — 중립 처리)`);
    }

    // ── 뉴스 점수 (0~10) ──
    if (news?.length > 0) {
        // 뉴스 건수 기반 기본 점수 + 제목 긍정/부정 키워드
        let n = 5;
        const positiveKw = ['beat', 'surge', 'record', 'growth', 'buy', 'upgrade', 'bullish', '급등', '호실적', '매수', '상향'];
        const negativeKw = ['miss', 'fall', 'drop', 'downgrade', 'sell', 'bearish', 'layoff', '급락', '어닝쇼크', '매도', '하향', 'lawsuit', 'tariff'];
        let pos = 0, neg = 0;
        for (const article of news.slice(0, 7)) {
            const t = (article.title || '').toLowerCase();
            if (positiveKw.some(k => t.includes(k))) pos++;
            if (negativeKw.some(k => t.includes(k))) neg++;
        }
        n += Math.min(2, pos) - Math.min(2, neg);
        newsScore = Math.max(0, Math.min(10, n));
        detail.push(`뉴스 ${newsScore}/10 (${news.length}건, 긍정신호:${pos}, 부정신호:${neg})`);
    } else {
        detail.push(`뉴스 ${newsScore}/10 (데이터 없음 — 중립 처리)`);
    }

    // ── 시장/거시 점수 (0~10) ──
    if (macro) {
        let m = 5;
        const vix = macro.vix ? parseFloat(macro.vix) : null;
        const rate = macro.federalFundsRate ? parseFloat(macro.federalFundsRate) : null;
        const ty = macro.tenYearYield ? parseFloat(macro.tenYearYield) : null;
        if (vix != null) {
            if (vix < 18) m += 2;        // 저변동성 — 안정
            else if (vix < 25) m += 1;
            else if (vix > 30) m -= 2;   // 고변동성 — 위험
            else if (vix > 22) m -= 1;
        }
        if (rate != null) {
            if (rate < 3) m += 1;
            else if (rate > 5) m -= 1;
        }
        if (ty != null) {
            if (ty > 4.5) m -= 1;        // 높은 채권금리 → 성장주 부담
        }
        macroScore = Math.max(0, Math.min(10, m));
        detail.push(`시장 ${macroScore}/10 (VIX:${vix?.toFixed(1)||'N/A'}, 기준금리:${rate?.toFixed(2)||'N/A'}%, 10Y:${ty?.toFixed(2)||'N/A'}%)`);
    } else {
        detail.push(`시장 ${macroScore}/10 (데이터 없음 — 중립 처리)`);
    }

    const total = techScore + fundScore + newsScore + macroScore;

    // ── 점수 → 행동 자동 연결 ──────────────────────────────
    let verdict, suggestedAction, probability, triggerHint;

    if (total >= 33) {
        verdict         = '✅ 강한 긍정';
        suggestedAction = '분할매수';
        probability     = '상승 확률 높음 📈';
        triggerHint     = '지금 구간부터 분할 진입 가능. 지지선 이탈 시 즉시 손절.';
    } else if (total >= 28) {
        verdict         = '✅ 긍정';
        suggestedAction = '매수 준비';
        probability     = '상승 가능성 우세 📈';
        triggerHint     = '1차 목표 가격 근처에서 소량 진입 후 추가 눌림 시 분할.';
    } else if (total >= 23) {
        verdict         = '⚖️ 중립·관망';
        suggestedAction = '관망';
        probability     = '방향 애매 — 조건 충족 전 대기 ↔️';
        triggerHint     = 'EMA20 돌파 또는 명확한 지지 확인 후 진입. 손절선은 진입 시 즉시 설정.';
    } else if (total >= 18) {
        verdict         = '⚠️ 중립·주의';
        suggestedAction = '관망';
        probability     = '하락 리스크 있음 ⚠️';
        triggerHint     = '급락 시 분할 대응 가능하나, 추세 회복 확인 전 신규 매수 금지.';
    } else {
        verdict         = '🔴 위험';
        suggestedAction = '매수 금지 / 리스크 관리';
        probability     = '하락 추세 — 보유 리스크 높음 📉';
        triggerHint     = '지지선 확인 및 거래량 회복 전까지 매수 금지. 보유 중이면 손절 기준 재점검.';
    }

    const summary =
`[AI 점수판단]
기술: ${techScore}/10 | 펀더멘털: ${fundScore}/10 | 뉴스: ${newsScore}/10 | 시장: ${macroScore}/10
총점: ${total}/40 → ${verdict}
${detail.join('\n')}

[행동 지시]
추천 행동: ${suggestedAction}
확률 강도: ${probability}
트리거 힌트: ${triggerHint}

⚠️ 반드시 위 [행동 지시]를 답변에 반영하세요. 총점이 낮을수록 매수 금지 기조를 유지하세요.`;

    return { techScore, fundScore, newsScore, macroScore, total, verdict, suggestedAction, probability, triggerHint, summary };
}

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

// 큰 수 포맷 (억/조 등)
function fmtLargeNum(val, currency = '$') {
    if (val == null) return '데이터 없음';
    const abs = Math.abs(val);
    if (abs >= 1e12) return `${currency}${(val / 1e12).toFixed(2)}T`;
    if (abs >= 1e9)  return `${currency}${(val / 1e9).toFixed(2)}B`;
    if (abs >= 1e6)  return `${currency}${(val / 1e6).toFixed(1)}M`;
    return `${currency}${val.toLocaleString()}`;
}

// ──────────────────────────────────────────────────────────
// 뉴스 필터링 및 감성 분류
// ──────────────────────────────────────────────────────────
function filterAndAnalyzeNews(news, ticker, companyName) {
    if (!news?.length) return { positive: [], negative: [], neutral: [], filtered: [], total: 0 };

    const positiveKw = ['beat', 'surge', 'record', 'growth', 'buy', 'upgrade', 'bullish',
        'raises', 'expand', 'profit', 'boost', 'gains', 'rally', 'breakthrough', 'partner',
        '급등', '호실적', '매수', '상향', '성장', '흑자', '계약', '수주', '개선', '돌파'];
    const negativeKw = ['miss', 'fall', 'drop', 'downgrade', 'sell', 'bearish', 'layoff',
        'lawsuit', 'tariff', 'penalty', 'warn', 'loss', 'decline', 'cut', 'delay', 'recall',
        '급락', '어닝쇼크', '매도', '하향', '적자', '규제', '소송', '해고', '부진', '하락'];

    // 종목 관련 키워드 (필터링)
    const tickerBase = ticker.replace('.KS', '').replace('.KQ', '').toLowerCase();
    const nameTokens = (companyName || '').toLowerCase().split(/\s+/).filter(t => t.length > 2);
    const relevantKw = [tickerBase, ...nameTokens];

    const relevant = news.filter(n => {
        const text = `${n.title || ''} ${n.description || ''}`.toLowerCase();
        // 티커/회사명 포함이거나 충분히 짧은 쿼리(일반 경제뉴스) 허용
        return relevantKw.some(kw => text.includes(kw)) || news.length <= 3;
    });

    // 뉴스가 0개면 전체 사용
    const pool = relevant.length > 0 ? relevant : news;

    const positive = [];
    const negative = [];
    const neutral = [];

    for (const n of pool.slice(0, 8)) {
        const text = `${n.title || ''} ${n.description || ''}`.toLowerCase();
        const posCount = positiveKw.filter(k => text.includes(k)).length;
        const negCount = negativeKw.filter(k => text.includes(k)).length;

        const item = {
            date: n.publishedAt || '날짜없음',
            title: n.title || '',
            source: n.source || 'Unknown',
            url: n.url || ''
        };

        if (posCount > negCount) positive.push(item);
        else if (negCount > posCount) negative.push(item);
        else neutral.push(item);
    }

    return { positive, negative, neutral, filtered: pool, total: pool.length };
}

function buildDataSummary(data) {
    const { ticker, companyName, price, history, technical, bbands, fundamentals,
            news, macro, disclosures, analystRatings, secFilings, supportResist } = data;
    const currency = ticker.endsWith('.KS') ? '₩' : '$';
    const lines = [];

    // ── 가격 ──
    if (price) {
        lines.push(`[현재가] ${fmtPrice(price.current, currency)} | 전일비 ${fmt(price.changePct?.toFixed(2), '', '%')} | 출처: ${price.source || '-'}`);
        lines.push(`고가: ${fmtPrice(price.high, currency)} | 저가: ${fmtPrice(price.low, currency)} | 전일종가: ${fmtPrice(price.prevClose, currency)}`);
        if (price.fifty2High) lines.push(`52주 고점: ${fmtPrice(price.fifty2High, currency)} | 52주 저점: ${fmtPrice(price.fifty2Low, currency)}`);
    }
    if (history) {
        lines.push(`[가격 흐름] 1주: ${fmt(history.change1W, '', '%')} | 1개월: ${fmt(history.change1M, '', '%')} | 3개월: ${fmt(history.change3M, '', '%')}`);
    }
    if (supportResist) {
        lines.push(`[지지/저항] 지지: ${fmtPrice(supportResist.support, currency)} | 저항: ${fmtPrice(supportResist.resistance, currency)}`);
    }

    // ── 기술적 지표 ──
    if (technical) {
        lines.push(`[기술적] RSI: ${fmt(technical.rsi?.toFixed(2))} (${technical.rsiSignal}) | 출처: ${technical.source || '-'}`);
        if (technical.macd) lines.push(`MACD: ${technical.macd.macd} | Signal: ${technical.macd.signal} | Hist: ${technical.macd.hist} → ${technical.macd.trend}`);
        lines.push(`EMA20: ${fmtPrice(technical.ema20, currency)} | EMA50: ${fmtPrice(technical.ema50, currency)} | SMA200: ${fmtPrice(technical.sma200, currency)}`);
        if (technical.stoch) lines.push(`스토캐스틱 K: ${technical.stoch.k} | D: ${technical.stoch.d}`);
        if (technical.avgVolume) lines.push(`평균 거래량(5일): ${technical.avgVolume.toLocaleString()}`);
    }
    if (bbands) {
        lines.push(`[볼린저밴드] 상단: ${fmtPrice(bbands.upper, currency)} | 중단: ${fmtPrice(bbands.middle, currency)} | 하단: ${fmtPrice(bbands.lower, currency)}`);
    }

    // ── 재무 (핵심 4대 지표 포함) ──
    if (fundamentals) {
        lines.push(`[기업] ${fundamentals.companyName || ticker} | 섹터: ${fundamentals.sector || '-'} | 출처: ${fundamentals.source || '-'}`);
        lines.push(`PER: ${fmt(fundamentals.peRatio)} | 선행PER: ${fmt(fundamentals.forwardPE)} | EPS: ${fmt(fundamentals.eps)} | PBR: ${fmt(fundamentals.pbRatio)}`);
        lines.push(`D/E(부채비율): ${fmt(fundamentals.debtToEquity)} | 순이익률: ${fmt(fundamentals.netMargin)} | ROE: ${fmt(fundamentals.roe)}`);

        // 영업이익률 계산 (있으면 직접, 없으면 revenue/operatingIncome으로)
        let opMargin = fundamentals.operatingMargin || null;
        if (!opMargin && fundamentals.operatingIncome != null && fundamentals.revenue != null && fundamentals.revenue !== 0) {
            opMargin = ((fundamentals.operatingIncome / fundamentals.revenue) * 100).toFixed(1) + '%';
        }

        lines.push(`[재무 핵심] 매출: ${fmtLargeNum(fundamentals.revenue, currency)} | 순이익: ${fmtLargeNum(fundamentals.netIncome, currency)} | 영업이익: ${fmtLargeNum(fundamentals.operatingIncome, currency)}`);
        lines.push(`잉여현금흐름(FCF): ${fmtLargeNum(fundamentals.freeCashFlow, currency)} | 영업이익률: ${opMargin || '데이터 없음'}`);
        lines.push(`매출성장(YoY): ${fmt(fundamentals.revenueGrowthYoY)} | 베타: ${fmt(fundamentals.beta)}`);
        if (fundamentals.mktCap) lines.push(`시가총액: ${fmtLargeNum(fundamentals.mktCap, currency)}`);
        if (fundamentals.nextEarningsDate) lines.push(`📅 다음 실적 발표: ${fundamentals.nextEarningsDate}`);
    } else {
        lines.push(`[재무] ⚠️ 펀더멘털 데이터 없음 — 재무 분석 불가`);
    }

    // ── 애널리스트 ──
    if (analystRatings?.consensus?.targetMean) {
        const c = analystRatings.consensus;
        lines.push(`[기관 의견] 평균 목표가: ${fmtPrice(parseFloat(c.targetMean).toFixed(2), currency)} | 고: ${fmtPrice(c.targetHigh, currency)} | 저: ${fmtPrice(c.targetLow, currency)} | 컨센서스: ${c.rating || '-'}`);
        if (analystRatings.recent?.length) {
            lines.push(`최근 애널: ${analystRatings.recent.slice(0, 3).map(r => `${r.firm}(${r.rating})`).join(', ')}`);
        }
    }
    if (secFilings?.length) {
        lines.push(`[SEC 공시] ${secFilings.slice(0, 3).map(f => `[${f.date}] ${f.form}`).join(' | ')}`);
    }

    // ── 뉴스 (필터링 결과 포함) ──
    const newsAnalysis = filterAndAnalyzeNews(news, ticker, companyName);
    const newsLines = newsAnalysis.filtered.slice(0, 7).map(n => `- [${n.date}] ${n.title} (${n.source})`);
    if (newsLines.length) {
        lines.push(`[최근 뉴스 필터링됨 ${newsAnalysis.total}건]\n${newsLines.join('\n')}`);
        if (newsAnalysis.positive.length) lines.push(`긍정 신호(${newsAnalysis.positive.length}): ${newsAnalysis.positive.map(n => n.title.slice(0, 50)).join(' / ')}`);
        if (newsAnalysis.negative.length) lines.push(`부정 신호(${newsAnalysis.negative.length}): ${newsAnalysis.negative.map(n => n.title.slice(0, 50)).join(' / ')}`);
    } else {
        lines.push(`[최근 뉴스] ⚠️ 뉴스 없음 — 뉴스 섹션에 "뉴스 없음" 명시요`);
    }

    if (disclosures?.length) {
        lines.push(`[공시]\n${disclosures.slice(0, 5).map(d => `- [${d.date}] ${d.name}`).join('\n')}`);
    }

    // ── 거시경제 ──
    if (macro) {
        lines.push(`[거시경제] 기준금리: ${fmt(macro.federalFundsRate, '', '%')} | CPI: ${fmt(macro.cpi)} | 실업률: ${fmt(macro.unemployment, '', '%')} | 10Y채권: ${fmt(macro.tenYearYield, '', '%')} | VIX: ${fmt(macro.vix)} | 기대인플레: ${fmt(macro.breakEvenInflation, '', '%')}`);
    } else {
        lines.push(`[거시경제] ⚠️ 거시 데이터 없음`);
    }

    // ── API 출처 요약 (디버그용) ──
    lines.push(`\n[📡 API 출처]
  가격:     ${price?.source       || '없음(fallback실패)'}
  기술지표: ${technical?.source   || '없음(fallback실패)'}
  재무:     ${fundamentals?.source|| '없음(fallback실패)'}
  뉴스:     ${newsLines.length > 0 ? `있음 (${newsAnalysis.total}건 필터됨)` : '없음'}
  거시:     ${macro?.source       || '없음(fallback실패)'}
  애널리스트:${analystRatings?.source || '없음'}`);

    // ── 데이터 신뢰도 등급 ──
    if (data._reliability) {
        const r = data._reliability;
        lines.push(`\n[📊 데이터 신뢰도: ${r.emoji} ${r.reliability} (${r.pct}%)]`);
        lines.push(`등급: ${r.tier} — ${r.label}`);
        if (r.missing.length) lines.push(`미확보 항목: ${r.missing.join(', ')} → 이 항목은 분석에서 제외하세요. 절대 추측하지 마세요.`);
    }
    if (data._partialWarning) {
        lines.push(data._partialWarning);
    }

    return lines.join('\n');
}

// ──────────────────────────────────────────────────────────
// OpenAI Responses API call
// ──────────────────────────────────────────────────────────
async function callOpenAI(userContent, useDeepModel = false, tone = 'normal') {
    const model = useDeepModel ? MODEL_DEEP : MODEL_DEFAULT;
    console.log(`[Analyzer] Model: ${model}, Tone: ${tone}`);
    try {
        const response = await client.responses.create({
            model,
            instructions: getSystemPrompt(tone),
            input: userContent,
            max_output_tokens: useDeepModel ? 4000 : 3000,
        });
        return response.output_text;
    } catch (err) {
        console.error(`❌ [callOpenAI] Failed! Model: ${model}`);
        console.error(`   → Env key used: OPENAI_API_KEY`);
        console.error(`   → Status: ${err.status} | Code: ${err.code}`);
        console.error(`   → Message: ${err.message}`);
        console.error('   → Stack Trace:', err.stack);
        throw err;
    }
}

// ──────────────────────────────────────────────────────────
// STOCK ANALYSIS — 12 sections
// ──────────────────────────────────────────────────────────
async function analyzeStock(data, useDeep = false, tone = 'normal') {
    const dataSummary = buildDataSummary(data);
    const score = computeScore(data);
    const today = new Date().toLocaleDateString('ko-KR');
    const ctx = data.investmentContext || {};
    const horizonNote = ctx.horizon
        ? `\n[투자 기간: ${ctx.horizon} | 성향: ${ctx.riskProfile || '미제공'} | 목표수익: ${ctx.targetReturn || '미제공'} | 보유여부: ${ctx.holding === true ? '보유 중' : ctx.holding === false ? '미보유' : '미제공'}]\n→ 이 맥락에 맞게 전략을 맞춤화하세요.\n`
        : '';

    const prompt = `
다음 데이터를 바탕으로 아래 섹션을 반드시 모두 작성하세요.
수치에는 구체적인 가격을 포함하고, 근거 없는 표현은 사용하지 마세요.
★★★ 반드시 ${data.companyName || data.ticker} (${data.ticker})만 분석하세요. 다른 종목(NVDA, MSFT, AAPL 등)으로 대체 분석 절대 금지. ★★★
${data._dataWarning ? `\n${data._dataWarning}\n` : ''}
[분석 기준일: ${today}]
[분석 대상: ${data.companyName || data.ticker} (${data.ticker})]
${horizonNote}
${score.summary}

${dataSummary}

────────────────────────────────

📊 AI 종합 주식 분석 리포트
종목: ${data.companyName || data.ticker} (${data.ticker})
분석 기준: ${today}

━━━━━━━━━━━━━━━━━━━━━━
1️⃣ 현재 시장 위치 판단 (핵심)

아래 3단계 중 하나를 반드시 선택하여 굵게 표시하고 이유를 2~3줄로 설명하세요:
→ 📉 저점 구간 | ↔️ 중립 구간 | 📈 과열 구간

판단 기준: RSI, MACD, 볼린저밴드, 52주 위치, 거래량을 종합
판단 이후: "따라서 ___보다 ___이 적절한 구간"으로 마무리

━━━━━━━━━━━━━━━━━━━━━━
2️⃣ 현재 상황 요약
• 현재 주가 및 52주 위치
• 최근 1개월 / 3개월 흐름
• 시장 내 한 줄 위치 설명

━━━━━━━━━━━━━━━━━━━━━━
3️⃣ 기술적 분석
• RSI: [수치] → [과매수/과매도/중립 해석]
• MACD: [수치 + 방향]
• EMA/SMA: [현재가 대비 위치]
• 볼린저밴드: [위치]
• 거래량: [분석]
• 주요 지지선: [수치] | 강한 지지: [수치]
• 주요 저항선: [수치] | 차기 저항: [수치]

━━━━━━━━━━━━━━━━━━━━━━
4️⃣ 기업 / 재무 분석
• 매출 안정성 / 성장성
• 재무 건전성 (부채비율, ROE 등)
• 밸류에이션 (PER, EPS, 선행PER)
• 장점 3가지
• 단점 / 리스크 2가지

━━━━━━━━━━━━━━━━━━━━━━
5️⃣ 업종 전망 (산업 상위 관점)

이 종목이 속한 업종/섹터의 중기 전망을 설명하세요:
• 수요 / 공급 흐름
• 글로벌 트렌드 (AI, 반도체, EV 등 해당 시)
• 업종 전반 방향성: [긍정 / 중립 / 부정] + 이유 한 줄

━━━━━━━━━━━━━━━━━━━━━━
6️⃣ 뉴스 / 시장 영향
• 📍 핵심 뉴스 1선: 가장 중요한 뉴스 제목을 먼저 1줄로 제시하고, 해당 뉴스가 주가에 미치는 단기/중기 영향을 2~3줄로 설명하세요.
• 기타 긍정 요인 (호재)
• 주의 요인 (악재 / 리스크)
• 중요 공시 또는 SEC 신고 (해당 시)

━━━━━━━━━━━━━━━━━━━━━━
7️⃣ 시장 환경 분석
• 금리 영향
• 환율 영향 (해당 시)
• 나스닥 / S&P500 흐름과의 연관성
• 섹터 분위기

━━━━━━━━━━━━━━━━━━━━━━
8️⃣ 매수 전략${ctx.horizon ? ` (${ctx.horizon} 기준)` : ''}
• 1차 매수 구간: [가격]
• 2차 매수 구간: [가격]
• 추세 확인 후 매수 조건: [조건]
• 현재 접근 방법: [분할 접근 / 관망 / 조건부 접근 중 선택]

━━━━━━━━━━━━━━━━━━━━━━
9️⃣ 매도 전략 (목표가 + 예상 수익률)

현재가를 기준으로 예상 수익률을 반드시 함께 표시하세요:
• 1차 목표가: [가격] (약 +X%)
• 2차 목표가: [가격] (약 +X%)
• 분할 매도 구간: [가격 범위]
• 손절 기준: [가격] 이탈 시 (약 -X%)

━━━━━━━━━━━━━━━━━━━━━━
🔟 AI 확률 판단

기술적 지표, 뉴스 흐름, 거시경제를 종합하여 향후 1~3개월 확률을 추정하세요.
합계는 반드시 100%:

📈 상승 가능성: XX%
↔️ 횡보 가능성: XX%
📉 하락 가능성: XX%

[판단 근거 2줄]

━━━━━━━━━━━━━━━━━━━━━━
1️⃣1️⃣ 같은 산업 비교 종목
같은 섹터 / 업종 3~5개 비교 종목 + 각각 한 줄 설명:
예) 종목A → 설명

━━━━━━━━━━━━━━━━━━━━━━
1️⃣2️⃣ 리스크 요인
• 리스크 1
• 리스크 2
• 리스크 3

━━━━━━━━━━━━━━━━━━━━━━
1️⃣3️⃣ AI 종합 의견
[3~5줄의 균형 잡힌 판단. 근거 포함]
현재 전략: [분할 접근 ⭕ / 추격 매수 ❌ 등]

━━━━━━━━━━━━━━━━━━━━━━
1️⃣4️⃣ 투자 판단 요약 (한 줄 결론)

시장 위치 + 전략을 합쳐 단 두 문장으로 요약:
예) "지금은 강한 저점은 아니지만 업황 회복 기대가 있는 중립 구간으로, 분할 접근 전략이 적절합니다."

━━━━━━━━━━━━━━━━━━━━━━
1️⃣5️⃣ 추가 분석 선택
추가 분석을 진행할까요?

1️⃣ 비슷한 종목 비교
2️⃣ 향후 3개월 전망
3️⃣ 지금 매수 가능한지
4️⃣ 언제 파는 게 좋은지
5️⃣ 같은 업종 추천 종목

━━━━━━━━━━━━━━━━━━━━━━
귀염둥이 예리의 성공적이 투자를 응원합니다♡

📡 데이터 출처
• 가격: ${data.price?.source || '없음'}
• 기술지표: ${data.technical?.source || '없음'}
• 재무: ${data.fundamentals?.source || '없음'}
• 거시경제: ${data.macro?.source || 'FRED'}
• 뉴스: ${data.news?.length ? `${data.news.length}건` : '없음'}${data.ticker?.endsWith('.KS') ? '\n⚠️ 한국 종목 특성상 일부 데이터(재무/기술지표)는 미국 종목 대비 제한될 수 있습니다.' : ''}
────────────────────────────────
`;
    return callOpenAI(prompt, useDeep, tone);
}

// ──────────────────────────────────────────────────────────
// INTENT-SPECIFIC ANALYSIS — 매수/매도/리스크 집중 모드
// ──────────────────────────────────────────────────────────

async function analyzeStockBuyTiming(data, useDeep = false, tone = 'normal') {
    const dataSummary = buildDataSummary(data);
    const score = computeScore(data);
    const today = new Date().toLocaleDateString('ko-KR');
    const ctx = data.investmentContext || {};
    const t = toneStrings(tone);
    const prompt = `
매수 타이밍 질문입니다. 반드시 아래 구조로만 답변하세요.

[기준일: ${today}] [종목: ${data.companyName || data.ticker} (${data.ticker})]${ctx.horizon ? ` [기간: ${ctx.horizon}]` : ''}

${score.summary}

${dataSummary}

━━ 반드시 이 순서로 ━━
① ${t.opener}
② 👉 결론 1줄: "${score.suggestedAction}" — ${score.probability}
   (총점 ${score.total}/40 기반. 이 행동 문구를 그대로 또는 더 구체화해서 사용하세요)
③ **매수 전략** (가격 필수)
   - 1차 진입: $xx~xx (근거: 지지선/RSI)
   - 2차 진입: $xx~xx (눌림 확인 후)
   - 손절: $xx 이탈 시
④ **타이밍 트리거** (조건부 진입 조건 2개)
   👉 조건 A: $xx 도달 또는 RSI xx 이하 시 1차 진입
   👉 조건 B: EMA20/EMA50 돌파 시 추가 진입
⑤ 이유 수치 2~3줄 (RSI/EMA/지지선)
⑥ 추가 질문 유도 1줄
${t.ending}

[절대 금지] 거시 설명 3줄 이상 | 결론 마지막 배치 | 가격 없는 매수 의견 | 점수와 다른 행동 출력
`;
    return callOpenAI(prompt, useDeep, tone);
}

async function analyzeStockSellTiming(data, useDeep = false, tone = 'normal') {
    const dataSummary = buildDataSummary(data);
    const score = computeScore(data);
    const today = new Date().toLocaleDateString('ko-KR');
    const ctx = data.investmentContext || {};
    const t = toneStrings(tone);
    const prompt = `
매도/익절 전략 질문입니다. 반드시 아래 구조로만 답변하세요.

[기준일: ${today}] [종목: ${data.companyName || data.ticker} (${data.ticker})]${ctx.horizon ? ` [기간: ${ctx.horizon}]` : ''}

${score.summary}

${dataSummary}

━━ 반드시 이 순서로 ━━
① ${t.opener}
② 👉 결론 1줄: ${score.total >= 28 ? '"보유 유지 또는 일부 익절 고려"' : score.total >= 20 ? '"관망 / 추가 매수 보류"' : '"매도 준비 / 리스크 관리"'} — ${score.probability}
③ **목표가 전략** (가격 + 수익률 필수)
   - 1차 목표가: $xx (+X%) → 👉 여기서 30% 분할매도
   - 2차 목표가: $xx (+X%) → 👉 여기서 50% 매도
   - 손절선: $xx (-X%) 이탈 시 전량 손절
④ **타이밍 트리거** (조건부 청산 조건 2개)
   👉 조건 A: RSI xx 이상 또는 $xx 저항 도달 시 1차 익절
   👉 조건 B: 지지선 $xx 이탈 시 즉시 손절
⑤ 이유 2~3줄 (저항선/RSI/밸류)
⑥ 추가 질문 유도 1줄
${t.ending}

[절대 금지] 거시 설명 3줄 이상 | 가격 없는 매도 의견 | 결론 마지막 배치
`;
    return callOpenAI(prompt, useDeep, tone);
}

async function analyzeStockRisk(data, useDeep = false, tone = 'normal') {
    const dataSummary = buildDataSummary(data);
    const score = computeScore(data);
    const today = new Date().toLocaleDateString('ko-KR');
    const t = toneStrings(tone);
    const prompt = `
리스크 질문입니다. 리스크만 집중해서 답변하세요. (매수 구간/기술적 분석 금지)

[기준일: ${today}] [종목: ${data.companyName || data.ticker} (${data.ticker})]

${score.summary}

${dataSummary}

━━ 반드시 이 순서로 ━━
① ${t.opener}
② 👉 지금 가장 큰 리스크 핵심 1줄
③ **핵심 리스크 3가지** (각 1~2줄, 수치 기반)
   - 밸류에이션 리스크: PER ${data.fundamentals ? 'XX배 기준' : '데이터 없음'}
   - 사업/경쟁 리스크:
   - 시장/거시 리스크:
④ 이 리스크를 감안한 접근 방향 1줄
⑤ 추가 질문 유도 1줄
${t.ending}

[절대 금지] 매수 구간 언급 | 기술적 지표(RSI/EMA) 언급 | 5개 이상 나열
`;
    return callOpenAI(prompt, useDeep, tone);
}

async function analyzeStockEarnings(data, useDeep = false, tone = 'normal') {
    const dataSummary = buildDataSummary(data);
    const today = new Date().toLocaleDateString('ko-KR');
    const t = toneStrings(tone);
    const prompt = `
다음 데이터를 바탕으로 실적 전후 투자 전략에 집중해서 답변해주세요.

[분석 기준일: ${today}]
[종목: ${data.companyName || data.ticker} (${data.ticker})]

${dataSummary}

답변 포함 사항:

1. **다음 실적 발표일**: 데이터에 있다면 명시, 없으면 "현재 확인 가능한 기준으로는 ~" 식으로 자연스럽게
2. **컨센서스 예상 EPS**: 애널리스트 예상치와 실제 비교
3. **실적 전 전략**: 실적 발표 전에 접근할지, 기다릴지 시나리오형으로 설명
4. **실적 후 전략**: 보유 중일 때 대응 방안
5. **시나리오 분석**:
   - 어닝 서프라이즈 시: 예상 주가 반응 + 대응
   - 어닝 미스 시: 예상 주가 반응 + 대응
6. **관점별 차이**: 단타/스윙/장기 관점에서 실적 이벤트를 각각 어떻게 볼 것인지
7. **결론**: 실적 기준 투자 판단 요약

규칙:
1. 반드시 "${t.opener}"로 시작
2. 구체적 수치와 날짜 포함
3. 자연스러운 대화체 (${t.style})
4. 딱딱한 구분선 금지, **볼드**와 줄바꿈으로 구분
5. 과하게 단정하지 말고 시나리오형으로 설명
6. 마지막에 "${t.followUp} 이어서 ~도 볼게요" 형태
7. 마지막 문구: ${t.ending}
`;
    return callOpenAI(prompt, useDeep, tone);
}

/**
 * 종합 분석 but 자연스러운 대화체 (짧은 요약형)
 * "삼성전자 어때?" 같은 가벼운 질문용
 */
async function analyzeStockCasual(data, useDeep = false, tone = 'normal') {
    const t = toneStrings(tone);
    const dataSummary = buildDataSummary(data);
    const score = computeScore(data);
    const today = new Date().toLocaleDateString('ko-KR');
    const ctx = data.investmentContext || {};
    const horizonNote = ctx.horizon ? `[기간: ${ctx.horizon} | 성향: ${ctx.riskProfile || '미제공'}]` : '';
    const currency = (data.ticker || '').endsWith('.KS') ? '₩' : '$';

    // 데이터 부족 항목 체크
    const hasPrice = data.price?.current != null;
    const hasTech  = data.technical?.rsi != null;
    const hasFund  = data.fundamentals?.peRatio != null;
    const f        = data.fundamentals || {};

    // 뉴스 필터링 및 감성 분류
    const newsAn = filterAndAnalyzeNews(data.news, data.ticker, data.companyName);
    const posNews = newsAn.positive.slice(0, 2).map(n => `    🟢 긍정: ${n.title.slice(0, 60)} (${n.date})`).join('\n');
    const negNews = newsAn.negative.slice(0, 2).map(n => `    🔴 부정: ${n.title.slice(0, 60)} (${n.date})`).join('\n');
    const neuNews = newsAn.neutral.slice(0, 2).map(n => `    ⚪ 중립: ${n.title.slice(0, 60)} (${n.date})`).join('\n');
    const newsBlock = newsAn.total > 0
        ? [posNews, negNews, neuNews].filter(Boolean).join('\n') || `    ${newsAn.filtered[0]?.title || ''}` 
        : '    최신 뉴스 없음';

    // 재무 현황 블록
    const finBlock = hasFund ? [
        `    PER: ${f.peRatio ?? '데이터 없음'} | EPS: ${f.eps ?? '데이터 없음'} | PBR: ${f.pbRatio ?? '데이터 없음'}`,
        `    ROE: ${f.roe ?? '데이터 없음'} | D/E: ${f.debtToEquity ?? '데이터 없음'} | 순이익률: ${f.netMargin ?? '데이터 없음'}`,
        f.revenue    != null ? `    매출: ${(f.revenue/1e9).toFixed(1)}B | 순이익: ${f.netIncome != null ? (f.netIncome/1e9).toFixed(1)+'B' : '데이터 없음'}` : '    매출/순이익: 데이터 없음',
        f.freeCashFlow != null ? `    FCF: ${(f.freeCashFlow/1e9).toFixed(1)}B | 매출성장: ${f.revenueGrowthYoY ?? '데이터 없음'}` : `    FCF: 데이터 없음 | 매출성장: ${f.revenueGrowthYoY ?? '데이터 없음'}`,
    ].join('\n') : '    ⚠️ 펀더멘털 데이터 없음';

    // API 출처 (디버그 블록)
    const apiBlock = [
        `    가격:     ${data.price?.source          || '없음'} ${hasPrice ? '✅' : '❌'}`,
        `    기술지표: ${data.technical?.source       || '없음'} ${hasTech ? '✅' : '❌'}`,
        `    재무:     ${data.fundamentals?.source    || '없음'} ${hasFund ? '✅' : '❌'}`,
        `    뉴스:     ${newsAn.total > 0 ? `${newsAn.total}건 (긍${newsAn.positive.length}/부${newsAn.negative.length}/중${newsAn.neutral.length})` : '없음 ❌'}`,
        `    거시:     ${data.macro?.source           || '없음'} ${data.macro ? '✅' : '❌'}`,
        `    애널:     ${data.analystRatings?.source  || '없음'} ${data.analystRatings?.consensus?.targetMean ? '✅' : '❌'}`,
    ].join('\n');

    const prompt = `
아래는 ${data.companyName || data.ticker} (${data.ticker}) 실데이터입니다. 이 데이터만 사용하세요.
★★★ 반드시 ${data.companyName || data.ticker} (${data.ticker})만 분석하세요. 다른 종목(NVDA, MSFT, AAPL 등)으로 대체 분석 절대 금지. ★★★
${data._dataWarning ? `\n${data._dataWarning}\n` : ''}

[기준일: ${today}] ${horizonNote}
${score.summary}

${dataSummary}

━━ 반드시 이 순서 / 포맷으로 답변하세요 (절대 순서 변경 금지) ━━

${t.opener}

📌 **[결론]** ${score.suggestedAction} — ${score.probability}
  (총점 ${score.total}/40 기반. 명확하게)

💹 **[현재 가격]**
  - 현재가: ${hasPrice ? `${currency}${Number(data.price.current).toLocaleString()}` : '데이터 부족'}
  - 전일비: ${data.price?.changePct != null ? (Number(data.price.changePct) >= 0 ? '+' : '') + Number(data.price.changePct).toFixed(2) + '%' : '데이터 부족'}
  - 52주: ${data.price?.fifty2High && data.price?.fifty2Low ? `고 ${currency}${Number(data.price.fifty2High).toLocaleString()} / 저 ${currency}${Number(data.price.fifty2Low).toLocaleString()}` : '데이터 부족'}

📊 **[기술적 분석]**
  - RSI(14): ${hasTech ? Number(data.technical.rsi).toFixed(1) + ' → ' + (data.technical.rsiSignal || '') : '데이터 부족'}
  - EMA20/50: ${data.technical?.ema20 != null ? `${currency}${Number(data.technical.ema20).toFixed(2)} / ${currency}${Number(data.technical.ema50 || 0).toFixed(2)}` : '데이터 부족'}
  - MACD: ${data.technical?.macd?.trend || '데이터 부족'}
  - 지지/저항: ${data.supportResist?.support ? `${currency}${data.supportResist.support} / ${currency}${data.supportResist.resistance}` : '데이터 부족'}

💼 **[재무 상태]**
${finBlock}
  ※ 순이익이 적자인 경우 반드시 추가: "이 기업은 성장주 특성상 이익보다 매출 성장률·기술력·시장 점유율 확대에 가치가 반영됩니다. 흑자 전환 시점과 FCF(잉여현금흐름) 추이가 핵심 관찰 포인트입니다."

📰 **[뉴스 요약]** (${newsAn.total}건 분석됨)
${newsBlock}
  위 뉴스의 투자 영향을 2~3줄로 요약. 없으면 "최신 뉴스 없음" 명시.

⚠️ **[리스크]** (데이터 기반, 억지 창작 금지)
  리스크 2~3개 구체적으로

👉 **[행동 제안]** (반드시 현재가 기준 구체적 가격/조건 포함)
  ${score.suggestedAction === '분할매수' || score.suggestedAction === '매수 준비'
    ? `1차 진입 구간 / 2차 구간 / 손절선을 현재가(${hasPrice ? currency + Number(data.price.current).toLocaleString() : '현재가'}) 기준 수치로 명시. 예: "${hasPrice ? currency + (Number(data.price.current) * 0.97).toFixed(2) : 'xxx'} 지지 시 1차 매수", "${hasPrice ? currency + (Number(data.price.current) * 0.93).toFixed(2) : 'yyy'} 이탈 시 손절"`
    : score.suggestedAction === '관망'
    ? `진입 조건 명시. 예: "EMA20(${data.technical?.ema20 != null ? currency + Number(data.technical.ema20).toFixed(2) : 'xxx'}) 돌파 확인 후 진입", "${hasPrice ? currency + Number(data.supportResist?.support || data.price.current * 0.95).toFixed(2) : 'xxx'} 지지 확인 시 관심"`
    : `매수 금지. 하락 추세 지속 시 ${hasPrice ? currency + (Number(data.price.current) * 0.90).toFixed(2) : 'xxx'} 추가 하락 가능성 존재. 추세 회복(EMA20 회복) 전까지 신규 진입 금지.`}
  목표가 / 손절선 구체적으로 (${hasPrice ? '현재가 기준 %' : '조건부'})

${t.ending}

[📡 API 출처 — 이 블록을 답변 맨 끝에 그대로 포함하세요]
${apiBlock}

[절대 금지]
- 데이터 없는 수치 상상 출력
- 뉴스 없으면 "최신 뉴스 없음" 명시
- ${hasFund ? '' : '펀더멘털 없음 — 재무 수치 창작 금지'}
- 결론을 마지막에 배치
- 섹션 순서 변경
`;
    return callOpenAI(prompt, useDeep, tone);
}

// ──────────────────────────────────────────────────────────
// MARKET ANALYSIS
// ──────────────────────────────────────────────────────────
async function analyzeMarket(data, useDeep = false, tone = 'normal') {
    const { indices, macro, news } = data;
    const newsText = (news || []).slice(0, 6).map(n => `- [${n.publishedAt}] ${n.title}`).join('\n');
    const today = new Date().toLocaleDateString('ko-KR');

    const prompt = `
다음 데이터를 기반으로 시장 전체 분석 리포트를 작성하세요.

[데이터 기준일: ${today}]
[시장 지수]
S&P 500: ${indices?.['S&P 500']?.current || 'N/A'} (${indices?.['S&P 500']?.changePct?.toFixed(2) || 'N/A'}%)
NASDAQ: ${indices?.['NASDAQ']?.current || 'N/A'} (${indices?.['NASDAQ']?.changePct?.toFixed(2) || 'N/A'}%)
DOW: ${indices?.['DOW']?.current || 'N/A'} (${indices?.['DOW']?.changePct?.toFixed(2) || 'N/A'}%)
[거시경제]
기준금리: ${macro?.federalFundsRate || 'N/A'}% | CPI: ${macro?.cpi || 'N/A'} | 실업률: ${macro?.unemployment || 'N/A'}%
10Y채권: ${macro?.tenYearYield || 'N/A'}% | VIX: ${macro?.vix || 'N/A'} | 기대인플레: ${macro?.breakEvenInflation || 'N/A'}%
[최근 뉴스]\n${newsText || '데이터 없음'}

────────────────────────────────
🌐 시장 전체 AI 분석 리포트
분석 기준: ${today}

━━━━━━━━━━━━━━━━━━━━━━
1️⃣ 현재 시장 한 줄 위치
(예: "지금은 금리 불확실성 속 방향을 탐색하는 구간입니다.")

━━━━━━━━━━━━━━━━━━━━━━
2️⃣ 주요 시장 지수 현황

━━━━━━━━━━━━━━━━━━━━━━
3️⃣ 금리 / CPI / 거시경제 영향

━━━━━━━━━━━━━━━━━━━━━━
4️⃣ VIX 및 변동성 분석

━━━━━━━━━━━━━━━━━━━━━━
5️⃣ 섹터별 분위기 (반도체 / AI / 전기차 / 금융 / 헬스케어)

━━━━━━━━━━━━━━━━━━━━━━
6️⃣ 성장주 vs 가치주 심리

━━━━━━━━━━━━━━━━━━━━━━
7️⃣ 최근 뉴스 영향 분석

━━━━━━━━━━━━━━━━━━━━━━
8️⃣ AI 시장 종합 전망
현재 전략: [분할 접근 / 관망 / 선별 매수 등]

━━━━━━━━━━━━━━━━━━━━━━
9️⃣ 리스크 요인

━━━━━━━━━━━━━━━━━━━━━━
🔟 투자자별 전략 (단타 / 스윙 / 장기)

━━━━━━━━━━━━━━━━━━━━━━
귀염둥이 예리의 성공적이 투자를 응원합니다♡
────────────────────────────────
`;
    return callOpenAI(prompt, useDeep, tone);
}

// ──────────────────────────────────────────────────────────
// SECTOR ANALYSIS
// ──────────────────────────────────────────────────────────
async function analyzeSector(sectorData, useDeep = false, tone = 'normal') {
    const { sector, stocks, marketData } = sectorData;
    const today = new Date().toLocaleDateString('ko-KR');
    const stockSummaries = stocks.map(s => buildDataSummary(s)).join('\n\n---\n\n');

    const prompt = `
다음은 [${sector}] 섹터 분석 데이터입니다.

[분석 기준일: ${today}]
[대표 종목 데이터]
${stockSummaries}

[시장 데이터]
S&P 500: ${marketData.indices?.['S&P 500']?.current || 'N/A'} | NASDAQ: ${marketData.indices?.['NASDAQ']?.current || 'N/A'}
금리: ${marketData.macro?.federalFundsRate || 'N/A'}% | VIX: ${marketData.macro?.vix || 'N/A'}

────────────────────────────────
📡 [${sector}] 섹터 AI 분석 리포트
분석 기준: ${today}

━━━━━━━━━━━━━━━━━━━━━━
1️⃣ [${sector}] 섹터 한 줄 위치

━━━━━━━━━━━━━━━━━━━━━━
2️⃣ 대표 종목 현황 및 기술적 분석

━━━━━━━━━━━━━━━━━━━━━━
3️⃣ 섹터 성장성 및 재무 건전성

━━━━━━━━━━━━━━━━━━━━━━
4️⃣ 최근 섹터 뉴스 및 이슈

━━━━━━━━━━━━━━━━━━━━━━
5️⃣ 금리 / 거시경제와의 연관성

━━━━━━━━━━━━━━━━━━━━━━
6️⃣ 지금 이 섹터 투자 판단 (분할 접근 / 관망 중 선택)

━━━━━━━━━━━━━━━━━━━━━━
7️⃣ 추천 접근 종목 (3~5개, 이유 포함)

━━━━━━━━━━━━━━━━━━━━━━
8️⃣ 리스크 요인

━━━━━━━━━━━━━━━━━━━━━━
9️⃣ AI 섹터 종합 의견

━━━━━━━━━━━━━━━━━━━━━━
관심 있는 종목을 알려주시면 매수 타이밍, 목표가, 손절가까지 구체적으로 분석해 드리겠습니다.

귀염둥이 예리의 성공적이 투자를 응원합니다♡
────────────────────────────────
`;
    return callOpenAI(prompt, useDeep, tone);
}

// ──────────────────────────────────────────────────────────
// FALLBACK CHAT — 일반 대화용 경량 응답
// ──────────────────────────────────────────────────────────
async function fallbackChat(message, tone = 'normal') {
    const t = toneStrings(tone);
    const prompt = `
사용자가 투자 비서 "예리"에게 아래 메시지를 보냈어요.
이것은 투자 분석 질문이 아니라 일반 대화입니다.

사용자 메시지: "${message}"

답변 규칙:
1. 반드시 "${t.opener}"로 시작
2. 짧고 자연스럽게 2~6줄 정도로 답변
3. 투자/주식 분석은 실행하지 말 것
4. 마지막에 자연스럽게 투자 대화로 연결 유도
5. 마지막 문구: ${t.ending}
6. 말투: ${t.style}
7. 예리는 주식/시장/섹터/종목 분석, 매수매도 타이밍, 추천 종목, 관심종목 관리를 도와줄 수 있어요
`;
    return callOpenAI(prompt, false, tone);
}

// ──────────────────────────────────────────────────────────
// ETF ANALYSIS — 지수/섹터/시장 흐름 중심
// ──────────────────────────────────────────────────────────
async function analyzeETF(data, useDeep = false, tone = 'normal', etfMeta = {}) {
    const dataSummary = buildDataSummary(data);
    const today = new Date().toLocaleDateString('ko-KR');
    const t = toneStrings(tone);
    const isLeveraged = etfMeta.isLeveraged || false;
    const peers = etfMeta.peers || [];
    const leveragedWarning = isLeveraged
        ? `\n⚠️ 이 ETF는 레버리지/인버스 상품입니다. 장기 보유 시 복리 효과로 원금 손실 리스크가 매우 큽니다. 반드시 단기 트레이딩 관점에서만 접근하세요.\n`
        : '';

    const prompt = `
다음 데이터를 바탕으로 ETF 분석을 해주세요.

[분석 기준일: ${today}]
[ETF: ${data.companyName || data.ticker} (${data.ticker})]
${leveragedWarning}

${dataSummary}

이 ETF는 기업이 아닌 ETF(상장지수펀드)입니다.
따라서 기업 재무 분석 대신 아래 관점으로 분석하세요:

1. **ETF 특성**: 이 ETF가 추종하는 지수/섹터/자산 클래스 설명
2. **시장 맥락**: 현재 금리, 나스닥/S&P 흐름, 해당 섹터 분위기가 이 ETF에 미치는 영향
3. **최근 흐름**: 1주/1개월/3개월 수익률 분석
4. **기술적 분석**: RSI, MACD, 지지/저항 수준
${isLeveraged ? '5. **레버리지 리스크**: 이 ETF는 레버리지/인버스 상품이므로 변동성 decay, 장기보유 위험, 적정 보유 기간을 반드시 경고' : '5. **구성 종목 특성**: 주요 편입 종목과 섹터 비중'}
6. **매수/매도 전략**: 접근 구간과 목표가
7. **비교 ETF**: ${peers.length ? peers.join(', ') + ' 등' : '유사 ETF'} 비교
8. **한 줄 총평**

규칙:
1. 반드시 "${t.opener}"로 시작
2. 자연스러운 대화체 (${t.style})
3. 딱딱한 구분선 금지, **볼드**와 줄바꿈으로 구분
4. 투자 보장 금지
5. 마지막에 "${t.followUp} 이어서 ~도 볼게요" 형태
6. 마지막 문구: ${t.ending}
`;
    return callOpenAI(prompt, useDeep, tone);
}

// ──────────────────────────────────────────────────────────
// PORTFOLIO ANALYSIS — 자산배분 관점 분석
// ──────────────────────────────────────────────────────────
async function analyzePortfolio(portfolioItems, useDeep = false, tone = 'normal') {
    const today = new Date().toLocaleDateString('ko-KR');
    const t = toneStrings(tone);
    
    // portfolioItems: [{ ticker, name, quantity, avgPrice, currentPrice, weight }]
    const portfolioText = portfolioItems.map(p => {
        const pnl = p.currentPrice ? (p.currentPrice - p.avgPrice) * p.quantity : 0;
        const pnlPct = p.avgPrice > 0 ? ((p.currentPrice / p.avgPrice - 1) * 100).toFixed(2) : '0';
        return `- ${p.name || p.ticker} (${p.ticker}): ${p.quantity}주 (평단 ${p.avgPrice.toLocaleString()} -> 현재 ${p.currentPrice?.toLocaleString() || 'N/A'}) | 비중 ${p.weight}% | 수익률 ${pnlPct}% (손익 ${pnl.toLocaleString()})`;
    }).join('\n');

    const prompt = `
사용자가 아래 포트폴리오를 보내왔습니다. 자산배분 및 수익성 관점에서 심층 분석해주세요.

[분석 기준일: ${today}]
[포트폴리오 구성 및 수익 현황]
${portfolioText}

다음 10가지 항목으로 상세히 분석하세요:

1. **포트폴리오 요약**: 전체 자산 규모(추정) 및 현재 수익 상태 요약
2. **핵심 차별화 결론 (⚠️ 중요)**: 상단에 표시할 "한 줄 결론" 카드용 문구. (예: "⚠️ 현재 포트폴리오: 특정 섹터 비중 과다로 변동성 위험이 높습니다. 👉 전략: 일부 익절 후 현금 비중 확대를 추천합니다.")
3. **섹터 및 테마 분석**: 어떤 섹터/테마에 얼마나 집중되어 있는지
4. **리스크 분석**: 종목 쏠림, 변동성 위험, 매수 단가 대비 현재 위치 등
5. **개별 종목 코멘트**: 비중이 높거나 수익률 변동이 큰 종목 위주 코멘트
6. **성장성 vs 안정성**: 포트폴리오의 전체적인 성격 (공격/방어)
7. **보완 아이디어**: 리스크 분산을 위해 추가/교체 고려할 섹터나 종목
8. **향후 시장 대응 전략**: 현재 시장 상황과 연계한 포트폴리오 운용 조언
9. **투자 성향 재확인**: 이 포트폴리오가 지향하는 투자자 스타일
10. **최종 총평**

규칙:
1. 반드시 "${t.opener}"로 시작
2. 자연스러운 대화체 (${t.style})
3. **볼드**와 줄바꿈을 적극 활용하여 가독성 높게 작성
4. 수치를 기반으로 논리적으로 설명 (추측 금지)
5. 마지막 문구: ${t.ending}
`;
    return callOpenAI(prompt, useDeep, tone);
}

// ──────────────────────────────────────────────────────────
// ENHANCED RECOMMENDATION — 추천 강화
// ──────────────────────────────────────────────────────────
async function analyzeRecommendation(marketData, useDeep = false, tone = 'normal', userStyle = '스윙') {
    const { indices, macro, news } = marketData;
    const newsText = (news || []).slice(0, 5).map(n => `- [${n.publishedAt}] ${n.title}`).join('\n');
    const today = new Date().toLocaleDateString('ko-KR');
    const t = toneStrings(tone);
    const indicesSummary = (indices || []).map(i => `${i.name}: ${i.value} (${i.change > 0 ? '+' : ''}${i.change}%)`).join(', ');
    const macroSummary = macro ? `금리: ${macro.rate || 'N/A'} | VIX: ${macro.vix || 'N/A'} | 달러인덱스: ${macro.dxy || 'N/A'}` : '';
    const marketSummary = [indicesSummary, macroSummary].filter(Boolean).join('\n');

    const prompt = `

다음 시장 데이터를 바탕으로 엄격한 4단계 필터를 거쳐 추천 종목을 선정하세요.

[분석 기준일: ${today}]
[사용자 투자 스타일: ${userStyle}]
→ 단타=기술적 신호 비중, 스윙=기술+섹터 균형, 장기=펀더멘털+밸류 중심

=== 시장 데이터 ===
${marketSummary}

=== 뉴스 데이터 ===
${newsText}

★★★ 4단계 엄격 필터링 (모든 단계를 통과해야 추천 가능) ★★★

[1단계: 기본 필터 — 여기서 탈락하면 이후 단계 없음]
즉시 제외 대상:
- 거래량 부족 / 유동성 낮은 종목
- 시가총액 소형주 / 잡주 / 테마성 급등주
- 최근 데이터 부족 종목
- 변동성만 큰 종목 (사업성 없음)
후보 유니버스: 미국 S&P500/나스닥100 우량 종목 우선

[2단계: 기술적 필터 — 차트 자리 확인]
모두 충족해야 통과:
- RSI 30~65 사이 (과매수 극단 제외)
- 지지선 근처 또는 건전한 반등 초기
- 추격매수 구간 완전 제외 (최근 3주 내 +20% 이상 급등 종목 탈락)
- EMA20 추세가 완전 붕괴 아닌 상태
- 리스크/리워드 비율 2:1 이상이어야 함

[3단계: 펀더멘털 필터 — 사업 체력 확인]
다음 중 하나라도 해당하면 탈락:
- 만성 적자 구조
- 최근 분기 매출 역성장 (특별 사유 없을 시)
- 어닝 쇼크 발생 후 회복 안 된 상태
- 경쟁력 없는 업종 내 약자
- PER > 100 또는 PSR > 30 (고성장 아닌 경우)

[4단계: 시장 적합성 필터 — 지금 이 종목이 맞는가]
다음 상황이면 감점/탈락:
- 나스닥/S&P500 조정장 → 초고변동 성장주 탈락
- 고금리 환경 → 고밸류 수익없는 성장주 탈락
- 해당 섹터 전체 약세 → 섹터 역행 추천 금지
- 악재 뉴스 있는 종목 → 뉴스 리스크 크면 탈락

★★★ 100점 채점 기준 (85점 이상만 최종 추천) ★★★
- 기술적 자리: 30점
- 펀더멘털: 25점
- 시장 적합성: 20점
- 밸류 부담: 15점
- 리스크 관리 용이성: 10점

[ 최종 추천 규칙 ]
85점 이상: 추천 가능 (최대 3개)
80~84점: 관심 후보 (추천 제외, 관망 권고)
79점 이하: 완전 제외

최종 추천 개수: 85점 이상 종목만, 최대 3개
조건 못 넘는 종목 억지로 추천 절대 금지
0개도 정상 결과임

★★★ 출력 형식 ★★★

[ 추천 종목이 0개일 때 — 고정 문구 그대로 출력 ]
귀염둥이 예리야 오늘은 엄격한 기준을 통과한 종목이 없어

👉 무리하게 들어가기보다 관망이 더 좋아

(이 이상 내용 추가 금지, 억지 후보 제시 금지)

[ 추천 종목이 있을 때 ]
귀염둥이 예리야 지금 매수 기회가 보이는 종목이 있어

1. [티커] ([종목명])
- 종합 점수: xx점
- 👉 지금은 "[판단명] 구간"입니다
- 이유: (기술 + 펀더 + 시장 적합성 핵심 2줄 이내)
- 전략: 분할매수 / 1차 $xx / 손절 $xx
- 리스크: (핵심 1줄)

번호 선택으로 이어서 분석 가능: "1번 분석해줘" "2번 리스크 뭐야?"

[형식 규칙]
1. 반드시 "귀염둥이 예리야"로 시작 (이 문구 절대 변경 금지)
2. 추천 없으면 위 고정 문구만 출력, 아무 종목도 억지로 추가하지 말 것
3. 추천 이유를 2줄 안에 명확히 설명 못 하면 그 종목 탈락
4. 딱딱한 구분선 금지
5. 마지막 문구: ${t.ending}
`;
    return callOpenAI(prompt, useDeep, tone);
}

// ──────────────────────────────────────────────────────────
// OVERHEAT CHECK — 과열 여부 집중 분석
// ──────────────────────────────────────────────────────────
async function analyzeStockOverheat(data, useDeep = false, tone = 'normal') {
    const dataSummary = buildDataSummary(data);
    const today = new Date().toLocaleDateString('ko-KR');
    const t = toneStrings(tone);
    const prompt = `
다음 데이터를 바탕으로 과열 여부 질문에 답변해주세요.

[분석 기준일: ${today}]
[종목: ${data.companyName || data.ticker} (${data.ticker})]

${dataSummary}

★ 답변 구조 (반드시 이 순서대로):

1. 질문 의도 확인: "${data.companyName || data.ticker} 과열 여부 중심으로 말씀드릴게요."
2. 과열/중립/과매도 한 줄 판단 (예: "단기 과열 구간에 가깝습니다" / "아직 극단적 과열은 아니에요")
3. **핵심 지표** (수치 필수):
   - RSI: xx → 해석
   - 최근 1개월 상승률: +x%
   - 52주 고점 대비: xx%
   - 볼린저밴드 위치: 상단근처/중립/하단
4. **추격매수 위험**: 위험/관망/가능 중 선택 + 한 줄 이유
5. **대응 전략** 한 줄: 지금 어떻게 행동해야 하는지
6. 추가 질문 유도

[절대 금지] 금리/VIX/나스닥 거시 설명, 기업 재무분석, 결론을 마지막에 배치

규칙:
1. 반드시 "${t.opener}"로 시작
2. 수치 반드시 포함 (RSI, 상승률 필수)
3. 자연스러운 대화체 (${t.style})
4. 딱딱한 구분선 금지
5. 마지막 문구: ${t.ending}
`;
    return callOpenAI(prompt, useDeep, tone);
}

// ──────────────────────────────────────────────────────────
// VALUATION CHECK — 뱸류 고평가 여부 집중 분석
// ──────────────────────────────────────────────────────────
async function analyzeStockValuation(data, useDeep = false, tone = 'normal') {
    const dataSummary = buildDataSummary(data);
    const today = new Date().toLocaleDateString('ko-KR');
    const t = toneStrings(tone);
    const prompt = `
다음 데이터를 바탕으로 밸류에이션 질문에 답변해주세요.

[분석 기준일: ${today}]
[종목: ${data.companyName || data.ticker} (${data.ticker})]

${dataSummary}

★ 답변 구조 (반드시 이 순서대로):

1. 질문 의도 확인: "${data.companyName || data.ticker} 밸류에이션 부담 기준으로 볼게요."
2. 저평가/중립/고평가 한 줄 결론 (예: "현재 기준으로는 고평가 구간에 있어요")
3. **주요 지표** (수치 필수):
   - PER: xx (동종 평균 xx)
   - 선행PER: xx
   - PSR: xx
   - PBR: xx
4. **동종 대비**: 동종 평균과 비교해 얼마나 비싼지/저렴한지 한 줄
5. **결론**: 밸류 감안 시 어떤 접근이 적절한지 한 줄
6. 추가 질문 유도

[절대 금지] 기술적 분석/매수타이밍 포함 금지, 수치 없이 "비싸다" 만 금지, 결론 마지막 배치 금지

규칙:
1. 반드시 "${t.opener}"로 시작
2. 지표 수치 반드시 포함
3. 자연스러운 대화체 (${t.style})
4. 딱딱한 구분선 금지
5. 마지막 문구: ${t.ending}
`;
    return callOpenAI(prompt, useDeep, tone);
}

// ──────────────────────────────────────────────────────────
// COMPARE STOCKS — 종목 비교 분석
// ──────────────────────────────────────────────────────────
async function analyzeStockComparison(data1, data2, useDeep = false, tone = 'normal') {
    const summary1 = buildDataSummary(data1);
    const summary2 = buildDataSummary(data2);
    const today = new Date().toLocaleDateString('ko-KR');
    const t = toneStrings(tone);

    // ── 실데이터 사전 추출 (프롬프트에 직접 주입) ──
    const nameA = data1.companyName || data1.ticker;
    const nameB = data2.companyName || data2.ticker;
    const tA = data1.ticker, tB = data2.ticker;
    const cA = (tA.endsWith('.KS') || tA.endsWith('.KQ')) ? '₩' : '$';
    const cB = (tB.endsWith('.KS') || tB.endsWith('.KQ')) ? '₩' : '$';

    const fmt = (v, fallback = '데이터 부족') => (v != null && v !== '' && v !== undefined) ? v : fallback;
    const fmtPct = (v) => v != null ? (Number(v) >= 0 ? '+' : '') + Number(v).toFixed(2) + '%' : '데이터 부족';
    const fmtNum = (v, d = 2) => v != null ? Number(v).toFixed(d) : '데이터 부족';
    const fmtPrice = (c, v) => v != null ? c + Number(v).toLocaleString() : '데이터 부족';

    // 가격
    const priceA = fmtPrice(cA, data1.price?.current);
    const priceB = fmtPrice(cB, data2.price?.current);
    const chgA = fmtPct(data1.price?.changePct);
    const chgB = fmtPct(data2.price?.changePct);
    const hi52A = fmtPrice(cA, data1.price?.fifty2High);
    const lo52A = fmtPrice(cA, data1.price?.fifty2Low);
    const hi52B = fmtPrice(cB, data2.price?.fifty2High);
    const lo52B = fmtPrice(cB, data2.price?.fifty2Low);

    // 기술지표
    const rsiA = fmtNum(data1.technical?.rsi, 1);
    const rsiB = fmtNum(data2.technical?.rsi, 1);
    const rsiSigA = fmt(data1.technical?.rsiSignal);
    const rsiSigB = fmt(data2.technical?.rsiSignal);
    const ema20A = fmtPrice(cA, data1.technical?.ema20);
    const ema20B = fmtPrice(cB, data2.technical?.ema20);
    const ema50A = fmtPrice(cA, data1.technical?.ema50);
    const ema50B = fmtPrice(cB, data2.technical?.ema50);
    const macdA = fmt(data1.technical?.macd?.trend);
    const macdB = fmt(data2.technical?.macd?.trend);

    // 재무
    const f1 = data1.fundamentals || {};
    const f2 = data2.fundamentals || {};
    const perA = fmt(f1.peRatio); const perB = fmt(f2.peRatio);
    const epsA = fmt(f1.eps); const epsB = fmt(f2.eps);
    const roeA = fmt(f1.roe); const roeB = fmt(f2.roe);
    const marginA = fmt(f1.netMargin); const marginB = fmt(f2.netMargin);
    const pbrA = fmt(f1.pbRatio); const pbrB = fmt(f2.pbRatio);
    const growthA = fmt(f1.revenueGrowthYoY); const growthB = fmt(f2.revenueGrowthYoY);

    const prompt = `
아래는 ${nameA} (${tA}) vs ${nameB} (${tB})의 실데이터입니다.
이 데이터만 사용하세요. 데이터 없는 항목은 절대 추측/창작하지 마세요.

[기준일: ${today}]

=== ${tA} 원본 데이터 ===
${summary1}

=== ${tB} 원본 데이터 ===
${summary2}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
★★★ 반드시 아래 포맷 그대로 출력하세요. 순서/구조 변경 절대 금지 ★★★
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

${t.opener}

👉 **결론:** (한 줄 — 어느 쪽이 현재 우위인지, 왜 그런지 핵심 1줄)
예: "현재는 ${nameA}가 기술적 반등 가능성이 더 높습니다."
반드시 위 실데이터(RSI/EMA/PER 등)에 기반해서 판단하세요.

📊 **[비교 분석]**

**현재가:**
• ${nameA}: ${priceA} (${chgA})
• ${nameB}: ${priceB} (${chgB})
→ 현재가 대비 52주 범위 위치를 한 줄로 비교

**기술적 분석:**
• ${nameA}: RSI ${rsiA} (${rsiSigA}) | EMA20 ${ema20A} / EMA50 ${ema50A} | MACD ${macdA}
• ${nameB}: RSI ${rsiB} (${rsiSigB}) | EMA20 ${ema20B} / EMA50 ${ema50B} | MACD ${macdB}
→ 현재가가 EMA20 위인지 아래인지 판단하고, RSI 기준 과매수/과매도/중립 비교. 2줄 이내.

**재무 비교:**
• ${nameA}: PER ${perA} | EPS ${epsA} | ROE ${roeA} | 순이익률 ${marginA} | 매출성장 ${growthA}
• ${nameB}: PER ${perB} | EPS ${epsB} | ROE ${roeB} | 순이익률 ${marginB} | 매출성장 ${growthB}
→ 밸류에이션/수익성/성장성 누가 우위인지 2줄 이내.
"데이터 부족" 항목은 비교에서 제외하고 해당 사실만 명시.

👉 **투자 전략:**
• **단기 (1~2주):** A와 B 중 어느 쪽이 유리한지 + 이유 1줄
• **중장기 (3개월+):** 어느 쪽이 유리한지 + 이유 1줄
• **행동 제안:** 각 종목별 "관망 / 분할매수 / 비중축소" 중 택1 + 조건

${t.ending}

[📡 데이터 출처]
${tA}: 가격-${data1.price?.source || '없음'} | 기술지표-${data1.technical?.source || '없음'} | 재무-${data1.fundamentals?.source || '없음'}
${tB}: 가격-${data2.price?.source || '없음'} | 기술지표-${data2.technical?.source || '없음'} | 재무-${data2.fundamentals?.source || '없음'}

[절대 금지]
- 각 종목 따로 섹션 나눠 설명 금지 → 반드시 항목별 비교 형태 유지
- 데이터 없는 수치 추정/창작 금지 → "데이터 부족" 명시
- 결론을 마지막에 배치 금지 → 결론은 반드시 최상단
- 장황한 기업 소개 금지 → 수치 기반 비교만
- 순서 변경 금지 → 위 포맷 그대로
`;
    return callOpenAI(prompt, useDeep, tone);
}

// ──────────────────────────────────────────────────────────
// QUERY CLASSIFIER
// ──────────────────────────────────────────────────────────
async function classifyQuery(message) {
    const response = await client.responses.create({
        model: 'gpt-4o-mini',
        instructions: '주식 질문 분류기. JSON만 응답. intent 필드를 반드시 포함하라. 투자/주식/시장/종목과 관련 없는 일반 대화는 반드시 intent:"fallback"으로 분류하라.',
        input: `다음 텍스트의 의도를 분류하라: "${message}"

JSON만 응답:
{
  "type": "stock" | "market" | "sector" | "etf" | "portfolio" | "general",
  "intent": "full_analysis" | "buy_timing" | "sell_timing" | "risk_check" | "earnings_check" | "overheat_check" | "valuation_check" | "compare_stocks" | "sector_analysis" | "recommendation" | "etf_analysis" | "portfolio_analysis" | "fallback",
  "ticker": "AAPL" | null,
  "name": "Apple" | null,
  "market": "US" | "KR",
  "sectorKey": "반도체" | "ai" | "전기차" | "바이오" | "금융" | "에너지" | "클라우드" | "소비재" | "플랫폼" | "사이버보안" | "핀테크" | null
}

type 분류:
- 종목명/티커 포함 → type:"stock"
- ETF 이름/티커 (QQQ, SPY, VOO, SOXX, SMH, TQQQ, SQQQ, ARKK 등) → type:"etf"
- "시장 어때", "미국장", "코스피", "나스닥", "증시" → type:"market"
- "반도체", "AI섹터", "전기차" → type:"sector"
- "삼성전자 50 엔비디아 30" 같은 종목+숫자 패턴 → type:"portfolio"
- 일반 대화/인사/감정표현/잡담 → type:"general"

intent 분류 (핵심!):
- "어때", "분석해줘", "전망", "알려줘", "풀분석" + 종목명 → intent:"full_analysis"
- "언제 사", "지금 사도", "매수", "사야", "들어가도", "살까", "타이밍" → intent:"buy_timing"
- "언제 팔", "목표가", "정리", "매도", "팔아", "어디서 팔", "익절" → intent:"sell_timing"
- "위험", "리스크", "괜찮아", "안전", "걱정", "위험해" → intent:"risk_check"
- "실적", "어닝", "분기", "실적발표", "실적 전", "실적 후", "컨센서스", "가이던스" → intent:"earnings_check"
- "과열", "과매수", "너무 올랐", "너무 올라", "고점이야", "과열구간", "추격매수 위험", "올란거 아니야", "너무 올랐", "일격도" → intent:"overheat_check"
- "비싸", "고평가", "밸류", "per", "psr", "pbr", "밸류부담", "밸류적으로", "값이 맞아" → intent:"valuation_check"
- "vs", "vs.", "대외한", "보다", "비교", "어느 게 나아", "둘 중 어느", "대비" → intent:"compare_stocks"
- "섹터", "업종", "산업" + 관련 전망 (종목 없이) → intent:"sector_analysis"
- "추천", "뭐 살까", "좋은 종목", "괜찮은 주식", "장기 투자 추천", "모아갈 종목" → intent:"recommendation"
- ETF 관련 질문 (QQQ, SPY 등) → intent:"etf_analysis"
- 종목+숫자 패턴 (포트폴리오) → intent:"portfolio_analysis"
- "시장 어때", "미국장", "나스닥", "증시" → intent:"full_analysis" (type:"market")
- 아래 같은 일반 대화는 반드시 intent:"fallback":
  "고마워", "ㅋㅋ", "뭐 할 수 있어?", "도와줘", "테스트", "뭐야",
  "너는 뭐 하는 봇이야?", "오늘 좀 불안하다", 감정 표현, 잡담, 의미 없는 텍스트
- 종목명/티커/시장/섹터 키워드가 없는 애매한 메시지 → intent:"fallback"`,
        max_output_tokens: 300,
    });

    try {
        const text = response.output_text.trim();
        return JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] || text);
    } catch {
        return { type: 'general', intent: 'fallback', ticker: null, name: null, market: 'US', sectorKey: null };
    }
}

module.exports = { analyzeStock, analyzeStockBuyTiming, analyzeStockSellTiming, analyzeStockRisk, analyzeStockEarnings, analyzeStockCasual, analyzeStockOverheat, analyzeStockValuation, analyzeStockComparison, analyzeETF, analyzePortfolio, analyzeRecommendation, analyzeMarket, analyzeSector, classifyQuery, fallbackChat, computeScore };

