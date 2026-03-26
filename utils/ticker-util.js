/**
 * ticker-util.js
 * Maps Korean company names / tickers / codes and sector keywords.
 */

const KR_COMPANY_MAP = {
    // 삼성 그룹
    '삼성전자': { ticker: '005930', corpCode: '00126380', name: '삼성전자', market: 'KR' },
    '삼성':     { ticker: '005930', corpCode: '00126380', name: '삼성전자', market: 'KR' },
    '삼전':     { ticker: '005930', corpCode: '00126380', name: '삼성전자', market: 'KR' },
    '삼성전자우': { ticker: '005935', corpCode: '00126380', name: '삼성전자우', market: 'KR' },
    '삼성바이오로직스': { ticker: '207940', corpCode: '00877059', name: '삼성바이오로직스', market: 'KR' },
    '삼바':     { ticker: '207940', corpCode: '00877059', name: '삼성바이오로직스', market: 'KR' },
    '삼성sdi':  { ticker: '006400', corpCode: '00126362', name: '삼성SDI', market: 'KR' },
    '삼성에스디아이': { ticker: '006400', corpCode: '00126362', name: '삼성SDI', market: 'KR' },
    '삼디':     { ticker: '006400', corpCode: '00126362', name: '삼성SDI', market: 'KR' },
    '삼성sds':  { ticker: '018260', corpCode: '00126362', name: '삼성SDS', market: 'KR' },
    '삼성물산':  { ticker: '028260', corpCode: '00126380', name: '삼성물산', market: 'KR' },
    // SK 그룹
    'sk하이닉스': { ticker: '000660', corpCode: '00164779', name: 'SK하이닉스', market: 'KR' },
    '하이닉스':  { ticker: '000660', corpCode: '00164779', name: 'SK하이닉스', market: 'KR' },
    'sk이노베이션': { ticker: '096770', corpCode: null, name: 'SK이노베이션', market: 'KR' },
    'sk텔레콤':  { ticker: '017670', corpCode: null, name: 'SK텔레콤', market: 'KR' },
    // 현대/기아
    '현대차':   { ticker: '005380', corpCode: '00164742', name: '현대자동차', market: 'KR' },
    '현대자동차': { ticker: '005380', corpCode: '00164742', name: '현대자동차', market: 'KR' },
    '기아':     { ticker: '000270', corpCode: '00106641', name: '기아', market: 'KR' },
    '현대모비스': { ticker: '012330', corpCode: null, name: '현대모비스', market: 'KR' },
    '현대중공업': { ticker: '329180', corpCode: null, name: '현대중공업', market: 'KR' },
    // LG 그룹
    'lg에너지솔루션': { ticker: '373220', corpCode: '01426674', name: 'LG에너지솔루션', market: 'KR' },
    '엘지에너지솔루션': { ticker: '373220', corpCode: '01426674', name: 'LG에너지솔루션', market: 'KR' },
    'lg화학':   { ticker: '051910', corpCode: '00356360', name: 'LG화학', market: 'KR' },
    'lg전자':   { ticker: '066570', corpCode: null, name: 'LG전자', market: 'KR' },
    'lg디스플레이': { ticker: '034220', corpCode: null, name: 'LG디스플레이', market: 'KR' },
    // 인터넷/플랫폼
    '카카오':   { ticker: '035720', corpCode: '00258801', name: '카카오', market: 'KR' },
    '네이버':   { ticker: '035420', corpCode: '00126371', name: 'NAVER', market: 'KR' },
    'naver':    { ticker: '035420', corpCode: '00126371', name: 'NAVER', market: 'KR' },
    // 바이오/제약
    '셀트리온':  { ticker: '068270', corpCode: '00430828', name: '셀트리온', market: 'KR' },
    '셀트':     { ticker: '068270', corpCode: '00430828', name: '셀트리온', market: 'KR' },
    // 철강/소재
    '포스코홀딩스': { ticker: '005490', corpCode: '00126352', name: 'POSCO홀딩스', market: 'KR' },
    '포스코':   { ticker: '005490', corpCode: '00126352', name: 'POSCO홀딩스', market: 'KR' },
    // 금융
    'kb금융':   { ticker: '105560', corpCode: '00540274', name: 'KB금융', market: 'KR' },
    '신한지주':  { ticker: '055550', corpCode: '00366774', name: '신한지주', market: 'KR' },
    '하나금융지주': { ticker: '086790', corpCode: '00643316', name: '하나금융지주', market: 'KR' },
    // 에너지/전력
    '한국전력':  { ticker: '015760', corpCode: null, name: '한국전력', market: 'KR' },
    '한전':     { ticker: '015760', corpCode: null, name: '한국전력', market: 'KR' },
    '두산에너빌리티': { ticker: '034020', corpCode: null, name: '두산에너빌리티', market: 'KR' },
    '두빌':     { ticker: '034020', corpCode: null, name: '두산에너빌리티', market: 'KR' },
    '한화솔루션': { ticker: '009830', corpCode: null, name: '한화솔루션', market: 'KR' },
    // 방산/항공우주
    '한화에어로스페이스': { ticker: '012450', corpCode: null, name: '한화에어로스페이스', market: 'KR' },
    '한화에어로': { ticker: '012450', corpCode: null, name: '한화에어로스페이스', market: 'KR' },
    '대한항공':  { ticker: '003490', corpCode: null, name: '대한항공', market: 'KR' },
    // 2차전지/소재
    '에코프로':  { ticker: '086520', corpCode: null, name: '에코프로', market: 'KR' },
    '에코프로비엠': { ticker: '247540', corpCode: null, name: '에코프로비엠', market: 'KR' },
    '엘앤에프':  { ticker: '066970', corpCode: null, name: '엘앤에프', market: 'KR' },
    '천보':     { ticker: '278280', corpCode: null, name: '천보', market: 'KR' },
    '금양':     { ticker: '001570', corpCode: null, name: '금양', market: 'KR' },
    // 건설/중공업
    '두산밥캣':  { ticker: '241560', corpCode: null, name: '두산밥캣', market: 'KR' },
    'ls일렉트릭': { ticker: '010120', corpCode: null, name: 'LS ELECTRIC', market: 'KR' },
    'lselectric': { ticker: '010120', corpCode: null, name: 'LS ELECTRIC', market: 'KR' },
    // 해운/물류
    'hmm':      { ticker: '011200', corpCode: null, name: 'HMM', market: 'KR' },
    '팬오션':   { ticker: '028670', corpCode: null, name: '팬오션', market: 'KR' },
    // 소비재/기타
    '아모레퍼시픽': { ticker: '090430', corpCode: null, name: '아모레퍼시픽', market: 'KR' },
    'cj제일제당': { ticker: '097950', corpCode: null, name: 'CJ제일제당', market: 'KR' },
    'kt':       { ticker: '030200', corpCode: null, name: 'KT', market: 'KR' },
    // 엔터
    '하이브':   { ticker: '352820', corpCode: null, name: '하이브', market: 'KR' },
    'hybe':     { ticker: '352820', corpCode: null, name: '하이브', market: 'KR' },
    'jyp':      { ticker: '035900', corpCode: null, name: 'JYP Ent.', market: 'KR' },
    'sm':       { ticker: '041510', corpCode: null, name: 'SM엔터', market: 'KR' },
    'sm엔터':   { ticker: '041510', corpCode: null, name: 'SM엔터', market: 'KR' },
    'yg':       { ticker: '122870', corpCode: null, name: 'YG엔터', market: 'KR' },
    'yg엔터':   { ticker: '122870', corpCode: null, name: 'YG엔터', market: 'KR' },
};

