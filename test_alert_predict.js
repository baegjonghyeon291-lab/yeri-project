const axios = require('axios');

async function run() {
    try {
        const userId = 'webapp';

        // 0. 기존 IREN 제거 (클린 상태)
        console.log("0. Removing existing IREN if any...");
        await axios.post(`http://localhost:3001/api/portfolio/${userId}/remove`, { ticker: "IREN" }).catch(() => {});

        // 1. Clear old alert history for fresh test
        console.log("1. Adding IREN with ALL alerts enabled (condition + predict)...");
        const addRes = await axios.post(`http://localhost:3001/api/portfolio/${userId}/add`, {
            ticker: "IREN",
            name: "Iris Energy",
            quantity: 100,
            avgPrice: 8,
            alerts: {
                enabled: true,
                takeProfitPct: 20,
                priceAbove: 15,     // Will test predictBreakout if price is 90%+ of 15
                priceBelow: 5,
                stopLossPct: -10,
                maxWeight: 30,
                totalValueAbove: 3000,
                badgeChange: true,
                predictEnabled: true,
                predictBreakout: true,
                predictMomentumUp: true,
                predictDump: true,
                predictBadgeDown: true,
                predictWeightRisk: true
            }
        });
        console.log(`   Add result: ${addRes.data.result}`);

        // 2. Trigger portfolio evaluation
        console.log("\n2. Fetching portfolio (triggers alert evaluation)...");
        const portRes = await axios.get(`http://localhost:3001/api/portfolio/${userId}`);
        const iren = portRes.data.holdings.find(h => h.ticker === 'IREN');
        if (iren) {
            console.log(`   IREN status: badge=${iren.status?.badge}, overall=${iren.status?.overall}`);
            console.log(`   IREN price: $${iren.currentPrice}, change: ${iren.changePct}%`);
            console.log(`   IREN weight: ${iren.weight}%`);
            console.log(`   IREN alerts saved: ${JSON.stringify(iren.alerts?.predictEnabled)}`);
        }

        // 3. Check notifications
        console.log("\n3. Checking notifications...");
        const notifRes = await axios.get(`http://localhost:3001/api/notifications/${userId}`);
        const notifs = notifRes.data.notifications || [];
        console.log(`   Total notifications: ${notifs.length}`);
        
        if (notifs.length > 0) {
            console.log("\n   📬 알림 목록:");
            notifs.forEach((n, i) => {
                console.log(`   ${i+1}. [${n.type}] ${n.message}`);
            });
        }

        console.log("\n✅ Test complete!");
    } catch (e) {
        console.error("❌ Error:", e.response?.data || e.message);
    }
}

run();
