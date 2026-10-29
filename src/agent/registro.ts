import { z } from 'zod';
import * as herramientasContratos from '../tools/contratos.ts';
import type { ToolContract, ToolContext } from '../tools/contratos.ts';
import type { EsquemaHerramienta } from '../llm/adapter.ts';

export interface HerramientaRegistrada {
  nombrePublico: string;
  nombreOriginal: string;
  descripcion: string;
  esquemaZod: z.ZodObject<Record<string, z.ZodType>>;
  esquemaJson: Record<string, unknown>;
  tool: ToolContract<Record<string, z.ZodType>>;
}

class RegistroHerramientas {
  private readonly mapa = new Map<string, HerramientaRegistrada>();

  public constructor() {
    this.registrarModulo('contratos', herramientasContratos as Record<string, unknown>);
  }

  private registrarModulo(prefijo: string, modulo: Record<string, unknown>): void {
    const nombresHerramientas = ['leer_buzon', 'extraer', 'validar', 'registrar', 'descartar', 'alertas'];

    for (const nombreOriginal of nombresHerramientas) {
      const candidato = modulo[nombreOriginal] as ToolContract<Record<string, z.ZodType>> | undefined;
      if (!candidato || typeof candidato.execute !== 'function') continue;

      const nombrePublico = `${prefijo}_${nombreOriginal}`;
      const esquemaZod = z.object(candidato.args);

      let esquemaJson: Record<string, unknown> = {};
      try {
        esquemaJson = z.toJSONSchema(esquemaZod) as Record<string, unknown>;
      } catch {
        esquemaJson = {
          type: 'object',
          properties: {},
        };
      }

      this.mapa.set(nombrePublico, {
        nombrePublico,
        nombreOriginal,
        descripcion: candidato.description,
        esquemaZod,
        esquemaJson,
        tool: candidato,
      });
    }
  }

  public obtenerEsquemas(): EsquemaHerramienta[] {
    return Array.from(this.mapa.values()).map((h) => ({
      nombre: h.nombrePublico,
      descripcion: h.descripcion,
      parametros: h.esquemaJson,
    }));
  }

  public tieneHerramienta(nombrePublico: string): boolean {
    return this.mapa.has(nombrePublico);
  }

  public obtener(nombrePublico: string): HerramientaRegistrada | undefined {
    return this.mapa.get(nombrePublico);
  }

  public async ejecutar(
    nombrePublico: string,
    argumentosRaw: unknown,
    ctx: ToolContext
  ): Promise<string> {
    const reg = this.mapa.get(nombrePublico);
    if (!reg) {
      return JSON.stringify({
        ok: false,
        error: `Herramienta desconocida: "${nombrePublico}". Herramientas disponibles: ${Array.from(this.mapa.keys()).join(', ')}`,
      });
    }

    // Validar argumentos con z.object(args).safeParse
    const parseRes = reg.esquemaZod.safeParse(argumentosRaw ?? {});
    if (!parseRes.success) {
      const issues = parseRes.error.issues.map((iss) => `${iss.path.join('.') || 'root'}: ${iss.message}`).join('; ');
      return JSON.stringify({
        ok: false,
        error: `Error de validación en argumentos de ${nombrePublico}: ${issues}`,
      });
    }

    try {
      return await reg.tool.execute(parseRes.data as never, ctx);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return JSON.stringify({
        ok: false,
        error: `Excepción en ${nombrePublico}: ${msg}`,
      });
    }
  }
}

export const registroHerramientas = new RegistroHerramientas();