// US company Korean names / abbreviations / English names → ticker
const US_COMPANY_MAP = {
    // Big Tech
    '애플': { ticker: 'AAPL', name: 'Apple' },
    'apple': { ticker: 'AAPL', name: 'Apple' },
    '테슬라': { ticker: 'TSLA', name: 'Tesla' },
    'tesla': { ticker: 'TSLA', name: 'Tesla' },
    '엔비디아': { ticker: 'NVDA', name: 'NVIDIA' },
    'nvidia': { ticker: 'NVDA', name: 'NVIDIA' },
    '마이크로소프트': { ticker: 'MSFT', name: 'Microsoft' },
    'microsoft': { ticker: 'MSFT', name: 'Microsoft' },
    '구글': { ticker: 'GOOGL', name: 'Alphabet (Google)' },
    'google': { ticker: 'GOOGL', name: 'Alphabet (Google)' },
    '알파벳': { ticker: 'GOOGL', name: 'Alphabet (Google)' },
    'alphabet': { ticker: 'GOOGL', name: 'Alphabet (Google)' },
    '메타': { ticker: 'META', name: 'Meta Platforms' },
    'meta': { ticker: 'META', name: 'Meta Platforms' },
    '페이스북': { ticker: 'META', name: 'Meta Platforms' },
    'facebook': { ticker: 'META', name: 'Meta Platforms' },
    '아마존': { ticker: 'AMZN', name: 'Amazon' },
    'amazon': { ticker: 'AMZN', name: 'Amazon' },
    // Streaming / Media
    '넷플릭스': { ticker: 'NFLX', name: 'Netflix' },
    'netflix': { ticker: 'NFLX', name: 'Netflix' },
    '디즈니': { ticker: 'DIS', name: 'Disney' },
    'disney': { ticker: 'DIS', name: 'Disney' },
    '스포티파이': { ticker: 'SPOT', name: 'Spotify' },
    'spotify': { ticker: 'SPOT', name: 'Spotify' },
    '로쿠': { ticker: 'ROKU', name: 'Roku' },
    'roku': { ticker: 'ROKU', name: 'Roku' },
    // Semiconductor
    '브로드컴': { ticker: 'AVGO', name: 'Broadcom' },
    'broadcom': { ticker: 'AVGO', name: 'Broadcom' },
    '인텔': { ticker: 'INTC', name: 'Intel' },
    'intel': { ticker: 'INTC', name: 'Intel' },
    'tsmc': { ticker: 'TSM', name: 'TSMC' },
    '타이완반도체': { ticker: 'TSM', name: 'TSMC' },
    'amd': { ticker: 'AMD', name: 'AMD' },
    '에이엠디': { ticker: 'AMD', name: 'AMD' },
    'asml': { ticker: 'ASML', name: 'ASML' },
    '퀄컴': { ticker: 'QCOM', name: 'Qualcomm' },
    'qualcomm': { ticker: 'QCOM', name: 'Qualcomm' },
    'arm': { ticker: 'ARM', name: 'Arm Holdings' },
    // Software / Platform
    '팔란티어': { ticker: 'PLTR', name: 'Palantir' },
    'palantir': { ticker: 'PLTR', name: 'Palantir' },
    '듀오링고': { ticker: 'DUOL', name: 'Duolingo' },
    'duolingo': { ticker: 'DUOL', name: 'Duolingo' },
    '오라클': { ticker: 'ORCL', name: 'Oracle' },
    'oracle': { ticker: 'ORCL', name: 'Oracle' },
    '어도비': { ticker: 'ADBE', name: 'Adobe' },
    'adobe': { ticker: 'ADBE', name: 'Adobe' },
    '세일즈포스': { ticker: 'CRM', name: 'Salesforce' },
    'salesforce': { ticker: 'CRM', name: 'Salesforce' },
    '스노우플레이크': { ticker: 'SNOW', name: 'Snowflake' },
    'snowflake': { ticker: 'SNOW', name: 'Snowflake' },
    '줌': { ticker: 'ZM', name: 'Zoom' },
    'zoom': { ticker: 'ZM', name: 'Zoom' },
    '도큐사인': { ticker: 'DOCU', name: 'DocuSign' },
    'docusign': { ticker: 'DOCU', name: 'DocuSign' },
    '쇼피파이': { ticker: 'SHOP', name: 'Shopify' },
    'shopify': { ticker: 'SHOP', name: 'Shopify' },
    '트윌리오': { ticker: 'TWLO', name: 'Twilio' },
    'twilio': { ticker: 'TWLO', name: 'Twilio' },
    '허브스팟': { ticker: 'HUBS', name: 'HubSpot' },
    'hubspot': { ticker: 'HUBS', name: 'HubSpot' },
    // Cybersecurity
    '팔로알토': { ticker: 'PANW', name: 'Palo Alto Networks' },
    'paloalto': { ticker: 'PANW', name: 'Palo Alto Networks' },
    '크라우드스트라이크': { ticker: 'CRWD', name: 'CrowdStrike' },
    'crowdstrike': { ticker: 'CRWD', name: 'CrowdStrike' },
    // Crypto / Fintech
    '코인베이스': { ticker: 'COIN', name: 'Coinbase' },
    'coinbase': { ticker: 'COIN', name: 'Coinbase' },
    '페이팔': { ticker: 'PYPL', name: 'PayPal' },
    'paypal': { ticker: 'PYPL', name: 'PayPal' },
    // Consumer / Retail
    '나이키': { ticker: 'NKE', name: 'Nike' },
    'nike': { ticker: 'NKE', name: 'Nike' },
    '코카콜라': { ticker: 'KO', name: 'Coca-Cola' },
    'cocacola': { ticker: 'KO', name: 'Coca-Cola' },
    'coca-cola': { ticker: 'KO', name: 'Coca-Cola' },
    '펩시': { ticker: 'PEP', name: 'PepsiCo' },
    'pepsi': { ticker: 'PEP', name: 'PepsiCo' },
    'pepsico': { ticker: 'PEP', name: 'PepsiCo' },
    '펩시코': { ticker: 'PEP', name: 'PepsiCo' },
    '월마트': { ticker: 'WMT', name: 'Walmart' },
    'walmart': { ticker: 'WMT', name: 'Walmart' },
    '코스트코': { ticker: 'COST', name: 'Costco' },
    'costco': { ticker: 'COST', name: 'Costco' },
    '스타벅스': { ticker: 'SBUX', name: 'Starbucks' },
    'starbucks': { ticker: 'SBUX', name: 'Starbucks' },
    '맥도날드': { ticker: 'MCD', name: "McDonald's" },
    'mcdonalds': { ticker: 'MCD', name: "McDonald's" },
    // Defense / Aerospace
    '보잉': { ticker: 'BA', name: 'Boeing' },
    'boeing': { ticker: 'BA', name: 'Boeing' },
    '록히드마틴': { ticker: 'LMT', name: 'Lockheed Martin' },
    'lockheed': { ticker: 'LMT', name: 'Lockheed Martin' },
    // EV / Auto
    '리비안': { ticker: 'RIVN', name: 'Rivian' },
    'rivian': { ticker: 'RIVN', name: 'Rivian' },
    '루시드': { ticker: 'LCID', name: 'Lucid' },
    'lucid': { ticker: 'LCID', name: 'Lucid' },
    '니오': { ticker: 'NIO', name: 'NIO' },
    'nio': { ticker: 'NIO', name: 'NIO' },
    '샤오펑': { ticker: 'XPEV', name: 'XPeng' },
    'xpeng': { ticker: 'XPEV', name: 'XPeng' },
    'byd': { ticker: 'BYDDY', name: 'BYD' },
    '비야디': { ticker: 'BYDDY', name: 'BYD' },
    // China Tech
    '알리바바': { ticker: 'BABA', name: 'Alibaba' },
    'alibaba': { ticker: 'BABA', name: 'Alibaba' },
    '텐센트': { ticker: 'TCEHY', name: 'Tencent' },
    'tencent': { ticker: 'TCEHY', name: 'Tencent' },
    '샤오미': { ticker: 'XIACY', name: 'Xiaomi' },
    'xiaomi': { ticker: 'XIACY', name: 'Xiaomi' },
    // Healthcare / Bio
    '존슨앤드존슨': { ticker: 'JNJ', name: 'Johnson & Johnson' },
    '유나이티드헬스': { ticker: 'UNH', name: 'UnitedHealth' },
    '화이자': { ticker: 'PFE', name: 'Pfizer' },
    'pfizer': { ticker: 'PFE', name: 'Pfizer' },
    '모더나': { ticker: 'MRNA', name: 'Moderna' },
    'moderna': { ticker: 'MRNA', name: 'Moderna' },
    // Finance
    '제이피모간': { ticker: 'JPM', name: 'JPMorgan' },
    'jpmorgan': { ticker: 'JPM', name: 'JPMorgan' },
    '골드만삭스': { ticker: 'GS', name: 'Goldman Sachs' },
    // Energy
    '엑손모빌': { ticker: 'XOM', name: 'ExxonMobil' },
    'exxon': { ticker: 'XOM', name: 'ExxonMobil' },
    '셰브론': { ticker: 'CVX', name: 'Chevron' },
    'chevron': { ticker: 'CVX', name: 'Chevron' },
    // Finance (추가)
    '뱅크오브아메리카': { ticker: 'BAC', name: 'Bank of America' },
    'bankofamerica': { ticker: 'BAC', name: 'Bank of America' },
    '모건스탠리': { ticker: 'MS', name: 'Morgan Stanley' },
    'morganstanley': { ticker: 'MS', name: 'Morgan Stanley' },
    '시티그룹': { ticker: 'C', name: 'Citigroup' },
    'citigroup': { ticker: 'C', name: 'Citigroup' },
    '비자': { ticker: 'V', name: 'Visa' },
    'visa': { ticker: 'V', name: 'Visa' },
    '마스터카드': { ticker: 'MA', name: 'Mastercard' },
    'mastercard': { ticker: 'MA', name: 'Mastercard' },
    '찰스슈왑': { ticker: 'SCHW', name: 'Charles Schwab' },
    '블랙록': { ticker: 'BLK', name: 'BlackRock' },
    'blackrock': { ticker: 'BLK', name: 'BlackRock' },
    // SaaS / Cloud (추가)
    '데이터독': { ticker: 'DDOG', name: 'Datadog' },
    'datadog': { ticker: 'DDOG', name: 'Datadog' },
    '몽고디비': { ticker: 'MDB', name: 'MongoDB' },
    'mongodb': { ticker: 'MDB', name: 'MongoDB' },
    '지스케일러': { ticker: 'ZS', name: 'Zscaler' },
    'zscaler': { ticker: 'ZS', name: 'Zscaler' },
    '서비스나우': { ticker: 'NOW', name: 'ServiceNow' },
    'servicenow': { ticker: 'NOW', name: 'ServiceNow' },
    '워크데이': { ticker: 'WDAY', name: 'Workday' },
    'workday': { ticker: 'WDAY', name: 'Workday' },
    '클라우드플레어': { ticker: 'NET', name: 'Cloudflare' },
    'cloudflare': { ticker: 'NET', name: 'Cloudflare' },
    '포티넷': { ticker: 'FTNT', name: 'Fortinet' },
    'fortinet': { ticker: 'FTNT', name: 'Fortinet' },
    // Comm / Social (추가)
    '스냅': { ticker: 'SNAP', name: 'Snap Inc.' },
    'snap': { ticker: 'SNAP', name: 'Snap Inc.' },
    '트위터': { ticker: 'X', name: 'X (Twitter)' },
    '레딧': { ticker: 'RDDT', name: 'Reddit' },
    'reddit': { ticker: 'RDDT', name: 'Reddit' },
    // Other
    '버크셔해서웨이': { ticker: 'BRK.B', name: 'Berkshire Hathaway' },
    '버크셔': { ticker: 'BRK.B', name: 'Berkshire Hathaway' },
    '우버': { ticker: 'UBER', name: 'Uber' },
    'uber': { ticker: 'UBER', name: 'Uber' },
    '에어비앤비': { ticker: 'ABNB', name: 'Airbnb' },
    'airbnb': { ticker: 'ABNB', name: 'Airbnb' },
    '로블록스': { ticker: 'RBLX', name: 'Roblox' },
    'roblox': { ticker: 'RBLX', name: 'Roblox' },
    '유니티': { ticker: 'U', name: 'Unity' },
    'unity': { ticker: 'U', name: 'Unity' },
    '코세라': { ticker: 'COUR', name: 'Coursera' },
    'coursera': { ticker: 'COUR', name: 'Coursera' },
    '슈퍼마이크로': { ticker: 'SMCI', name: 'Super Micro Computer' },
    'supermicro': { ticker: 'SMCI', name: 'Super Micro Computer' },
    '아이온큐': { ticker: 'IONQ', name: 'IonQ' },
    'ionq': { ticker: 'IONQ', name: 'IonQ' },
    '아이로봇': { ticker: 'IRBT', name: 'iRobot' },
    '핀터레스트': { ticker: 'PINS', name: 'Pinterest' },
    'pinterest': { ticker: 'PINS', name: 'Pinterest' },
    // Ride-hailing / Travel (추가)
    '리프트': { ticker: 'LYFT', name: 'Lyft' },
    'lyft': { ticker: 'LYFT', name: 'Lyft' },
    '부킹': { ticker: 'BKNG', name: 'Booking Holdings' },
    'booking': { ticker: 'BKNG', name: 'Booking Holdings' },
    // Gaming (추가)
    '일렉트로닉아츠': { ticker: 'EA', name: 'Electronic Arts' },
    'ea': { ticker: 'EA', name: 'Electronic Arts' },
    '테이크투': { ticker: 'TTWO', name: 'Take-Two Interactive' },
    // ── AI / 성장주 (추가) ──
    'c3ai': { ticker: 'AI', name: 'C3.ai' },
    'c3': { ticker: 'AI', name: 'C3.ai' },
    '사운드하운드': { ticker: 'SOUN', name: 'SoundHound AI' },
    'soundhound': { ticker: 'SOUN', name: 'SoundHound AI' },
    'soun': { ticker: 'SOUN', name: 'SoundHound AI' },
    '유아이패스': { ticker: 'PATH', name: 'UiPath' },
    'uipath': { ticker: 'PATH', name: 'UiPath' },
    '심보틱': { ticker: 'SYM', name: 'Symbotic' },
    'symbotic': { ticker: 'SYM', name: 'Symbotic' },
    '빅베어ai': { ticker: 'BBAI', name: 'BigBear.ai' },
    'bigbear': { ticker: 'BBAI', name: 'BigBear.ai' },
    '사운드하운드': { ticker: 'SOUN', name: 'SoundHound AI' },
    'soundhound': { ticker: 'SOUN', name: 'SoundHound AI' },
    '아이온큐': { ticker: 'IONQ', name: 'IonQ' },
    'ionq': { ticker: 'IONQ', name: 'IonQ' },
    'c3ai': { ticker: 'AI', name: 'C3.ai' },
    'ai': { ticker: 'AI', name: 'C3.ai' },
    'smr': { ticker: 'SMR', name: 'NuScale Power' },
    '누스케일': { ticker: 'SMR', name: 'NuScale Power' },
    'rklb': { ticker: 'RKLB', name: 'Rocket Lab' },
    '로켓랩': { ticker: 'RKLB', name: 'Rocket Lab' },
    // ── 플랫폼 (추가) ──
    '도어대시': { ticker: 'DASH', name: 'DoorDash' },
    'doordash': { ticker: 'DASH', name: 'DoorDash' },
    '그랩': { ticker: 'GRAB', name: 'Grab Holdings' },
    'grab': { ticker: 'GRAB', name: 'Grab Holdings' },
    '씨리미티드': { ticker: 'SE', name: 'Sea Limited' },
    'sea': { ticker: 'SE', name: 'Sea Limited' },
    '메르카도리브레': { ticker: 'MELI', name: 'MercadoLibre' },
    'mercadolibre': { ticker: 'MELI', name: 'MercadoLibre' },
    '블록': { ticker: 'SQ', name: 'Block (Square)' },
    'block': { ticker: 'SQ', name: 'Block (Square)' },
    '스퀘어': { ticker: 'SQ', name: 'Block (Square)' },
    'square': { ticker: 'SQ', name: 'Block (Square)' },
    '토스트': { ticker: 'TOST', name: 'Toast' },
    'toast': { ticker: 'TOST', name: 'Toast' },
    // ── 반도체 (추가) ──
    '마벨': { ticker: 'MRVL', name: 'Marvell Technology' },
    'marvell': { ticker: 'MRVL', name: 'Marvell Technology' },
    '마이크론': { ticker: 'MU', name: 'Micron Technology' },
    'micron': { ticker: 'MU', name: 'Micron Technology' },
    '램리서치': { ticker: 'LRCX', name: 'Lam Research' },
    'lamresearch': { ticker: 'LRCX', name: 'Lam Research' },
    '어플라이드머티리얼즈': { ticker: 'AMAT', name: 'Applied Materials' },
    'appliedmaterials': { ticker: 'AMAT', name: 'Applied Materials' },
    '케이엘에이': { ticker: 'KLAC', name: 'KLA Corporation' },
    'kla': { ticker: 'KLAC', name: 'KLA Corporation' },
    '온세미': { ticker: 'ON', name: 'ON Semiconductor' },
    'onsemi': { ticker: 'ON', name: 'ON Semiconductor' },
    '텍사스인스트루먼트': { ticker: 'TXN', name: 'Texas Instruments' },
    'texasinstruments': { ticker: 'TXN', name: 'Texas Instruments' },
    // ── 소비재 (추가) ──
    '피앤지': { ticker: 'PG', name: 'Procter & Gamble' },
    'pg': { ticker: 'PG', name: 'Procter & Gamble' },
    '프록터앤갬블': { ticker: 'PG', name: 'Procter & Gamble' },
    '룰루레몬': { ticker: 'LULU', name: 'Lululemon' },
    'lululemon': { ticker: 'LULU', name: 'Lululemon' },
    '치폴레': { ticker: 'CMG', name: 'Chipotle Mexican Grill' },
    'chipotle': { ticker: 'CMG', name: 'Chipotle Mexican Grill' },
    '타겟': { ticker: 'TGT', name: 'Target' },
    'target': { ticker: 'TGT', name: 'Target' },
    '홈디포': { ticker: 'HD', name: 'Home Depot' },
    'homedepot': { ticker: 'HD', name: 'Home Depot' },
    '에스티로더': { ticker: 'EL', name: 'Estée Lauder' },
    'esteelauder': { ticker: 'EL', name: 'Estée Lauder' },
    // ── 금융 (추가) ──
    '웰스파고': { ticker: 'WFC', name: 'Wells Fargo' },
    'wellsfargo': { ticker: 'WFC', name: 'Wells Fargo' },
    '아메리칸익스프레스': { ticker: 'AXP', name: 'American Express' },
    'americanexpress': { ticker: 'AXP', name: 'American Express' },
    '아멕스': { ticker: 'AXP', name: 'American Express' },
    '로빈후드': { ticker: 'HOOD', name: 'Robinhood' },
    'robinhood': { ticker: 'HOOD', name: 'Robinhood' },
    '소파이': { ticker: 'SOFI', name: 'SoFi Technologies' },
    'sofi': { ticker: 'SOFI', name: 'SoFi Technologies' },
    // ── 통신/미디어 (추가) ──
    '컴캐스트': { ticker: 'CMCSA', name: 'Comcast' },
    'comcast': { ticker: 'CMCSA', name: 'Comcast' },
    '워너브로스': { ticker: 'WBD', name: 'Warner Bros. Discovery' },
    'warnerbros': { ticker: 'WBD', name: 'Warner Bros. Discovery' },
    '파라마운트': { ticker: 'PARA', name: 'Paramount Global' },
    'paramount': { ticker: 'PARA', name: 'Paramount Global' },
    // ── 헬스케어 (추가) ──
    '애브비': { ticker: 'ABBV', name: 'AbbVie' },
    'abbvie': { ticker: 'ABBV', name: 'AbbVie' },
    '일라이릴리': { ticker: 'LLY', name: 'Eli Lilly' },
    'elililly': { ticker: 'LLY', name: 'Eli Lilly' },
    '릴리': { ticker: 'LLY', name: 'Eli Lilly' },
    '노보노디스크': { ticker: 'NVO', name: 'Novo Nordisk' },
    'novonordisk': { ticker: 'NVO', name: 'Novo Nordisk' },
    '노보': { ticker: 'NVO', name: 'Novo Nordisk' },
    '머크': { ticker: 'MRK', name: 'Merck & Co.' },
    'merck': { ticker: 'MRK', name: 'Merck & Co.' },
    '암젠': { ticker: 'AMGN', name: 'Amgen' },
    'amgen': { ticker: 'AMGN', name: 'Amgen' },
    '인튜이티브서지컬': { ticker: 'ISRG', name: 'Intuitive Surgical' },
    'intuitivesurgical': { ticker: 'ISRG', name: 'Intuitive Surgical' },
    // ── 기타 성장주 (추가) ──
    '컨플루언트': { ticker: 'CFLT', name: 'Confluent' },
    'confluent': { ticker: 'CFLT', name: 'Confluent' },
    '깃랩': { ticker: 'GTLB', name: 'GitLab' },
    'gitlab': { ticker: 'GTLB', name: 'GitLab' },
    '델': { ticker: 'DELL', name: 'Dell Technologies' },
    'dell': { ticker: 'DELL', name: 'Dell Technologies' },
};

