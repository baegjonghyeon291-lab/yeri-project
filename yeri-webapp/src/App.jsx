import { useState, useEffect, useCallback, useRef } from 'react'

const API_BASE = '/api'

// ── 유틸 ──────────────────────────────────────────────────────
function fmtChange(v) {
  if (v == null) return null
  return v > 0 ? `+${v.toFixed(2)}%` : `${v.toFixed(2)}%`
}
function rsiClass(rsi) {
  if (!rsi) return 'rsi-normal'
  if (rsi < 30) return 'rsi-oversold'
  if (rsi > 70) return 'rsi-overbought'
  return 'rsi-normal'
}
function verdictClass(verdict = '') {
  if (verdict.includes('긍정')) return 'positive'
  if (verdict.includes('위험') || verdict.includes('주의')) return 'negative'
  return 'neutral'
}
function timeAgo(ts) {
  if (!ts) return '-'
  const sec = Math.floor((Date.now() - ts) / 1000)
  if (sec < 60) return '방금'
  if (sec < 3600) return `${Math.floor(sec / 60)}분 전`
  return `${Math.floor(sec / 3600)}시간 전`
}

// ── 상단 알림 배지 ─────────────────────────────────────────────
function AlertBadge({ count, onClick }) {
  return (
    <button className="alert-badge-btn" onClick={onClick}>
      🔔 알림
      {count > 0 && <span className="badge">{count}</span>}
    </button>
  )
}

// ── 알림 카드 ─────────────────────────────────────────────────
function AlertCard({ alert }) {
  return (
    <div className={`alert-card ${alert.level}`}>
      <div className="alert-emoji">{alert.emoji}</div>
      <div className="alert-body">
        <div className="alert-title">
          <span className="alert-ticker-tag">{alert.ticker}</span>
          {alert.title.replace(alert.ticker, '').trim()}
        </div>
        <div className="alert-desc">{alert.desc}</div>
      </div>
    </div>
  )
}

// ── 종목 카드 ─────────────────────────────────────────────────
function StockCard({ stock, hasAlert }) {
  const changePct = stock.changePct
  const changeStr = fmtChange(changePct)
  const changeClass = changePct > 0 ? 'up' : changePct < 0 ? 'down' : 'flat'

  return (
    <div className="stock-card">
      <div className="stock-card-header">
        <div>
          <div className="stock-ticker">{stock.ticker}</div>
          <div className="stock-name">{stock.name !== stock.ticker ? stock.name : ''}</div>
        </div>
        {hasAlert && <div className="new-alert-dot" title="새 알림 있음" />}
      </div>

      <div className="stock-price-row">
        <span className="stock-price">
          {stock.priceStr || (stock.price ? `$${stock.price.toLocaleString()}` : 'N/A')}
        </span>
        {changeStr && (
          <span className={`stock-change ${changeClass}`}>{changeStr}</span>
        )}
      </div>

      <div className="stock-metrics">
        <span className={`metric-pill ${rsiClass(stock.rsi)}`}>
          RSI {stock.rsi?.toFixed(1) || 'N/A'}
          {stock.rsi < 30 ? ' 과매도' : stock.rsi > 70 ? ' 과매수' : ''}
        </span>
        <span className="metric-pill">AI {stock.score}/40</span>
      </div>

      <div className={`verdict-badge ${verdictClass(stock.verdict)}`}>
        {stock.verdict} &nbsp;·&nbsp; {stock.suggestedAction}
      </div>

      <div className="stock-source">출처: {stock.priceSource || '-'}</div>
    </div>
  )
}

// ── 빠른 질문 버튼 ─────────────────────────────────────────────
const QUICK_ACTIONS = [
  { label: '📈 오늘 추천 종목', text: '오늘 추천 종목', cat: 'rec' },
  { label: '🌍 시장 브리핑', text: '오늘 시장 브리핑', cat: 'rec' },
  { label: '📊 지금 살만한 종목', text: '지금 사도 되는 종목 추천', cat: 'rec' },
  { label: 'NVDA 분석', text: 'NVDA 분석해줘', cat: 'stock' },
  { label: 'TSLA 분석', text: 'TSLA 분석해줘', cat: 'stock' },
  { label: '삼성전자', text: '삼성전자 분석해줘', cat: 'stock' },
  { label: '애플 분석', text: '애플 분석해줘', cat: 'stock' },
  { label: '⚔️ 엔비디아 vs 테슬라', text: '엔비디아 vs 테슬라 비교', cat: 'compare' },
  { label: '⚔️ 애플 vs 마소', text: '애플 vs 마이크로소프트 비교', cat: 'compare' },
]

