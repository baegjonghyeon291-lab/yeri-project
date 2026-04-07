/**
 * briefing_service.js
 * 관심종목 데일리 브리핑 — 실데이터(가격/기술지표/뉴스) 기반
 * 포맷: 결론 → 가격/기술 → 뉴스 → 리스크 → 행동 제안
 */
const { fetchAllStockData, fetchMarketData } = require('./data-fetcher');
const client = require('./openai-client');
const MODEL_DEFAULT = process.env.OPENAI_MODEL_DEFAULT || 'gpt-4.1';

// ─────────────────────────────────────────────
// 실데이터 필드 안전 추출 헬퍼
// ─────────────────────────────────────────────
function safeNum(val, digits = 2) {
    const n = parseFloat(val);
    return isNaN(n) ? null : n.toFixed(digits);
}

function extractStockSummary(data) {
    const ticker = data.ticker;
    const name   = data.companyName || ticker;
    const currency = ticker.endsWith('.KS') ? '₩' : '$';

    // 가격 — data.price 필드명 정확히 매핑
    const price      = data.price?.current     ? `${currency}${Number(data.price.current).toLocaleString()}` : '데이터 부족';
    const changePct  = data.price?.changePct   != null ? `${Number(data.price.changePct) >= 0 ? '+' : ''}${safeNum(data.price.changePct)}%` : '데이터 부족';
    const hi52w      = data.price?.fifty2High  ? `${currency}${Number(data.price.fifty2High).toLocaleString()}` : '데이터 부족';
    const lo52w      = data.price?.fifty2Low   ? `${currency}${Number(data.price.fifty2Low).toLocaleString()}` : '데이터 부족';
    const volume     = data.price?.volume      ? Number(data.price.volume).toLocaleString() : '데이터 부족';

    // 기술지표 — data.technical (TwelveData 기준)
    const rsi    = data.technical?.rsi    != null ? safeNum(data.technical.rsi, 1) : '데이터 부족';
    const rsiSig = data.technical?.rsiSignal || '';
    const ema20  = data.technical?.ema20  != null ? `${currency}${safeNum(data.technical.ema20)}` : '데이터 부족';
    const ema50  = data.technical?.ema50  != null ? `${currency}${safeNum(data.technical.ema50)}` : '데이터 부족';
    const macdTrend  = data.technical?.macd?.trend || '데이터 부족';
    const macdHist   = data.technical?.macd?.hist  != null ? safeNum(data.technical.macd.hist, 4) : null;

    // 지지/저항
    const support    = data.supportResist?.support    ? `${currency}${data.supportResist.support}` : '데이터 부족';
    const resistance = data.supportResist?.resistance ? `${currency}${data.supportResist.resistance}` : '데이터 부족';

    // 뉴스 (최신 3개 제목)
    const newsItems = (data.news || []).slice(0, 3);
    const newsBlock = newsItems.length > 0
        ? newsItems.map(n => `  • [${n.publishedAt || '날짜 없음'}] ${n.title} (${n.source || '출처 없음'})`).join('\n')
        : '  최신 뉴스 부족';

    return {
        ticker, name, currency,
        price, changePct, hi52w, lo52w, volume,
        rsi, rsiSig, ema20, ema50, macdTrend, macdHist,
        support, resistance,
        newsBlock,
        hasData: data.price?.current != null,
        hasNews: newsItems.length > 0,
    };
}

// ─────────────────────────────────────────────
// 종목 데이터 블록 문자열 생성
// ─────────────────────────────────────────────
function buildStockBlock(s) {
    return `
[${s.name} (${s.ticker})]
현재가: ${s.price} | 전일비: ${s.changePct} | 거래량: ${s.volume}
52주 고점: ${s.hi52w} | 52주 저점: ${s.lo52w}
RSI(14): ${s.rsi} ${s.rsiSig ? `→ ${s.rsiSig}` : ''}
EMA20: ${s.ema20} | EMA50: ${s.ema50}
MACD 추세: ${s.macdTrend}${s.macdHist ? ` (Hist: ${s.macdHist})` : ''}
지지선: ${s.support} | 저항선: ${s.resistance}
최근 뉴스:
${s.newsBlock}`.trim();
}

// ─────────────────────────────────────────────
// 관심종목 브리핑 생성
// ─────────────────────────────────────────────
async function generateWatchlistBriefing(tickers) {
    return generateDailyBriefingText(tickers, true);
}