// ──────────────────────────────────────────────────────────
// ETF MAPPING — 주요 ETF 한글/영문 별칭
// ──────────────────────────────────────────────────────────
const ETF_MAP = {
    'qqq':    { ticker: 'QQQ',  name: 'Invesco QQQ (NASDAQ-100)' },
    '큐큐큐':  { ticker: 'QQQ',  name: 'Invesco QQQ (NASDAQ-100)' },
    '나스닥etf': { ticker: 'QQQ', name: 'Invesco QQQ (NASDAQ-100)' },
    'spy':    { ticker: 'SPY',  name: 'SPDR S&P 500 ETF' },
    '에스피와이': { ticker: 'SPY', name: 'SPDR S&P 500 ETF' },
    '에스앤피etf': { ticker: 'SPY', name: 'SPDR S&P 500 ETF' },
    's&p500etf': { ticker: 'SPY', name: 'SPDR S&P 500 ETF' },
    'dia':    { ticker: 'DIA',  name: 'SPDR Dow Jones ETF' },
    '다우etf':  { ticker: 'DIA',  name: 'SPDR Dow Jones ETF' },
    'iwm':    { ticker: 'IWM',  name: 'iShares Russell 2000 ETF' },
    '러셀etf':  { ticker: 'IWM',  name: 'iShares Russell 2000 ETF' },
    'soxx':   { ticker: 'SOXX', name: 'iShares Semiconductor ETF' },
    '반도체etf': { ticker: 'SOXX', name: 'iShares Semiconductor ETF' },
    'soxl':   { ticker: 'SOXL', name: 'Direxion Daily Semiconductor Bull 3x Shares' },
    '속슬':    { ticker: 'SOXL', name: 'Direxion Daily Semiconductor Bull 3x Shares' },
    'smh':    { ticker: 'SMH',  name: 'VanEck Semiconductor ETF' },
    'voo':    { ticker: 'VOO',  name: 'Vanguard S&P 500 ETF' },
    'tqqq':   { ticker: 'TQQQ', name: 'ProShares UltraPro QQQ (3x)' },
    '삼배나스닥': { ticker: 'TQQQ', name: 'ProShares UltraPro QQQ (3x)' },
    '3배나스닥': { ticker: 'TQQQ', name: 'ProShares UltraPro QQQ (3x)' },
    'sqqq':   { ticker: 'SQQQ', name: 'ProShares UltraPro Short QQQ (-3x)' },
    '인버스나스닥': { ticker: 'SQQQ', name: 'ProShares UltraPro Short QQQ (-3x)' },
    'arkk':   { ticker: 'ARKK', name: 'ARK Innovation ETF' },
    '아크':    { ticker: 'ARKK', name: 'ARK Innovation ETF' },
    'ark':    { ticker: 'ARKK', name: 'ARK Innovation ETF' },
    'vti':    { ticker: 'VTI',  name: 'Vanguard Total Stock Market ETF' },
    'schd':   { ticker: 'SCHD', name: 'Schwab U.S. Dividend Equity ETF' },
    '배당etf':  { ticker: 'SCHD', name: 'Schwab U.S. Dividend Equity ETF' },
    'xlk':    { ticker: 'XLK',  name: 'Technology Select Sector SPDR' },
    '기술etf':  { ticker: 'XLK',  name: 'Technology Select Sector SPDR' },
    // ── 추가 ETF ──
    'arkg':   { ticker: 'ARKG', name: 'ARK Genomic Revolution ETF' },
    '아크지노믹': { ticker: 'ARKG', name: 'ARK Genomic Revolution ETF' },
    'arkw':   { ticker: 'ARKW', name: 'ARK Next Generation Internet ETF' },
    'xle':    { ticker: 'XLE',  name: 'Energy Select Sector SPDR' },
    '에너지etf': { ticker: 'XLE',  name: 'Energy Select Sector SPDR' },
    'xlf':    { ticker: 'XLF',  name: 'Financial Select Sector SPDR' },
    '금융etf':  { ticker: 'XLF',  name: 'Financial Select Sector SPDR' },
    'xlv':    { ticker: 'XLV',  name: 'Health Care Select Sector SPDR' },
    '헬스케어etf': { ticker: 'XLV', name: 'Health Care Select Sector SPDR' },
    'gld':    { ticker: 'GLD',  name: 'SPDR Gold Shares' },
    '금etf':   { ticker: 'GLD',  name: 'SPDR Gold Shares' },
    '골드etf':  { ticker: 'GLD',  name: 'SPDR Gold Shares' },
    'slv':    { ticker: 'SLV',  name: 'iShares Silver Trust' },
    '은etf':   { ticker: 'SLV',  name: 'iShares Silver Trust' },
    'tlt':    { ticker: 'TLT',  name: 'iShares 20+ Year Treasury Bond ETF' },
    '채권etf':  { ticker: 'TLT',  name: 'iShares 20+ Year Treasury Bond ETF' },
    '국채etf':  { ticker: 'TLT',  name: 'iShares 20+ Year Treasury Bond ETF' },
    'kweb':   { ticker: 'KWEB', name: 'KraneShares CSI China Internet ETF' },
    '중국인터넷etf': { ticker: 'KWEB', name: 'KraneShares CSI China Internet ETF' },
    'eem':    { ticker: 'EEM',  name: 'iShares MSCI Emerging Markets ETF' },
    '이머징etf': { ticker: 'EEM',  name: 'iShares MSCI Emerging Markets ETF' },
    '신흥국etf': { ticker: 'EEM',  name: 'iShares MSCI Emerging Markets ETF' },
    'jepi':   { ticker: 'JEPI', name: 'JPMorgan Equity Premium Income ETF' },
    '커버드콜etf': { ticker: 'JEPI', name: 'JPMorgan Equity Premium Income ETF' },
    'jepq':   { ticker: 'JEPQ', name: 'JPMorgan Nasdaq Equity Premium Income ETF' },
    '나스닥커버드콜': { ticker: 'JEPQ', name: 'JPMorgan Nasdaq Equity Premium Income ETF' },
    'vnq':    { ticker: 'VNQ',  name: 'Vanguard Real Estate ETF' },
    '부동산etf': { ticker: 'VNQ', name: 'Vanguard Real Estate ETF' },
    '리츠etf':  { ticker: 'VNQ', name: 'Vanguard Real Estate ETF' },
};

