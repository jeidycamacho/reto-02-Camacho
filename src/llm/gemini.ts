import { GoogleGenAI, ThinkingLevel, type Content, type FunctionDeclaration, type Tool } from '@google/genai';
import type {
  AdaptadorLLM,
  MensajeLLM,
  EsquemaHerramienta,
  OpcionesEnvio,
  RespuestaLLM,
  LlamadaHerramienta,
} from './adapter.ts';

const CAMPOS_CONTRATO = [
  'id_contrato',
  'cliente',
  'nit_cliente',
  'pais',
  'objeto',
  'valor',
  'moneda',
  'fecha_inicio',
  'fecha_fin',
  'requiere_poliza',
  'tipo_poliza',
  'estado_poliza',
  'comercial',
  'ruta_sharepoint',
  'fecha_registro',
  'fuente',
  'valor_indeterminado',
  'es_otrosi',
];

/**
 * Sanitiza recursivamente esquemas JSON generados por zod-to-json-schema
 * para cumplir estrictamente con los requisitos de OpenAPI 3.0 de Gemini Function Calling:
 * - Quita "$schema", "$id", "additionalProperties", "propertyNames", "definitions", "$defs".
 * - Convierte campos nullable (anyOf con null o array type con null) a "nullable": true.
 * - Convierte registros parciales (confianza y evidencia) en objetos con propiedades opcionales.
 */
function sanitizarEsquemaGemini(esquema: unknown, propKey?: string): unknown {
  if (!esquema || typeof esquema !== 'object') return esquema;
  if (Array.isArray(esquema)) {
    return esquema.map((item) => sanitizarEsquemaGemini(item, propKey));
  }

  const obj = { ...(esquema as Record<string, unknown>) };

  // Eliminar palabras clave incompatibles con OpenAPI 3.0 / Gemini function calling
  delete obj['$schema'];
  delete obj['$id'];
  delete obj['additionalProperties'];
  delete obj['propertyNames'];
  delete obj['definitions'];
  delete obj['$defs'];

  // Registros parciales de confianza o evidencia: definir como objeto con propiedades opcionales
  if (propKey === 'confianza') {
    const props: Record<string, unknown> = {};
    for (const c of CAMPOS_CONTRATO) {
      props[c] = { type: 'number', description: `Confianza de ${c} [0, 1]` };
    }
    return {
      type: 'object',
      description: (obj['description'] as string) || 'Nivel de confianza de extracción por campo en rango [0, 1]',
      properties: props,
    };
  }

  if (propKey === 'evidencia') {
    const props: Record<string, unknown> = {};
    for (const c of CAMPOS_CONTRATO) {
      props[c] = { type: 'string', description: `Evidencia textual de ${c}` };
    }
    return {
      type: 'object',
      description: (obj['description'] as string) || 'Evidencia textual literal de cada campo extraído',
      properties: props,
    };
  }

  // Manejar type como array, ej. ['string', 'null'] -> type: 'string', nullable: true
  if (Array.isArray(obj['type'])) {
    const tipos = obj['type'] as string[];
    const esNullable = tipos.includes('null');
    const tipoValido = tipos.find((t) => t !== 'null') || 'string';
    obj['type'] = tipoValido;
    if (esNullable) {
      obj['nullable'] = true;
    }
  }

  // Manejar anyOf con null
  if (Array.isArray(obj['anyOf'])) {
    const anyOf = obj['anyOf'] as Array<Record<string, unknown>>;
    const tieneNull = anyOf.some((item) => item && item['type'] === 'null');
    const sinNull = anyOf.filter((item) => item && item['type'] !== 'null');

    if (sinNull.length === 1 && sinNull[0]) {
      const base = sanitizarEsquemaGemini(sinNull[0], propKey) as Record<string, unknown>;
      delete obj['anyOf'];
      Object.assign(obj, base);
      if (tieneNull) {
        obj['nullable'] = true;
      }
    } else if (sinNull.length > 1) {
      obj['anyOf'] = sinNull.map((item) => sanitizarEsquemaGemini(item, propKey));
      if (tieneNull) {
        obj['nullable'] = true;
      }
    }
  }

  // Manejar oneOf con null
  if (Array.isArray(obj['oneOf'])) {
    const oneOf = obj['oneOf'] as Array<Record<string, unknown>>;
    const tieneNull = oneOf.some((item) => item && item['type'] === 'null');
    const sinNull = oneOf.filter((item) => item && item['type'] !== 'null');

    if (sinNull.length === 1 && sinNull[0]) {
      const base = sanitizarEsquemaGemini(sinNull[0], propKey) as Record<string, unknown>;
      delete obj['oneOf'];
      Object.assign(obj, base);
      if (tieneNull) {
        obj['nullable'] = true;
      }
    } else if (sinNull.length > 1) {
      obj['oneOf'] = sinNull.map((item) => sanitizarEsquemaGemini(item, propKey));
      if (tieneNull) {
        obj['nullable'] = true;
      }
    }
  }

  // Sanitizar recursivamente properties
  if (obj['properties'] && typeof obj['properties'] === 'object') {
    const props = obj['properties'] as Record<string, unknown>;
    const sanitizedProps: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(props)) {
      sanitizedProps[k] = sanitizarEsquemaGemini(v, k);
    }
    obj['properties'] = sanitizedProps;
  }

  // Sanitizar recursivamente items si es array
  if (obj['items']) {
    obj['items'] = sanitizarEsquemaGemini(obj['items'], propKey);
  }

  // Si es un objeto sin properties, asegurar properties vacío
  if (obj['type'] === 'object' && !obj['properties']) {
    obj['properties'] = {};
  }

  return obj;
}

