import { useCallback, useEffect, useRef, useState } from 'react';
import { useMatch, useNavigate } from 'react-router-dom';
import './chatWidget.css';

const CHATBOT_URL = import.meta.env.VITE_CHATBOT_URL || 'http://localhost:4000';

const SUGGESTIONS = [
  '🌟 Best rated campgrounds?',
  '💰 Cheap camping under $25/night',
  '🏕️ Tips for a first camping trip',
  '🐾 Pet-friendly campgrounds?',
];

const GREETING = {
  role: 'assistant',
  content:
    "Hi, I'm **Trailie** 🏕️ — your Campify camping assistant!\n\nAsk me to find campgrounds, summarise reviews, or give you camping tips.",
};

// ── Safe inline Markdown renderer ─────────────────────────────
// Handles: [text](url)  **bold**  — no dangerouslySetInnerHTML
function renderInline(text, navigate) {
  const parts = [];
  // Match [label](url) or **bold**
  const re = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)|\*\*([^*]+)\*\*/g;
  let last = 0;
  let m;
  let key = 0;

  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index));

    if (m[1]) {
      // Link
      const label = m[1];
      const href = m[2];
      const isInternal =
        typeof window !== 'undefined' && href.startsWith(window.location.origin);
      parts.push(
        <a
          key={key++}
          href={href}
          {...(!isInternal ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
          onClick={(e) => {
            if (isInternal) {
              e.preventDefault();
              navigate(href.slice(window.location.origin.length));
            }
          }}
        >
          {label}
        </a>
      );
    } else {
      // Bold
      parts.push(<strong key={key++}>{m[3]}</strong>);
    }
    last = re.lastIndex;
  }

  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

// ── Message component ─────────────────────────────────────────
function Message({ role, content, navigate }) {
  const lines = content.split('\n');
  return (
    <div className={`cw-msg cw-${role}`}>
      {lines.map((line, idx) => {
        if (!line.trim()) return <div key={idx} className="cw-spacer" />;
        if (/^\s*[-*•]\s+/.test(line)) {
          return (
            <div key={idx} className="cw-bullet">
              <span className="cw-bullet-dot">•</span>
              <span>{renderInline(line.replace(/^\s*[-*•]\s+/, ''), navigate)}</span>
            </div>
          );
        }
        return <p key={idx}>{renderInline(line, navigate)}</p>;
      })}
    </div>
  );
}

// ── Typing indicator (3 animated dots) ───────────────────────
function TypingIndicator() {
  return (
    <div className="cw-msg cw-assistant cw-typing-indicator" aria-label="Trailie is thinking">
      <span />
      <span />
      <span />
    </div>
  );
}

// ── Main widget ───────────────────────────────────────────────
export default function ChatWidget() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([GREETING]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const endRef = useRef(null);
  const inputRef = useRef(null);
  const navigate = useNavigate();

  // Detect campground detail page → extract the id for context
  const match = useMatch('/campgrounds/:id');
  const campgroundId =
    /^[a-f0-9]{24}$/i.test(match?.params?.id || '') ? match.params.id : undefined;

  // Scroll to latest message / indicator
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading, open]);

  // Auto-focus the input when the panel opens
  useEffect(() => {
    if (open) {
      // Small delay so the CSS transition doesn't fight the focus
      const t = setTimeout(() => inputRef.current?.focus(), 120);
      return () => clearTimeout(t);
    }
  }, [open]);

  const send = useCallback(
    async (overrideText) => {
      const content = (overrideText ?? input).trim();
      if (!content || loading) return;

      const next = [...messages, { role: 'user', content }];
      setMessages(next);
      setInput('');
      setLoading(true);

      try {
        // The GREETING is UI-only — exclude it from the API payload
        const payload = next.filter((m) => m !== GREETING).slice(-10);
        const res = await fetch(`${CHATBOT_URL}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messages: payload, campgroundId }),
        });

        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `Error ${res.status}`);

        setMessages((prev) => [...prev, { role: 'assistant', content: data.reply }]);
      } catch (e) {
        setMessages((prev) => [
          ...prev,
          {
            role: 'assistant',
            content:
              e.message.length < 200
                ? e.message
                : 'Sorry, something went wrong. Please try again.',
          },
        ]);
      } finally {
        setLoading(false);
      }
    },
    [input, loading, messages, campgroundId]
  );

  const handleKey = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  const showChips = messages.length === 1 && !loading;
  const onDetailPage = Boolean(campgroundId);

  return (
    <>
      {/* ── Chat panel ── */}
      <div
        className={`cw-panel${open ? ' cw-panel--open' : ''}`}
        role="dialog"
        aria-label="Camping assistant – Trailie"
        aria-hidden={!open}
      >
        {/* Header */}
        <div className="cw-header">
          <div className="cw-header-info">
            <span className="cw-avatar">🏕️</span>
            <div>
              <div className="cw-header-name">Trailie</div>
              <div className="cw-header-status">
                {loading ? 'Thinking…' : 'Camp Assistant · Online'}
              </div>
            </div>
          </div>
          <button
            className="cw-close"
            onClick={() => setOpen(false)}
            aria-label="Close chat"
          >
            ×
          </button>
        </div>

        {/* Detail-page context banner */}
        {onDetailPage && (
          <div className="cw-context-banner">
            📍 Viewing this campground — ask me anything about it!
          </div>
        )}

        {/* Message body */}
        <div className="cw-body" role="log" aria-live="polite">
          {messages.map((m, i) => (
            <Message key={i} {...m} navigate={navigate} />
          ))}

          {/* Suggestion chips — only shown on the initial greeting */}
          {showChips && (
            <div className="cw-chips" role="list" aria-label="Suggested questions">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  role="listitem"
                  className="cw-chip"
                  onClick={() => send(s.replace(/^[^\w]+/, '').trim())}
                >
                  {s}
                </button>
              ))}
            </div>
          )}

          {loading && <TypingIndicator />}
          <div ref={endRef} />
        </div>

        {/* Input row */}
        <div className="cw-input">
          <input
            ref={inputRef}
            id="cw-message-input"
            value={input}
            maxLength={1000}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKey}
            placeholder={
              onDetailPage ? 'Ask about this campground…' : 'Ask about campgrounds…'
            }
            aria-label="Your message"
            disabled={loading}
          />
          <button
            id="cw-send-button"
            onClick={() => send()}
            disabled={loading || !input.trim()}
            aria-label="Send message"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <line x1="22" y1="2" x2="11" y2="13" />
              <polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          </button>
        </div>
      </div>

      {/* ── FAB (floating action button) ── */}
      <button
        id="cw-fab"
        className={`cw-fab${open ? ' cw-fab--open' : ''}`}
        onClick={() => setOpen((o) => !o)}
        aria-label={open ? 'Close camping assistant' : 'Open camping assistant'}
        aria-expanded={open}
      >
        <span className="cw-fab-icon cw-fab-icon--chat" aria-hidden="true">🏕️</span>
        <span className="cw-fab-icon cw-fab-icon--close" aria-hidden="true">×</span>
      </button>
    </>
  );
}