// ──────────────────────────────────────────────────────────
// LEVERAGED ETF DETECTION
// ──────────────────────────────────────────────────────────
const LEVERAGED_ETFS = ['TQQQ', 'SQQQ', 'SOXL', 'SOXS', 'SPXL', 'SPXS', 'UPRO', 'SDOW', 'UDOW', 'LABU', 'LABD', 'FNGU', 'FNGD', 'TNA', 'TZA'];

function isLeveragedETF(ticker) {
    return LEVERAGED_ETFS.includes((ticker || '').toUpperCase());
}

function isETF(ticker) {
    const upper = (ticker || '').toUpperCase();
    for (const info of Object.values(ETF_MAP)) {
        if (info.ticker === upper) return true;
    }
    return false;
}

// ──────────────────────────────────────────────────────────
// ETF PEER MAP — ETF 비교 추천
// ──────────────────────────────────────────────────────────
const ETF_PEER_MAP = {
    'QQQ':  ['VOO', 'SPY', 'VTI', 'XLK', 'ARKK'],
    'SPY':  ['VOO', 'VTI', 'QQQ', 'DIA', 'IWM'],
    'VOO':  ['SPY', 'VTI', 'QQQ', 'SCHD', 'IWM'],
    'DIA':  ['SPY', 'VOO', 'VTI', 'IWM', 'SCHD'],
    'IWM':  ['SPY', 'QQQ', 'VTI', 'ARKK', 'DIA'],
    'SOXX': ['SMH', 'XLK', 'QQQ', 'ARKK', 'VGT'],
    'SMH':  ['SOXX', 'XLK', 'QQQ', 'ARKK', 'VGT'],
    'TQQQ': ['QQQ', 'SQQQ', 'SOXL', 'UPRO', 'FNGU'],
    'SQQQ': ['TQQQ', 'QQQ', 'SH', 'SPXS', 'SDOW'],
    'ARKK': ['ARKW', 'ARKG', 'QQQ', 'XLK', 'VGT'],
    'XLK':  ['QQQ', 'VGT', 'SOXX', 'SMH', 'ARKK'],
    'XLE':  ['VDE', 'OIH', 'XOP', 'IYE', 'AMLP'],
    'XLF':  ['KBE', 'KRE', 'VFH', 'IYF', 'KBWB'],
    'XLV':  ['VHT', 'IBB', 'ARKG', 'XBI', 'IHI'],
    'GLD':  ['SLV', 'IAU', 'GDX', 'GDXJ', 'SGOL'],
    'SLV':  ['GLD', 'IAU', 'SIL', 'PSLV', 'SIVR'],
    'TLT':  ['IEF', 'BND', 'AGG', 'VGLT', 'EDV'],
    'SCHD': ['VYM', 'DVY', 'HDV', 'DGRO', 'JEPI'],
    'JEPI': ['JEPQ', 'SCHD', 'XYLD', 'QYLD', 'DIVO'],
    'JEPQ': ['JEPI', 'QQQ', 'QYLD', 'SCHD', 'RYLD'],
    'VNQ':  ['XLRE', 'IYR', 'SCHH', 'RWR', 'REET'],
    'KWEB': ['FXI', 'EEM', 'MCHI', 'BABA', 'CQQQ'],
    'EEM':  ['VWO', 'IEMG', 'KWEB', 'FXI', 'EWZ'],
};

