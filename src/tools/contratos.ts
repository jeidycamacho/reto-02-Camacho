import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { ContratoSchema } from './lib/esquema.ts';
import { procesarExtraccion, cargarReglas, clasificarDocumento } from './lib/extraccion.ts';
import { validarContrato, resolverComercial } from './lib/validacion.ts';
import { registrarContrato, descartarContrato } from './lib/registro.ts';
import { generarReporteAlertas } from './lib/alertas.ts';
import { leerProcesados, registrarLog } from './lib/almacen.ts';

export interface ToolContext {
  directory: string;
  sessionId: string;
}

export interface ToolContract<TArgs extends Record<string, z.ZodType> = Record<string, z.ZodType>> {
  description: string;
  args: TArgs;
  execute: (args: { [K in keyof TArgs]: z.infer<TArgs[K]> }, ctx: ToolContext) => Promise<string>;
}

const mensajeIdSchema = z
  .string()
  .regex(/^[A-Za-z0-9._-]+$/, 'El mensaje_id debe cumplir con el patrón ^[A-Za-z0-9._-]+$')
  .describe('Id del mensaje del buzón, por ejemplo msg-001');

// Envoltura segura común para ejecutar herramientas y garantizar trazabilidad en log.jsonl
async function ejecutarHerramientaSegura<T>(
  herramienta: string,
  mensajeId: string,
  ctx: ToolContext,
  accion: () => Promise<T> | T
): Promise<string> {
  const ts = new Date().toISOString();
  try {
    const data = await accion();
    const resumen =
      typeof data === 'object' && data !== null && 'clasificacion' in data
        ? `Clasificación: ${(data as { clasificacion: string }).clasificacion}`
        : typeof data === 'object' && data !== null && 'id_contrato' in data
        ? `Contrato: ${(data as { id_contrato: string }).id_contrato}`
        : typeof data === 'object' && data !== null && 'mensajes' in data
        ? `${(data as { mensajes: unknown[] }).mensajes.length} mensajes en buzón`
        : 'Ejecución exitosa';

    registrarLog(
      {
        ts,
        herramienta,
        mensaje_id: mensajeId,
        ok: true,
        resumen,
      },
      ctx.directory
    );

    return JSON.stringify({ ok: true, data });
  } catch (error) {
    const mensajeError = error instanceof Error ? error.message : String(error);

    registrarLog(
      {
        ts,
        herramienta,
        mensaje_id: mensajeId,
        ok: false,
        resumen: `Error: ${mensajeError}`,
      },
      ctx.directory
    );

    return JSON.stringify({ ok: false, error: mensajeError });
  }
}

export const leer_buzon: ToolContract<Record<string, never>> = {
  description:
    'Lista los mensajes del buzón de contratos que aún no se han procesado, indicando si cada uno trae un contrato adjunto.',
  args: {},
  execute: async (_args, ctx): Promise<string> => {
    return ejecutarHerramientaSegura('contratos_leer_buzon', 'buzon', ctx, () => {
      const buzonDir = path.join(ctx.directory, 'fixtures', 'reto-02', 'buzon');
      if (!fs.existsSync(buzonDir)) {
        throw new Error(`Directorio de buzón no encontrado en: ${buzonDir}`);
      }

      const procesados = leerProcesados(ctx.directory);
      const reglas = cargarReglas(ctx.directory);
      const carpetas = fs.readdirSync(buzonDir).sort();

      const mensajes: Array<{
        id: string;
        de: string;
        asunto: string;
        fecha: string;
        adjuntos: string[];
        tiene_contrato: boolean;
        remitente_registrado: boolean;
        clasificacion_preliminar?: string;
        motivo?: string;
      }> = [];

      for (const carpeta of carpetas) {
        if (procesados[carpeta]) {
          // Ya procesado, no listar
          continue;
        }

        const rutaCorreo = path.join(buzonDir, carpeta, 'correo.json');
        if (!fs.existsSync(rutaCorreo)) continue;

        try {
          const rawCorreo = fs.readFileSync(rutaCorreo, 'utf-8');
          const correo = JSON.parse(rawCorreo) as {
            id: string;
            de: string;
            asunto: string;
            fecha: string;
            adjuntos?: string[];
          };

          const adjuntos = correo.adjuntos ?? [];
          let tieneContrato = false;

          for (const adj of adjuntos) {
            const rutaAdj = path.join(buzonDir, carpeta, adj);
            if (fs.existsSync(rutaAdj)) {
              const contenido = fs.readFileSync(rutaAdj, 'utf-8');
              const tipo = clasificarDocumento(contenido, reglas);
              if (tipo === 'contrato' || tipo === 'otrosi') {
                tieneContrato = true;
                break;
              }
            }
          }

          const { registrado } = resolverComercial(correo.de, ctx.directory);

          const item: (typeof mensajes)[number] = {
            id: correo.id ?? carpeta,
            de: correo.de ?? '',
            asunto: correo.asunto ?? '',
            fecha: correo.fecha ?? '',
            adjuntos,
            tiene_contrato: tieneContrato,
            remitente_registrado: registrado,
          };

          if (!tieneContrato) {
            item.clasificacion_preliminar = 'rechazado';
            item.motivo = 'El mensaje no contiene ningún adjunto de contrato ni otrosí';
          }

          mensajes.push(item);
        } catch {
          // Ignorar archivos corruptos individuales para no romper el listado
        }
      }

      return { mensajes };
    });
  },
};

