import { GoogleGenAI, type Content, type FunctionDeclaration, type Tool } from '@google/genai';
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

export class GeminiAdaptador implements AdaptadorLLM {
  public readonly proveedor = 'google';
  public readonly modelo: string;
  private readonly ai: GoogleGenAI;
  private readonly apiKey: string;

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
      try {
        return await llamadaConTimeout();
      } catch (primerError) {
        const info = extraerDetalleError(primerError, this.apiKey);
        // Si es 503 UNAVAILABLE (pico temporal de demanda), intentar 1 reintento con breve pausa
        if (info.codigoHttp === 503 || info.mensajeOriginal.includes('UNAVAILABLE') || info.mensajeOriginal.includes('high demand')) {
          await new Promise((r) => setTimeout(r, 1200));
          return await llamadaConTimeout();
        }
        throw primerError;
      }
    } catch (error) {
      const { codigoHttp, mensajeOriginal, detalleParaChat } = extraerDetalleError(error, this.apiKey);

      // 1) Registrar en consola del servidor código HTTP y mensaje original (sin la clave)
      console.error(`[Gemini Error] HTTP ${codigoHttp ?? 'N/A'}: ${mensajeOriginal}`);

      // Casos específicos:
      if (mensajeOriginal === 'TIMEOUT_LLM' || mensajeOriginal.includes('TIMEOUT_LLM') || mensajeOriginal.includes('ETIMEDOUT')) {
        throw new Error(`Tiempo de espera agotado al consultar el modelo de lenguaje (detalle: TIMEOUT)`);
      }

      if (
        codigoHttp === 401 ||
        codigoHttp === 403 ||
        mensajeOriginal.includes('API_KEY_INVALID') ||
        mensajeOriginal.includes('API key not valid') ||
        mensajeOriginal.includes('invalid api key')
      ) {
        throw new Error(`Clave de API inválida o no configurada para el proveedor de lenguaje (detalle: ${detalleParaChat})`);
      }

      // 2) No clasificar como 5xx un error 400; 400 debe decir "solicitud rechazada por el modelo"
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

export function crearAdaptadorLLM(modelo?: string): AdaptadorLLM {
  return new GeminiAdaptador(modelo);
}