async function generateDailyBriefingText(tickers, isManual = false) {
    if (!tickers || tickers.length === 0) {
        return `관심종목이 아직 없어요.\n아래 입력창에서 티커를 추가해보세요! (예: NVDA, 005930)`;
    }

    console.log(`[BriefingService] 브리핑 생성 중 (${tickers.length}개): ${tickers.join(', ')}`);

    // 순차 데이터 수집 — 무료 API 속도제한(Rate Limit) 방지
    const rawResults = [];
    for (const ticker of tickers) {
        try {
            const data = await fetchAllStockData(ticker);
            rawResults.push(extractStockSummary(data));
        } catch (err) {
            console.error(`[BriefingService] ${ticker} 실패:`, err.message);
            rawResults.push({ ticker, name: ticker, hasData: false, newsBlock: '  최신 뉴스 부족' });
        }
        // 다음 종목 요청 전 300ms 대기 — API Rate Limit 여유 확보
        if (tickers.indexOf(ticker) < tickers.length - 1) {
            await new Promise(r => setTimeout(r, 300));
        }
    }

    if (!rawResults.some(r => r.hasData)) {
        return `데이터 수집에 문제가 있어요. 잠시 후 다시 시도해주세요.`;
    }

    const dataBlock = rawResults.map(s => buildStockBlock(s)).join('\n\n---\n\n');
    const hasNewsCount = rawResults.filter(s => s.hasNews).length;
    const intro = isManual ? '관심종목 브리핑' : '오늘 아침 관심종목 브리핑';
    const today = new Date().toLocaleDateString('ko-KR');

    const prompt = `다음은 ${today} 기준 관심종목 실데이터야.

[${intro}]
${dataBlock}

위 실데이터를 기반으로 종목별 브리핑을 아래 형식에 맞게 작성해줘.
차분한 투자 비서 톤으로, 근거 중심으로 써줘.

━━━━━━━━━━━━━━━━━━━━━━
[각 종목당 반드시 이 5개 섹션 순서대로]

📊 종목 요약
이 종목이 어떤 섹터/테마에 속하는지, 최근 전체적인 흐름(강세/약세/횡보)을 2~3줄로 설명.
단순 나열 금지 — "왜 지금 이 상황인지" 맥락을 설명할 것.

📉 기술적 분석
- RSI: [수치] → [과매수/과매도/중립] 판단
- EMA 20/50: [단기/중기 정렬 방향 — 상승정렬/하락정렬/횡보]
- MACD: [양수/음수/골든크로스/데드크로스] 여부
- 주요 지지선: [가격]
- 주요 저항선: [가격]
➡️ 한 문장 기술적 결론 (예: "하락 추세 속 과매도 구간 근접")

📦 수급 / 거래 흐름
거래량 동향, 수급 유입 여부, 큰 손 매집/매도 신호 유무를 1~2줄로.
데이터 없으면 "수급 데이터 부족" 명시.

📰 뉴스 / 이슈
가장 중요한 뉴스 or 이슈 1~2개 요약.
→ 해당 뉴스가 주가에 미치는 영향 1줄 추가.
뉴스 없으면 "최신 뉴스 부족" 명시.

🧠 종합 판단 + 전략
현재 구간 성격을 한 문장으로 정의.
👉 보유자 전략: (구체적 조건/가격 포함)
👉 신규 진입 전략: (진입 조건 or 가격 구간 포함)
💡 단기 결론: [관망 / 분할매수 준비 / 일부 익절 / 매수 대기] 중 하나 선택 + 이유 한 줄

━━━━━━━━━━━━━━━━━━━━━━
[모든 종목 분석 후 마지막에]
📋 오늘 전체 요약
- 주목 종목: (가장 변화가 있는 종목 1~2개)
- 전체 분위기: (한 줄)
"예리가 응원해요, 오늘도 현명한 투자 하세요 ♡"

[절대 금지]
- 데이터에 없는 수치를 만들어내는 것
- 뉴스 없으면 반드시 "최신 뉴스 부족" 명시
- 수치 없는 섹션은 반드시 "데이터 부족" 명시
- "몰빵", "올인", "무조건 오른다" 등 과장 표현
- 뉴스 데이터 확보 현황: ${hasNewsCount}개 종목 뉴스 있음`;

    try {
        const response = await client.chat.completions.create({
            model: MODEL_DEFAULT,
            messages: [
                {
                    role: 'system',
                    content: '너는 "예리"라는 AI 투자 비서야. 차분하고 근거 기반의 투자 브리핑을 해. 각 종목마다 5개 섹션(종목요약/기술분석/수급흐름/뉴스이슈/종합판단+전략)을 반드시 포함해. 데이터가 없으면 절대 수치를 만들어내지 마. 각 섹션은 핵심만 간결하게 써서 반드시 모든 종목을 빠짐없이 분석 완료해.'
                },
                { role: 'user', content: prompt }
            ],
            max_tokens: 4500,
        });

        // 출력 잘림 감지 — finish_reason이 'length'이면 토큰 한도에 걸린 것
        const finishReason = response.choices[0].finish_reason;
        let content = response.choices[0].message.content;
        if (finishReason === 'length') {
            console.warn(`⚠️ [BriefingService] 브리핑 출력이 max_tokens(4500)에 의해 잘렸습니다.`);
            content += '\n\n⚠️ 브리핑이 길어져 일부가 생략되었습니다. 관심종목 수를 줄이면 더 상세한 분석을 받아보실 수 있어요.';
        }
        console.log(`[BriefingService] 브리핑 완료 (finish: ${finishReason}, tokens: ${response.usage?.completion_tokens || '?'})`);
        return content;
    } catch (err) {
        console.error(`❌ [generateDailyBriefingText] 실패:`, err.message);
        throw err;
    }
}