function getETFPeers(ticker) {
    return ETF_PEER_MAP[ticker?.toUpperCase()] || null;
}

// ──────────────────────────────────────────────────────────
// ABBREVIATION MAP — 축약어 전용 매핑 (fuzzy match 전 우선 체크)
// ──────────────────────────────────────────────────────────
const ABBREVIATION_MAP = {};

// ──────────────────────────────────────────────────────────
// PORTFOLIO PARSER — 포트폴리오 입력 파싱
// ──────────────────────────────────────────────────────────
function parsePortfolio(text) {
    // Pattern: "삼성전자 50 엔비디아 30 애플 20" or "NVDA 40 AAPL 30 MSFT 30"
    // Also handles: "삼성전자 50%, 엔비디아 30%, 애플 20%"
    // Returns [{name, ticker, market, weight}] or null
    const tokens = text.replace(/[,%％를을은이가·\-]/g, ' ').trim().split(/\s+/);
    const items = [];
    let i = 0;
    while (i < tokens.length) {
        const token = tokens[i];
        // Check if next token is a number (weight)
        const nextNum = i + 1 < tokens.length ? parseFloat(tokens[i + 1]) : NaN;
        if (!isNaN(nextNum)) {
            // Resolve the token as a stock/ETF
            if (token.toLowerCase() === '현금' || token.toLowerCase() === 'cash') {
                items.push({ name: '현금', ticker: 'CASH', market: '-', weight: nextNum });
                i += 2;
                continue;
            }
            const resolved = resolveStock(token);
            if (resolved) {
                items.push({ name: resolved.name, ticker: resolved.ticker, market: resolved.market, weight: nextNum });
            } else {
                items.push({ name: token, ticker: token.toUpperCase(), market: 'US', weight: nextNum });
            }
            i += 2;
        } else {
            i++;
        }
    }
    return items.length >= 2 ? items : null;
}

function isPortfolioInput(text) {
    // Detect if text looks like portfolio: at least 2 pairs of (name/ticker + number)
    const pattern = /(?:[A-Za-z가-힣]+)\s+\d+/g;
    const matches = text.match(pattern);
    return matches && matches.length >= 2;
}

function resolveUSCompany(input) {
    const lower = (input || '').toLowerCase().replace(/\s/g, '');
    if (US_COMPANY_MAP[lower]) return US_COMPANY_MAP[lower];
    // Also try partial match for longer names
    for (const [key, info] of Object.entries(US_COMPANY_MAP)) {
        if (lower.includes(key) && key.length >= 2) return info;
    }
    return null;
}

// Sector keywords → representative US/KR tickers
const SECTOR_MAP = {
    '반도체': { tickers: ['NVDA', 'AMD', 'INTC', 'TSM', 'ASML'], sector: '반도체', market: 'US' },
    'semiconductor': { tickers: ['NVDA', 'AMD', 'INTC', 'TSM'], sector: 'Semiconductor', market: 'US' },
    '전기차': { tickers: ['TSLA', 'RIVN', 'NIO', 'GM', 'F'], sector: '전기차/EV', market: 'US' },
    'ev': { tickers: ['TSLA', 'RIVN', 'NIO'], sector: 'EV', market: 'US' },
    'ai': { tickers: ['NVDA', 'MSFT', 'GOOGL', 'META', 'AMZN'], sector: 'AI', market: 'US' },
    '인공지능': { tickers: ['NVDA', 'MSFT', 'GOOGL', 'META'], sector: 'AI', market: 'US' },
    '바이오': { tickers: ['MRNA', 'BNTX', 'PFE', 'JNJ', 'ABBV'], sector: '바이오/헬스케어', market: 'US' },
    '헬스케어': { tickers: ['JNJ', 'UNH', 'PFE', 'ABBV', 'MRK'], sector: '헬스케어', market: 'US' },
    '금융': { tickers: ['JPM', 'BAC', 'GS', 'MS', 'C'], sector: '금융', market: 'US' },
    '에너지': { tickers: ['XOM', 'CVX', 'COP', 'SLB'], sector: '에너지', market: 'US' },
    '클라우드': { tickers: ['AMZN', 'MSFT', 'GOOGL', 'CRM', 'SNOW'], sector: '클라우드', market: 'US' },
    // ── 추가 섹터 ──
    '소비재': { tickers: ['AAPL', 'NKE', 'COST', 'MCD', 'SBUX'], sector: '소비재', market: 'US' },
    '플랫폼': { tickers: ['UBER', 'DASH', 'ABNB', 'GRAB', 'SE'], sector: '플랫폼', market: 'US' },
    '사이버보안': { tickers: ['CRWD', 'PANW', 'ZS', 'FTNT', 'NET'], sector: '사이버보안', market: 'US' },
    '보안': { tickers: ['CRWD', 'PANW', 'ZS', 'FTNT', 'NET'], sector: '사이버보안', market: 'US' },
    '비만치료': { tickers: ['LLY', 'NVO', 'AMGN', 'PFE', 'ABBV'], sector: '비만/헬스케어', market: 'US' },
    'saas': { tickers: ['CRM', 'NOW', 'WDAY', 'DDOG', 'SNOW'], sector: 'SaaS/클라우드', market: 'US' },
    '핀테크': { tickers: ['SQ', 'PYPL', 'SOFI', 'HOOD', 'COIN'], sector: '핀테크', market: 'US' },
    'fintech': { tickers: ['SQ', 'PYPL', 'SOFI', 'HOOD', 'COIN'], sector: '핀테크', market: 'US' },
};

// ──────────────────────────────────────────────────────────
// PEER MAP — 비교 종목 추천 사전
// ──────────────────────────────────────────────────────────
const PEER_MAP = {
    'AAPL': ['MSFT', 'GOOGL', 'META', 'AMZN', '005930'],
    'MSFT': ['AAPL', 'GOOGL', 'AMZN', 'CRM', 'ORCL'],
    'NVDA': ['AMD', 'AVGO', 'TSM', 'INTC', 'ASML'],
    'TSLA': ['RIVN', 'LCID', 'NIO', 'XPEV', 'BYDDY'],
    'GOOGL': ['META', 'MSFT', 'AMZN', 'AAPL', 'SNAP'],
    'META': ['GOOGL', 'SNAP', 'PINS', 'RDDT', 'MSFT'],
    'AMZN': ['SHOP', 'WMT', 'BABA', 'MSFT', 'GOOGL'],
    'NFLX': ['DIS', 'SPOT', 'ROKU', 'AMZN', 'AAPL'],
    'AMD': ['NVDA', 'INTC', 'AVGO', 'TSM', 'QCOM'],
    'AVGO': ['NVDA', 'AMD', 'TSM', 'QCOM', 'ASML'],
    'PLTR': ['SNOW', 'DDOG', 'CRM', 'MDB', 'NOW'],
    'DUOL': ['COUR', 'RBLX', 'U', 'PINS', 'SNAP'],
    'COIN': ['PYPL', 'SQ', 'HOOD', 'MARA', 'RIOT'],
    'BABA': ['JD', 'PDD', 'TCEHY', 'AMZN', 'SHOP'],
    'NIO': ['XPEV', 'RIVN', 'LCID', 'TSLA', 'BYDDY'],
    'SNOW': ['DDOG', 'MDB', 'PLTR', 'CRM', 'NET'],
    'CRM': ['NOW', 'WDAY', 'HUBS', 'ADBE', 'MSFT'],
    'UBER': ['LYFT', 'ABNB', 'BKNG', 'DASH', 'GRAB'],
    'V': ['MA', 'PYPL', 'SQ', 'GS', 'JPM'],
    'JPM': ['BAC', 'GS', 'MS', 'C', 'WFC'],
    // ── 추가 비교 그룹 ──
    'LLY': ['NVO', 'ABBV', 'MRK', 'AMGN', 'PFE'],
    'NVO': ['LLY', 'ABBV', 'MRK', 'AMGN', 'PFE'],
    'MRVL': ['NVDA', 'AMD', 'AVGO', 'QCOM', 'ON'],
    'MU': ['NVDA', 'AMD', 'INTC', 'MRVL', 'LRCX'],
    'DASH': ['UBER', 'LYFT', 'GRAB', 'SE', 'ABNB'],
    'SQ': ['PYPL', 'COIN', 'SOFI', 'HOOD', 'V'],
    'SOFI': ['SQ', 'HOOD', 'PYPL', 'COIN', 'SCHW'],
    'SHOP': ['MELI', 'SE', 'AMZN', 'WMT', 'BABA'],
    'SMCI': ['NVDA', 'AMD', 'AVGO', 'DELL', 'HPE'],
    'CRWD': ['PANW', 'FTNT', 'ZS', 'NET', 'S'],
    'PANW': ['CRWD', 'FTNT', 'ZS', 'NET', 'S'],
    'SOUN': ['AI', 'PATH', 'BBAI', 'PLTR', 'SYM'],
    'DELL': ['HPE', 'SMCI', 'LNVGY', 'NTAP', 'IBM'],
    'INTC': ['AMD', 'NVDA', 'TSM', 'QCOM', 'TXN'],
    'TSM': ['NVDA', 'AMD', 'AVGO', 'ASML', 'INTC'],
    'ARM': ['NVDA', 'QCOM', 'AMD', 'AVGO', 'INTC'],
    'HOOD': ['SOFI', 'SQ', 'COIN', 'PYPL', 'SCHW'],
};

