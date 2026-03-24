const { OpenAI } = require('openai');
const path = require('path');

// Ensure dotenv is loaded before initializing the client
// We use an absolute path to avoid directory-dependent issues
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const apiKey = process.env.OPENAI_API_KEY;

// Force override because shell environment might have an old key
require('dotenv').config({ 
    path: path.join(__dirname, '../.env'),
    override: true 
});

const newApiKey = process.env.OPENAI_API_KEY;

if (!newApiKey) {
    console.error('❌ [OpenAI-Client] OPENAI_API_KEY is missing in process.env');
} else {
    // Mask the key for security in logs
    const maskedKey = newApiKey.substring(0, 10) + '...' + newApiKey.substring(newApiKey.length - 4);
    if (apiKey && apiKey !== newApiKey) {
        console.log(`⚠️ [OpenAI-Client] Overriding shell key (...${apiKey.slice(-4)}) with .env key (...${newApiKey.slice(-4)})`);
    }
    console.log(`📡 [OpenAI-Client] Initializing with key: ${maskedKey}`);
}

const client = new OpenAI({
    apiKey: newApiKey,
});

/**
 * Common OpenAI client instance for the entire project.
 * Ensures consistent configuration and authentication.
 */
module.exports = client;