// ─────────────────────────────────────────────
// 시장 전체 브리핑 생성
// ─────────────────────────────────────────────
async function generateMarketBriefing() {
    console.log(`[BriefingService] 시장 브리핑 생성 중...`);
    const today = new Date().toLocaleDateString('ko-KR');

    let marketData;
    try {
        marketData = await fetchMarketData();
    } catch (err) {
        console.error('[BriefingService] 시장 데이터 수집 실패:', err.message);
        return '시장 데이터 수집에 실패했어요. 잠시 후 다시 시도해주세요.';
    }

    const { indices, macro, news } = marketData;

    // 데이터 충분히 수집되었는지 확인 (최소 S&P 500과 VIX 여부)
    const validDataCount = (indices?.['S&P 500'] ? 1 : 0) + (indices?.['NASDAQ'] ? 1 : 0) + (macro?.vix ? 1 : 0) + (macro?.tenYearYield ? 1 : 0);
    if (validDataCount < 2) {
        return '시장 데이터를 충분히 확보하지 못해 브리핑을 생성할 수 없습니다. (데이터 소스 응답 지연)\n\n잠시 후 다시 시도해 주세요.';
    }

    const indexBlock = indices
        ? Object.entries(indices).map(([k, v]) =>
            `  ${k}: ${v.current ?? '데이터 부족'} (${v.changePct != null ? (Number(v.changePct) >= 0 ? '+' : '') + Number(v.changePct).toFixed(2) + '%' : '데이터 부족'})`
          ).join('\n')
        : '  지수 데이터 부족';

    const macroBlock = macro ? [
        `  기준금리: ${macro.federalFundsRate ?? '데이터 부족'}%`,
        `  CPI: ${macro.cpi ?? '데이터 부족'}`,
        `  실업률: ${macro.unemployment ?? '데이터 부족'}%`,
        `  10Y채권: ${macro.tenYearYield ?? '데이터 부족'}%`,
        `  VIX: ${macro.vix ?? '데이터 부족'}`,
    ].join('\n') : '  거시경제 데이터 부족';

    const newsItems = (news || []).slice(0, 4);
    const newsBlock = newsItems.length > 0
        ? newsItems.map(n => `  • [${n.publishedAt || '날짜 없음'}] ${n.title} (${n.source || '출처 없음'})`).join('\n')
        : '  최신 뉴스 부족';

    const prompt = `다음은 ${today} 기준 시장 실데이터야.

[시장 지수]
${indexBlock}

[거시경제]
${macroBlock}

[시장 뉴스 (최신 ${newsItems.length}건)]
${newsBlock}

위 실데이터를 기반으로 오늘 시장 브리핑을 아래 형식으로 작성해줘.

📌 결론: 오늘 시장 한줄 요약
💹 가격/기술: 주요 지수 흐름 + VIX 기준 변동성 (실수치 반드시 포함)
📰 뉴스: 시장 뉴스 방향성 요약 (뉴스 없으면 "최신 뉴스 부족")
✅ 긍정 포인트: 2가지
⚠️ 부정 포인트: 2가지
🧠 시장 심리: 한 줄
👉 전략 제안: 오늘 투자자별 행동 방향 (단타/스윙/장기 각 1줄)

[절대 금지]
- 데이터에 없는 수치 GPT가 만들어내기 금지
- 뉴스 없으면 "최신 뉴스 부족" 명시
- "몰빵", "올인", "무조건" 금지`;

    try {
        const response = await client.chat.completions.create({
            model: MODEL_DEFAULT,
            messages: [
                {
                    role: 'system',
                    content: '너는 "예리"라는 AI 투자 비서야. 실데이터와 뉴스를 기반으로 오늘 시장 브리핑을 해. 데이터가 없으면 절대 수치를 만들어내지 마.'
                },
                { role: 'user', content: prompt }
            ],
            max_tokens: 1400,
        });
        return response.choices[0].message.content;
    } catch (err) {
        console.error(`❌ [generateMarketBriefing] 실패:`, err.message);
        throw err;
    }
}

module.exports = { generateWatchlistBriefing, generateDailyBriefingText, generateMarketBriefing };