// ──────────────────────────────────────────────────────────
// EARNINGS KEYWORDS — 실적 관련 키워드
// ──────────────────────────────────────────────────────────
const EARNINGS_KEYWORDS = [
    '실적', '어닝', 'earnings', '분기', '실적발표', '실적전', '실적후',
    '실적시즌', '어닝시즌', '컨센서스', '가이던스', '실적발표일',
    '실적언제', '실적일정', '어닝콜', '실적전략', '실적대응',
    '어닝서프라이즈', '어닝미스', '분기실적', '연간실적',
];

function hasEarningsKeyword(text) {
    const lower = text.replace(/\s/g, '').toLowerCase();
    return EARNINGS_KEYWORDS.some(k => lower.includes(k));
}

function getPeers(ticker) {
    return PEER_MAP[ticker?.toUpperCase()] || null;
}

function resolveKoreanTicker(input) {
    const lower = (input || '').toLowerCase().replace(/\s/g, '');
    if (KR_COMPANY_MAP[lower]) return KR_COMPANY_MAP[lower];
    if (/^\d{6}$/.test(input)) {
        for (const info of Object.values(KR_COMPANY_MAP)) {
            if (info.ticker === input) return info;
        }
        return { ticker: input, corpCode: null, name: input, market: 'KR' };
    }
    return null;
}

function resolveSector(input) {
    const lower = (input || '').toLowerCase();
    for (const [keyword, info] of Object.entries(SECTOR_MAP)) {
        if (lower.includes(keyword)) return info;
    }
    return null;
}

function toFinnhubKRFormat(ticker) {
    return `${ticker}.KS`;
}

function isDeepAnalysisRequest(text) {
    const deepKeywords = ['풀분석', '자세히', '깊게', '장문', '상세', '심층', '전체', '완전히', '디테일', 'deep', 'full', 'detailed'];
    const lower = text.toLowerCase();
    return deepKeywords.some(k => lower.includes(k));
}

// ──────────────────────────────────────────────────────────
// COMPANY DESC — 후보 UI에 표시할 간단 설명
// ──────────────────────────────────────────────────────────
const COMPANY_DESC = {
    'AAPL': '아이폰, 맥, 에어팟 제조',
    'MSFT': 'Windows, Azure 클라우드, Office',
    'GOOGL': '구글 검색, 유튜브, 안드로이드',
    'AMZN': '이커머스, AWS 클라우드',
    'META': '페이스북, 인스타그램, 메타버스',
    'TSLA': '전기차, 에너지, 자율주행',
    'NVDA': 'GPU, AI 반도체, 데이터센터',
    'AMD': 'CPU, GPU 반도체',
    'AVGO': '반도체, 네트워킹 칩',
    'TSM': '세계 최대 반도체 파운드리',
    'INTC': 'CPU 반도체, 파운드리',
    'NFLX': '글로벌 스트리밍 서비스',
    'DIS': '디즈니+, 테마파크, 엔터',
    'PLTR': 'AI 데이터 분석 플랫폼',
    'SNOW': '클라우드 데이터 웨어하우스',
    'CRM': 'Salesforce CRM 클라우드',
    'COIN': '암호화폐 거래소',
    'SQ': 'Block(Square) 핀테크 결제',
    'PYPL': '온라인 결제 서비스',
    'SOFI': '디지털 금융 서비스',
    'HOOD': '무수수료 주식거래 앱',
    'UBER': '라이드셰어, 배달 플랫폼',
    'BABA': '알리바바 이커머스',
    'NIO': '중국 전기차 스타트업',
    'RIVN': '전기 픽업트럭, SUV',
    'LCID': '럭셔리 전기차',
    'SOUN': 'AI 음성인식 플랫폼',
    'IONQ': '양자 컴퓨팅',
    'BBAI': 'AI/빅데이터 분석 (국방)',
    'ARM': 'ARM 칩 설계 아키텍처',
    'SMCI': 'AI 서버, 데이터센터 인프라',
    'CRWD': '사이버보안 클라우드',
    'PANW': '차세대 사이버보안',
    'DELL': 'PC, 서버, 스토리지',
    'SHOP': '이커머스 플랫폼',
    'V': '글로벌 결제 네트워크',
    'MA': '글로벌 결제 네트워크',
    'JPM': '미국 최대 은행',
    'LLY': '비만치료제(GLP-1), 바이오',
    'NVO': '노보노디스크 비만/당뇨 치료',
    'DUOL': '듀오링고 AI 어학 학습',
    'MRVL': 'AI 네트워크 반도체',
    'MU': 'DRAM/NAND 메모리 반도체',
    'DASH': 'DoorDash 음식 배달',
    'QQQ': 'NASDAQ 100 추종 ETF',
    'SPY': 'S&P 500 추종 ETF',
    'VOO': 'Vanguard S&P 500 ETF',
    'TQQQ': 'NASDAQ 100 3배 레버리지',
    'SOXL': '반도체 3배 레버리지',
    '005930': '삼성전자 (반도체, 스마트폰)',
    '000660': 'SK하이닉스 (메모리 반도체)',
    '373220': 'LG에너지솔루션 (배터리)',
    '035420': 'NAVER (검색, 커머스)',
    '035720': '카카오 (메신저, 핀테크)',
};

function getCompanyDesc(ticker) {
    return COMPANY_DESC[ticker?.toUpperCase()] || null;
}

// ──────────────────────────────────────────────────────────
// RESOLVE CACHE — 동일 입력 반복 시 캐싱 (5분 TTL, 200개 제한)
// ──────────────────────────────────────────────────────────
const RESOLVE_CACHE = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5분
const CACHE_MAX = 200;

function getCached(key) {
    const entry = RESOLVE_CACHE.get(key);
    if (!entry) return null;
    if (Date.now() - entry.ts > CACHE_TTL) { RESOLVE_CACHE.delete(key); return null; }
    return entry.val;
}

function setCache(key, val) {
    if (RESOLVE_CACHE.size >= CACHE_MAX) {
        const oldest = RESOLVE_CACHE.keys().next().value;
        RESOLVE_CACHE.delete(oldest);
    }
    RESOLVE_CACHE.set(key, { val, ts: Date.now() });
}

// ──────────────────────────────────────────────────────────
// STOCK KEYWORDS — 종목 질문 감지
// ──────────────────────────────────────────────────────────
const STOCK_KEYWORDS = [
    '어때', '전망', '분석', '언제사', '지금사', '사도돼', '사도될까',
    '매수', '매도', '목표가', '위험', '괜찮아', '팔아', '사야',
    '들어가도', '살까', '타이밍', '익절', '손절', '리스크', '위험해',
    '지금사도', '지금사도돼', '언제팔', '어디서팔', '풀분석', '해줘', '알려줘',
    '사도될까', '들어가도돼', '올라갈까', '떨어질까', '추매', '물타기',
    '전후', '전략', '대응', '비교', '뭐가나아', '뭐가좋아',
    '얼마까지', '바닥', '천장', '고점', '저점', '지지', '저항',
    '과열', '과매수', '너무올랐', '너무올라', '고점이야', '과열구간', '추격매수',
    '비싸', '고평가', '밸류', '밸류부담', '비교', 'vs',
    '어느게나아', '둘중어느', '얼마나올랐', '올란거아니야',
];

const NOISE_WORDS = [
    '분석', '어때', '추천', '주가', '전망', '해줘', '알려줘', '해봐',
    '풀분석', '좀', '요', '해', '줘', '사도돼', '사도될까', '살까',
    '들어가도', '들어가도돼', '올라갈까', '떨어질까', '지금', '현재',
    '리스크', '위험', '매수', '매도', '언제사', '언제팔', '목표가',
    '익절', '손절', '타이밍', '괜찮아', '위험해', '팔아', '사야',
    '과열', '고평가', '비싸', '밸류', '실적', '어닝', '비교',
];

function hasStockKeyword(text) {
    const lower = text.replace(/\s/g, '').toLowerCase();
    return STOCK_KEYWORDS.some(k => lower.includes(k));
}

