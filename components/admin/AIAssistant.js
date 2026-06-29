import React, { useState, useRef } from 'react';
import { supabase } from '../../lib/supabaseClient';
import styles from '../../styles/admin.module.css';

export default function AIAssistant() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const containerRef = useRef(null);

  const suggested = [
    'Which shops are underperforming?',
    'Top 10 shops this week',
    'Why are sales low in a certain region?',
    'Which reps are performing poorly?',
    'Suggest where to focus next',
  ];

  const scrollToBottom = () => { try { if (containerRef.current) containerRef.current.scrollTop = containerRef.current.scrollHeight; } catch (e) {} };

  const clearChat = () => { setMessages([]); };

  const sendQuestion = async (q) => {
    if (!q) return;
    setMessages(prev => [...prev, { role: 'user', text: q }]);
    setInput('');
    setLoading(true);
    try {
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        setMessages(prev => [...prev, { role: 'assistant', text: 'Offline — AI Assistant requires an internet connection.' }]);
        return;
      }
      const { data: { session } } = await supabase.auth.getSession();
      const tok = session?.access_token;
      const res = await fetch('/api/admin/ai-assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` },
        body: JSON.stringify({ question: q }),
      });
      const data = await res.json();
      if (res.ok && data.answer) {
        setMessages(prev => [...prev, { role: 'assistant', text: data.answer }]);
      } else {
        setMessages(prev => [...prev, { role: 'assistant', text: data.error || 'AI call failed' }]);
      }
    } catch (e) {
      setMessages(prev => [...prev, { role: 'assistant', text: e.message || 'Network error' }]);
    } finally { setLoading(false); scrollToBottom(); }
  };

  const onSubmit = (e) => { e.preventDefault(); sendQuestion(input); };

  return (
    <div className={styles.aiAssistantCard} style={{ maxWidth: 900 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h3 style={{ margin: 0 }}>AI Assistant</h3>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className={styles.btn} onClick={clearChat}>Clear</button>
        </div>
      </div>

      <div ref={containerRef} style={{ maxHeight: 360, overflowY: 'auto', padding: 12, border: '1px solid #e6eef8', borderRadius: 8, background: '#fff' }}>
        {messages.length === 0 && (
          <div style={{ color: '#6b7280' }}>Ask questions about sales. Suggestions below.</div>
        )}
        {messages.map((m, i) => (
          <div key={i} style={{ marginBottom: 10, display: 'flex', justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start' }}>
            <div style={{ maxWidth: '78%', background: m.role === 'user' ? '#e0f2fe' : '#f1f5f9', padding: '10px 12px', borderRadius: 8 }}>
              <div style={{ fontSize: '0.9rem', color: '#0f172a' }}>{m.text}</div>
            </div>
          </div>
        ))}
      </div>

      <div style={{ marginTop: 8, marginBottom: 8, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {suggested.map(s => (
          <button key={s} className={styles.btnOutline} onClick={() => sendQuestion(s)}>{s}</button>
        ))}
      </div>

      <form onSubmit={onSubmit} style={{ display: 'flex', gap: 8 }}>
        <input className={styles.formControl} placeholder="Ask the assistant…" value={input} onChange={e => setInput(e.target.value)} />
        <button className={styles.btnPrimary} disabled={loading} style={{ minWidth: 120 }}>{loading ? 'Thinking…' : 'Ask'}</button>
      </form>
    </div>
  );
}
