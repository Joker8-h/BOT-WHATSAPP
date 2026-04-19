import { useState, useEffect, useRef } from 'react';
import { getConversations, getConversationMessages, sendManualMessage, timeAgo } from '../api';

export default function Conversations() {
  const [convs, setConvs] = useState([]);
  const [selected, setSelected] = useState(null);
  const [messages, setMessages] = useState([]);
  const [manual, setManual] = useState('');
  const messagesEnd = useRef(null);

  useEffect(() => {
    const load = async () => {
      const r = await getConversations();
      if (r?.success) setConvs(r.data);
    };
    load();
    const i = setInterval(load, 15000);
    return () => clearInterval(i);
  }, []);

  const selectConv = async (conv) => {
    setSelected(conv);
    const r = await getConversationMessages(conv.id);
    if (r?.success) setMessages(r.data);
    setTimeout(() => messagesEnd.current?.scrollIntoView({ behavior: 'smooth' }), 100);
  };

  const send = async () => {
    if (!manual.trim() || !selected?.contact?.phone) return;
    await sendManualMessage({ phone: selected.contact.phone, message: manual });
    setManual('');
    setTimeout(() => selectConv(selected), 1500);
  };

  const statusLabel = { ACTIVE: '', ESCALATED: '', CLOSED: '' };

  return (
    <div className="page-container p-6" style={{ height: 'calc(100vh - 100px)', display: 'flex', flexDirection: 'column' }}>
      <header className="mb-6 flex-shrink-0">
        <h1 className="page-title">Conversaciones</h1>
        <p className="page-subtitle">Soporte en tiempo real y ventas vía WhatsApp Business</p>
      </header>

      <div className="chat-layout flex-1 overflow-hidden" style={{ background: 'var(--bg-card)', borderRadius: 'var(--r-lg)', border: '1px solid var(--border)', display: 'flex' }}>
        <div className="chat-list" style={{ width: '320px', borderRight: '1px solid var(--border)', background: 'var(--bg-0)' }}>
          {convs.map(c => (
            <div key={c.id} className={`chat-item ${selected?.id === c.id ? 'active' : ''} ${c.status === 'ESCALATED' ? 'chat-item-escalated' : ''}`}
              onClick={() => selectConv(c)}>
              <div className="chat-item-top">
                <strong>{c.contact?.name || c.contact?.phone || '?'}</strong>
                <span className="chat-time">{timeAgo(c.updatedAt)}</span>
              </div>
              <div className="chat-item-bottom">
                <span className="chat-preview">{c.messages?.[0]?.content?.substring(0, 50) || '...'}</span>
                <span>{c.status === 'ESCALATED' ? '🆘' : ''}</span>
              </div>
            </div>
          ))}
          {convs.length === 0 && <p className="empty">No hay conversaciones</p>}
        </div>

        <div className="chat-panel">
          {selected ? (
            <>
              <div className="chat-header">
                <strong>{selected.contact?.name || selected.contact?.phone}</strong>
                <span className={`badge badge-${selected.status === 'ACTIVE' ? 'green' : selected.status === 'ESCALATED' ? 'red' : 'muted'}`}>
                  {selected.status}
                </span>
              </div>
              <div className="chat-messages">
                {messages.map(m => (
                  <div key={m.id} className={`msg ${m.role === 'USER' ? 'msg-in' : 'msg-out'}`}>
                    <div className="msg-content">{m.content}</div>
                    <div className="msg-time">{new Date(m.createdAt).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })}</div>
                  </div>
                ))}
                <div ref={messagesEnd} />
              </div>
              <div className="chat-input">
                <input value={manual} onChange={e => setManual(e.target.value)}
                  placeholder="Enviar mensaje manual..." onKeyDown={e => e.key === 'Enter' && send()} />
                <button className="btn-primary" onClick={send}>Enviar</button>
              </div>
            </>
          ) : (
            <div className="chat-empty">Selecciona una conversación</div>
          )}
        </div>
      </div>
    </div>
  );
}
