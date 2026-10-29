import { GoogleGenAI, type Content, type FunctionDeclaration, type Tool } from '@google/genai';
import type {
  AdaptadorLLM,
  MensajeLLM,
  EsquemaHerramienta,
  OpcionesEnvio,
  RespuestaLLM,
  LlamadaHerramienta,
} from './adapter.ts';

export class GeminiAdaptador implements AdaptadorLLM {
  public readonly proveedor = 'google';
  public readonly modelo: string;
  private readonly ai: GoogleGenAI;

  public constructor(modelo?: string) {
    this.modelo = modelo ?? process.env['LLM_MODEL'] ?? 'gemini-3.8-flash';
    const apiKey = process.env['GEMINI_API_KEY'] ?? '';

    this.ai = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
  }

  public async enviar(
    mensajes: readonly MensajeLLM[],
    herramientas?: readonly EsquemaHerramienta[],
    opciones?: OpcionesEnvio
  ): Promise<RespuestaLLM> {
    const timeoutMs = opciones?.timeoutMs ?? Number(process.env['LLM_TIMEOUT_MS'] ?? 60000);

    // Preparar contenidos para el SDK
    const contents: Content[] = [];

    for (const m of mensajes) {
      if (m.rol === 'system') continue;

      if (m.rol === 'tool' && m.respuestaHerramienta) {
        let parsedOutput: Record<string, unknown>;
        try {
          parsedOutput = JSON.parse(m.respuestaHerramienta.contenido) as Record<string, unknown>;
        } catch {
          parsedOutput = { output: m.respuestaHerramienta.contenido };
        }

        contents.push({
          role: 'user',
          parts: [
            {
              functionResponse: {
                name: m.respuestaHerramienta.nombre,
                response: parsedOutput,
              },
            },
          ],
        });
        continue;
      }

      if (m.rol === 'model') {
        const parts: Content['parts'] = [];
        if (m.texto) {
          parts.push({ text: m.texto });
        }
        if (m.llamadas && m.llamadas.length > 0) {
          for (const ll of m.llamadas) {
            parts.push({
              functionCall: {
                name: ll.nombre,
                args: ll.argumentos,
              },
            });
          }
        }
        if (parts.length > 0) {
          contents.push({ role: 'model', parts });
        }
        continue;
      }

      // Mensaje de usuario
      if (m.texto) {
        contents.push({
          role: 'user',
          parts: [{ text: m.texto }],
        });
      }
    }

    // Preparar herramientas
    let toolsConfig: Tool[] | undefined = undefined;
    if (herramientas && herramientas.length > 0) {
      const decls: FunctionDeclaration[] = herramientas.map((h) => ({
        name: h.nombre,
        description: h.descripcion,
        parameters: h.parametros as FunctionDeclaration['parameters'],
      }));
      toolsConfig = [{ functionDeclarations: decls }];
    }

    const systemInstruction = opciones?.systemInstruction;
    const maxOutputTokens = opciones?.maxTokens ?? Number(process.env['MAX_TOKENS_RESPUESTA'] ?? 4096);

    // Timeout seguro con Promise.race
    const llamadaConTimeout = async (): Promise<RespuestaLLM> => {
      let timeoutHandle: NodeJS.Timeout | null = null;
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(() => {
          reject(new Error('TIMEOUT_LLM'));
        }, timeoutMs);
      });

      try {
        const ejecucionPromise = this.ai.models.generateContent({
          model: this.modelo,
          contents,
          config: {
            systemInstruction,
            maxOutputTokens,
            tools: toolsConfig,
          },
        });

        const respuesta = await Promise.race([ejecucionPromise, timeoutPromise]);
        if (timeoutHandle) clearTimeout(timeoutHandle);

        const texto = respuesta.text ?? '';
        const llamadas: LlamadaHerramienta[] = [];

        // Extraer functionCalls
        const functionCalls = respuesta.functionCalls;
        if (functionCalls && Array.isArray(functionCalls)) {
          let seq = 0;
          for (const fc of functionCalls) {
            seq++;
            llamadas.push({
              id: `call_${Date.now()}_${seq}`,
              nombre: fc.name ?? '',
              argumentos: (fc.args as Record<string, unknown>) ?? {},
            });
          }
        }

        const promptTokens = respuesta.usageMetadata?.promptTokenCount ?? 0;
        const candidatesTokens = respuesta.usageMetadata?.candidatesTokenCount ?? 0;

        return {
          texto,
          llamadas,
          uso: {
            entrada: promptTokens,
            salida: candidatesTokens,
          },
        };
      } catch (err) {
        if (timeoutHandle) clearTimeout(timeoutHandle);
        throw err;
      }
    };

    try {
      return await llamadaConTimeout();
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);

      if (msg === 'TIMEOUT_LLM' || msg.includes('timeout') || msg.includes('ETIMEDOUT')) {
        throw new Error('Tiempo de espera agotado al consultar el modelo de lenguaje.');
      }
      if (msg.includes('API_KEY_INVALID') || msg.includes('API key not valid') || msg.includes('invalid api key')) {
        throw new Error('Clave de API inválida o no configurada para el proveedor de lenguaje.');
      }
      if (msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED') || msg.includes('Quota exceeded')) {
        throw new Error('Se ha excedido la cuota de peticiones al modelo de lenguaje (429). Por favor intente más tarde.');
      }
      if (msg.includes('500') || msg.includes('503') || msg.includes('Internal Server Error') || msg.includes('Unavailable')) {
        throw new Error('El servicio del modelo de lenguaje no se encuentra disponible temporalmente (5xx).');
      }

      // Remover cualquier posible fragmento de la clave del mensaje de error
      const sanitized = msg.replace(/[a-zA-Z0-9_-]{20,}/g, '[REDACTADO]');
      throw new Error(`Error en el proveedor de lenguaje: ${sanitized}`);
    }
  }
}

export function crearAdaptadorLLM(modelo?: string): AdaptadorLLM {
  return new GeminiAdaptador(modelo);
}
