import { z } from 'zod';

export const PaisEnum = z.enum(['CO', 'EC', 'PE', 'PA', 'HN']);
export type Pais = z.infer<typeof PaisEnum>;

export const MonedaEnum = z.enum(['COP', 'USD', 'PEN', 'PAB', 'HNL']);
export type Moneda = z.infer<typeof MonedaEnum>;

export const EstadoPolizaEnum = z.enum(['vigente', 'pendiente', 'vencida', 'no_aplica']);
export type EstadoPoliza = z.infer<typeof EstadoPolizaEnum>;

export const FuenteEnum = z.enum(['buzon', 'manual', 'migracion']);
export type Fuente = z.infer<typeof FuenteEnum>;

const fechaRegex = /^\d{4}-\d{2}-\d{2}$/;

export const ContratoSchema = z
  .object({
    id_contrato: z
      .string()
      .nullable()
      .describe('Número del contrato tal como aparece en el documento o código generado'),
    cliente: z
      .string()
      .nullable()
      .describe('Razón social de la contraparte'),
    nit_cliente: z
      .string()
      .nullable()
      .describe('Identificador tributario sin puntos ni dígito de verificación'),
    pais: PaisEnum
      .nullable()
      .describe('Código ISO del país de la contraparte (CO, EC, PE, PA, HN)'),
    objeto: z
      .string()
      .max(200, 'El objeto debe tener como máximo 200 caracteres')
      .nullable()
      .describe('Objeto del contrato (máx. 200 caracteres)'),
    valor: z
      .number()
      .nonnegative('El valor debe ser mayor o igual a 0')
      .nullable()
      .describe('Valor numérico total sin separadores; 0 si es por demanda'),
    moneda: MonedaEnum
      .nullable()
      .describe('Moneda del contrato (COP, USD, PEN, PAB, HNL)'),
    fecha_inicio: z
      .string()
      .regex(fechaRegex, 'Formato de fecha inválido, debe ser YYYY-MM-DD')
      .nullable()
      .describe('Fecha de inicio del contrato en formato YYYY-MM-DD'),
    fecha_fin: z
      .string()
      .regex(fechaRegex, 'Formato de fecha inválido, debe ser YYYY-MM-DD')
      .nullable()
      .describe('Fecha de fin del contrato en formato YYYY-MM-DD'),
    requiere_poliza: z
      .boolean()
      .nullable()
      .describe('Indica si el contrato exige garantías o pólizas'),
    tipo_poliza: z
      .string()
      .nullable()
      .describe('Tipos de póliza exigidos separados por punto y coma'),
    estado_poliza: EstadoPolizaEnum
      .nullable()
      .describe('Estado de la póliza (vigente, pendiente, vencida, no_aplica)'),
    comercial: z
      .string()
      .nullable()
      .describe('Nombre del ejecutivo comercial resuelto'),
    ruta_sharepoint: z
      .string()
      .nullable()
      .describe('Ruta relativa en out/sharepoint/'),
    fecha_registro: z
      .string()
      .regex(fechaRegex, 'Formato de fecha inválido, debe ser YYYY-MM-DD')
      .nullable()
      .describe('Fecha en que se registra el contrato en el maestro'),
    fuente: FuenteEnum
      .nullable()
      .describe('Origen del registro (buzon, manual, migracion)'),
    valor_indeterminado: z
      .boolean()
      .nullable()
      .optional()
      .describe('True si el contrato es por demanda o sin valor fijado'),
    es_otrosi: z
      .boolean()
      .nullable()
      .optional()
      .describe('True si el documento es un otrosí, adenda o modificatorio'),
    confianza: z
      .record(z.string(), z.number().min(0).max(1))
      .describe('Nivel de confianza de extracción por campo en rango [0, 1]'),
    evidencia: z
      .record(z.string(), z.string())
      .optional()
      .describe('Evidencia textual literal de cada campo extraído'),
  })
  .describe('Contrato tal como lo devolvió contratos_extraer o contratos_validar');

export type Contrato = z.infer<typeof ContratoSchema>;
