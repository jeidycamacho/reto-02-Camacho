export type RolMensaje = 'user' | 'model' | 'system' | 'tool';

export interface LlamadaHerramienta {
  id: string;
  nombre: string;
  argumentos: Record<string, unknown>;
}

export interface RespuestaHerramienta {
  llamadaId: string;
  nombre: string;
  contenido: string;
}

export interface MensajeLLM {
  rol: RolMensaje;
  texto?: string;
  llamadas?: LlamadaHerramienta[];
  respuestaHerramienta?: RespuestaHerramienta;
  crudoProveedor?: unknown;
}

export interface EsquemaHerramienta {
  nombre: string;
  descripcion: string;
  parametros: Record<string, unknown>;
}

export interface UsoTokens {
  entrada: number;
  salida: number;
}

export interface RespuestaLLM {
  texto: string;
  llamadas: LlamadaHerramienta[];
  uso: UsoTokens;
  crudoProveedor?: unknown;
}

export interface OpcionesEnvio {
  timeoutMs?: number;
  maxTokens?: number;
  systemInstruction?: string;
  onNotificacion?: (detalle: string) => void;
}

export interface AdaptadorLLM {
  readonly proveedor: string;
  readonly modelo: string;
  enviar(
    mensajes: readonly MensajeLLM[],
    herramientas?: readonly EsquemaHerramienta[],
    opciones?: OpcionesEnvio
  ): Promise<RespuestaLLM>;
}
