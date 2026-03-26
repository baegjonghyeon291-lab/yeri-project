/**
 * test-resolve.js — resolveStock / resolveComparisonStocks 단위 테스트
 * 실행: node test-resolve.js
 */
const {
    resolveStock, resolveComparisonStocks, extractCompanyName
} = require('./utils/ticker-util');

let passed = 0;
let failed = 0;

function test(label, input, expectedTicker, fn = resolveStock) {
    const result = fn(input);
    const actual = result?.ticker || null;
    const ok = actual === expectedTicker;
    if (ok) {
        passed++;
        console.log(`  ✅ ${label}: "${input}" → ${actual} (${result?.name || '-'})`);
    } else {
        failed++;
        console.error(`  ❌ ${label}: "${input}" → ${actual} (expected: ${expectedTicker})`);
    }
}

function testComparison(label, input, expectedA, expectedB) {
    const result = resolveComparisonStocks(input);
    const actualA = result?.stockA?.ticker || null;
    const actualB = result?.stockB?.ticker || null;
    const ok = actualA === expectedA && actualB === expectedB;
    if (ok) {
        passed++;
        console.log(`  ✅ ${label}: "${input}" → ${actualA} vs ${actualB}`);
    } else {
        failed++;
        console.error(`  ❌ ${label}: "${input}" → ${actualA} vs ${actualB} (expected: ${expectedA} vs ${expectedB})`);
    }
}

function testNotComparison(label, input) {
    const result = resolveComparisonStocks(input);
    if (result === null) {
        passed++;
        console.log(`  ✅ ${label}: "${input}" → 비교 아님 (정상)`);
    } else {
        failed++;
        console.error(`  ❌ ${label}: "${input}" → 비교로 잘못 감지됨: ${result?.stockA?.ticker} vs ${result?.stockB?.ticker}`);
    }
}

console.log('\n══════════════════════════════════════════════');
console.log('  📋 resolveStock 단위 테스트');
console.log('══════════════════════════════════════════════\n');

console.log('── 단일 종목 분석 (정확히 해당 종목만 resolve) ──');
test('BBAI 분석', 'bbai 분석', 'BBAI');
test('IONQ 분석', 'ionq 분석', 'IONQ');
test('SOUN 분석', 'soun 분석', 'SOUN');
test('PLTR 분석', 'pltr 분석', 'PLTR');
test('NVDA 분석', 'nvda 분석', 'NVDA');
test('삼성전자 분석', '삼성전자 분석', '005930');

console.log('\n── 한글 이름 resolve ──');
test('엔비디아', '엔비디아 어때', 'NVDA');
test('테슬라', '테슬라 전망', 'TSLA');
test('빅베어ai', '빅베어ai 분석', 'BBAI');
test('사운드하운드', '사운드하운드 분석', 'SOUN');
test('아이온큐', '아이온큐 분석', 'IONQ');
test('팔란티어', '팔란티어 어때', 'PLTR');

console.log('\n── 직접 티커 입력 ──');
test('AAPL', 'AAPL', 'AAPL');
test('TSLA', 'TSLA', 'TSLA');
test('BBAI 직접', 'BBAI', 'BBAI');
test('SOUN 직접', 'SOUN', 'SOUN');

console.log('\n── ETF ──');
test('QQQ', 'qqq 분석', 'QQQ');
test('SPY', 'spy 분석', 'SPY');
test('TQQQ', 'tqqq 분석', 'TQQQ');

console.log('\n── 한국 종목 코드 ──');
test('삼성전자 코드', '005930', '005930');

console.log('\n══════════════════════════════════════════════');
console.log('  📋 resolveComparisonStocks 테스트');
console.log('══════════════════════════════════════════════\n');

console.log('── 비교 질문 (정상 감지) ──');
testComparison('nvda vs tsla', 'nvda vs tsla', 'NVDA', 'TSLA');
testComparison('삼성전자 vs 엔비디아', '삼성전자 vs 엔비디아', '005930', 'NVDA');
testComparison('애플이랑 구글 비교', '애플이랑 구글 비교', 'AAPL', 'GOOGL');

console.log('\n── 단일 종목 (비교로 감지되면 안됨) ──');
testNotComparison('bbai 분석', 'bbai 분석');
testNotComparison('ionq 분석', 'ionq 분석');
testNotComparison('soun 어때', 'soun 어때');
testNotComparison('pltr 전망', 'pltr 전망');

console.log('\n══════════════════════════════════════════════');
console.log('  📋 extractCompanyName 테스트');
console.log('══════════════════════════════════════════════\n');

const nameTests = [
    ['bbai 분석', 'bbai'],
    ['ionq 어때', 'ionq'],
    ['삼성전자 분석해줘', '삼성전자'],
    ['nvda 전망', 'nvda'],
    ['soun 분석', 'soun'],
];
for (const [input, expected] of nameTests) {
    const result = extractCompanyName(input);
    const ok = result.trim().toLowerCase() === expected.toLowerCase();
    if (ok) {
        passed++;
        console.log(`  ✅ extractCompanyName("${input}") → "${result.trim()}"`);
    } else {
        failed++;
        console.error(`  ❌ extractCompanyName("${input}") → "${result.trim()}" (expected: "${expected}")`);
    }
}

console.log('\n══════════════════════════════════════════════');
console.log(`  결과: ${passed} passed, ${failed} failed`);
console.log('══════════════════════════════════════════════\n');

process.exit(failed > 0 ? 1 : 0);
