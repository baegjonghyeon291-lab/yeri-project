require('dotenv').config();
const fetcher = require('./services/data-fetcher');
const { analyzeStock, computeScore } = require('./services/analyzer');

async function test() {
    console.log('=== BBAI 데이터 기반 분석 테스트 ===\n');
    try {
        const data = await fetcher.fetchAllStockData('BBAI');
        console.log('\n--- computeScore ---');
        const score = computeScore(data);
        console.log(JSON.stringify(score, null, 2));
        console.log('\n--- analyzeStock (full report) ---');
        const report = await analyzeStock(data);
        console.log(report);
    } catch(e) {
        console.error('Error:', e.message);
    }
}
test();
