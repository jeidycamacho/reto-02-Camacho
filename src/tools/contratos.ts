import { z } from 'zod';
import { ContratoSchema } from './lib/esquema.ts';

export interface ToolContext {
  directory: string;
  sessionId: string;
}

export interface ToolContract<TArgs extends Record<string, z.ZodType> = Record<string, z.ZodType>> {
  description: string;
  args: TArgs;
  execute: (args: { [K in keyof TArgs]: z.infer<TArgs[K]> }, ctx: ToolContext) => Promise<string>;
}

const DEFAULT_STUB_RESPONSE = JSON.stringify({ ok: false, error: 'no implementado' });

const mensajeIdSchema = z
  .string()
  .regex(/^[A-Za-z0-9._-]+$/, 'El mensaje_id debe cumplir con el patrón ^[A-Za-z0-9._-]+$')
  .describe('Id del mensaje del buzón, por ejemplo msg-001');

export const leer_buzon: ToolContract<Record<string, never>> = {
  description:
    'Lista los mensajes del buzón de contratos que aún no se han procesado, indicando si cada uno trae un contrato adjunto.',
  args: {},
  execute: async (_args, _ctx): Promise<string> => {
    return DEFAULT_STUB_RESPONSE;
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
  execute: async (_args, _ctx): Promise<string> => {
    return DEFAULT_STUB_RESPONSE;
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
  execute: async (_args, _ctx): Promise<string> => {
    return DEFAULT_STUB_RESPONSE;
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
  execute: async (_args, _ctx): Promise<string> => {
    return DEFAULT_STUB_RESPONSE;
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
  execute: async (_args, _ctx): Promise<string> => {
    return DEFAULT_STUB_RESPONSE;
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
  execute: async (_args, _ctx): Promise<string> => {
    return DEFAULT_STUB_RESPONSE;
  },
};
