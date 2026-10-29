import type { AdaptadorLLM } from '../llm/adapter.ts';
import { CicloAgente, type ResultadoTurno, type LlamadaToolVisible } from './ciclo.ts';
import { registroHerramientas } from './registro.ts';
import { obtenerOCrearSesion, type EstadoSesion } from './sesion.ts';

export {
  CicloAgente,
  registroHerramientas,
  obtenerOCrearSesion,
  type ResultadoTurno,
  type LlamadaToolVisible,
  type EstadoSesion,
};

export function crearCicloAgente(llm: AdaptadorLLM): CicloAgente {
  return new CicloAgente(llm);
}