// Strip stock keywords from text to extract company name
function extractCompanyName(text) {
    return text
        .replace(/\s*(어때|전망|분석|언제\s*사|지금\s*사도|지금\s*사도\s*돼|사도\s*돼|사도\s*될까|매수|매도|목표가|위험|괜찮아|팔아|사야|들어가도|들어가도\s*돼|살까|타이밍|익절|손절|리스크|위험해|지금|해줘|알려줘|풀분석|올라갈까|떨어질까|추매|물타기|실적|어닝|분기|컨센서스|가이던스|실적전|실적후|해\s*줘|\?|!|요|좀).*/gi, '')
        .trim();
}

// ──────────────────────────────────────────────────────────
// NORMALIZE — 공통 입력 정규화 (소문자화 + 노이즈 제거 + 특수문자 제거)
// ──────────────────────────────────────────────────────────
function normalize(raw) {
    let s = (raw || '').trim();
    // 소문자화
    s = s.toLowerCase();
    // 특수문자 제거 (한글/영문/숫자만 유지)
    s = s.replace(/[^a-z0-9가-힣\s]/g, '');
    // 노이즈 단어 제거
    for (const w of NOISE_WORDS) {
        s = s.replace(new RegExp(w, 'g'), '');
    }
    // 공백 제거
    s = s.replace(/\s+/g, '').trim();
    return s;
}

// ──────────────────────────────────────────────────────────
// LEVENSHTEIN DISTANCE — 편집 거리 기반 fuzzy matching
// ──────────────────────────────────────────────────────────
function levenshteinDistance(a, b) {
    const m = a.length, n = b.length;
    if (m === 0) return n;
    if (n === 0) return m;
    const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
    for (let i = 0; i <= m; i++) dp[i][0] = i;
    for (let j = 0; j <= n; j++) dp[0][j] = j;
    for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
            dp[i][j] = a[i - 1] === b[j - 1]
                ? dp[i - 1][j - 1]
                : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
        }
    }
    return dp[m][n];
}

// 유사도 점수 (0~1, 높을수록 유사)
function similarityScore(input, target) {
    const maxLen = Math.max(input.length, target.length);
    if (maxLen === 0) return 1;
    const dist = levenshteinDistance(input, target);
    return 1 - dist / maxLen;
}

// ──────────────────────────────────────────────────────────
// UNIFIED STOCK RESOLVER — 3단계 엔진 (exact → alias → fuzzy)
// ──────────────────────────────────────────────────────────
function resolveStock(text) {
    const cleaned = extractCompanyName(text);
    const lower = cleaned.toLowerCase().replace(/\s/g, '');
    const normalized = normalize(text);

    // 캐시 확인
    const cacheKey = `resolve:${normalized}`;
    const cached = getCached(cacheKey);
    if (cached !== null) {
        console.log(`[resolveStock] CACHE HIT: "${text}" → ${cached?.ticker}`);
        return cached;
    }

    const _log = (stage, result) => {
        console.log(`[resolveStock] input="${text}" → normalized="${normalized}" | stage=${stage} → ticker=${result?.ticker}, name=${result?.name}`);
        setCache(cacheKey, result);
        return result;
    };

    // ════════ 1단계: 정확 일치 (exact match) ════════

    // 1a) Ticker exact match (대문자)
    const upper = cleaned.toUpperCase();
    if (/^[A-Z]{1,5}(\.[A-Z])?$/.test(upper)) {
        for (const info of Object.values(US_COMPANY_MAP)) {
            if (info.ticker === upper) return _log('EXACT_TICKER_US', { ticker: info.ticker, name: info.name, market: 'US', corpCode: null });
        }
        for (const info of Object.values(ETF_MAP)) {
            if (info.ticker === upper) return _log('EXACT_TICKER_ETF', { ticker: info.ticker, name: info.name, market: 'US', corpCode: null, isETFResult: true });
        }
    }

    // 1b) KR map exact
    if (KR_COMPANY_MAP[lower]) {
        const info = KR_COMPANY_MAP[lower];
        return _log('EXACT_KR', { ticker: info.ticker, name: info.name, market: 'KR', corpCode: info.corpCode });
    }

    // 1c) US map exact
    if (US_COMPANY_MAP[lower]) {
        const info = US_COMPANY_MAP[lower];
        return _log('EXACT_US', { ticker: info.ticker, name: info.name, market: 'US', corpCode: null });
    }

    // 1d) ETF map exact
    if (ETF_MAP[lower]) {
        const info = ETF_MAP[lower];
        return _log('EXACT_ETF', { ticker: info.ticker, name: info.name, market: 'US', corpCode: null, isETFResult: true });
    }

    // 1e) KR 6-digit code
    if (/^\d{6}$/.test(cleaned)) {
        for (const info of Object.values(KR_COMPANY_MAP)) {
            if (info.ticker === cleaned) return _log('EXACT_KR_CODE', { ticker: info.ticker, name: info.name, market: 'KR', corpCode: info.corpCode });
        }
        return _log('EXACT_KR_CODE_UNKNOWN', { ticker: cleaned, name: cleaned, market: 'KR', corpCode: null });
    }

    // ════════ 2단계: Alias / 별칭 / 부분 매칭 ════════

    // 2a) Abbreviation map (축약어)
    if (ABBREVIATION_MAP[normalized]) {
        const info = ABBREVIATION_MAP[normalized];
        return _log('ALIAS_ABBREV', { ticker: info.ticker, name: info.name, market: 'US', corpCode: null });
    }
    for (const [abbr, info] of Object.entries(ABBREVIATION_MAP)) {
        if (normalized.length >= 2 && (normalized.includes(abbr) || abbr.includes(normalized))) {
            return _log('ALIAS_ABBREV_PARTIAL', { ticker: info.ticker, name: info.name, market: 'US', corpCode: null });
        }
    }

    // 2b) Normalized match against all dictionaries
    if (US_COMPANY_MAP[normalized]) {
        const info = US_COMPANY_MAP[normalized];
        return _log('ALIAS_NORM_US', { ticker: info.ticker, name: info.name, market: 'US', corpCode: null });
    }
    if (KR_COMPANY_MAP[normalized]) {
        const info = KR_COMPANY_MAP[normalized];
        return _log('ALIAS_NORM_KR', { ticker: info.ticker, name: info.name, market: 'KR', corpCode: info.corpCode });
    }
    if (ETF_MAP[normalized]) {
        const info = ETF_MAP[normalized];
        return _log('ALIAS_NORM_ETF', { ticker: info.ticker, name: info.name, market: 'US', corpCode: null, isETFResult: true });
    }

    // 2c) Partial match in all maps (for compound text like "엔비디아칩")
    for (const [key, info] of Object.entries(US_COMPANY_MAP)) {
        if (key.length >= 2 && (lower.includes(key) || normalized.includes(key))) {
            return _log('ALIAS_PARTIAL_US', { ticker: info.ticker, name: info.name, market: 'US', corpCode: null });
        }
    }
    for (const [key, info] of Object.entries(KR_COMPANY_MAP)) {
        if (key.length >= 2 && (lower.includes(key) || normalized.includes(key))) {
            return _log('ALIAS_PARTIAL_KR', { ticker: info.ticker, name: info.name, market: 'KR', corpCode: info.corpCode });
        }
    }

    // ════════ 3단계: Fuzzy match (Levenshtein) ════════
    const fuzzyResult = fuzzyResolve(normalized.length >= 2 ? normalized : lower);
    if (fuzzyResult && fuzzyResult.score >= 0.85) {
        return _log(`FUZZY(${fuzzyResult.score.toFixed(2)})`, fuzzyResult.result);
    }

    console.log(`[resolveStock] ❌ resolve 실패: input="${text}" → normalized="${normalized}"`);
    setCache(cacheKey, null);
    return null;
}

// ──────────────────────────────────────────────────────────
// FUZZY RESOLVE — Levenshtein 기반 최상위 후보 반환
// ──────────────────────────────────────────────────────────
function fuzzyResolve(input) {
    if (!input || input.length < 2) return null;

    const allEntries = [
        ...Object.entries(US_COMPANY_MAP).map(([k, v]) => ({ key: k, info: v, market: 'US' })),
        ...Object.entries(KR_COMPANY_MAP).map(([k, v]) => ({ key: k, info: v, market: 'KR' })),
        ...Object.entries(ETF_MAP).map(([k, v]) => ({ key: k, info: v, market: 'US' })),
        ...Object.entries(ABBREVIATION_MAP).map(([k, v]) => ({ key: k, info: v, market: 'US' })),
    ];

    let bestScore = 0;
    let bestEntry = null;

    for (const entry of allEntries) {
        if (entry.key.length < 2) continue;
        const score = similarityScore(input, entry.key);
        if (score > bestScore) {
            bestScore = score;
            bestEntry = entry;
        }
    }

    if (bestEntry && bestScore >= 0.65) {
        return {
            score: bestScore,
            result: {
                ticker: bestEntry.info.ticker,
                name: bestEntry.info.name,
                market: bestEntry.market,
                corpCode: bestEntry.info.corpCode || null,
                isETFResult: bestEntry.market === 'US' && ETF_MAP[bestEntry.key] ? true : undefined,
            },
        };
    }
    return null;
}

// ──────────────────────────────────────────────────────────
// FUZZY CLOSEST ALIAS — Levenshtein 기반 최근접 후보 반환
// ──────────────────────────────────────────────────────────
function findClosestAlias(input) {
    const normalized = normalize(input);
    if (normalized.length < 2) return null;

    const result = fuzzyResolve(normalized);
    if (result) return { ticker: result.result.ticker, name: result.result.name, market: result.result.market };
    return null;
}

