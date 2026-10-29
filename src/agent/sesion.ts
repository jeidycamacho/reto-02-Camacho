import fs from 'node:fs';
import path from 'node:path';
import type { MensajeLLM } from '../llm/adapter.ts';

export interface MensajeChatVisible {
  id: string;
  remitente: 'user' | 'agent';
  texto: string;
  ts: string;
  llamadasHerramientas?: Array<{
    nombre: string;
    argumentos: Record<string, unknown>;
    ok: boolean;
    resumen: string;
    resultado?: unknown;
  }>;
}

export interface EstadoSesion {
  id: string;
  mensajesLLM: MensajeLLM[];
  chatVisible: MensajeChatVisible[];
  tokensEntradaTotal: number;
  tokensSalidaTotal: number;
  mensajesPendientesConfirmacion: string[];
  enEjecucion: boolean;
  creadoEn: string;
  actualizadoEn: string;
}

const sesionesMemoria = new Map<string, EstadoSesion>();

function asegurarCarpetaSesiones(baseDir: string): string {
  const dir = path.join(baseDir, 'out', 'sesiones');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

export function obtenerOCrearSesion(id: string, baseDir = process.cwd()): EstadoSesion {
  const enMemoria = sesionesMemoria.get(id);
  if (enMemoria) return enMemoria;

  const dir = asegurarCarpetaSesiones(baseDir);
  const rutaArchivo = path.join(dir, `${id}.json`);

  if (fs.existsSync(rutaArchivo)) {
    try {
      const raw = fs.readFileSync(rutaArchivo, 'utf-8');
      const parseada = JSON.parse(raw) as EstadoSesion;
      parseada.enEjecucion = false;
      sesionesMemoria.set(id, parseada);
      return parseada;
    } catch {
      // Si falla lectura, inicializar nueva
    }
  }

  const nueva: EstadoSesion = {
    id,
    mensajesLLM: [],
    chatVisible: [],
    tokensEntradaTotal: 0,
    tokensSalidaTotal: 0,
    mensajesPendientesConfirmacion: [],
    enEjecucion: false,
    creadoEn: new Date().toISOString(),
    actualizadoEn: new Date().toISOString(),
  };

  sesionesMemoria.set(id, nueva);
  guardarSesion(nueva, baseDir);
  return nueva;
}

export function guardarSesion(sesion: EstadoSesion, baseDir = process.cwd()): void {
  sesion.actualizadoEn = new Date().toISOString();
  sesionesMemoria.set(sesion.id, sesion);

  try {
    const dir = asegurarCarpetaSesiones(baseDir);
    const rutaArchivo = path.join(dir, `${sesion.id}.json`);
    fs.writeFileSync(rutaArchivo, JSON.stringify(sesion, null, 2), 'utf-8');
  } catch {
    // Si no se puede escribir en disco temporalmente, se mantiene en memoria
  }
}

export function intentarBloquearSesion(id: string, baseDir = process.cwd()): boolean {
  const sesion = obtenerOCrearSesion(id, baseDir);
  if (sesion.enEjecucion) return false;
  sesion.enEjecucion = true;
  guardarSesion(sesion, baseDir);
  return true;
}

export function desbloquearSesion(id: string, baseDir = process.cwd()): void {
  const sesion = obtenerOCrearSesion(id, baseDir);
  sesion.enEjecucion = false;
  guardarSesion(sesion, baseDir);
}
