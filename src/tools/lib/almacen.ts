import fs from 'node:fs';
import path from 'node:path';
import type { Contrato } from './esquema.ts';

export interface FilaMaestro {
  id_contrato: string;
  cliente: string;
  nit_cliente: string;
  pais: string;
  objeto: string;
  valor: number;
  moneda: string;
  fecha_inicio: string;
  fecha_fin: string;
  requiere_poliza: boolean;
  tipo_poliza: string;
  estado_poliza: string;
  comercial: string;
  ruta_sharepoint: string;
  fecha_registro: string;
  fuente: string;
  estado_registro?: 'nuevo' | 'actualizado' | 'original';
}

export interface RegistroProcesado {
  ts: string;
  mensaje_id: string;
  accion: 'registrado' | 'actualizado' | 'descartado';
  motivo?: string;
  id_contrato?: string;
}

export interface CambioHistorial {
  antes: string | number | boolean | null;
  despues: string | number | boolean | null;
  origen: 'extraccion' | 'maestro' | 'confirmacion_humana';
}

export interface EntradaHistorial {
  ts: string;
  id_contrato: string;
  accion: 'nuevo' | 'actualizacion';
  cambios: Record<string, CambioHistorial>;
  mensaje_id: string;
}

export interface LogToolCall {
  ts: string;
  herramienta: string;
  mensaje_id: string;
  ok: boolean;
  resumen: string;
}

export const COLUMNAS_MAESTRO: (keyof FilaMaestro)[] = [
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
];

export function asegurarDirectorios(baseDir = process.cwd()): void {
  const outDir = path.join(baseDir, 'out');
  const sharepointDir = path.join(outDir, 'sharepoint');
  const contratosDir = path.join(sharepointDir, 'Contratos');

  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  if (!fs.existsSync(sharepointDir)) fs.mkdirSync(sharepointDir, { recursive: true });
  if (!fs.existsSync(contratosDir)) fs.mkdirSync(contratosDir, { recursive: true });
}

export function asegurarMaestro(baseDir = process.cwd()): string {
  asegurarDirectorios(baseDir);
  const rutaMaestroOut = path.join(baseDir, 'out', 'sharepoint', 'maestro-contratos.csv');

  if (!fs.existsSync(rutaMaestroOut)) {
    const rutaFixture = path.join(baseDir, 'fixtures', 'reto-02', 'maestro-contratos.csv');
    if (!fs.existsSync(rutaFixture)) {
      throw new Error(`Fixture maestro no encontrado en: ${rutaFixture}`);
    }
    fs.copyFileSync(rutaFixture, rutaMaestroOut);
  }

  return rutaMaestroOut;
}

export function parsearLineaCSV(linea: string): string[] {
  const celdas: string[] = [];
  let enComillas = false;
  let valorActual = '';

  for (let i = 0; i < linea.length; i++) {
    const c = linea[i];
    if (c === '"') {
      if (enComillas && linea[i + 1] === '"') {
        valorActual += '"';
        i++;
      } else {
        enComillas = !enComillas;
      }
    } else if (c === ',' && !enComillas) {
      celdas.push(valorActual);
      valorActual = '';
    } else {
      valorActual += c;
    }
  }
  celdas.push(valorActual);
  return celdas;
}

export function escaparCeldaCSV(valor: string | number | boolean | null | undefined): string {
  if (valor === null || valor === undefined) return '';
  const str = String(valor);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function leerMaestro(baseDir = process.cwd()): FilaMaestro[] {
  const rutaMaestro = asegurarMaestro(baseDir);
  const contenido = fs.readFileSync(rutaMaestro, 'utf-8').trim();
  if (!contenido) return [];

  const lineas = contenido.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lineas.length <= 1) return [];

  let fechaCorteMaestro = '2026-05-30';
  try {
    const rutaReglas = path.join(baseDir, 'src', 'knowledge', 'reglas.json');
    if (fs.existsSync(rutaReglas)) {
      const rawReglas = JSON.parse(fs.readFileSync(rutaReglas, 'utf-8')) as { fecha_corte_maestro?: string };
      if (rawReglas.fecha_corte_maestro) {
        fechaCorteMaestro = rawReglas.fecha_corte_maestro;
      }
    }
  } catch {
    // fallback
  }

  const idsActualizados = new Set<string>();
  try {
    const rutaHistorial = path.join(baseDir, 'out', 'sharepoint', 'historial.jsonl');
    if (fs.existsSync(rutaHistorial)) {
      const lineasHistorial = fs.readFileSync(rutaHistorial, 'utf-8').split(/\r?\n/);
      for (const line of lineasHistorial) {
        if (!line.trim()) continue;
        try {
          const entry = JSON.parse(line) as { id_contrato?: string; accion?: string };
          if (entry.id_contrato && (entry.accion === 'actualizacion' || entry.accion === 'actualizado')) {
            idsActualizados.add(entry.id_contrato);
          }
        } catch {
          // ignora errores de formato individual
        }
      }
    }
  } catch {
    // ignora
  }

  const filas: FilaMaestro[] = [];

  for (let i = 1; i < lineas.length; i++) {
    const linea = lineas[i];
    if (!linea) continue;
    const celdas = parsearLineaCSV(linea);

    const idContrato = celdas[0] ?? '';
    const fechaReg = celdas[14] ?? '';

    let estadoRegistro: 'nuevo' | 'actualizado' | 'original' = 'original';
    if (idsActualizados.has(idContrato)) {
      estadoRegistro = 'actualizado';
    } else if (fechaReg && fechaReg > fechaCorteMaestro) {
      estadoRegistro = 'nuevo';
    }

    filas.push({
      id_contrato: idContrato,
      cliente: celdas[1] ?? '',
      nit_cliente: celdas[2] ?? '',
      pais: celdas[3] ?? '',
      objeto: celdas[4] ?? '',
      valor: Number(celdas[5] ?? 0),
      moneda: celdas[6] ?? '',
      fecha_inicio: celdas[7] ?? '',
      fecha_fin: celdas[8] ?? '',
      requiere_poliza: (celdas[9] ?? '').toLowerCase() === 'true',
      tipo_poliza: celdas[10] ?? '',
      estado_poliza: celdas[11] ?? 'no_aplica',
      comercial: celdas[12] ?? '',
      ruta_sharepoint: celdas[13] ?? '',
      fecha_registro: fechaReg,
      fuente: celdas[15] ?? 'buzon',
      estado_registro: estadoRegistro,
    });
  }

  return filas;
}

