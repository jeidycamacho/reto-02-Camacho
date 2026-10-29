import fs from 'node:fs';
import path from 'node:path';
import type { Contrato, Pais, Moneda, EstadoPoliza } from './esquema.ts';
import { cargarReglas } from './extraccion.ts';
import { leerMaestro, type FilaMaestro } from './almacen.ts';

export interface DetalleRevisionItem {
  campo: string;
  valor_propuesto: string | number | boolean | null;
  motivo: string;
  confianza: number;
  evidencia: string;
}

export interface ResultadoValidacion {
  clasificacion: 'nuevo' | 'actualizacion' | 'duplicado' | 'rechazado';
  motivo: string;
  id_contrato_existente: string | null;
  requiere_revision: string[];
  detalle_revision: DetalleRevisionItem[];
  diferencias: Record<string, { maestro: unknown; extraido: unknown }>;
  advertencias: string[];
  comercial: string;
  contrato_resultante: Contrato;
}

export function normalizarTexto(texto: string): string {
  return texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function calcularSimilitud(textoA: string, textoB: string): number {
  const normA = normalizarTexto(textoA);
  const normB = normalizarTexto(textoB);
  if (!normA && !normB) return 1.0;
  if (!normA || !normB) return 0.0;
  if (normA === normB) return 1.0;

  const obtenerBigramas = (str: string): Set<string> => {
    const bigramas = new Set<string>();
    for (let i = 0; i < str.length - 1; i++) {
      bigramas.add(str.slice(i, i + 2));
    }
    return bigramas;
  };

  const bA = obtenerBigramas(normA);
  const bB = obtenerBigramas(normB);
  if (bA.size === 0 || bB.size === 0) return 0.0;

  let interseccion = 0;
  for (const b of bA) {
    if (bB.has(b)) interseccion++;
  }
  return (2.0 * interseccion) / (bA.size + bB.size);
}

export function resolverComercial(emailRemitente: string, baseDir = process.cwd()): { nombre: string; registrado: boolean } {
  try {
    const rutaComerciales = path.join(baseDir, 'fixtures', 'reto-02', 'comerciales.json');
    if (fs.existsSync(rutaComerciales)) {
      const data = JSON.parse(fs.readFileSync(rutaComerciales, 'utf-8')) as { email: string; nombre: string }[];
      const encontrado = data.find((c) => c.email.toLowerCase() === emailRemitente.toLowerCase());
      if (encontrado) {
        return { nombre: encontrado.nombre, registrado: true };
      }
    }
  } catch {
    // Si falla o no existe
  }
  return { nombre: emailRemitente, registrado: false };
}

export function validarContrato(
  mensajeId: string,
  contrato: Contrato,
  baseDir = process.cwd()
): ResultadoValidacion {
  const reglas = cargarReglas(baseDir);
  const maestro = leerMaestro(baseDir);
  const advertencias: string[] = [];

  // Obtener remitente del correo
  let emailRemitente = '';
  try {
    const rutaCorreo = path.join(baseDir, 'fixtures', 'reto-02', 'buzon', mensajeId, 'correo.json');
    if (fs.existsSync(rutaCorreo)) {
      const correo = JSON.parse(fs.readFileSync(rutaCorreo, 'utf-8')) as { de: string };
      emailRemitente = correo.de;
    }
  } catch {
    // Manejo silencioso si es prueba directa
  }

  const { nombre: comercialResuelto, registrado: comercialRegistrado } = resolverComercial(emailRemitente, baseDir);
  if (!comercialRegistrado && emailRemitente) {
    advertencias.push(`Remitente ${emailRemitente} no registrado en comerciales.json`);
  }

  // 1. Buscar en el maestro
  let filaEncontrada: FilaMaestro | null = null;

  if (contrato.id_contrato) {
    const idBusqueda = contrato.id_contrato.toUpperCase();
    filaEncontrada = maestro.find((f) => f.id_contrato.toUpperCase() === idBusqueda) ?? null;
  }

  if (!filaEncontrada && contrato.nit_cliente && contrato.objeto) {
    const nitLimpio = contrato.nit_cliente.replace(/\D/g, '');
    for (const f of maestro) {
      if (f.nit_cliente.replace(/\D/g, '') === nitLimpio) {
        const sim = calcularSimilitud(f.objeto, contrato.objeto);
        if (sim >= reglas.umbral_similitud_objeto) {
          filaEncontrada = f;
          break;
        }
      }
    }
  }

  let clasificacion: 'nuevo' | 'actualizacion' | 'duplicado' | 'rechazado' = 'nuevo';
  let motivo = 'Contrato nuevo sin coincidencias previas en el maestro';
  let idExistente: string | null = null;
  const diferencias: Record<string, { maestro: unknown; extraido: unknown }> = {};
  const requiereRevisionSet = new Set<string>();
  const detalleRevisionMap = new Map<string, DetalleRevisionItem>();

  const contratoResultante: Contrato = {
    ...contrato,
    comercial: comercialResuelto,
    confianza: { ...contrato.confianza },
    evidencia: { ...contrato.evidencia },
  };

  if (filaEncontrada) {
    idExistente = filaEncontrada.id_contrato;

    // RN1: Duplicado exacto
    const mismoValor = Math.abs(filaEncontrada.valor - (contrato.valor ?? 0)) < 0.01;
    const mismaFechaInicio = filaEncontrada.fecha_inicio === (contrato.fecha_inicio ?? '');
    const mismaFechaFin = filaEncontrada.fecha_fin === (contrato.fecha_fin ?? '');

    if (!contrato.es_otrosi && mismoValor && mismaFechaInicio && mismaFechaFin) {
      clasificacion = 'duplicado';
      motivo = `El contrato ya existe en el maestro (${filaEncontrada.id_contrato}) con id, valor y fechas idénticos`;
      contratoResultante.estado_poliza = filaEncontrada.estado_poliza as EstadoPoliza;
    } else if (contrato.es_otrosi) {
      // RN2: Otrosí
      clasificacion = 'actualizacion';
      motivo = `Otrosí que modifica el contrato existente ${filaEncontrada.id_contrato}`;

      // Heredar campos null del maestro con confianza 1
      if (!contratoResultante.objeto) {
        contratoResultante.objeto = filaEncontrada.objeto;
        contratoResultante.confianza['objeto'] = 1.0;
        if (contratoResultante.evidencia) contratoResultante.evidencia['objeto'] = 'Heredado del maestro';
      }
      if (!contratoResultante.fecha_inicio) {
        contratoResultante.fecha_inicio = filaEncontrada.fecha_inicio;
        contratoResultante.confianza['fecha_inicio'] = 1.0;
        if (contratoResultante.evidencia) contratoResultante.evidencia['fecha_inicio'] = 'Heredado del maestro';
      }
      if (contratoResultante.valor === null) {
        contratoResultante.valor = filaEncontrada.valor;
        contratoResultante.confianza['valor'] = 1.0;
      }
      if (!contratoResultante.moneda) {
        contratoResultante.moneda = filaEncontrada.moneda as Moneda;
        contratoResultante.confianza['moneda'] = 1.0;
      }
      if (!contratoResultante.cliente) {
        contratoResultante.cliente = filaEncontrada.cliente;
        contratoResultante.confianza['cliente'] = 1.0;
      }
      if (!contratoResultante.nit_cliente) {
        contratoResultante.nit_cliente = filaEncontrada.nit_cliente;
        contratoResultante.confianza['nit_cliente'] = 1.0;
      }
      if (!contratoResultante.pais) {
        contratoResultante.pais = filaEncontrada.pais as Pais;
        contratoResultante.confianza['pais'] = 1.0;
      }
      if (contratoResultante.requiere_poliza === null) {
        contratoResultante.requiere_poliza = filaEncontrada.requiere_poliza;
      }
      if (contratoResultante.tipo_poliza === null) {
        contratoResultante.tipo_poliza = filaEncontrada.tipo_poliza;
      }

      // RN8: Otrosí que amplía plazo de contrato con póliza -> estado_poliza = pendiente
      if (filaEncontrada.requiere_poliza || contratoResultante.requiere_poliza) {
        contratoResultante.estado_poliza = 'pendiente';
      } else {
        contratoResultante.estado_poliza = 'no_aplica';
      }

      // Comparar diferencias para trazabilidad
      if (filaEncontrada.valor !== contratoResultante.valor) {
        diferencias['valor'] = { maestro: filaEncontrada.valor, extraido: contratoResultante.valor };
      }
      if (filaEncontrada.fecha_fin !== contratoResultante.fecha_fin) {
        diferencias['fecha_fin'] = { maestro: filaEncontrada.fecha_fin, extraido: contratoResultante.fecha_fin };
      }
    } else {
      // Reenvío distinto que no es otrosí -> actualización con conflictos
      clasificacion = 'actualizacion';
      motivo = `Reenvío de contrato existente ${filaEncontrada.id_contrato} con diferencias`;

      const camposComparar: (keyof FilaMaestro)[] = ['valor', 'fecha_inicio', 'fecha_fin', 'objeto', 'requiere_poliza', 'tipo_poliza'];
      for (const col of camposComparar) {
        const valM = filaEncontrada[col];
        const valC = contrato[col as keyof Contrato];
        if (valC !== null && valC !== undefined && String(valM) !== String(valC)) {
          diferencias[col] = { maestro: valM, extraido: valC };
          requiereRevisionSet.add(col);
          detalleRevisionMap.set(col, {
            campo: col,
            valor_propuesto: valC as string | number | boolean | null,
            motivo: `Conflicto con valor en maestro (maestro: "${valM}")`,
            confianza: contrato.confianza[col] ?? 0.5,
            evidencia: `Valor en maestro: ${valM}`,
          });
        }
      }

      contratoResultante.estado_poliza = filaEncontrada.estado_poliza as EstadoPoliza;
    }
  } else {
    // No existe en el maestro
    if (contrato.es_otrosi) {
      clasificacion = 'rechazado';
      motivo = 'Otrosí sin contrato base registrado en el maestro';
    } else {
      clasificacion = 'nuevo';
      motivo = 'Contrato nuevo para registro en el maestro';
      contratoResultante.estado_poliza = contrato.requiere_poliza ? 'pendiente' : 'no_aplica';
    }
  }

  // 2. Evaluar campos con baja confianza (< umbral_confianza)
  for (const [campo, conf] of Object.entries(contratoResultante.confianza)) {
    if (conf < reglas.umbral_confianza && conf > 0) {
      const val = contratoResultante[campo as keyof Contrato];
      requiereRevisionSet.add(campo);

      let motivoDuda = `Confianza de extracción (${conf}) inferior al umbral (${reglas.umbral_confianza})`;
      if (campo === 'valor' && contratoResultante.valor_indeterminado) {
        motivoDuda = 'Contrato marco con valor indeterminado / por demanda (se propone 0)';
      } else if (campo === 'fecha_fin' && conf === reglas.niveles_confianza.derivado) {
        motivoDuda = 'Fecha fin calculada por plazo de meses sin fecha fija explícita';
      }

      detalleRevisionMap.set(campo, {
        campo,
        valor_propuesto: (val as string | number | boolean | null) ?? null,
        motivo: motivoDuda,
        confianza: conf,
        evidencia: contratoResultante.evidencia?.[campo] ?? '',
      });
    }
  }

  // 3. Validar incoherencias lógicas
  if (contratoResultante.fecha_inicio && contratoResultante.fecha_fin) {
    if (contratoResultante.fecha_fin < contratoResultante.fecha_inicio) {
      requiereRevisionSet.add('fecha_fin');
      detalleRevisionMap.set('fecha_fin', {
        campo: 'fecha_fin',
        valor_propuesto: contratoResultante.fecha_fin,
        motivo: `Incoherencia: fecha de fin (${contratoResultante.fecha_fin}) es anterior a inicio (${contratoResultante.fecha_inicio})`,
        confianza: 0,
        evidencia: `inicio: ${contratoResultante.fecha_inicio}, fin: ${contratoResultante.fecha_fin}`,
      });
    }
  }

  if (contratoResultante.requiere_poliza && (!contratoResultante.tipo_poliza || contratoResultante.tipo_poliza.trim() === '')) {
    requiereRevisionSet.add('tipo_poliza');
    detalleRevisionMap.set('tipo_poliza', {
      campo: 'tipo_poliza',
      valor_propuesto: null,
      motivo: 'El contrato exige póliza pero no se especificó ningún tipo de garantía',
      confianza: 0,
      evidencia: 'Cláusula de garantías sin tipo determinado',
    });
  }

  return {
    clasificacion,
    motivo,
    id_contrato_existente: idExistente,
    requiere_revision: Array.from(requiereRevisionSet),
    detalle_revision: Array.from(detalleRevisionMap.values()),
    diferencias,
    advertencias,
    comercial: comercialResuelto,
    contrato_resultante: contratoResultante,
  };
}
