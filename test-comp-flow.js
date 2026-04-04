const axios = require('axios');
const API_URL = 'http://localhost:3001/api/chat';

async function chat(text, chatId = 'test-comp-final') {
    const res = await axios.post(API_URL, { text, chatId });
    return res.data.messages[0].content;
}

async function run() {
    console.log('\n======================================');
    console.log('3. 비교 질문 테스트');
    console.log('======================================');
    console.log('User: NVDA랑 TSLA 비교해줘');
    res = await chat('NVDA랑 TSLA 비교해줘', 'test-comp');
    console.log('Yeri:', res.substring(0, 100).replace(/\n/g, ' '));
    await new Promise(r => setTimeout(r, 4000));

    console.log('\nUser: 지금은 누가 덜 비싸?');
    res = await chat('지금은 누가 덜 비싸?', 'test-comp');
    console.log('Yeri:', res.substring(0, 300).replace(/\n/g, ' '));
}

run().catch(console.error);
