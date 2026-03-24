const { OpenAI } = require('openai');
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '../.env'), override: true });

const apiKey = process.env.OPENAI_API_KEY;

if (!apiKey) {
    // api-server.js에서 이미 체크해서 종료했어야 하지만, 직접 require된 경우 대비
    throw new Error(
        '[OpenAI-Client] OPENAI_API_KEY is not set.\n' +
        '  → Set it in Render → Environment Variables\n' +
        '  → Or add it to your .env file'
    );
}

const maskedKey = apiKey.substring(0, 10) + '...' + apiKey.substring(apiKey.length - 4);
console.log(`📡 [OpenAI-Client] Initialized with key: ${maskedKey}`);

const client = new OpenAI({ apiKey });

module.exports = client;


/**
 * Common OpenAI client instance for the entire project.
 * Ensures consistent configuration and authentication.
 */
module.exports = client;
