import { useState, useEffect, useRef } from 'react';
import { getConversations, getConversationMessages, sendManualMessage, updateConversationStatus, timeAgo } from '../api';

export default function Conversations() {
  const [convs, setConvs] = useState([]);
  const [selected, setSelected] = useState(null);
  const [messages, setMessages] = useState([]);
  const [manual, setManual] = useState('');
  const [loading, setLoading] = useState(false);
  const messagesEnd = useRef(null);

  useEffect(() => {
    const load = async () => {
      const r = await getConversations();
      if (r?.success) {
        setConvs(r.data);
        // Actualizar el seleccionado si existe
        if (selected) {
          const updated = r.data.find(c => c.id === selected.id);
          if (updated) setSelected(updated);
        }
      }
    };
    load();
    const i = setInterval(load, 10000);
    return () => clearInterval(i);
  }, [selected]);

  const selectConv = async (conv) => {
    setSelected(conv);
    const r = await getConversationMessages(conv.id);
    if (r?.success) setMessages(r.data);
    setTimeout(() => messagesEnd.current?.scrollIntoView({ behavior: 'smooth' }), 100);
  };

  const toggleBot = async () => {
    if (!selected) return;
    const newStatus = selected.status === 'PAUSED' ? 'ACTIVE' : 'PAUSED';
    setLoading(true);
    const r = await updateConversationStatus(selected.id, newStatus);
    if (r?.success) {
      setSelected({ ...selected, status: newStatus });
    }
    setLoading(false);
  };

  const send = async () => {
    if (!manual.trim() || !selected?.contact?.phone) return;
    await sendManualMessage({ phone: selected.contact.phone, message: manual });
    setManual('');
    // Al enviar manual, el bot se pausa automáticamente en el backend
    setSelected({ ...selected, status: 'PAUSED' });
    setTimeout(() => selectConv(selected), 1500);
  };

  return (
    <div className="page-container p-6" style={{ height: 'calc(100vh - 100px)', display: 'flex', flexDirection: 'column' }}>
      <header className="mb-6 flex-shrink-0">
        <div className="flex justify-between items-center">
          <div>
            <h1 className="page-title">Conversaciones</h1>
            <p className="page-subtitle">Soporte en tiempo real y ventas vía WhatsApp Business</p>
          </div>
        </div>
      </header>

      <div className="chat-layout flex-1 overflow-hidden" style={{ background: 'var(--bg-card)', borderRadius: 'var(--r-lg)', border: '1px solid var(--border)', display: 'flex' }}>
        <div className="chat-list" style={{ width: '320px', borderRight: '1px solid var(--border)', background: 'var(--bg-0)', overflowY: 'auto' }}>
          {convs.map(c => (
            <div key={c.id} className={`chat-item ${selected?.id === c.id ? 'active' : ''} ${c.status === 'ESCALATED' ? 'chat-item-escalated' : ''} ${c.status === 'PAUSED' ? 'chat-item-paused' : ''}`}
              onClick={() => selectConv(c)}>
              <div className="chat-item-top">
                <strong>{c.contact?.name || c.contact?.phone || '?'}</strong>
                <span className="chat-time">{timeAgo(c.updatedAt)}</span>
              </div>
              <div className="chat-item-bottom">
                <span className="chat-preview">{c.messages?.[0]?.content?.substring(0, 50) || '...'}</span>
                <span className="flex items-center gap-1">
                  {c.status === 'ESCALATED' && <span title="Escalado a humano">🆘</span>}
                  {c.status === 'PAUSED' && <span title="Bot desactivado (Manual)" style={{ fontSize: '10px', opacity: 0.7 }}>⏸️</span>}
                </span>
              </div>
            </div>
          ))}
          {convs.length === 0 && <p className="empty">No hay conversaciones</p>}
        </div>

        <div className="chat-panel" style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
          {selected ? (
            <>
              <div className="chat-header" style={{ padding: '15px 20px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--bg-card)' }}>
                <div>
                  <strong>{selected.contact?.name || selected.contact?.phone}</strong>
                  <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{selected.contact?.city || 'Ciudad no capturada'}</div>
                </div>
                
                <div className="flex items-center gap-3">
                  <button 
                    onClick={toggleBot}
                    disabled={loading}
                    className={`btn-sm ${selected.status === 'PAUSED' ? 'btn-outline' : 'btn-success'}`}
                    style={{ fontSize: '12px', display: 'flex', alignItems: 'center', gap: '5px' }}
                  >
                    {selected.status === 'PAUSED' ? '🤖 Activar Bot' : '⏸️ Pausar Bot'}
                  </button>
                  
                  <span className={`badge badge-${selected.status === 'ACTIVE' ? 'green' : selected.status === 'ESCALATED' ? 'red' : 'orange'}`}>
                    {selected.status === 'ACTIVE' ? 'AUTO' : selected.status === 'PAUSED' ? 'MANUAL' : 'AYUDA'}
                  </span>
                </div>
              </div>

              <div className="chat-messages" style={{ flex: 1, overflowY: 'auto', padding: '20px' }}>
                {messages.map(m => (
                  <div key={m.id} className={`msg ${m.role === 'USER' ? 'msg-in' : 'msg-out'}`}>
                    <div className="msg-content">{m.content}</div>
                    <div className="msg-time">{new Date(m.createdAt).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })}</div>
                  </div>
                ))}
                <div ref={messagesEnd} />
              </div>

              <div className="chat-input" style={{ padding: '20px', borderTop: '1px solid var(--border)', background: 'var(--bg-card)' }}>
                <div style={{ display: 'flex', gap: '10px' }}>
                  <input 
                    className="chat-input-field"
                    style={{ flex: 1, padding: '10px 15px', borderRadius: 'var(--r-md)', border: '1px solid var(--border)', background: 'var(--bg-0)', color: 'var(--text)' }}
                    value={manual} 
                    onChange={e => setManual(e.target.value)}
                    placeholder={selected.status === 'PAUSED' ? "Modo manual activo..." : "Escribe aquí para pausar el bot y responder..."} 
                    onKeyDown={e => e.key === 'Enter' && send()} 
                  />
                  <button className="btn-primary" onClick={send} disabled={!manual.trim()}>Enviar</button>
                </div>
              </div>
            </>
          ) : (
            <div className="chat-empty" style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>
              Selecciona una conversación para chatear
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
