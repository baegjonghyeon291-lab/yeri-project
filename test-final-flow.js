const axios = require('axios');
const API_URL = 'http://localhost:3001/api/chat';

async function chat(text, chatId = 'test-final-user') {
    const res = await axios.post(API_URL, { text, chatId });
    return res.data.messages[0].content;
}

async function run() {
    console.log('\n======================================');
    console.log('1. 긴 대화 문맥 유지 (6턴)');
    console.log('======================================');
    console.log('User: NVDA 분석해줘');
    let res = await chat('NVDA 분석해줘', 'test-long1');
    console.log('Yeri:', res.substring(0, 100).replace(/\n/g, ' '));
    
    console.log('\nUser: 어때?');
    res = await chat('어때?', 'test-long1');
    console.log('Yeri:', res.substring(0, 100).replace(/\n/g, ' '));

    console.log('\nUser: 비싸?');
    res = await chat('비싸?', 'test-long1');
    console.log('Yeri:', res.substring(0, 100).replace(/\n/g, ' '));

    console.log('\nUser: PER은?');
    res = await chat('PER은?', 'test-long1');
    console.log('Yeri:', res.substring(0, 100).replace(/\n/g, ' '));

    console.log('\nUser: 위험해?');
    res = await chat('위험해?', 'test-long1');
    console.log('Yeri:', res.substring(0, 100).replace(/\n/g, ' '));

    console.log('\nUser: 더 갈까?');
    res = await chat('더 갈까?', 'test-long1');
    console.log('Yeri:', res.substring(0, 100).replace(/\n/g, ' '));

    console.log('\n======================================');
    console.log('2. 종목 전환 테스트');
    console.log('======================================');
    console.log('User: 삼성전자 분석해줘');
    res = await chat('삼성전자 분석해줘', 'test-switch');
    console.log('\nUser: 어때?');
    res = await chat('어때?', 'test-switch');
    console.log('Yeri (expects 삼성전자):', res.substring(0, 100).replace(/\n/g, ' '));

    console.log('\nUser: NVDA 분석해줘');
    res = await chat('NVDA 분석해줘', 'test-switch');
    console.log('\nUser: 어때?');
    res = await chat('어때?', 'test-switch');
    console.log('Yeri (expects NVDA):', res.substring(0, 100).replace(/\n/g, ' '));

    console.log('\n======================================');
    console.log('3. 비교 질문 테스트');
    console.log('======================================');
    console.log('User: NVDA랑 TSLA 비교해줘');
    res = await chat('NVDA랑 TSLA 비교해줘', 'test-comp');
    console.log('Yeri:', res.substring(0, 100).replace(/\n/g, ' '));

    console.log('\nUser: 지금은 누가 덜 비싸?');
    res = await chat('지금은 누가 덜 비싸?', 'test-comp');
    console.log('Yeri:', res.substring(0, 150).replace(/\n/g, ' '));
}

run().catch(console.error);
