require('dotenv').config();
const { resolveStock } = require('./utils/ticker-util');
const { fetchAllStockData } = require('./services/data-fetcher');

const major = ['NVDA', 'AAPL', 'TSLA', 'MSFT'];
const minor = ['BBAI', 'SOUN', 'IONQ', 'RKLB', 'LCID', 'C3AI'];
const korean = ['엔비디아', '애플', '마소', '사운드하운드', '아이온큐', '빅베어'];
const typos = ['babi', '사운', '아이온', '애플이'];

const allTests = [...major, ...minor, ...korean, ...typos];

async function runTest() {
    console.log("=== 비주류 종목 및 오타 조회 성공률 강화 통합 테스트 ===\n");
    const results = [];
    
    for (const testCase of allTests) {
        console.log(`[TEST] 입력: "${testCase}"`);
        const resolved = resolveStock(testCase);
        
        let targetTicker = resolved ? resolved.ticker : null;
        let priceOK = '❌', techOK = '❌', fundOK = '❌', newsOK = '❌', finalTier = 'NO_DATA';

        if (targetTicker) {
            try {
                const data = await fetchAllStockData(targetTicker, resolved.name);
                priceOK = data.price?.current != null ? '✅' : '❌';
                techOK = data.technical?.rsi != null || data.technical?.ema20 != null ? '✅' : '❌';
                fundOK = data.fundamentals?.peRatio != null || data.fundamentals?.revenue != null ? '✅' : '❌';
                newsOK = (data.news?.length || 0) > 0 ? '✅' : '❌';

                // computeDataReliability 로직 가져오기
                if (!data.price?.current) {
                    finalTier = 'FAIL';
                } else {
                    let weight = 30; // price
                    if (techOK === '✅') weight += 25;
                    if (fundOK === '✅') weight += 20;
                    if (newsOK === '✅') weight += 15;
                    weight += 10; // macro assumption

                    if (weight >= 80) finalTier = 'FULL';
                    else finalTier = 'PARTIAL';
                }
            } catch (err) {
                console.error(`Fetch Error for ${targetTicker}:`, err.message);
                finalTier = 'FAIL_ERROR';
            }
        }

        results.push({
            입력: testCase,
            Resolve결과: targetTicker || '실패',
            가격: priceOK,
            기술: techOK,
            재무: fundOK,
            뉴스: newsOK,
            최종분류: finalTier
        });
        
        // Rate limit 방지 1초 대기
        await new Promise(r => setTimeout(r, 1000));
    }

    console.table(results);
}

runTest();