// ──────────────────────────────────────────────────────────
// RECOMMENDATION KEYWORDS — 추천 질문 감지
// ──────────────────────────────────────────────────────────
const RECOMMENDATION_KEYWORDS = [
    '추천', '뭐 사', '뭘 사', '좋은 주식', '뭐가 좋', '좋은 종목', '추천해',
    '요즘 괜찮', '안정적', '모아갈', '장기 투자', '뭐 좋아', '괜찮은 주식',
    '괜찮은 종목', '뭐 살까', '뭘 살까', '살만한', '요즘 뭐', '뭐가 나아',
];

function isRecommendationKeyword(text) {
    const lower = text.toLowerCase();
    return RECOMMENDATION_KEYWORDS.some(k => lower.includes(k));
}

// ──────────────────────────────────────────────────────────
// NUMBERED FOLLOWUP PARSER — "1번 분석해줘", "두번째 리스크" 파싱
// ──────────────────────────────────────────────────────────

const KR_NUMBER_MAP = { '첫': 1, '두': 2, '세': 3, '네': 4, '다섯': 5 };

const INTENT_KEYWORDS_MAP = [
    { keywords: ['언제사', '매수', '들어가', '살까', '사도돼', '지금사', '타이밍', '진입'], intent: 'buy_timing' },
    { keywords: ['목표가', '언제팔', '익절', '매도', '팔아', '어디서팔', '정리'], intent: 'sell_timing' },
    { keywords: ['리스크', '위험', '약점', '괜찮아', '안전', '걱정'], intent: 'risk_check' },
    { keywords: ['과열', '과매수', '너무올랐', '올란거', '고점이야', '추격매수'], intent: 'overheat_check' },
    { keywords: ['비싸', '고평가', '밸류', 'per', 'psr', '밸류부담'], intent: 'valuation_check' },
    { keywords: ['실적', '어닝', '분기', '컨센서스'], intent: 'earnings_check' },
];

/**
 * "1번 분석해줘", "두번째 리스크", "3번 언제 사?" 파싱
 * @returns {{ index: number, intent: string } | null}
 */
function parseNumberedFollowup(text) {
    const raw = text.replace(/\s/g, '').toLowerCase();
    let index = null;
    let rest = raw;

    // 한글 서수
    for (const [kr, num] of Object.entries(KR_NUMBER_MAP)) {
        if (raw.startsWith(kr)) {
            index = num;
            rest = raw.slice(kr.length).replace(/^(?:번(?:째)?(?:종목)?)?/, '');
            break;
        }
    }
    // 아라비아 숫자
    if (index === null) {
        const m = raw.match(/^([1-9])(?:번(?:째)?(?:종목)?)?/);
        // 반드시 "번" 이상 있어야 "1 이름" 같은 오매칭 방지
        if (m && (m[0].length > 1 || raw[1] === '번')) { index = parseInt(m[1], 10); rest = raw.slice(m[0].length); }
    }
    if (index === null) return null;

    // 의도 파악
    let intent = 'full_analysis';
    for (const { keywords, intent: i } of INTENT_KEYWORDS_MAP) {
        if (keywords.some(k => rest.includes(k))) { intent = i; break; }
    }
    return { index, intent };
}

/**
 * suggestCandidates(text) — Levenshtein 기반 유사 종목 후보 TOP 5
 * tier: HIGH(>=0.75 자동선택) | MED(0.5~0.75 확인질문) | LOW(<0.5 리스트)
 */
function suggestCandidates(text) {
    const cleaned = (text || '').trim();

    // 캐시 확인
    const cacheKey = `suggest:${normalize(text)}`;
    const cached = getCached(cacheKey);
    if (cached !== null) {
        console.log(`[suggestCandidates] CACHE HIT: "${text}"`);
        return cached;
    }

    // 1) 정확 매칭 (resolveStock이 3단계 엔진 통과)
    const exact = resolveStock(cleaned);
    if (exact) {
        const result = {
            input: text, resolved: exact, confidence: 1.0, tier: 'HIGH',
            candidates: [{ ticker: exact.ticker, name: exact.name, market: exact.market, confidence: 1.0, tier: 'HIGH' }],
        };
        setCache(cacheKey, result);
        return result;
    }

    // 2) Levenshtein fuzzy 스코어링
    const normalized = normalize(text);
    if (normalized.length < 2) return { input: text, resolved: null, confidence: 0, tier: 'LOW', candidates: [] };

    const allEntries = [
        ...Object.entries(US_COMPANY_MAP).map(([k, v]) => ({ key: k, info: v, market: 'US' })),
        ...Object.entries(ETF_MAP).map(([k, v]) => ({ key: k, info: v, market: 'US' })),
        ...Object.entries(KR_COMPANY_MAP).map(([k, v]) => ({ key: k, info: v, market: 'KR' })),
        ...Object.entries(ABBREVIATION_MAP).map(([k, v]) => ({ key: k, info: v, market: 'US' })),
    ];

    const scored = allEntries
        .filter(e => e.key.length >= 2)
        .map(e => ({ ...e, score: similarityScore(normalized, e.key) }))
        .filter(e => e.score >= 0.3)
        .sort((a, b) => b.score - a.score);

    // 중복 ticker 제거
    const seen = new Set();
    const unique = scored.filter(e => {
        if (seen.has(e.info.ticker)) return false;
        seen.add(e.info.ticker);
        return true;
    }).slice(0, 5);

    if (!unique.length) {
        const empty = { input: text, resolved: null, confidence: 0, tier: 'LOW', candidates: [] };
        setCache(cacheKey, empty);
        return empty;
    }

    const best = unique[0];
    const confidence = best.score;
    const tier = confidence >= 0.85 ? 'HIGH' : confidence >= 0.5 ? 'MED' : 'LOW';

    function candidateTier(score) {
        if (score >= 0.85) return 'HIGH';
        if (score >= 0.5) return 'MED';
        return 'LOW';
    }

    const result = {
        input: text,
        resolved: tier === 'HIGH'
            ? { ticker: best.info.ticker, name: best.info.name, market: best.market, corpCode: best.info.corpCode || null }
            : null,
        confidence, tier,
        candidates: unique.map(c => ({
            ticker: c.info.ticker, name: c.info.name, market: c.market,
            confidence: parseFloat(c.score.toFixed(2)),
            tier: candidateTier(c.score),
        })),
    };
    setCache(cacheKey, result);
    return result;
}

// ──────────────────────────────────────────────────────────
// COMPARISON RESOLVER — 비교 질문에서 두 종목 동시 추출
// ──────────────────────────────────────────────────────────
/**
 * "NVDA vs TSLA", "삼성전자랑 엔비디아 비교", "애플 대비 구글" 등에서 두 종목 추출
 * @returns {{ stockA: object, stockB: object } | null}
 */
function resolveComparisonStocks(text) {
    // 비교 키워드/분리자를 기준으로 텍스트를 둘로 분리
    // 순서 중요: 긴 패턴 먼저 매칭 ("이랑" before "랑")
    const separators = /\s+(?:vs\.?|VS\.?|versus)\s+|(?:이랑|랑|하고|과\s|와\s|대비|비교(?:해|해줘|해봐)?\s*)\s*/;
    
    // 먼저 비교 관련 접미사를 제거
    let cleaned = text
        .replace(/\s*(비교해\s*줘|비교해봐|비교해|비교|어느게\s*나아|뭐가\s*나아|뭐가\s*좋아|둘\s*중\s*어느|어때)\s*[?？]?\s*$/gi, '')
        .trim();
    
    const parts = cleaned.split(separators).map(p => p.trim()).filter(Boolean);
    
    if (parts.length >= 2) {
        const stockA = resolveStock(parts[0]);
        const stockB = resolveStock(parts[1]);
        if (stockA && stockB && stockA.ticker !== stockB.ticker) {
            return { stockA, stockB };
        }
    }
    
    // fallback: 텍스트에서 공백으로 분리 후 각각 resolveStock 시도
    // "NVDA TSLA 비교" 같은 경우
    const tokens = cleaned.replace(/\s*(비교|vs\.?|VS\.?)\s*/g, ' ').trim().split(/\s+/);
    if (tokens.length >= 2) {
        for (let i = 0; i < tokens.length - 1; i++) {
            const a = resolveStock(tokens[i]);
            if (!a) continue;
            for (let j = i + 1; j < tokens.length; j++) {
                const b = resolveStock(tokens[j]);
                if (b && a.ticker !== b.ticker) {
                    return { stockA: a, stockB: b };
                }
            }
        }
    }
    
    return null;
}

module.exports = {
    resolveKoreanTicker, resolveUSCompany, resolveStock, resolveComparisonStocks, suggestCandidates,
    resolveSector, toFinnhubKRFormat, isDeepAnalysisRequest,
    hasStockKeyword, hasEarningsKeyword, extractCompanyName,
    getPeers, getETFPeers, findClosestAlias, getCompanyDesc,
    isETF, isLeveragedETF, parsePortfolio, isPortfolioInput,
    isRecommendationKeyword, parseNumberedFollowup,
    KR_COMPANY_MAP, US_COMPANY_MAP, ETF_MAP, SECTOR_MAP, PEER_MAP, ETF_PEER_MAP,
    STOCK_KEYWORDS, EARNINGS_KEYWORDS, LEVERAGED_ETFS, ABBREVIATION_MAP, COMPANY_DESC,
};