interface DetalleErrorLlm {
  codigoHttp: number | null;
  mensajeOriginal: string;
  detalleParaChat: string;
}

/**
 * Extrae código HTTP y mensaje original del error de @google/genai,
 * garantizando la redacción estricta de cualquier clave de API.
 */
function extraerDetalleError(error: unknown, apiKeyRedactar?: string): DetalleErrorLlm {
  let codigoHttp: number | null = null;
  let mensajeOriginal = '';

  const redactar = (texto: string): string => {
    let limpio = texto;
    if (apiKeyRedactar && apiKeyRedactar.length > 5) {
      limpio = limpio.split(apiKeyRedactar).join('[REDACTADO]');
    }
    // Redactar tokens o claves alfanuméricas largas
    return limpio.replace(/[A-Za-z0-9_-]{28,}/g, '[REDACTADO]');
  };

  if (typeof error === 'object' && error !== null) {
    const obj = error as Record<string, unknown>;
    if (typeof obj['status'] === 'number') {
      codigoHttp = obj['status'];
    } else if (typeof obj['statusCode'] === 'number') {
      codigoHttp = obj['statusCode'];
    }

    const rawMessage = typeof obj['message'] === 'string' ? obj['message'] : String(error);

    try {
      const parsed = JSON.parse(rawMessage) as {
        error?: {
          code?: number;
          message?: string;
          status?: string;
        };
      };
      if (parsed.error) {
        if (!codigoHttp && typeof parsed.error.code === 'number') {
          codigoHttp = parsed.error.code;
        }
        const statusPrefix = parsed.error.status ? `${parsed.error.status} - ` : '';
        mensajeOriginal = redactar(`${statusPrefix}${parsed.error.message ?? ''}`.trim());
      }
    } catch {
      mensajeOriginal = redactar(rawMessage);
    }

    if (!mensajeOriginal) {
      mensajeOriginal = redactar(rawMessage);
    }
  } else {
    mensajeOriginal = redactar(String(error));
  }

  // Extraer código HTTP numérico si viene en el texto
  if (!codigoHttp) {
    const match = mensajeOriginal.match(/\b(4\d\d|5\d\d)\b/);
    if (match && match[1]) {
      codigoHttp = parseInt(match[1], 10);
    }
  }

  const detalleParaChat = codigoHttp
    ? `${codigoHttp} ${mensajeOriginal}`.trim()
    : mensajeOriginal.trim();

  return { codigoHttp, mensajeOriginal, detalleParaChat };
}

