# 📈 AI 주식 분석 비서 (yeri-project)

웹앱(React) 기반 GPT-4.1/o3 구동 주식 분석 봇입니다.

## 프로젝트 구조

```
yeri-project/
├── index.js                   # 서버 진입점
├── .env                       # API 키 설정
├── .env.example               # 키 템플릿
├── services/
│   ├── data-fetcher.js        # 7개 API 데이터 수집 (캐시/폴백)
│   └── analyzer.js            # GPT 분석 엔진
└── utils/
    └── ticker-util.js         # 한국 종목 + 섹터 매핑
```

## 설치 및 실행

```bash
# 1. 의존성 설치
npm install

# 2. 환경 변수 설정
cp .env.example .env
# .env 파일에 API 키 입력

# 3. 실행
node index.js
```

## 환경 변수

| 변수 | 필수 | 설명 |
|------|------|------|
| `OPENAI_API_KEY` | ✅ | OpenAI API 키 |
| `OPENAI_MODEL_DEFAULT` | - | 기본 모델 (기본값: gpt-4.1) |
| `OPENAI_MODEL_DEEP` | - | 심층 분석 모델 (기본값: o3) |
| `FINNHUB_API_KEY` | - | 주가/지수 데이터 |
| `TWELVEDATA_API_KEY` | - | RSI/MACD/EMA |
| `ALPHAVANTAGE_API_KEY` | - | 볼린저밴드 |
| `FMP_API_KEY` | - | 기업 재무 |
| `NEWS_API_KEY` | - | 뉴스 분석 |
| `DART_API_KEY` | - | 한국 공시 |
| `FRED_API_KEY` | - | 거시경제 |

## 사용법

### 웹 앱 주요 기능
- 관심종목 알림: 목표가, 이상 급등락 알림
- 포트폴리오 관리: 수익률 분석, 리스크 관리
- 채팅형 스크리닝: 종목, 섹터, 시장 현황 질의응답

### 자연어 질문 예시

```
"삼성전자 어때?"
"AAPL 지금 사도 돼?"
"TSLA 목표가 알려줘"
"반도체 섹터 전망 어때?"
"지금 미국장 위험해?"
"NVDA 풀분석 해줘"    ← 심층 분석 (o3) 모드
"AAPL 자세히 분석해줘" ← 심층 분석 (o3) 모드
```

### 심층 분석 키워드
`풀분석`, `자세히`, `깊게`, `장문`, `상세`, `심층`, `전체`, `디테일`, `deep`, `full`

## 지원 기능

- 🌐 **종목 분석**: 10개 섹션 애널리스트급 리포트
- 📊 **시장 분석**: S&P500/NASDAQ/VIX/금리/CPI 종합
- 📡 **섹터 분석**: 반도체/AI/전기차/바이오/금융/에너지 등
- 🇰🇷 **한국 종목**: 한국어 이름/코드 자동 인식 + DART 공시
- ⚡ **심층 분석**: o3 모델로 전환 지원
- 💾 **캐시**: 5분 TTL로 동일 종목 반복 조회 최적화
- 🔄 **폴백**: API 실패 시 다른 소스로 자동 대체
