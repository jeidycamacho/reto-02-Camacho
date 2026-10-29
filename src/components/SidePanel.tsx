import { useState, useEffect, useCallback } from 'react';
import { Database, Bell, RefreshCw, X, ShieldAlert, Sparkles } from 'lucide-react';
import { MarkdownRenderer } from './MarkdownRenderer';
import type { FilaMaestro } from '../tools/lib/almacen';

interface SidePanelProps {
  isOpen: boolean;
  onClose: () => void;
  refreshTrigger: number;
  accessKey?: string;
}

export function SidePanel({ isOpen, onClose, refreshTrigger, accessKey }: SidePanelProps) {
  const [activeTab, setActiveTab] = useState<'maestro' | 'alertas'>('maestro');
  const [maestroRows, setMaestroRows] = useState<FilaMaestro[]>([]);
  const [alertasContent, setAlertasContent] = useState<string>('');
  const [isLoadingMaestro, setIsLoadingMaestro] = useState<boolean>(false);
  const [isLoadingAlertas, setIsLoadingAlertas] = useState<boolean>(false);
  const [errorMaestro, setErrorMaestro] = useState<string | null>(null);
  const [errorAlertas, setErrorAlertas] = useState<string | null>(null);

  const getHeaders = useCallback(() => {
    const headers: Record<string, string> = {};
    if (accessKey) {
      headers['x-access-key'] = accessKey;
    }
    return headers;
  }, [accessKey]);

  const fetchMaestro = useCallback(async () => {
    setIsLoadingMaestro(true);
    setErrorMaestro(null);
    try {
      const res = await fetch('/api/maestro', {
        headers: getHeaders(),
      });
      if (!res.ok) {
        throw new Error(`Error ${res.status}: ${res.statusText}`);
      }
      const data = (await res.json()) as { ok: boolean; filas?: FilaMaestro[]; error?: string };
      if (data.ok && Array.isArray(data.filas)) {
        setMaestroRows(data.filas);
      } else {
        setErrorMaestro(data.error ?? 'No se pudo cargar el maestro');
      }
    } catch (err) {
      setErrorMaestro(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoadingMaestro(false);
    }
  }, [getHeaders]);

  const fetchAlertas = useCallback(async () => {
    setIsLoadingAlertas(true);
    setErrorAlertas(null);
    try {
      const res = await fetch('/api/alertas', {
        headers: {
          ...getHeaders(),
          Accept: 'application/json, text/markdown',
        },
      });
      if (!res.ok) {
        throw new Error(`Error ${res.status}: ${res.statusText}`);
      }

      const contentType = res.headers.get('content-type') ?? '';
      if (contentType.includes('application/json')) {
        const data = (await res.json()) as { ok: boolean; markdown?: string; error?: string };
        setAlertasContent(data.markdown ?? 'No hay reporte de alertas disponible.');
      } else {
        const text = await res.text();
        setAlertasContent(text || 'No hay reporte de alertas disponible.');
      }
    } catch (err) {
      setErrorAlertas(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoadingAlertas(false);
    }
  }, [getHeaders]);

  // Cargar datos al montar y al cambiar el refreshTrigger
  useEffect(() => {
    void fetchMaestro();
    void fetchAlertas();
  }, [fetchMaestro, fetchAlertas, refreshTrigger]);

  const getBadgePoliza = (estado: string) => {
    switch (estado.toLowerCase()) {
      case 'vigente':
        return (
          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-emerald-950/70 text-emerald-400 border border-emerald-500/30">
            vigente
          </span>
        );
      case 'pendiente':
        return (
          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-950/70 text-amber-400 border border-amber-500/30">
            pendiente
          </span>
        );
      case 'vencida':
        return (
          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-rose-950/70 text-rose-400 border border-rose-500/30">
            vencida
          </span>
        );
      case 'no_aplica':
      default:
        return (
          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-slate-800 text-slate-400 border border-slate-700">
            no aplica
          </span>
        );
    }
  };

  const buzonCount = maestroRows.filter((r) => r.fuente === 'buzon').length;

  return (
    <aside
      className={`fixed lg:static top-0 right-0 h-full w-full sm:w-[480px] lg:w-[500px] xl:w-[540px] bg-slate-900 border-l border-slate-800 flex flex-col z-30 transition-transform duration-300 shadow-2xl lg:shadow-none ${
        isOpen ? 'translate-x-0' : 'translate-x-full lg:translate-x-0'
      }`}
    >
      {/* Barra superior de pestañas y controles */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800 bg-slate-950/60">
        <div className="flex items-center space-x-1 bg-slate-900 p-0.5 rounded-lg border border-slate-800">
          <button
            type="button"
            onClick={() => setActiveTab('maestro')}
            className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors cursor-pointer ${
              activeTab === 'maestro'
                ? 'bg-sky-600 text-white shadow-xs'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Database className="w-3.5 h-3.5" />
            <span>Maestro ({maestroRows.length})</span>
            {buzonCount > 0 && (
              <span className="ml-1 px-1 py-0.2 rounded-full bg-emerald-500/30 text-emerald-300 text-[10px] border border-emerald-500/40 font-semibold" title={`${buzonCount} registrados desde el buzón`}>
                +{buzonCount}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('alertas')}
            className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors cursor-pointer ${
              activeTab === 'alertas'
                ? 'bg-sky-600 text-white shadow-xs'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Bell className="w-3.5 h-3.5" />
            <span>Alertas</span>
          </button>
        </div>

        <div className="flex items-center space-x-2">
          <button
            type="button"
            onClick={() => (activeTab === 'maestro' ? void fetchMaestro() : void fetchAlertas())}
            title="Actualizar datos"
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition cursor-pointer"
          >
            <RefreshCw
              className={`w-4 h-4 ${
                (activeTab === 'maestro' ? isLoadingMaestro : isLoadingAlertas) ? 'animate-spin text-sky-400' : ''
              }`}
            />
          </button>

          {/* Botón cerrar en dispositivos móviles */}
          <button
            type="button"
            onClick={onClose}
            title="Cerrar panel lateral"
            className="lg:hidden p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Contenido según pestaña */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {activeTab === 'maestro' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between text-xs text-slate-400 px-1">
              <span className="text-[11px]">
                Filas con fondo verde provienen de <strong className="text-emerald-400">buzón</strong>
              </span>
              <span className="text-[11px] font-mono text-slate-500">
                Total: {maestroRows.length} contratos
              </span>
            </div>

            {errorMaestro ? (
              <div className="p-3 rounded-lg border border-rose-500/30 bg-rose-950/40 text-rose-300 text-xs flex items-center space-x-2">
                <ShieldAlert className="w-4 h-4 shrink-0" />
                <span>{errorMaestro}</span>
              </div>
            ) : maestroRows.length === 0 ? (
              <div className="text-center py-12 text-slate-500 text-xs">
                {isLoadingMaestro ? 'Cargando contratos del maestro...' : 'No hay contratos en el maestro.'}
              </div>
            ) : (
              <div className="space-y-2.5">
                {maestroRows.map((row) => {
                  const isBuzon = row.fuente === 'buzon';
                  return (
                    <div
                      key={row.id_contrato}
                      className={`p-3 rounded-lg border text-xs transition-colors ${
                        isBuzon
                          ? 'bg-emerald-950/30 border-emerald-500/40 ring-1 ring-emerald-500/20'
                          : 'bg-slate-950/60 border-slate-800 hover:border-slate-700'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2 mb-1.5">
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono font-bold text-sky-300 text-xs">
                            {row.id_contrato}
                          </span>
                          {isBuzon && (
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.2 rounded text-[10px] font-medium bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                              <Sparkles className="w-2.5 h-2.5" />
                              buzón
                            </span>
                          )}
                        </div>
                        {getBadgePoliza(row.estado_poliza)}
                      </div>

                      <div className="font-medium text-slate-200 text-xs truncate mb-1">
                        {row.cliente}
                      </div>

                      <p className="text-[11px] text-slate-400 line-clamp-2 leading-relaxed mb-2">
                        {row.objeto}
                      </p>

                      <div className="grid grid-cols-2 gap-x-2 gap-y-1 text-[10px] text-slate-400 pt-2 border-t border-slate-800/80">
                        <div>
                          <span className="text-slate-500">Monto: </span>
                          <span className="font-mono text-slate-200">
                            {Number(row.valor).toLocaleString('es-CO')} {row.moneda}
                          </span>
                        </div>
                        <div>
                          <span className="text-slate-500">País / NIT: </span>
                          <span className="text-slate-200 font-mono">
                            {row.pais} • {row.nit_cliente}
                          </span>
                        </div>
                        <div>
                          <span className="text-slate-500">Vigencia: </span>
                          <span className="text-slate-200 font-mono">
                            {row.fecha_inicio} al {row.fecha_fin}
                          </span>
                        </div>
                        <div>
                          <span className="text-slate-500">Comercial: </span>
                          <span className="text-slate-200 truncate">{row.comercial}</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {activeTab === 'alertas' && (
          <div className="space-y-3">
            {errorAlertas ? (
              <div className="p-3 rounded-lg border border-rose-500/30 bg-rose-950/40 text-rose-300 text-xs flex items-center space-x-2">
                <ShieldAlert className="w-4 h-4 shrink-0" />
                <span>{errorAlertas}</span>
              </div>
            ) : alertasContent ? (
              <div className="p-3 rounded-lg bg-slate-950/60 border border-slate-800">
                <MarkdownRenderer content={alertasContent} />
              </div>
            ) : (
              <div className="text-center py-12 text-slate-500 text-xs">
                {isLoadingAlertas ? 'Cargando reporte de alertas...' : 'No hay alertas generadas aún.'}
              </div>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}