export function escribirMaestroAtomico(filas: readonly FilaMaestro[], baseDir = process.cwd()): void {
  asegurarDirectorios(baseDir);
  const rutaMaestro = path.join(baseDir, 'out', 'sharepoint', 'maestro-contratos.csv');
  const rutaTmp = path.join(baseDir, 'out', 'sharepoint', `maestro-contratos.tmp.${Date.now()}`);

  const header = COLUMNAS_MAESTRO.join(',');
  const lineasCSV = filas.map((f) =>
    COLUMNAS_MAESTRO.map((col) => escaparCeldaCSV(f[col])).join(',')
  );

  const contenido = [header, ...lineasCSV].join('\n') + '\n';
  fs.writeFileSync(rutaTmp, contenido, 'utf-8');
  fs.renameSync(rutaTmp, rutaMaestro);
}

export function leerProcesados(baseDir = process.cwd()): Record<string, RegistroProcesado> {
  asegurarDirectorios(baseDir);
  const ruta = path.join(baseDir, 'out', 'procesados.json');
  if (!fs.existsSync(ruta)) {
    return {};
  }
  try {
    const raw = fs.readFileSync(ruta, 'utf-8');
    return JSON.parse(raw) as Record<string, RegistroProcesado>;
  } catch {
    return {};
  }
}

export function marcarProcesado(registro: RegistroProcesado, baseDir = process.cwd()): void {
  const procesados = leerProcesados(baseDir);
  procesados[registro.mensaje_id] = registro;

  const ruta = path.join(baseDir, 'out', 'procesados.json');
  fs.writeFileSync(ruta, JSON.stringify(procesados, null, 2), 'utf-8');
}

export function registrarEnHistorial(entrada: EntradaHistorial, baseDir = process.cwd()): void {
  asegurarDirectorios(baseDir);
  const ruta = path.join(baseDir, 'out', 'sharepoint', 'historial.jsonl');
  fs.appendFileSync(ruta, JSON.stringify(entrada) + '\n', 'utf-8');
}

export function registrarLog(log: LogToolCall, baseDir = process.cwd()): void {
  asegurarDirectorios(baseDir);
  const ruta = path.join(baseDir, 'out', 'log.jsonl');
  fs.appendFileSync(ruta, JSON.stringify(log) + '\n', 'utf-8');
}

export function generarSlug(texto: string): string {
  return texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function archivarDocumentoContrato(
  mensajeId: string,
  nombreAdjunto: string,
  idContrato: string,
  cliente: string,
  fechaInicio: string,
  esOtrosi: boolean,
  baseDir = process.cwd()
): string {
  asegurarDirectorios(baseDir);

  const rutaOrigen = path.join(baseDir, 'fixtures', 'reto-02', 'buzon', mensajeId, nombreAdjunto);
  if (!fs.existsSync(rutaOrigen)) {
    throw new Error(`Adjunto de origen no existe: ${rutaOrigen}`);
  }

  const anio = fechaInicio ? fechaInicio.split('-')[0] ?? '2026' : '2026';
  const clienteSlug = generarSlug(cliente);
  const carpetaDestino = path.join(baseDir, 'out', 'sharepoint', 'Contratos', anio, clienteSlug);

  if (!fs.existsSync(carpetaDestino)) {
    fs.mkdirSync(carpetaDestino, { recursive: true });
  }

  const extOriginal = path.extname(nombreAdjunto) || '.txt';
  let nombreArchivoFinal = `${idContrato}${extOriginal.toLowerCase() === '.txt' ? '.pdf' : extOriginal}`;
  if (esOtrosi) {
    nombreArchivoFinal = `${idContrato}_otrosi_${mensajeId}${extOriginal}`;
  }

  const rutaDestinoAbs = path.join(carpetaDestino, nombreArchivoFinal);
  fs.copyFileSync(rutaOrigen, rutaDestinoAbs);

  return `Contratos/${anio}/${clienteSlug}/${nombreArchivoFinal}`;
}
