import { useState } from 'react';
import { ChevronDown, Check, X, Wrench } from 'lucide-react';

export interface ToolCallData {
  nombre: string;
  argumentos: Record<string, unknown>;
  ok: boolean;
  resumen: string;
  resultado?: unknown;
}

interface ToolCardProps {
  tool: ToolCallData;
}

export function ToolCard({ tool }: ToolCardProps) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/70 overflow-hidden text-xs transition-all my-1.5 shadow-sm">
      {/* Encabezado colapsable */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between px-3 py-2 text-left bg-slate-900/90 hover:bg-slate-800/60 transition-colors gap-2 cursor-pointer"
        aria-expanded={isOpen}
      >
        <div className="flex items-center space-x-2.5 min-w-0 flex-1">
          {/* Indicador de éxito/error */}
          <span
            className={`inline-flex items-center justify-center w-4 h-4 rounded-full text-[10px] font-bold shrink-0 ${
              tool.ok
                ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
                : 'bg-rose-500/20 text-rose-400 border border-rose-500/40'
            }`}
            title={tool.ok ? 'Ejecución exitosa' : 'Ejecución con error o advertencia'}
          >
            {tool.ok ? <Check className="w-2.5 h-2.5 stroke-[3]" /> : <X className="w-2.5 h-2.5 stroke-[3]" />}
          </span>

          {/* Nombre de la herramienta */}
          <div className="flex items-center gap-1.5 shrink-0">
            <Wrench className="w-3 h-3 text-sky-400 shrink-0" />
            <span className="font-mono text-sky-300 font-medium text-[11px] bg-sky-950/60 px-1.5 py-0.5 rounded border border-sky-800/40">
              {tool.nombre}
            </span>
          </div>

          {/* Resumen */}
          <span className="text-slate-300 truncate text-[11px] font-normal" title={tool.resumen}>
            {tool.resumen}
          </span>
        </div>

        {/* Chevron para desplegar */}
        <div className="flex items-center text-slate-400 shrink-0 pl-1">
          <ChevronDown
            className={`w-3.5 h-3.5 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
          />
        </div>
      </button>

      {/* Contenido desplegado */}
      {isOpen && (
        <div className="p-3 border-t border-slate-800 bg-slate-950/80 space-y-2.5">
          {/* Argumentos */}
          <div>
            <span className="block text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-1">
              Argumentos:
            </span>
            <pre className="p-2 rounded bg-slate-900 border border-slate-800 font-mono text-[11px] text-sky-200 overflow-x-auto leading-relaxed">
              <code>{JSON.stringify(tool.argumentos, null, 2)}</code>
            </pre>
          </div>

          {/* Resultado */}
          {tool.resultado !== undefined && (
            <div>
              <span className="block text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-1">
                Resultado:
              </span>
              <pre className="p-2 rounded bg-slate-900 border border-slate-800 font-mono text-[11px] text-emerald-200 overflow-x-auto leading-relaxed max-h-56">
                <code>
                  {typeof tool.resultado === 'string'
                    ? tool.resultado
                    : JSON.stringify(tool.resultado, null, 2)}
                </code>
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
