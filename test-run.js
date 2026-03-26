require('dotenv').config();
const { fetchMarketData } = require('./services/data-fetcher');
const { generateMarketBriefing } = require('./services/briefing_service');

async function test() {
    console.log('--- fetchMarketData ---');
    try {
        const data = await fetchMarketData();
        console.log(JSON.stringify(data, null, 2));
    } catch (e) {
        console.error('fetchMarketData Error:', e.message);
    }

    console.log('\n--- generateMarketBriefing ---');
    try {
        const rep = await generateMarketBriefing();
        console.log(rep);
    } catch (e) {
        console.error('generateMarketBriefing Error:', e.message);
    }
}
test();
