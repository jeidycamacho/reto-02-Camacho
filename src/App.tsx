import { useState, useEffect, type FormEvent, type ChangeEvent } from 'react';
import { Send, FileText, CheckCircle2, ShieldAlert } from 'lucide-react';

interface HealthStatus {
  ok: boolean;
  provider: string;
  model: string;
}

interface ChatMessage {
  id: string;
  sender: 'user' | 'agent';
  text: string;
  timestamp: string;
}

export default function App() {
  const [messages, setMessages] = useState<readonly ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [health, setHealth] = useState<HealthStatus | null>(null);

  useEffect(() => {
    void fetch('/api/health')
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error('Health check falló'))))
      .then((data: HealthStatus) => {
        setHealth(data);
      })
      .catch(() => {
        setHealth(null);
      });
  }, []);

  const handleInputChange = (e: ChangeEvent<HTMLInputElement>): void => {
    setInputValue(e.target.value);
  };

  const handleSendMessage = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    const text = inputValue.trim();
    if (!text || isLoading) return;

    const userMsg: ChatMessage = {
      id: `msg-${Date.now()}`,
      sender: 'user',
      text,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    setMessages((prev) => [...prev, userMsg]);
    setInputValue('');
    setIsLoading(true);

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ message: text }),
      });

      if (!response.ok) {
        throw new Error(`Error en el servidor: ${response.status}`);
      }

      const data = (await response.json()) as { ok: boolean; reply?: string; error?: string };

      const agentMsg: ChatMessage = {
        id: `msg-${Date.now()}-agent`,
        sender: 'agent',
        text: data.reply ?? data.error ?? 'Sin respuesta disponible.',
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };

      setMessages((prev) => [...prev, agentMsg]);
    } catch {
      const errorMsg: ChatMessage = {
        id: `msg-${Date.now()}-err`,
        sender: 'agent',
        text: 'Error al comunicarse con el servidor.',
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };
      setMessages((prev) => [...prev, errorMsg]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-screen bg-slate-950 text-slate-100">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-900/80 backdrop-blur-md">
        <div className="flex items-center space-x-3">
          <div className="p-2 bg-blue-600/20 text-blue-400 rounded-lg border border-blue-500/30">
            <FileText className="w-5 h-5" />
          </div>
          <div>
            <h1 className="font-semibold text-base text-slate-100 tracking-tight">
              Registro de Contratos Vigentes
            </h1>
            <p className="text-xs text-slate-400">
              Esqueleto de sistema • Node.js + React + Gemini
            </p>
          </div>
        </div>

        {/* Backend health status badge */}
        <div className="flex items-center text-xs">
          {health ? (
            <div className="flex items-center space-x-2 px-2.5 py-1 rounded-full bg-emerald-950/60 border border-emerald-500/30 text-emerald-400">
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>
                API Activa ({health.provider} / {health.model})
              </span>
            </div>
          ) : (
            <div className="flex items-center space-x-2 px-2.5 py-1 rounded-full bg-amber-950/60 border border-amber-500/30 text-amber-400">
              <ShieldAlert className="w-3.5 h-3.5" />
              <span>Conectando API...</span>
            </div>
          )}
        </div>
      </header>

      {/* Chat Area */}
      <main className="flex-1 overflow-y-auto px-4 py-6 sm:px-8 max-w-4xl mx-auto w-full flex flex-col justify-between">
        {messages.length === 0 ? (
          /* Empty Chat Screen State */
          <div className="flex-1 flex flex-col items-center justify-center text-center p-8">
            <div className="w-16 h-16 rounded-2xl bg-slate-900 border border-slate-800 flex items-center justify-center text-slate-500 mb-4 shadow-inner">
              <FileText className="w-8 h-8 text-blue-400" />
            </div>
            <h2 className="text-lg font-medium text-slate-200 mb-1">
              Pantalla de Chat Vacía
            </h2>
            <p className="text-sm text-slate-400 max-w-md">
              No hay mensajes aún. El sistema está preparado para recibir instrucciones o consultas para el registro, validación y gestión de contratos vigentes.
            </p>
          </div>
        ) : (
          /* Messages List */
          <div className="space-y-4 py-4 flex-1">
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex ${msg.sender === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[80%] rounded-2xl px-4 py-3 text-sm leading-relaxed shadow-sm ${
                    msg.sender === 'user'
                      ? 'bg-blue-600 text-white rounded-br-xs'
                      : 'bg-slate-900 text-slate-200 border border-slate-800 rounded-bl-xs'
                  }`}
                >
                  <p className="whitespace-pre-wrap">{msg.text}</p>
                  <span
                    className={`block text-[10px] mt-1 text-right ${
                      msg.sender === 'user' ? 'text-blue-200' : 'text-slate-400'
                    }`}
                  >
                    {msg.timestamp}
                  </span>
                </div>
              </div>
            ))}
            {isLoading && (
              <div className="flex justify-start">
                <div className="bg-slate-900 text-slate-400 border border-slate-800 rounded-2xl px-4 py-2.5 text-xs flex items-center space-x-2">
                  <div className="w-2 h-2 rounded-full bg-blue-400 animate-ping" />
                  <span>Procesando ciclo de agente...</span>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Chat Input Bar */}
        <form onSubmit={(e) => void handleSendMessage(e)} className="mt-4 pt-2">
          <div className="flex items-center space-x-2 bg-slate-900 border border-slate-800 rounded-xl p-1.5 focus-within:border-blue-500/60 focus-within:ring-1 focus-within:ring-blue-500/50 transition">
            <input
              type="text"
              value={inputValue}
              onChange={handleInputChange}
              placeholder="Escribe un mensaje o instrucción..."
              disabled={isLoading}
              className="flex-1 bg-transparent px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-hidden disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={isLoading || !inputValue.trim()}
              className="inline-flex items-center justify-center px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-800 disabled:text-slate-600 text-white text-sm font-medium rounded-lg transition"
            >
              <Send className="w-4 h-4 mr-1.5" />
              <span>Enviar</span>
            </button>
          </div>
        </form>
      </main>
    </div>
  );
}
