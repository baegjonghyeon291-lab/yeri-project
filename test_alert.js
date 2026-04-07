const axios = require('axios');

async function run() {
    try {
        const userId = 'webapp'; // Assuming 'webapp' is the user ID if not specified

        console.log("1. Adding IREN with takeProfitPct=1% to trigger alert...");
        await axios.post(`http://localhost:3001/api/portfolio/${userId}/add`, {
            ticker: "IREN",
            name: "IREN",
            quantity: 100,
            avgPrice: 8, // Assuming 8, current price is around 35 so it's a huge profit.
            alerts: {
                enabled: true,
                takeProfitPct: 1, // 1% profit target, which will definitely trigger since 8 -> 35 is >300%
                priceAbove: null,
                priceBelow: null,
                stopLossPct: null,
                maxWeight: null,
                badgeChange: true
            }
        });

        console.log("2. Fetching portfolio to trigger the background alert evaluation...");
        await axios.get(`http://localhost:3001/api/portfolio/${userId}`);

        console.log("3. Fetching notifications from the store...");
        const res = await axios.get(`http://localhost:3001/api/notifications/${userId}`);
        
        console.log("✅ Success! Notifications:", JSON.stringify(res.data, null, 2));
    } catch (e) {
        console.error("❌ Error:", e.message);
    }
}

run();