export const extraer: ToolContract<{
  mensaje_id: typeof mensajeIdSchema;
}> = {
  description:
    'Extrae del contrato adjunto a un mensaje los campos del maestro con su confianza [0,1] y la evidencia textual de cada uno.',
  args: {
    mensaje_id: mensajeIdSchema,
  },
  execute: async (args, ctx): Promise<string> => {
    return ejecutarHerramientaSegura('contratos_extraer', args.mensaje_id, ctx, () => {
      const resultado = procesarExtraccion(args.mensaje_id, ctx.directory);
      return {
        mensaje_id: resultado.mensaje_id,
        adjunto: resultado.adjunto,
        contrato: resultado.contrato,
        advertencias: resultado.advertencias,
      };
    });
  },
};

export const validar: ToolContract<{
  mensaje_id: typeof mensajeIdSchema;
  contrato: typeof ContratoSchema;
}> = {
  description:
    'Clasifica un contrato extraído como nuevo, actualizacion, duplicado o rechazado contra el maestro y lista los campos que requieren revisión humana.',
  args: {
    mensaje_id: mensajeIdSchema,
    contrato: ContratoSchema,
  },
  execute: async (args, ctx): Promise<string> => {
    return ejecutarHerramientaSegura('contratos_validar', args.mensaje_id, ctx, () => {
      return validarContrato(args.mensaje_id, args.contrato, ctx.directory);
    });
  },
};

export const registrar: ToolContract<{
  mensaje_id: typeof mensajeIdSchema;
  contrato: typeof ContratoSchema;
  confirmado: z.ZodOptional<z.ZodBoolean>;
}> = {
  description:
    'Escribe o actualiza el contrato en el maestro, lo archiva y deja historial; rechaza si hay campos en revisión sin confirmado=true.',
  args: {
    mensaje_id: mensajeIdSchema,
    contrato: ContratoSchema,
    confirmado: z
      .boolean()
      .optional()
      .describe('true solo si la persona confirmó explícitamente en su último mensaje los campos en revisión'),
  },
  execute: async (args, ctx): Promise<string> => {
    return ejecutarHerramientaSegura('contratos_registrar', args.mensaje_id, ctx, () => {
      return registrarContrato(args.mensaje_id, args.contrato, args.confirmado ?? false, ctx.directory);
    });
  },
};

export const descartar: ToolContract<{
  mensaje_id: typeof mensajeIdSchema;
  motivo: z.ZodString;
}> = {
  description:
    'Cierra un mensaje clasificado como duplicado o rechazado sin escribir en el maestro, dejando el motivo registrado.',
  args: {
    mensaje_id: mensajeIdSchema,
    motivo: z
      .string()
      .describe('Motivo breve del descarte'),
  },
  execute: async (args, ctx): Promise<string> => {
    return ejecutarHerramientaSegura('contratos_descartar', args.mensaje_id, ctx, () => {
      return descartarContrato(args.mensaje_id, args.motivo, ctx.directory);
    });
  },
};

export const alertas: ToolContract<{
  hoy: z.ZodString;
}> = {
  description:
    'Genera out/alertas.md con contratos que vencen en 60 días o menos, pólizas exigidas no vigentes y contratos registrados desde el corte del maestro.',
  args: {
    hoy: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'La fecha debe tener formato YYYY-MM-DD')
      .describe('Fecha de referencia con formato YYYY-MM-DD'),
  },
  execute: async (args, ctx): Promise<string> => {
    return ejecutarHerramientaSegura('contratos_alertas', 'alertas', ctx, () => {
      return generarReporteAlertas(args.hoy, ctx.directory);
    });
  },
};