// ── 추천 카드 컴포넌트 ───────────────────────────────────────
function RecCard({ item, grade, onAnalyze }) {
  const gradeClass = grade === 'STRONG_PICK' ? 'grade-strong' : 'grade-watch'
  const gradeLabel = grade === 'STRONG_PICK' ? '🟢 STRONG PICK' : '🟡 WATCHLIST'
  return (
    <div className={`rec-card ${gradeClass}`}>
      <div className="rec-card-header">
        <span className="rec-grade-badge">{gradeLabel}</span>
        <span className="rec-score">{item.totalScore}/20</span>
      </div>
      <div className="rec-card-ticker">{item.ticker}</div>
      <div className="rec-card-name">{item.name}{item.desc ? ` — ${item.desc}` : ''}</div>
      {item.price && (
        <div className="rec-card-price">
          ${item.price.toLocaleString()}
          {item.changePct != null && (
            <span className={item.changePct >= 0 ? 'up' : 'down'}>
              {item.changePct >= 0 ? '+' : ''}{item.changePct.toFixed(2)}%
            </span>
          )}
        </div>
      )}
      <div className="rec-card-reason">{item.reason}</div>
      <button className="rec-analyze-btn" onClick={() => onAnalyze(item.ticker)}>분석하기</button>
    </div>
  )
}