const historialLlamadasTimestamp: number[] = [];

/**
 * Extrae el tiempo sugerido de espera (en segundos) de un error 429 de Gemini.
 * Busca patrones tipo "retry in 12s", "retry after 15.5s" o campos retryDelay.
 */
function extraerTiempoEspera429(error: unknown): number {
  let text = '';
  if (typeof error === 'object' && error !== null) {
    const obj = error as Record<string, unknown>;
    text = `${String(obj['message'] ?? '')} ${JSON.stringify(error)}`;
  } else {
    text = String(error);
  }

  const matchRetryIn = text.match(/retry\s+(?:in|after)\s+(\d+(?:\.\d+)?)\s*s/i);
  if (matchRetryIn && matchRetryIn[1]) {
    const seg = parseFloat(matchRetryIn[1]);
    if (!isNaN(seg) && seg > 0) return seg;
  }

  const matchRetryDelayStr = text.match(/"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/i);
  if (matchRetryDelayStr && matchRetryDelayStr[1]) {
    const seg = parseFloat(matchRetryDelayStr[1]);
    if (!isNaN(seg) && seg > 0) return seg;
  }

  const matchRetryDelayNum = text.match(/"retryDelay"\s*:\s*(\d+)/i);
  if (matchRetryDelayNum && matchRetryDelayNum[1]) {
    const val = parseFloat(matchRetryDelayNum[1]);
    if (!isNaN(val) && val > 0) {
      return val > 100 ? val / 1000 : val;
    }
  }

  return 12;
}

/**
 * Limita el ritmo de peticiones al modelo de lenguaje a LLM_MAX_RPM (por defecto 5).
 * Si se ha alcanzado la cuota por minuto, aguarda lo necesario antes de continuar y emite notificación.
 */
async function aplicarLimiteVelocidad(onNotificacion?: (detalle: string) => void): Promise<void> {
  const maxRpm = Number(process.env['LLM_MAX_RPM'] ?? 5);
  if (maxRpm <= 0) return;

  while (true) {
    const ahora = Date.now();
    while (historialLlamadasTimestamp.length > 0 && ahora - historialLlamadasTimestamp[0]! >= 60000) {
      historialLlamadasTimestamp.shift();
    }

    if (historialLlamadasTimestamp.length < maxRpm) {
      historialLlamadasTimestamp.push(Date.now());
      break;
    }

    const masAntigua = historialLlamadasTimestamp[0]!;
    const esperaMs = Math.max(1000, 60000 - (ahora - masAntigua) + 500);
    const esperaSegundos = Math.ceil(esperaMs / 1000);

    const detalleMsg = `esperando cupo del modelo (${esperaSegundos}s)`;
    console.log(`[Gemini Rate Limiter] Límite RPM alcanzado (${historialLlamadasTimestamp.length}/${maxRpm}). ${detalleMsg}`);
    if (onNotificacion) {
      onNotificacion(detalleMsg);
    }

    await new Promise((resolve) => setTimeout(resolve, esperaMs));
  }
}

export class GeminiAdaptador implements AdaptadorLLM {
  public readonly proveedor = 'google';
  public readonly modelo: string;
  private readonly ai: GoogleGenAI;
  public readonly apiKey: string;

  public constructor(modelo?: string) {
    const modeloParam = modelo ?? process.env['LLM_MODEL'] ?? 'gemini-3.8-flash';
    this.modelo = modeloParam.replace(/^models\//, '');
    this.apiKey = process.env['GEMINI_API_KEY'] ?? '';

    this.ai = new GoogleGenAI({
      apiKey: this.apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
  }

  public async generarMinimo(prompt = 'responde OK', signal?: AbortSignal): Promise<{ texto: string; ms: number }> {
    const inicio = Date.now();
    const res = await this.ai.models.generateContent({
      model: this.modelo,
      contents: prompt,
      config: {
        maxOutputTokens: 20,
        thinkingConfig: {
          thinkingLevel: ThinkingLevel.LOW,
        },
        abortSignal: signal,
      },
    });
    const ms = Date.now() - inicio;
    return {
      texto: res.text ?? 'OK',
      ms,
    };
  }

  public async enviar(
    mensajes: readonly MensajeLLM[],
    herramientas?: readonly EsquemaHerramienta[],
    opciones?: OpcionesEnvio
  ): Promise<RespuestaLLM> {
    const timeoutMs = opciones?.timeoutMs ?? Number(process.env['LLM_TIMEOUT_MS'] ?? 120000);

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

        const part = {
          functionResponse: {
            name: m.respuestaHerramienta.nombre,
            response: parsedOutput,
          },
        };

        const ultimo = contents[contents.length - 1];
        if (ultimo && ultimo.role === 'user') {
          // Si el último contenido ya es del rol user (soporte de respuestas a llamadas en paralelo),
          // agrupamos las partes dentro del mismo turno
          ultimo.parts = ultimo.parts ?? [];
          ultimo.parts.push(part);
        } else {
          contents.push({
            role: 'user',
            parts: [part],
          });
        }
        continue;
      }

      if (m.rol === 'model') {
        if (m.crudoProveedor && typeof m.crudoProveedor === 'object') {
          contents.push(m.crudoProveedor as Content);
        } else {
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

    // Preparar herramientas compatibles con Gemini Function Calling
    let toolsConfig: Tool[] | undefined = undefined;
    if (herramientas && herramientas.length > 0) {
      const decls: FunctionDeclaration[] = herramientas.map((h) => ({
        name: h.nombre,
        description: h.descripcion,
        parameters: sanitizarEsquemaGemini(h.parametros) as FunctionDeclaration['parameters'],
      }));
      toolsConfig = [{ functionDeclarations: decls }];
    }

    const systemInstruction = opciones?.systemInstruction;
    const maxOutputTokens = opciones?.maxTokens ?? Number(process.env['MAX_TOKENS_RESPUESTA'] ?? 4096);

    // Función interna para una sola ejecución con AbortController que realmente cancela la petición
    const ejecutarLlamadaUnaVez = async (): Promise<RespuestaLLM> => {
      const controller = new AbortController();
      let timedOut = false;
      const inicioLlamada = Date.now();

      const timeoutHandle = setTimeout(() => {
        timedOut = true;
        controller.abort(new Error('TIMEOUT_LLM'));
      }, timeoutMs);

      try {
        const respuesta = await this.ai.models.generateContent({
          model: this.modelo,
          contents,
          config: {
            systemInstruction,
            maxOutputTokens,
            tools: toolsConfig,
            thinkingConfig: {
              thinkingLevel: ThinkingLevel.LOW,
            },
            abortSignal: controller.signal,
            httpOptions: {
              timeout: timeoutMs,
            },
          },
        });

        clearTimeout(timeoutHandle);
        const duracionMs = Date.now() - inicioLlamada;

        const texto = respuesta.text ?? '';
        const llamadas: LlamadaHerramienta[] = [];

        // Extraer todas las functionCalls (permite llamadas en paralelo)
        const functionCalls = respuesta.functionCalls;
        if (functionCalls && Array.isArray(functionCalls)) {
          let seq = 0;
          for (const fc of functionCalls) {
            seq++;
            llamadas.push({
              id: `call_${Date.now()}_${seq}_${fc.name ?? 'tool'}`,
              nombre: fc.name ?? '',
              argumentos: (fc.args as Record<string, unknown>) ?? {},
            });
          }
        }

        const promptTokens = respuesta.usageMetadata?.promptTokenCount ?? 0;
        const candidatesTokens = respuesta.usageMetadata?.candidatesTokenCount ?? 0;

        const candidate = respuesta.candidates?.[0];
        const crudoProveedor = candidate?.content;

        // Registrar en la consola del servidor la duración de cada llamada al modelo y cuántas herramientas pidió
        console.log(
          `[Gemini Call] Modelo: ${this.modelo} | Duración: ${duracionMs}ms | Herramientas solicitadas: ${llamadas.length} | Tokens entrada: ${promptTokens}, salida: ${candidatesTokens}`
        );

        return {
          texto,
          llamadas,
          uso: {
            entrada: promptTokens,
            salida: candidatesTokens,
          },
          crudoProveedor,
        };
      } catch (err: unknown) {
        clearTimeout(timeoutHandle);
        const duracionMs = Date.now() - inicioLlamada;

        const esAbort =
          timedOut ||
          controller.signal.aborted ||
          (err instanceof Error && (err.name === 'AbortError' || err.message === 'TIMEOUT_LLM'));

        if (esAbort) {
          console.error(
            `[Gemini Call Timeout] Modelo: ${this.modelo} | Duración: ${duracionMs}ms | Cancelada por AbortController (timeout de ${timeoutMs}ms)`
          );
          const timeoutError = new Error('TIMEOUT_LLM');
          (timeoutError as unknown as Record<string, unknown>)['esTimeout'] = true;
          throw timeoutError;
        }

        console.error(
          `[Gemini Call Falló] Modelo: ${this.modelo} | Duración: ${duracionMs}ms | Error: ${err instanceof Error ? err.message : String(err)}`
        );
        throw err;
      }
    };

    // Aplicar limitador de ritmo por minuto (LLM_MAX_RPM)
    await aplicarLimiteVelocidad(opciones?.onNotificacion);

    let intentos429 = 0;
    let intentos503 = 0;

    while (true) {
      try {
        return await ejecutarLlamadaUnaVez();
      } catch (primerError: unknown) {
        const esTimeout =
          (primerError as Record<string, unknown>)?.['esTimeout'] === true ||
          (primerError instanceof Error &&
            (primerError.name === 'AbortError' ||
              primerError.message === 'TIMEOUT_LLM' ||
              primerError.message.includes('TIMEOUT_LLM')));

        // NUNCA reintentar un timeout
        if (esTimeout) {
          throw primerError;
        }

        const info = extraerDetalleError(primerError, this.apiKey);

        const es429 =
          info.codigoHttp === 429 ||
          info.mensajeOriginal.includes('429') ||
          info.mensajeOriginal.includes('RESOURCE_EXHAUSTED') ||
          info.mensajeOriginal.includes('quota');

        if (es429) {
          intentos429++;
          if (intentos429 <= 3) {
            const segSugeridos = extraerTiempoEspera429(primerError);
            const esperaTotalSeg = Math.ceil(segSugeridos) + 1; // tiempo sugerido más 1 segundo
            const esperaMs = esperaTotalSeg * 1000;

            const detalleMsg = `esperando cupo del modelo (${esperaTotalSeg}s)`;
            console.warn(
              `[Gemini 429 Retry ${intentos429}/3] Cuota excedida. ${detalleMsg}. Reintentando en ${esperaTotalSeg}s...`
            );

            if (opciones?.onNotificacion) {
              opciones.onNotificacion(detalleMsg);
            }

            await new Promise((resolve) => setTimeout(resolve, esperaMs));
            continue;
          }
        }

        const es503 =
          info.codigoHttp === 503 ||
          info.mensajeOriginal.includes('503') ||
          info.mensajeOriginal.includes('UNAVAILABLE') ||
          info.mensajeOriginal.includes('high demand');

        if (es503) {
          intentos503++;
          if (intentos503 <= 1) {
            console.warn(
              `[Gemini 503 Retry ${intentos503}/1] Servicio no disponible temporalmente. Reintentando tras 1.5s...`
            );
            await new Promise((resolve) => setTimeout(resolve, 1500));
            continue;
          }
        }

        // Manejo de error formateado para UI/Chat si se agotaron los reintentos o no es reintentable
        const { codigoHttp, mensajeOriginal, detalleParaChat } = info;

        console.error(`[Gemini Error Final] HTTP ${codigoHttp ?? 'N/A'}: ${mensajeOriginal}`);

        if (
          codigoHttp === 401 ||
          codigoHttp === 403 ||
          mensajeOriginal.includes('API_KEY_INVALID') ||
          mensajeOriginal.includes('API key not valid') ||
          mensajeOriginal.includes('invalid api key')
        ) {
          throw new Error(`Clave de API inválida o no configurada para el proveedor de lenguaje (detalle: ${detalleParaChat})`);
        }

        if (
          codigoHttp === 400 ||
          mensajeOriginal.includes('INVALID_ARGUMENT') ||
          mensajeOriginal.includes('400') ||
          mensajeOriginal.includes('bad request')
        ) {
          throw new Error(`solicitud rechazada por el modelo (detalle: ${detalleParaChat})`);
        }

        if (
          codigoHttp === 429 ||
          mensajeOriginal.includes('RESOURCE_EXHAUSTED') ||
          mensajeOriginal.includes('Quota exceeded') ||
          mensajeOriginal.includes('429')
        ) {
          throw new Error(`Se ha excedido la cuota de peticiones al modelo de lenguaje (429) (detalle: ${detalleParaChat})`);
        }

        if (
          (codigoHttp && codigoHttp >= 500 && codigoHttp < 600) ||
          mensajeOriginal.includes('500') ||
          mensajeOriginal.includes('503') ||
          mensajeOriginal.includes('UNAVAILABLE') ||
          mensajeOriginal.includes('Internal Server Error')
        ) {
          throw new Error(`El servicio del modelo de lenguaje no se encuentra disponible temporalmente (5xx) (detalle: ${detalleParaChat})`);
        }

        throw new Error(`Error en el proveedor de lenguaje: ${mensajeOriginal} (detalle: ${detalleParaChat})`);
      }
    }
  }
}

export async function ejecutarDiagnostico(adaptador?: GeminiAdaptador): Promise<{
  ok: boolean;
  modelo: string;
  ms: number;
  detalle_error: string | null;
}> {
  const ad = adaptador ?? new GeminiAdaptador();
  const inicio = Date.now();

  const llamarMinimo = async (timeoutMs = 60000): Promise<{ texto: string; ms: number }> => {
    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => {
      controller.abort(new Error('TIMEOUT_DIAGNOSTICO'));
    }, timeoutMs);
    try {
      const res = await ad.generarMinimo('responde OK', controller.signal);
      clearTimeout(timeoutHandle);
      return res;
    } catch (err) {
      clearTimeout(timeoutHandle);
      throw err;
    }
  };

  try {
    let res: { texto: string; ms: number };
    try {
      res = await llamarMinimo();
    } catch (primerError) {
      const info = extraerDetalleError(primerError, ad.apiKey);
      const es503 =
        info.codigoHttp === 503 ||
        info.mensajeOriginal.includes('503') ||
        info.mensajeOriginal.includes('UNAVAILABLE') ||
        info.mensajeOriginal.includes('high demand');
      const es429 =
        info.codigoHttp === 429 ||
        info.mensajeOriginal.includes('429') ||
        info.mensajeOriginal.includes('RESOURCE_EXHAUSTED') ||
        info.mensajeOriginal.includes('quota');

      if (es503 || es429) {
        console.warn(`[Gemini Diagnóstico Retry] Reintentando tras error ${info.codigoHttp ?? '503/429'}...`);
        await new Promise((r) => setTimeout(r, 1500));
        res = await llamarMinimo();
      } else {
        throw primerError;
      }
    }

    return {
      ok: true,
      modelo: ad.modelo,
      ms: Date.now() - inicio,
      detalle_error: null,
    };
  } catch (error) {
    const ms = Date.now() - inicio;
    const { detalleParaChat, mensajeOriginal } = extraerDetalleError(error, ad.apiKey);
    const errorFinal = detalleParaChat || mensajeOriginal || (error instanceof Error ? error.message : String(error));
    return {
      ok: false,
      modelo: ad.modelo,
      ms,
      detalle_error: errorFinal,
    };
  }
}

export function crearAdaptadorLLM(modelo?: string): AdaptadorLLM {
  return new GeminiAdaptador(modelo);
}
