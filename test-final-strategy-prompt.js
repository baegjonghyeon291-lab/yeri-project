const axios = require('axios');
const API_URL = 'http://localhost:3001/api/chat';

async function chat(text, chatId) {
    const res = await axios.post(API_URL, { text, chatId });
    return res.data.messages[0].content;
}

async function run() {
    console.log('\n======================================');
    console.log('1. 한국주식 (삼성전자) - 평단/수량/목표가 계산 검증');
    console.log('======================================');
    const res1 = await chat('삼성전자 1주 평균이 85000원이고 15주 가지고 있어. 100000원 돌파 가능할까?', 'test-strat-1');
    console.log(res1);
    
    await new Promise(r => setTimeout(r, 4000));
    console.log('\n======================================');
    console.log('2. 해외 주류 (NVDA) - 평단/수량/목표가 계산 검증');
    console.log('======================================');
    const res2 = await chat('엔비디아 평단가 $130, 수량 50주 보유중임. 이거 $200 언제 갈까?', 'test-strat-2');
    console.log(res2);

    await new Promise(r => setTimeout(r, 4000));
    console.log('\n======================================');
    console.log('3. 비주류 (IREN) - 일반 전략 질문 (목표가 없음)');
    console.log('======================================');
    const res3 = await chat('IREN 살까 말까 고민중인데 지금 어때?', 'test-strat-3');
    console.log(res3);
}

run().catch(console.error);