// ── 채팅 페이지 ───────────────────────────────────────────────
function ChatPage({ chatId }) {
  const [messages, setMessages] = useState([
    { role: 'bot', type: 'text', text: '안녕하세요 🙂\n예리입니다! 어떤 종목이 궁금하세요?\n\n아래 버튼을 눌러보세요 👇' }
  ])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [selectedCandidate, setSelectedCandidate] = useState(null)
  const bottomRef = useRef(null)

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

  const sendMessage = useCallback(async (text) => {
    if (!text || loading) return
    setInput('')
    setMessages(prev => [...prev, { role: 'user', type: 'text', text }])
    setLoading(true)
    try {
      const res = await fetch(`${API_BASE}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, chatId: chatId || 'webapp', tone: 'normal' })
      })
      const data = await res.json()

      // API returns { messages: [{type, content, candidates?, data?, ...}] }
      if (data.messages && data.messages.length > 0) {
        const newMsgs = data.messages.map(m => {
          if (m.type === 'candidates') {
            return { role: 'bot', type: 'candidates', text: m.content, candidates: m.candidates }
          }
          if (m.type === 'recommendation') {
            return { role: 'bot', type: 'recommendation', text: m.content, recData: m.data }
          }
          return { role: 'bot', type: 'text', text: m.content || '' }
        })
        setMessages(prev => [...prev, ...newMsgs])
      } else if (data.reply) {
        setMessages(prev => [...prev, { role: 'bot', type: 'text', text: data.reply }])
      } else if (data.error) {
        setMessages(prev => [...prev, { role: 'bot', type: 'text', text: `❌ ${data.error}` }])
      } else {
        setMessages(prev => [...prev, { role: 'bot', type: 'text', text: '응답 없음' }])
      }
    } catch (e) {
      setMessages(prev => [...prev, { role: 'bot', type: 'text', text: `❌ 오류: ${e.message}` }])
    } finally {
      setLoading(false)
      setSelectedCandidate(null)
    }
  }, [chatId, loading])

  function handleCandidateClick(ticker) {
    setSelectedCandidate(ticker)
    setTimeout(() => sendMessage(`${ticker} 분석해줘`), 200)
  }

  function truncDesc(desc, max = 30) {
    if (!desc) return ''
    return desc.length > max ? desc.slice(0, max) + '…' : desc
  }

  return (
    <div className="chat-page">
      <div className="chat-messages">
        {messages.map((m, i) => (
          <div key={i} className={`chat-bubble-row ${m.role === 'user' ? 'user' : 'bot'}`}>
            <div className={`chat-bubble ${m.role === 'user' ? 'user' : 'bot'}`}>
              {m.text}
              {m.type === 'candidates' && m.candidates && (() => {
                const cands = m.candidates.slice(0, 3)
                const bestConf = Math.max(...cands.map(c => c.confidence))
                const bestIdx = cands.findIndex(c => c.confidence === bestConf)
                return (
                  <div className="candidate-buttons">
                    {cands.map((c, j) => (
                      <button
                        key={j}
                        className={`candidate-btn${j === bestIdx ? ' top-pick' : ''}${selectedCandidate === c.ticker ? ' selected' : ''}`}
                        onClick={() => handleCandidateClick(c.ticker)}
                        disabled={loading || selectedCandidate != null}
                      >
                        {j === bestIdx && <span className="candidate-badge">👉 가장 유력</span>}
                        <div className="candidate-main">
                          <span className="candidate-ticker">{c.ticker}</span>
                          <span className="candidate-name">
                            {c.name}{c.desc ? ` — ${truncDesc(c.desc)}` : ''}
                          </span>
                        </div>
                        <span className="candidate-conf">{Math.round(c.confidence * 100)}% 유사</span>
                      </button>
                    ))}
                  </div>
                )
              })()}
              {m.type === 'recommendation' && m.recData && (
                <div className="rec-cards-wrap">
                  {m.recData.strongPicks?.length > 0 && (
                    <>
                      <div className="rec-section-label">🟢 STRONG PICK</div>
                      {m.recData.strongPicks.map((item, j) => (
                        <RecCard key={`sp-${j}`} item={item} grade="STRONG_PICK" onAnalyze={(t) => sendMessage(`${t} 분석해줘`)} />
                      ))}
                    </>
                  )}
                  {m.recData.watchlist?.length > 0 && (
                    <>
                      <div className="rec-section-label">🟡 WATCHLIST</div>
                      {m.recData.watchlist.map((item, j) => (
                        <RecCard key={`wl-${j}`} item={item} grade="WATCHLIST" onAnalyze={(t) => sendMessage(`${t} 분석해줘`)} />
                      ))}
                    </>
                  )}
                  {m.recData.strongPicks?.length === 0 && m.recData.watchlist?.length === 0 && (
                    <div className="rec-empty">엄격한 필터 기준을 통과한 추천 종목이 없습니다.</div>
                  )}
                  {m.recData.excluded?.length > 0 && (
                    <details className="rec-excluded">
                      <summary>추천 제외 종목 ({m.recData.excluded.length}개)</summary>
                      <ul>
                        {m.recData.excluded.map((ex, j) => (
                          <li key={j}><strong>{ex.ticker}</strong> — {ex.reason}</li>
                        ))}
                      </ul>
                    </details>
                  )}
                  {m.recData.meta && (
                    <div className="rec-meta">스캔: {m.recData.meta.scannedCount}종목 | {(m.recData.meta.elapsedMs / 1000).toFixed(1)}초</div>
                  )}
                </div>
              )}
            </div>
          </div>
        ))}
        {loading && (
          <div className="chat-bubble-row bot">
            <div className="chat-bubble bot">⏳ 분석 중...</div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* 빠른 질문 버튼 */}
      <div className="quick-actions">
        {QUICK_ACTIONS.map((qa, i) => (
          <button
            key={i}
            className={`quick-chip chip-${qa.cat}`}
            onClick={() => sendMessage(qa.text)}
            disabled={loading}
          >{qa.label}</button>
        ))}
      </div>

      <div className="chat-input-bar">
        <textarea
          className="chat-input"
          rows={2}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(input.trim()) } }}
          placeholder="종목명, 티커, 또는 질문을 입력하세요..."
        />
        <button className="chat-send-btn" onClick={() => sendMessage(input.trim())} disabled={loading || !input.trim()}>전송</button>
      </div>
    </div>
  )
}

// ── 관심종목/알림 페이지 ──────────────────────────────────────
function WatchlistPage({ chatId, onBadgeCountChange }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [lastUpdated, setLastUpdated] = useState(null)

  const fetchAlerts = useCallback(async (refresh = false) => {
    if (!chatId) return
    setLoading(true)
    setError(null)
    try {
      const url = `${API_BASE}/alerts/${chatId}${refresh ? '?refresh=true' : ''}`
      const res = await fetch(url)
      const json = await res.json()
      if (!json.ok) throw new Error(json.error)
      setData(json)
      setLastUpdated(Date.now())
      onBadgeCountChange?.(json.alertCount || 0)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [chatId, onBadgeCountChange])

  // 첫 로드 + chatId 변경 시
  useEffect(() => { fetchAlerts() }, [fetchAlerts])

  // 5분마다 자동 갱신
  useEffect(() => {
    const timer = setInterval(() => fetchAlerts(), 5 * 60 * 1000)
    return () => clearInterval(timer)
  }, [fetchAlerts])

  const alertTickerSet = new Set((data?.alerts || []).map(a => a.ticker))

  return (
    <div className="main">
      {/* 섹션: 알림 */}
      <div className="section-header">
        <span className="section-title">🔔 알림</span>
        <span className="section-sub">
          {lastUpdated ? `마지막 업데이트: ${timeAgo(lastUpdated)}` : ''}
        </span>
        <button className="refresh-btn" onClick={() => fetchAlerts(true)} disabled={loading}>
          {loading ? '스캔 중...' : '새로고침'}
        </button>
      </div>

      {error && <div className="error-bar">⚠️ {error}</div>}

      {loading && !data && (
        <div className="loading-wrap">
          <div className="spinner" />
          <span>관심종목 스캔 중...</span>
        </div>
      )}

      {data && (
        <>
          {data.alerts.length === 0 ? (
            <div className="empty-state" style={{ padding: '30px', marginBottom: '24px' }}>
              <span className="big-emoji" style={{ fontSize: '2rem' }}>✅</span>
              <p style={{ fontSize: '.85rem', color: 'var(--text-sub)' }}>
                현재 특별한 알림이 없습니다.<br />관심종목이 정상 범위 내에 있습니다.
              </p>
            </div>
          ) : (
            <div className="alerts-grid">
              {data.alerts.map((a, i) => <AlertCard key={i} alert={a} />)}
            </div>
          )}

          {/* 섹션: 관심종목 상태 */}
          <div className="section-header">
            <span className="section-title">📊 관심종목 현황</span>
            <span className="section-sub">{data.stocks.length}종목</span>
          </div>
          {data.stocks.length === 0 ? (
            <div className="empty-state">
              <span className="big-emoji">📋</span>
              <p>관심종목이 없습니다.<br />텔레그램에서 <b>/add AAPL</b> 로 추가하세요.</p>
            </div>
          ) : (
            <div className="stocks-grid">
              {data.stocks.map(s => (
                <StockCard key={s.ticker} stock={s} hasAlert={alertTickerSet.has(s.ticker)} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ── 루트 App ─────────────────────────────────────────────────
export default function App() {
  const [page, setPage] = useState('watchlist') // 'watchlist' | 'chat'
  const [chatId, setChatId] = useState(() => localStorage.getItem('yeri_chatId') || '')
  const [alertCount, setAlertCount] = useState(0)

  function handleChatIdChange(v) {
    setChatId(v)
    localStorage.setItem('yeri_chatId', v)
  }

  return (
    <div className="app">
      {/* 탑바 */}
      <header className="topbar">
        <span className="topbar-logo">예리 💛</span>
        <nav className="topbar-nav">
          <button className={page === 'watchlist' ? 'active' : ''} onClick={() => setPage('watchlist')}>
            관심종목
          </button>
          <button className={page === 'chat' ? 'active' : ''} onClick={() => setPage('chat')}>
            채팅 분석
          </button>
        </nav>
        <div className="topbar-right">
          <AlertBadge count={alertCount} onClick={() => setPage('watchlist')} />
          <input
            className="chatid-input"
            placeholder="내 Chat ID"
            value={chatId}
            onChange={e => handleChatIdChange(e.target.value)}
            title="텔레그램 chatId를 입력하면 내 관심종목이 표시됩니다"
          />
        </div>
      </header>

      {/* 페이지 */}
      {page === 'watchlist' && (
        <WatchlistPage chatId={chatId} onBadgeCountChange={setAlertCount} />
      )}
      {page === 'chat' && <ChatPage chatId={chatId} />}
    </div>
  )
}
