/**
 * briefing_service.js
 * 관심종목 데일리 브리핑 — 행동 중심, 자연스러운 "귀염둥이 예리야" 말투
 */
const { fetchAllStockData } = require('./data-fetcher');
const client = require('./openai-client');
const MODEL_DEFAULT = process.env.OPENAI_MODEL_DEFAULT || 'gpt-4.1';

/**
 * /brief 명령어용 — 즉시 브리핑 (기존 호환 유지)
 */
async function generateWatchlistBriefing(tickers) {
    return generateDailyBriefingText(tickers, true);
}

/**
 * 핵심 브리핑 생성 함수
 * @param {string[]} tickers   관심종목 티커 목록
 * @param {boolean} isManual   true: /brief 명령, false: 자동 스케줄
 */
async function generateDailyBriefingText(tickers, isManual = false) {
    if (!tickers || tickers.length === 0) {
        return `귀염둥이 예리야 아직 등록된 관심종목이 없어\n원하면 내가 같이 종목 골라줄게 😊\n(/add NVDA 로 추가 가능)`;
    }

    console.log(`[BriefingService] 브리핑 생성 중: ${tickers.join(', ')}`);

    // 각 종목 데이터 병렬 수집
    const results = await Promise.all(tickers.map(async (ticker) => {
        try {
            const data = await fetchAllStockData(ticker);
            return {
                ticker,
                name:     data.companyName || ticker,
                price:    data.price?.current   ?? 'N/A',
                change1d: data.price?.changePercent ?? data.price?.changePct ?? 'N/A',
                change1m: data.price?.change1m  ?? 'N/A',
                rsi:      data.technicals?.rsi14 ?? data.technical?.rsi ?? 'N/A',
                ema20:    data.technicals?.ema20 ?? 'N/A',
                trend:    data.technicals?.macdSignal ?? data.technical?.macd?.trend ?? 'N/A',
            };
        } catch (err) {
            console.error(`[BriefingService] ${ticker} 데이터 수집 실패:`, err.message);
            return { ticker, error: true };
        }
    }));

    const valid = results.filter(r => !r.error);
    if (!valid.length) return `귀염둥이 예리야 오늘 데이터 수집에 문제가 있어. 잠시 후 다시 시도해줘.`;

    const dataBlock = valid.map(s =>
        `- ${s.name}(${s.ticker}): $${s.price} (전일 ${s.change1d}%, 1달 ${s.change1m}%) | RSI ${s.rsi} | EMA20 ${s.ema20} | 추세 ${s.trend}`
    ).join('\n');

    const intro = isManual ? '관심종목 브리핑' : '오늘 아침 관심종목 브리핑';

    const prompt = `다음은 사용자 관심종목의 오늘 상태야.

[${intro}]
${dataBlock}

아래 형식과 규칙에 맞게 브리핑을 작성해줘.

[형식]
반드시 "귀염둥이 예리야 오늘 관심종목 브리핑이야" 로 시작

각 종목은 번호 순서로, 종목당 2~4줄:
1. [종목명/티커]
- 오늘 상태 핵심 한 줄
- 👉 할 행동 (아래 표현 중 하나 사용)

할 행동 표현 (한 개만 선택):
- 지금은 지켜보는 게 좋아
- 매수 준비를 해두자
- 매도 준비를 해두는 게 좋아 보여
- 아직은 관망이 더 좋아
- 급하게 따라가진 말고 눌림을 보자
- 일부 익절도 생각해볼 수 있어
- 분할 접근을 준비해두자

마지막에 전체 한 줄 종합 코멘트 포함

[규칙]
- 딱딱한 분석 리포트 금지, 자연스러운 대화체
- 종목당 2~4줄만 (너무 길면 안 됨)
- 기술적 지표는 행동 판단에만 활용, 숫자 나열 금지
- 과한 표현 절대 금지: 몰빵, 올인, 무조건 사야 한다, 지금 안 사면 늦는다
- 마지막: "귀염둥이 예리의 성공적인 투자를 응원합니다♡"`;

    try {
        const response = await client.chat.completions.create({
            model: MODEL_DEFAULT,
            messages: [
                { role: 'system', content: '너는 "예리"라는 친근한 AI 투자 비서야. 자연스럽고 행동 중심으로 브리핑해.' },
                { role: 'user', content: prompt }
            ],
            max_tokens: 1200,
        });
        return response.choices[0].message.content;
    } catch (err) {
        console.error(`❌ [generateDailyBriefingText] 실패:`, err.message);
        throw err;
    }
}

module.exports = { generateWatchlistBriefing, generateDailyBriefingText };
