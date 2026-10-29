import { useState, useEffect, useRef, useCallback, type KeyboardEvent } from 'react';
import {
  Send,
  FileText,
  CheckCircle2,
  ShieldAlert,
  RotateCcw,
  PlusCircle,
  Key,
  PanelRight,
  AlertTriangle,
  Sparkles,
  Bot,
  User,
  Info,
} from 'lucide-react';
import { MarkdownRenderer } from './components/MarkdownRenderer';
import { ToolCard, type ToolCallData } from './components/ToolCard';
import { SidePanel } from './components/SidePanel';

interface HealthStatus {
  ok: boolean;
  provider: string;
  model: string;
}

interface MessageItem {
  id: string;
  sender: 'user' | 'agent';
  text: string;
  timestamp: string;
  toolCalls?: ToolCallData[];
  needsConfirmation?: boolean;
  isError?: boolean;
}

const PROMPT_DEMO =
  'Procesa el buzón de contratos con fecha de hoy 2026-09-03. Registra lo que esté limpio, muéstrame lo que requiere revisión campo por campo y termina con el reporte de alertas. No registres nada dudoso sin preguntarme.';

const PROMPT_ALERTAS = 'Genera las alertas con fecha 2026-09-03';

function generarNuevoSessionId(): string {
  return `sesion-${Math.random().toString(36).substring(2, 8)}-${Date.now()}`;
}

function safeGetStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSetStorage(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // ignorar si almacenamiento local está restringido
  }
}

export default function App() {
  const [sessionId, setSessionId] = useState<string>(() => {
    return safeGetStorage('registro_contratos_session_id') || generarNuevoSessionId();
  });
  const [accessKey, setAccessKey] = useState<string>(() => {
    return safeGetStorage('registro_contratos_access_key') || '';
  });
  const [messages, setMessages] = useState<MessageItem[]>([]);
  const [inputValue, setInputValue] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [thinkingStep, setThinkingStep] = useState<number | null>(null);
  const [thinkingDetail, setThinkingDetail] = useState<string | null>(null);
  const [currentToolCalls, setCurrentToolCalls] = useState<ToolCallData[]>([]);
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [isSidePanelOpen, setIsSidePanelOpen] = useState<boolean>(false);
  const [refreshTrigger, setRefreshTrigger] = useState<number>(0);

  // Modales
  const [showKeyModal, setShowKeyModal] = useState<boolean>(false);
  const [tempKeyInput, setTempKeyInput] = useState<string>('');
  const [showResetModal, setShowResetModal] = useState<boolean>(false);
  const [isResetting, setIsResetting] = useState<boolean>(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Desplazamiento automático al final de mensajes
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, currentToolCalls, thinkingStep]);

  // Cabeceras de red
  const getHeaders = useCallback(() => {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (accessKey) {
      headers['x-access-key'] = accessKey;
    }
    return headers;
  }, [accessKey]);

  // 1. Consultar salud del backend
  const checkHealth = useCallback(async () => {
    try {
      const res = await fetch('/api/health');
      if (res.ok) {
        const data = (await res.json()) as HealthStatus;
        setHealth(data);
      } else {
        setHealth(null);
      }
    } catch {
      setHealth(null);
    }
  }, []);

  useEffect(() => {
    void checkHealth();
  }, [checkHealth]);

  // 2. Restaurar sesión desde backend al iniciar o cambiar de sessionId
  useEffect(() => {
    safeSetStorage('registro_contratos_session_id', sessionId);

    let isMounted = true;
    const fetchSession = async () => {
      try {
        const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}`, {
          headers: getHeaders(),
        });
        if (res.status === 401) {
          setShowKeyModal(true);
          return;
        }
        if (res.ok) {
          const data = (await res.json()) as {
            ok: boolean;
            sesion?: {
              chatVisible?: Array<{
                id: string;
                remitente: 'user' | 'agent';
                texto: string;
                ts: string;
                llamadasHerramientas?: ToolCallData[];
              }>;
              mensajesPendientesConfirmacion?: string[];
            };
          };

          if (isMounted && data.ok && data.sesion?.chatVisible) {
            const pendientes = data.sesion.mensajesPendientesConfirmacion ?? [];
            const loaded: MessageItem[] = data.sesion.chatVisible.map((m, idx, arr) => {
              const isLastAgent = m.remitente === 'agent' && idx === arr.length - 1;
              return {
                id: m.id,
                sender: m.remitente,
                text: m.texto,
                timestamp: new Date(m.ts).toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit',
                }),
                toolCalls: m.llamadasHerramientas,
                needsConfirmation: isLastAgent && pendientes.length > 0,
              };
            });
            setMessages(loaded);
          }
        }
      } catch {
        // sesión nueva o error no fatal
      }
    };

    void fetchSession();
    return () => {
      isMounted = false;
    };
  }, [sessionId, getHeaders]);

  // 3. Crear nueva sesión
  const handleNuevaSesion = () => {
    const nuevoId = generarNuevoSessionId();
    setSessionId(nuevoId);
    safeSetStorage('registro_contratos_session_id', nuevoId);
    setMessages([]);
    setCurrentToolCalls([]);
    setThinkingStep(null);
  };

  // 4. Reiniciar datos (out/)
  const handleConfirmReset = async () => {
    setIsResetting(true);
    try {
      const res = await fetch('/api/reset', {
        method: 'POST',
        headers: getHeaders(),
      });
      if (res.status === 401) {
        setShowResetModal(false);
        setShowKeyModal(true);
        return;
      }
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error ?? 'Error al reiniciar datos');
      }

      // Reinicio exitoso
      setRefreshTrigger((prev) => prev + 1);
      setShowResetModal(false);
      handleNuevaSesion();
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    } finally {
      setIsResetting(false);
    }
  };

  // 5. Guardar clave de acceso
  const handleSaveAccessKey = () => {
    const trimmed = tempKeyInput.trim();
    setAccessKey(trimmed);
    safeSetStorage('registro_contratos_access_key', trimmed);
    setShowKeyModal(false);
  };

  // 6. Enviar mensaje con streaming NDJSON
  const sendMessage = async (textToSend: string) => {
    const text = textToSend.trim();
    if (!text || isLoading) return;

    const userMessage: MessageItem = {
      id: `msg-${Date.now()}-u`,
      sender: 'user',
      text,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInputValue('');
    setIsLoading(true);
    setThinkingStep(1);
    setCurrentToolCalls([]);

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/x-ndjson',
          ...(accessKey ? { 'x-access-key': accessKey } : {}),
        },
        body: JSON.stringify({
          message: text,
          sessionId,
        }),
      });

      if (response.status === 401) {
        setShowKeyModal(true);
        throw new Error('Autenticación requerida: clave x-access-key no autorizada o faltante');
      }

      if (response.status === 409) {
        throw new Error('La sesión está procesando otra solicitud. Por favor espera unos momentos.');
      }

      if (!response.ok) {
        let errorMsg = `Error del servidor (${response.status})`;
        try {
          const errData = (await response.json()) as { error?: string };
          if (errData.error) errorMsg = errData.error;
        } catch {
          // respuesta no json
        }
        throw new Error(errorMsg);
      }

      // Procesar flujo NDJSON
      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('No se pudo inicializar la lectura en streaming');
      }

      const decoder = new TextDecoder('utf-8');
      let buffer = '';
      const accumulatedTools: ToolCallData[] = [];
      let finalAgentReply = '';
      let needsConfirmationFlag = false;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          let ev: {
            tipo: string;
            paso?: number;
            llamada?: ToolCallData;
            texto?: string;
            detalle?: string;
            needsConfirmation?: boolean;
            error?: string;
          } | null = null;

          try {
            ev = JSON.parse(trimmed);
          } catch (parseErr) {
            console.error('Error al parsear evento NDJSON:', parseErr, line);
            continue;
          }

          if (ev) {
            if (ev.tipo === 'pensando') {
              setThinkingStep(ev.paso ?? ((prev) => (prev ? prev + 1 : 1)));
              if (ev.detalle) {
                setThinkingDetail(ev.detalle);
              } else {
                setThinkingDetail(null);
              }
            } else if (ev.tipo === 'herramienta' && ev.llamada) {
              accumulatedTools.push(ev.llamada);
              setCurrentToolCalls([...accumulatedTools]);
              // Refrescar panel lateral automáticamente tras cada herramienta ejecutada
              setRefreshTrigger((prev) => prev + 1);
            } else if (ev.tipo === 'respuesta') {
              finalAgentReply = ev.texto ?? '';
              needsConfirmationFlag = Boolean(ev.needsConfirmation);
            } else if (ev.tipo === 'error') {
              throw new Error(ev.error ?? 'Error en el ciclo del agente');
            }
          }
        }
      }

      // Turno completado: consolidar mensaje final del agente
      const agentMessage: MessageItem = {
        id: `msg-${Date.now()}-a`,
        sender: 'agent',
        text: finalAgentReply || 'Turno finalizado.',
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        toolCalls: accumulatedTools.length > 0 ? accumulatedTools : undefined,
        needsConfirmation: needsConfirmationFlag,
      };

      setMessages((prev) => [...prev, agentMessage]);
      setCurrentToolCalls([]);
      setThinkingStep(null);
      // Refrescar panel lateral al final del turno
      setRefreshTrigger((prev) => prev + 1);
    } catch (err) {
      const errorText = err instanceof Error ? err.message : String(err);
      const errorMsgItem: MessageItem = {
        id: `msg-${Date.now()}-err`,
        sender: 'agent',
        text: `⚠️ Incidencia: ${errorText}`,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        toolCalls: currentToolCalls.length > 0 ? currentToolCalls : undefined,
        isError: true,
      };
      setMessages((prev) => [...prev, errorMsgItem]);
      setCurrentToolCalls([]);
      setThinkingStep(null);
    } finally {
      setIsLoading(false);
    }
  };

  // Manejador del teclado: Enter envía, Shift+Enter salto de línea
  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void sendMessage(inputValue);
    }
  };

  return (
    <div className="flex h-screen w-full bg-slate-950 text-slate-100 overflow-hidden font-sans">
      {/* Contenedor Principal (Chat y Cabecera) */}
      <div className="flex-1 flex flex-col h-full min-w-0">
        {/* Cabecera Principal */}
        <header className="flex items-center justify-between px-4 sm:px-6 py-3 border-b border-slate-800 bg-slate-900/90 backdrop-blur-xs z-10 shrink-0 gap-3">
          {/* Logo y Título */}
          <div className="flex items-center space-x-3 min-w-0">
            <div className="p-2 bg-sky-600/20 text-sky-400 rounded-lg border border-sky-500/30 shrink-0">
              <FileText className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h1 className="font-semibold text-sm sm:text-base text-slate-100 tracking-tight truncate">
                Registro de Contratos Vigentes
              </h1>
              <div className="flex items-center gap-2 text-[11px] text-slate-400">
                <span className="font-mono text-slate-500 truncate max-w-[140px] sm:max-w-none">
                  {sessionId}
                </span>
                <span className="text-slate-600 hidden sm:inline">•</span>
                <span className="text-slate-400 hidden sm:inline">Periferia IT Group</span>
              </div>
            </div>
          </div>

          {/* Acciones y Estado en Cabecera */}
          <div className="flex items-center space-x-2 shrink-0">
            {/* Badge de salud API */}
            {health ? (
              <div
                className="hidden md:flex items-center space-x-1.5 px-2.5 py-1 rounded-full bg-emerald-950/60 border border-emerald-500/30 text-emerald-400 text-xs font-mono"
                title={`Proveedor: ${health.provider} | Modelo: ${health.model}`}
              >
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span className="truncate max-w-[160px]">
                  {health.provider}: {health.model}
                </span>
              </div>
            ) : (
              <div className="hidden md:flex items-center space-x-1.5 px-2.5 py-1 rounded-full bg-amber-950/60 border border-amber-500/30 text-amber-400 text-xs">
                <ShieldAlert className="w-3.5 h-3.5" />
                <span>API no conectada</span>
              </div>
            )}

            {/* Botón Clave de Acceso */}
            <button
              type="button"
              onClick={() => {
                setTempKeyInput(accessKey);
                setShowKeyModal(true);
              }}
              title="Configurar clave de acceso x-access-key"
              className={`p-1.5 rounded-lg border text-xs flex items-center gap-1 transition cursor-pointer ${
                accessKey
                  ? 'border-sky-500/40 bg-sky-950/50 text-sky-300 hover:bg-sky-900/50'
                  : 'border-slate-800 bg-slate-900 text-slate-400 hover:text-slate-200 hover:bg-slate-800'
              }`}
            >
              <Key className="w-4 h-4" />
              <span className="hidden xl:inline">Clave</span>
            </button>

            {/* Botón Nueva Sesión */}
            <button
              type="button"
              onClick={handleNuevaSesion}
              title="Iniciar una nueva sesión limpia"
              className="inline-flex items-center space-x-1.5 px-2.5 py-1.5 rounded-lg border border-slate-800 bg-slate-900 hover:bg-slate-800 text-slate-200 text-xs font-medium transition cursor-pointer"
            >
              <PlusCircle className="w-3.5 h-3.5 text-sky-400" />
              <span className="hidden sm:inline">Nueva sesión</span>
            </button>

            {/* Botón Reiniciar Datos */}
            <button
              type="button"
              onClick={() => setShowResetModal(true)}
              title="Reiniciar base de datos y archivos generados"
              className="inline-flex items-center space-x-1.5 px-2.5 py-1.5 rounded-lg border border-rose-900/40 bg-rose-950/30 hover:bg-rose-900/40 text-rose-300 text-xs font-medium transition cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5 text-rose-400" />
              <span className="hidden sm:inline">Reiniciar datos</span>
            </button>

            {/* Botón para alternar panel lateral en pantallas móviles / desktop */}
            <button
              type="button"
              onClick={() => setIsSidePanelOpen(!isSidePanelOpen)}
              title={isSidePanelOpen ? 'Ocultar panel lateral' : 'Mostrar panel lateral'}
              className="p-1.5 rounded-lg border border-slate-800 bg-slate-900 hover:bg-slate-800 text-slate-300 text-xs transition cursor-pointer"
            >
              <PanelRight className="w-4 h-4 text-sky-400" />
            </button>
          </div>
        </header>

        {/* Zona de Conversación */}
        <main className="flex-1 overflow-y-auto px-3 sm:px-6 py-4 flex flex-col justify-between">
          <div className="max-w-4xl mx-auto w-full flex-1 flex flex-col space-y-4">
            {messages.length === 0 ? (
              /* Estado Inicial de Bienvenida con Botones de Sugerencia */
              <div className="my-auto py-8 px-4 flex flex-col items-center justify-center text-center">
                <div className="w-14 h-14 rounded-2xl bg-sky-950/60 border border-sky-500/30 flex items-center justify-center text-sky-400 mb-4 shadow-lg">
                  <Bot className="w-7 h-7" />
                </div>
                <h2 className="text-lg font-semibold text-slate-100 mb-1">
                  Agente de Registro de Contratos Vigentes
                </h2>
                <p className="text-xs text-slate-400 max-w-lg mb-6 leading-relaxed">
                  Sistema automatizado con lectura de buzón, extracción determinista, validación contra
                  maestro en SharePoint, gestión de pólizas y emisión de alertas de vencimiento.
                </p>

                {/* Botones de sugerencia iniciales */}
                <div className="w-full max-w-lg space-y-2.5 text-left">
                  <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider px-1">
                    Acciones rápidas recomendadas:
                  </div>

                  {/* Botón 1: Procesar buzón demo */}
                  <button
                    type="button"
                    onClick={() => void sendMessage(PROMPT_DEMO)}
                    className="w-full p-3 rounded-xl border border-sky-500/30 bg-sky-950/40 hover:bg-sky-900/50 hover:border-sky-400/50 text-left transition group cursor-pointer shadow-sm"
                  >
                    <div className="flex items-center space-x-2 text-sky-300 font-medium text-xs mb-1">
                      <Sparkles className="w-4 h-4 text-sky-400 group-hover:rotate-12 transition-transform" />
                      <span>Procesar buzón (demo 2026-09-03)</span>
                    </div>
                    <p className="text-[11px] text-slate-400 line-clamp-2 leading-relaxed">
                      &quot;{PROMPT_DEMO}&quot;
                    </p>
                  </button>

                  {/* Botón 2: Generar alertas */}
                  <button
                    type="button"
                    onClick={() => void sendMessage(PROMPT_ALERTAS)}
                    className="w-full p-3 rounded-xl border border-slate-800 bg-slate-900/70 hover:bg-slate-800 hover:border-slate-700 text-left transition group cursor-pointer"
                  >
                    <div className="flex items-center space-x-2 text-slate-200 font-medium text-xs mb-1">
                      <Info className="w-4 h-4 text-sky-400" />
                      <span>Generar las alertas con fecha 2026-09-03</span>
                    </div>
                    <p className="text-[11px] text-slate-400">
                      Calcula contratos que vencen en 60 días o pólizas no vigentes a la fecha de corte.
                    </p>
                  </button>
                </div>
              </div>
            ) : (
              /* Flujo de Mensajes del Chat */
              messages.map((msg) => (
                <div
                  key={msg.id}
                  className={`flex ${msg.sender === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-[92%] sm:max-w-[85%] rounded-2xl p-4 shadow-sm text-xs leading-relaxed ${
                      msg.sender === 'user'
                        ? 'bg-sky-600 text-white rounded-br-xs'
                        : msg.isError
                        ? 'bg-rose-950/50 text-rose-200 border border-rose-500/40 rounded-bl-xs'
                        : 'bg-slate-900/90 text-slate-200 border border-slate-800 rounded-bl-xs'
                    }`}
                  >
                    {/* Encabezado del mensaje */}
                    <div className="flex items-center justify-between gap-3 mb-2 text-[11px] opacity-80 border-b border-white/10 pb-1.5">
                      <div className="flex items-center space-x-1.5 font-medium">
                        {msg.sender === 'user' ? (
                          <>
                            <User className="w-3.5 h-3.5" />
                            <span>Tú</span>
                          </>
                        ) : (
                          <>
                            <Bot className="w-3.5 h-3.5 text-sky-400" />
                            <span className="text-sky-300">Agente de Contratos</span>
                          </>
                        )}
                      </div>
                      <span className="text-[10px] font-mono">{msg.timestamp}</span>
                    </div>

                    {/* Tarjetas de herramientas asociadas a este mensaje */}
                    {msg.toolCalls && msg.toolCalls.length > 0 && (
                      <div className="mb-3 space-y-1">
                        <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-1">
                          Herramientas ejecutadas ({msg.toolCalls.length}):
                        </div>
                        {msg.toolCalls.map((tc, idx) => (
                          <ToolCard key={`tool-${msg.id}-${idx}`} tool={tc} />
                        ))}
                      </div>
                    )}

                    {/* Texto o Markdown del mensaje */}
                    {msg.sender === 'user' ? (
                      <p className="whitespace-pre-wrap">{msg.text}</p>
                    ) : (
                      <MarkdownRenderer content={msg.text} />
                    )}

                    {/* Banner de Confirmación Humana */}
                    {msg.needsConfirmation && (
                      <div className="mt-4 p-3.5 rounded-xl border border-amber-500/50 bg-amber-950/40 text-amber-200 space-y-2.5">
                        <div className="flex items-center space-x-2 text-amber-300 font-semibold text-xs">
                          <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                          <span>Requiere tu confirmación</span>
                        </div>
                        <p className="text-[11px] text-amber-200/90 leading-relaxed">
                          El agente ha detectado campos que no alcanzaron el umbral de certeza o que
                          requieren decisión humana. Por favor confirma o corrige los valores para
                          proceder con el registro.
                        </p>

                        <div className="flex flex-wrap gap-2 pt-1">
                          <button
                            type="button"
                            onClick={() =>
                              void sendMessage(
                                'Confirmo el valor 0 y la fecha fin 2027-08-31'
                              )
                            }
                            className="px-3 py-1.5 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 text-xs font-medium transition cursor-pointer"
                          >
                            Confirmo el valor 0 y la fecha fin 2027-08-31
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              void sendMessage('Muéstrame la evidencia de cada campo')
                            }
                            className="px-3 py-1.5 rounded-lg bg-slate-900/80 hover:bg-slate-800 text-slate-300 border border-slate-700 text-xs font-medium transition cursor-pointer"
                          >
                            Muéstrame la evidencia de cada campo
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ))
            )}

            {/* Indicador en vivo de pensamiento y herramientas del turno actual */}
            {isLoading && (
              <div className="flex justify-start">
                <div className="max-w-[92%] sm:max-w-[85%] rounded-2xl p-4 bg-slate-900/90 border border-slate-800 rounded-bl-xs text-xs space-y-3">
                  {/* Indicador de pensamiento con número de paso */}
                  <div className="flex items-center space-x-2.5 text-sky-400">
                    <div className="w-2.5 h-2.5 rounded-full bg-sky-400 animate-ping" />
                    <span className="font-medium text-xs">
                      Pensando… {thinkingStep ? `paso ${thinkingStep}` : ''}{' '}
                      {thinkingDetail ? `(${thinkingDetail})` : ''}
                    </span>
                  </div>

                  {/* Herramientas que se van ejecutando en vivo en este turno */}
                  {currentToolCalls.length > 0 && (
                    <div className="space-y-1 pt-1 border-t border-slate-800/80">
                      <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-1">
                        Herramientas en progreso:
                      </div>
                      {currentToolCalls.map((tc, idx) => (
                        <ToolCard key={`current-tool-${idx}`} tool={tc} />
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Barra de Entrada del Chat */}
          <div className="mt-4 pt-2 max-w-4xl mx-auto w-full">
            <div className="relative flex flex-col bg-slate-900/90 border border-slate-800 rounded-xl focus-within:border-sky-500/60 focus-within:ring-1 focus-within:ring-sky-500/50 transition">
              <textarea
                ref={textareaRef}
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Escribe una instrucción (Enter para enviar, Shift+Enter para salto de línea)..."
                disabled={isLoading}
                rows={2}
                className="w-full bg-transparent px-3.5 py-2.5 text-xs text-slate-100 placeholder-slate-500 focus:outline-hidden disabled:opacity-50 resize-none font-sans leading-relaxed"
              />

              <div className="flex items-center justify-between px-3 py-1.5 border-t border-slate-800/80 bg-slate-950/40 text-[11px] text-slate-500">
                <span className="hidden sm:inline">
                  Presiona <kbd className="px-1 py-0.5 rounded bg-slate-800 text-slate-300 font-mono text-[10px]">Enter</kbd> para enviar, <kbd className="px-1 py-0.5 rounded bg-slate-800 text-slate-300 font-mono text-[10px]">Shift+Enter</kbd> nueva línea
                </span>
                <span className="sm:hidden">Enter para enviar</span>

                <button
                  type="button"
                  onClick={() => void sendMessage(inputValue)}
                  disabled={isLoading || !inputValue.trim()}
                  className="inline-flex items-center justify-center space-x-1.5 px-3 py-1.5 bg-sky-600 hover:bg-sky-500 disabled:bg-slate-800 disabled:text-slate-600 text-white text-xs font-medium rounded-lg transition cursor-pointer"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>Enviar</span>
                </button>
              </div>
            </div>
          </div>
        </main>
      </div>

      {/* Panel Lateral con Maestro y Alertas */}
      <SidePanel
        isOpen={isSidePanelOpen}
        onClose={() => setIsSidePanelOpen(false)}
        refreshTrigger={refreshTrigger}
        accessKey={accessKey}
      />

      {/* Modal: Configurar Clave de Acceso (x-access-key) */}
      {showKeyModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4">
          <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-2xl text-xs space-y-4">
            <div className="flex items-center space-x-2 text-slate-100 font-semibold text-sm">
              <Key className="w-4 h-4 text-sky-400" />
              <span>Clave de Acceso de la API</span>
            </div>

            <p className="text-slate-400 leading-relaxed">
              Si el servidor está protegido por la variable de entorno <code className="text-sky-300 font-mono">ACCESS_KEY</code>, ingresa tu clave para autorizar las solicitudes. Se almacenará en tu navegador.
            </p>

            <div>
              <label className="block text-[11px] font-medium text-slate-300 mb-1">
                Clave (cabecera x-access-key):
              </label>
              <input
                type="password"
                value={tempKeyInput}
                onChange={(e) => setTempKeyInput(e.target.value)}
                placeholder="Ingresa la ACCESS_KEY..."
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-slate-200 text-xs focus:outline-hidden focus:border-sky-500"
              />
            </div>

            <div className="flex items-center justify-end space-x-2 pt-2 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setShowKeyModal(false)}
                className="px-3 py-1.5 rounded-lg border border-slate-800 hover:bg-slate-800 text-slate-300 text-xs transition cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleSaveAccessKey}
                className="px-3.5 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-medium transition cursor-pointer"
              >
                Guardar clave
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Confirmación de Reinicio de Datos */}
      {showResetModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4">
          <div className="w-full max-w-md bg-slate-900 border border-rose-900/50 rounded-2xl p-5 shadow-2xl text-xs space-y-4">
            <div className="flex items-center space-x-2 text-rose-300 font-semibold text-sm">
              <RotateCcw className="w-4 h-4 text-rose-400" />
              <span>¿Confirmar reinicio de datos?</span>
            </div>

            <p className="text-slate-300 leading-relaxed">
              Esta acción eliminará el contenido generado en la carpeta <code className="text-rose-300 font-mono">out/</code>, restaurará el archivo maestro original desde los fixtures y reseteará las sesiones activas.
            </p>

            <div className="flex items-center justify-end space-x-2 pt-2 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setShowResetModal(false)}
                disabled={isResetting}
                className="px-3 py-1.5 rounded-lg border border-slate-800 hover:bg-slate-800 text-slate-300 text-xs transition cursor-pointer disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => void handleConfirmReset()}
                disabled={isResetting}
                className="px-3.5 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-medium transition cursor-pointer disabled:opacity-50"
              >
                {isResetting ? 'Reiniciando...' : 'Sí, reiniciar datos'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
