import fs from 'node:fs';
import path from 'node:path';
import type { Contrato, Pais, Moneda, EstadoPoliza } from './esquema.ts';

export interface ReglasNegocio {
  umbral_confianza: number;
  umbral_similitud_objeto: number;
  dias_alerta_vencimiento: number;
  fecha_corte_maestro: string;
  niveles_confianza: {
    etiquetado: number;
    patron: number;
    inferido: number;
    derivado: number;
    ambiguo: number;
    ausente: number;
  };
  fuente_extraccion: {
    regla_fuente: string;
    confianza_maxima_solo_correo: number;
  };
  paises: Record<string, {
    nombre: string;
    tipo_identificador: string;
    longitud_identificador?: number;
    requiere_digito_verificacion?: boolean;
    ciudades_clave?: string[];
  }>;
  monedas: Record<string, {
    simbolos: string[];
    palabras: string[];
  }>;
  vocabularios: {
    contrato: {
      marcas_documento: {
        contrato: string[];
        otrosi: string[];
      };
      marcas_no_contrato: string[];
      palabras_valor_indeterminado: string[];
      frases_no_requiere_poliza: string[];
      tipos_poliza: Record<string, {
        clave_maestro: string;
        palabras_clave: string[];
      }>;
    };
    correo: {
      pistas_poliza: string[];
      pistas_no_poliza: string[];
      pistas_otrosi: string[];
      pistas_no_contrato: string[];
    };
  };
}

export interface CampoExtraccion<T> {
  valor: T;
  confianza: number;
  evidencia?: string;
}

export interface CorreoData {
  id: string;
  de: string;
  para: string;
  asunto: string;
  fecha: string;
  cuerpo: string;
  adjuntos: string[];
}

export interface ResultadoExtraccion {
  mensaje_id: string;
  adjunto: string;
  contrato: Contrato;
  advertencias: string[];
}

export type TipoDocumento = 'contrato' | 'otrosi' | 'no_contrato';

let reglasCache: ReglasNegocio | null = null;

export function cargarReglas(baseDir = process.cwd()): ReglasNegocio {
  if (reglasCache) return reglasCache;
  const rutaReglas = path.join(baseDir, 'src', 'knowledge', 'reglas.json');
  if (!fs.existsSync(rutaReglas)) {
    throw new Error(`Archivo de reglas no encontrado en: ${rutaReglas}`);
  }
  const raw = fs.readFileSync(rutaReglas, 'utf-8');
  reglasCache = JSON.parse(raw) as ReglasNegocio;
  return reglasCache;
}

export function clasificarDocumento(texto: string, reglas: ReglasNegocio): TipoDocumento {
  const normalizado = texto.toUpperCase();

  for (const marca of reglas.vocabularios.contrato.marcas_no_contrato) {
    if (normalizado.includes(marca.toUpperCase())) {
      return 'no_contrato';
    }
  }

  for (const marca of reglas.vocabularios.contrato.marcas_documento.otrosi) {
    if (normalizado.includes(marca.toUpperCase())) {
      return 'otrosi';
    }
  }

  for (const marca of reglas.vocabularios.contrato.marcas_documento.contrato) {
    if (normalizado.includes(marca.toUpperCase())) {
      return 'contrato';
    }
  }

  return 'no_contrato';
}

const MESES: Record<string, number> = {
  enero: 1,
  febrero: 2,
  marzo: 3,
  abril: 4,
  mayo: 5,
  junio: 6,
  julio: 7,
  agosto: 8,
  septiembre: 9,
  setiembre: 9,
  octubre: 10,
  noviembre: 11,
  diciembre: 12,
};

function normalizarTextoEspacios(texto: string): string {
  return texto.replace(/\s+/g, ' ').trim();
}

function formatearFecha(year: number, month: number, day: number): string {
  const y = String(year);
  const m = String(month).padStart(2, '0');
  const d = String(day).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function parsearFechaEspanol(texto: string): string | null {
  const regexFecha = /(?:el\s+)?([a-záéíóú0-9\s()]+?)\s+de\s+(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)\s+de\s+(\d{4})/i;
  const match = regexFecha.exec(texto);
  if (!match) return null;

  const diaRaw = match[1]?.trim().toLowerCase() ?? '';
  const mesNombre = match[2]?.trim().toLowerCase() ?? '';
  const anio = Number(match[3]);

  let dia = 1;
  const matchNum = /\b(\d{1,2})\b/.exec(diaRaw);
  if (matchNum && matchNum[1]) {
    dia = Number(matchNum[1]);
  } else if (diaRaw.includes('primero')) {
    dia = 1;
  }

  const mes = MESES[mesNombre];
  if (!mes || isNaN(anio) || isNaN(dia)) return null;

  return formatearFecha(anio, mes, dia);
}

function obtenerUltimoDiaMes(anio: number, mes: number): number {
  return new Date(Date.UTC(anio, mes, 0)).getUTCDate();
}

function sumarMesesCalendario(fechaIso: string, mesesASumar: number): string {
  const partes = fechaIso.split('-');
  const anio = Number(partes[0]);
  const mes = Number(partes[1]);
  const dia = Number(partes[2]);

  const nuevoAnio = anio + Math.floor((mes - 1 + mesesASumar) / 12);
  const nuevoMes = ((mes - 1 + mesesASumar) % 12) + 1;
  const maxDias = obtenerUltimoDiaMes(nuevoAnio, nuevoMes);
  const nuevoDia = Math.min(dia, maxDias);

  return formatearFecha(nuevoAnio, nuevoMes, nuevoDia);
}

function aislarClausula(texto: string, encabezados: readonly string[]): string {
  for (const enc of encabezados) {
    // Coincidir tanto cláusula normal como modificatoria de otrosí
    // Ej: "SEGUNDA. VALOR" o "SEGUNDA. Modificar la cláusula SEGUNDA (VALOR)"
    const regex = new RegExp(
      `(?:^|\\n)\\s*(?:[A-ZÁÉÍÓÚ0-9]+\\.\\s*)?(?:(?:Modificar\\s+[^.\\n]*?\\b${enc}\\b|${enc})\\.?)[\\s\\S]*?(?=(?:\\n\\s*(?:[A-ZÁÉÍÓÚ0-9]+\\.\\s*[A-ZÁÉÍÓÚ]+|Para constancia|Se firma|EL CONTRATANTE)|$))`,
      'i'
    );
    const m = regex.exec(texto);
    if (m && m[0]) {
      return m[0].trim();
    }
  }
  return '';
}

// 1. id_contrato
export function extraerIdContrato(texto: string, esOtrosi: boolean, reglas: ReglasNegocio): CampoExtraccion<string | null> {
  if (esOtrosi) {
    const regexOtrosi = /(?:al\s+(?:contrato(?:\s+de\s+prestaci[oó]n\s+de\s+servicios)?\s+)?No\.?\s*)([A-Z0-9.-]+)/i;
    const match = regexOtrosi.exec(texto);
    if (match && match[1]) {
      return {
        valor: match[1].trim(),
        confianza: reglas.niveles_confianza.etiquetado,
        evidencia: match[0].trim(),
      };
    }
  }

  const regexContrato = /(?:CONTRATO(?:\s+MARCO)?(?:\s+DE\s+PRESTACI[OÓ]N\s+DE\s+SERVICIOS)?\s+No\.?\s*)([A-Z0-9.-]+)/i;
  const match = regexContrato.exec(texto);
  if (match && match[1]) {
    return {
      valor: match[1].trim(),
      confianza: reglas.niveles_confianza.etiquetado,
      evidencia: match[0].trim(),
    };
  }

  const regexGenerico = /(?:No\.\s*)([A-Z]+-\d{4}-\d+)/i;
  const mGen = regexGenerico.exec(texto);
  if (mGen && mGen[1]) {
    return {
      valor: mGen[1].trim(),
      confianza: reglas.niveles_confianza.patron,
      evidencia: mGen[0].trim(),
    };
  }

  return {
    valor: null,
    confianza: reglas.niveles_confianza.ausente,
  };
}

export function normalizarNombreCliente(nombre: string): string {
  let limpio = nombre.trim().replace(/\s+/g, ' ').replace(/[,;]+$/, '').trim();

  const sufijos = [
    { regex: /\bS\.?\s*A\.?\s*S\.?/gi, canonico: 'S.A.S.' },
    { regex: /\bS\.?\s*A\.?\s*C\.?/gi, canonico: 'S.A.C.' },
    { regex: /\bS\.?\s*A\.?(?!\s*S|\s*C)/gi, canonico: 'S.A.' },
    { regex: /\bS\.?\s*de\s*R\.?\s*L\.?/gi, canonico: 'S. de R.L.' },
    { regex: /\bLTDA\.?/gi, canonico: 'Ltda.' },
  ];

  let sufijoEncontrado = '';
  for (const s of sufijos) {
    if (s.regex.test(limpio)) {
      sufijoEncontrado = s.canonico;
      limpio = limpio.replace(s.regex, '').trim();
      break;
    }
  }

  const conectores = new Set(['de', 'del', 'la', 'las', 'el', 'los', 'y', 'e', 'en']);
  const palabras = limpio.split(/\s+/).map((p, idx) => {
    const pLower = p.toLowerCase();
    if (idx > 0 && conectores.has(pLower)) {
      return pLower;
    }
    return p.charAt(0).toUpperCase() + p.slice(1).toLowerCase();
  });

  const base = palabras.join(' ').trim();
  return sufijoEncontrado ? `${base} ${sufijoEncontrado}` : base;
}

// 2. cliente (NUNCA Periferia IT Group)
export function extraerCliente(texto: string, reglas: ReglasNegocio): CampoExtraccion<string | null> {
  const regexPartes = /Entre(?:\s+los\s+suscritos,)?\s+([^,]+?),\s*(?:identificada\s+con\s+|NIT|RUC|RTN)/i;
  const match = regexPartes.exec(texto);
  if (match && match[1]) {
    const candidato = match[1].trim();
    if (!/PERIFERIA\s+IT\s+GROUP/i.test(candidato)) {
      return {
        valor: normalizarNombreCliente(candidato),
        confianza: reglas.niveles_confianza.etiquetado,
        evidencia: match[0].trim(),
      };
    }
  }

  const regexContratante = /([A-ZÁÉÍÓÚ\s.,-]+?)(?:,|\s+)(?:identificada\s+con\s+(?:NIT|RUC|RTN)[^,]+?,\s*.*?quien\s+en\s+adelante\s+se\s+denominar[aá]\s+EL\s+CONTRATANTE)/i;
  const mContratante = regexContratante.exec(texto);
  if (mContratante && mContratante[1]) {
    const cand = mContratante[1].trim();
    if (!/PERIFERIA\s+IT\s+GROUP/i.test(cand)) {
      return {
        valor: normalizarNombreCliente(cand),
        confianza: reglas.niveles_confianza.etiquetado,
        evidencia: mContratante[0].trim(),
      };
    }
  }

  return {
    valor: null,
    confianza: reglas.niveles_confianza.ausente,
  };
}

// 3. nit_cliente y país
export function extraerNitCliente(texto: string, reglas: ReglasNegocio): {
  nit: CampoExtraccion<string | null>;
  pais: CampoExtraccion<Pais | null>;
} {
  const regexIdent = /(NIT|RUC|RTN)\s+([0-9.-]+)/gi;
  let match: RegExpExecArray | null;

  while ((match = regexIdent.exec(texto)) !== null) {
    const tipo = (match[1] ?? '').toUpperCase();
    const numeroRaw = match[2] ?? '';

    // Descartar NIT de Periferia IT Group (900.123.456-7)
    if (numeroRaw.includes('900.123.456') || numeroRaw.replace(/\D/g, '') === '900123456') {
      continue;
    }

    if (tipo === 'NIT') {
      // Colombia: remover puntos y dígito de verificación
      const sinPuntos = numeroRaw.replace(/\./g, '');
      const nitLimpio = sinPuntos.includes('-') ? (sinPuntos.split('-')[0] ?? sinPuntos) : sinPuntos;
      return {
        nit: {
          valor: nitLimpio.trim(),
          confianza: reglas.niveles_confianza.patron,
          evidencia: match[0].trim(),
        },
        pais: {
          valor: 'CO',
          confianza: reglas.niveles_confianza.patron,
          evidencia: `Identificador NIT en ${match[0]}`,
        },
      };
    }

    if (tipo === 'RUC') {
      const digitos = numeroRaw.replace(/\D/g, '');
      if (digitos.length === 13 || /Ecuador|Quito|Guayaquil/i.test(texto)) {
        return {
          nit: {
            valor: digitos,
            confianza: reglas.niveles_confianza.patron,
            evidencia: match[0].trim(),
          },
          pais: {
            valor: 'EC',
            confianza: reglas.niveles_confianza.patron,
            evidencia: `RUC de Ecuador: ${match[0]}`,
          },
        };
      }
      if (digitos.length === 11 || /Per[uú]|Lima/i.test(texto)) {
        return {
          nit: {
            valor: digitos,
            confianza: reglas.niveles_confianza.patron,
            evidencia: match[0].trim(),
          },
          pais: {
            valor: 'PE',
            confianza: reglas.niveles_confianza.patron,
            evidencia: `RUC de Perú: ${match[0]}`,
          },
        };
      }
      // Panamá
      const valorPanama = numeroRaw.replace(/\./g, '');
      return {
        nit: {
          valor: valorPanama,
          confianza: reglas.niveles_confianza.patron,
          evidencia: match[0].trim(),
        },
        pais: {
          valor: 'PA',
          confianza: reglas.niveles_confianza.patron,
          evidencia: `RUC de Panamá: ${match[0]}`,
        },
      };
    }

    if (tipo === 'RTN') {
      const digitos = numeroRaw.replace(/\D/g, '');
      return {
        nit: {
          valor: digitos,
          confianza: reglas.niveles_confianza.patron,
          evidencia: match[0].trim(),
        },
        pais: {
          valor: 'HN',
          confianza: reglas.niveles_confianza.patron,
          evidencia: `RTN de Honduras: ${match[0]}`,
        },
      };
    }
  }

  return {
    nit: { valor: null, confianza: reglas.niveles_confianza.ausente },
    pais: { valor: null, confianza: reglas.niveles_confianza.ausente },
  };
}

// 4. objeto (máx. 200 caracteres, en otrosí queda null)
export function extraerObjeto(texto: string, esOtrosi: boolean, reglas: ReglasNegocio): CampoExtraccion<string | null> {
  if (esOtrosi) {
    return {
      valor: null,
      confianza: reglas.niveles_confianza.ausente,
    };
  }

  const cuerpoObjeto = aislarClausula(texto, ['OBJETO', 'OBJETO DEL CONTRATO']);
  if (cuerpoObjeto) {
    let limpio = normalizarTextoEspacios(cuerpoObjeto);
    if (limpio.length > 200) {
      limpio = limpio.slice(0, 197).trim() + '...';
    }
    return {
      valor: limpio,
      confianza: reglas.niveles_confianza.etiquetado,
      evidencia: cuerpoObjeto.slice(0, 150).trim(),
    };
  }

  return {
    valor: null,
    confianza: reglas.niveles_confianza.ausente,
  };
}

// 5. valor y moneda (SOLO cláusula VALOR/PRECIO, nunca GARANTÍAS)
export function extraerValorYMoneda(texto: string, pais: Pais | null, reglas: ReglasNegocio): {
  valor: CampoExtraccion<number | null>;
  moneda: CampoExtraccion<Moneda | null>;
  valor_indeterminado: boolean;
} {
  let cuerpoValor = aislarClausula(texto, ['VALOR', 'PRECIO', 'VALOR DEL CONTRATO']);
  if (!cuerpoValor) {
    const matchModValor = /(?:Modificar[^.\n]*?\bVALOR\b[^\n]*?)([\s\S]*?)(?=(?:\n\s*[A-ZÁÉÍÓÚ0-9]+\.|\n\s*Se firma|\n\s*Para constancia|$))/i.exec(texto);
    if (matchModValor) {
      cuerpoValor = matchModValor[0].trim();
    }
  }
  if (!cuerpoValor) {
    return {
      valor: { valor: null, confianza: reglas.niveles_confianza.ausente },
      moneda: { valor: null, confianza: reglas.niveles_confianza.ausente },
      valor_indeterminado: false,
    };
  }

  const normalizado = cuerpoValor.toLowerCase();

  // Caso: Valor indeterminado / por demanda
  for (const palabra of reglas.vocabularios.contrato.palabras_valor_indeterminado) {
    if (normalizado.includes(palabra.toLowerCase())) {
      let monedaInferida: Moneda | null = null;
      let confMoneda = reglas.niveles_confianza.inferido;

      // Buscar si menciona explícitamente alguna moneda en el cuerpo de valor
      for (const [cod, def] of Object.entries(reglas.monedas)) {
        for (const pal of def.palabras) {
          if (normalizado.includes(pal.toLowerCase())) {
            monedaInferida = cod as Moneda;
            confMoneda = reglas.niveles_confianza.etiquetado;
            break;
          }
        }
        if (monedaInferida) break;
      }

      if (!monedaInferida && pais) {
        if (pais === 'CO') monedaInferida = 'COP';
        else if (pais === 'EC') monedaInferida = 'USD';
        else if (pais === 'PE') monedaInferida = 'PEN';
        else if (pais === 'PA') monedaInferida = 'PAB';
        else if (pais === 'HN') monedaInferida = 'HNL';
      }

      return {
        valor: {
          valor: 0,
          confianza: reglas.niveles_confianza.ambiguo,
          evidencia: cuerpoValor.trim(),
        },
        moneda: {
          valor: monedaInferida,
          confianza: confMoneda,
          evidencia: cuerpoValor.trim(),
        },
        valor_indeterminado: true,
      };
    }
  }

  // Detectar moneda explícita
  let monedaDetectada: Moneda | null = null;
  let evidenciaMoneda = '';

  if (/\b(?:USD|D[OÓ]LARES)\b/i.test(cuerpoValor)) {
    monedaDetectada = 'USD';
    evidenciaMoneda = 'USD';
  } else if (/\b(?:COP|PESOS)\b/i.test(cuerpoValor)) {
    monedaDetectada = 'COP';
    evidenciaMoneda = 'COP';
  } else if (/\b(?:PEN|SOLES|S\/\.?)\b/i.test(cuerpoValor)) {
    monedaDetectada = 'PEN';
    evidenciaMoneda = 'PEN';
  } else if (/\b(?:PAB|BALBOAS)\b/i.test(cuerpoValor)) {
    monedaDetectada = 'PAB';
    evidenciaMoneda = 'PAB';
  } else if (/\b(?:HNL|LEMPIRAS)\b/i.test(cuerpoValor)) {
    monedaDetectada = 'HNL';
    evidenciaMoneda = 'HNL';
  }

  // Verificar si hay monedas no soportadas (ej. EUR, GBP)
  if (/\b(?:EUR|EUROS|GBP|LIBRAS|JPY)\b/i.test(cuerpoValor)) {
    throw new Error('Moneda detectada fuera de COP/USD/PEN/PAB/HNL; no soportada');
  }

  let confMoneda = reglas.niveles_confianza.etiquetado;
  if (!monedaDetectada && pais) {
    if (pais === 'CO') monedaDetectada = 'COP';
    else if (pais === 'EC') monedaDetectada = 'USD';
    else if (pais === 'PE') monedaDetectada = 'PEN';
    else if (pais === 'PA') monedaDetectada = 'PAB';
    else if (pais === 'HN') monedaDetectada = 'HNL';
    confMoneda = reglas.niveles_confianza.inferido;
    evidenciaMoneda = `Inferida por país ${pais}`;
  }

  // Extraer número monetario
  const regexMonto = /(?:COP\s*\$|USD\s*|PEN\s*|\$\s*)([0-9]{1,3}(?:[.,][0-9]{3})*(?:[.,][0-9]{2})?)/i;
  const matchMonto = regexMonto.exec(cuerpoValor);

  let valorNum: number | null = null;
  let evidenciaValor = cuerpoValor;

  if (matchMonto && matchMonto[1]) {
    const rawNum = matchMonto[1];
    evidenciaValor = matchMonto[0];
    if (rawNum.includes(',') && rawNum.includes('.')) {
      if (rawNum.indexOf(',') < rawNum.indexOf('.')) {
        // Formato 120,000.00
        valorNum = parseFloat(rawNum.replace(/,/g, ''));
      } else {
        // Formato 120.000,00
        valorNum = parseFloat(rawNum.replace(/\./g, '').replace(',', '.'));
      }
    } else if (rawNum.includes('.')) {
      // Formato colombiano o con miles: 265.000.000
      valorNum = parseFloat(rawNum.replace(/\./g, ''));
    } else if (rawNum.includes(',')) {
      valorNum = parseFloat(rawNum.replace(/,/g, ''));
    } else {
      valorNum = parseFloat(rawNum);
    }
  }

  if (valorNum !== null && !isNaN(valorNum)) {
    return {
      valor: {
        valor: valorNum,
        confianza: reglas.niveles_confianza.etiquetado,
        evidencia: evidenciaValor.trim(),
      },
      moneda: {
        valor: monedaDetectada,
        confianza: confMoneda,
        evidencia: evidenciaMoneda,
      },
      valor_indeterminado: false,
    };
  }

  return {
    valor: { valor: null, confianza: reglas.niveles_confianza.ausente },
    moneda: { valor: monedaDetectada, confianza: confMoneda, evidencia: evidenciaMoneda },
    valor_indeterminado: false,
  };
}

// 6. fecha_inicio (de PLAZO "desde" o firma "a partir de la fecha de su firma")
export function extraerFechaInicio(texto: string, reglas: ReglasNegocio): CampoExtraccion<string | null> {
  const cuerpoPlazo = aislarClausula(texto, ['PLAZO', 'DURACIÓN', 'VIGENCIA']);
  if (cuerpoPlazo) {
    // Buscar "desde el ..."
    const regexDesde = /desde\s+(?:el\s+)?([a-záéíóú0-9\s()]+?\s+de\s+[a-z]+\s+de\s+\d{4})/i;
    const matchDesde = regexDesde.exec(cuerpoPlazo);
    if (matchDesde && matchDesde[1]) {
      const parsed = parsearFechaEspanol(matchDesde[1]);
      if (parsed) {
        return {
          valor: parsed,
          confianza: reglas.niveles_confianza.etiquetado,
          evidencia: matchDesde[0].trim(),
        };
      }
    }

    // Caso: "a partir de la fecha de su firma"
    if (/a\s+partir\s+de\s+la\s+fecha\s+de\s+su\s+firma/i.test(cuerpoPlazo)) {
      const regexFirma = /Se\s+firma\s+en[^,\n]+,\s+(?:en\s+el\s+mes\s+de\s+([a-z]+)\s+de\s+(\d{4})|a\s+los\s+([a-z0-9\s()]+)\s+d[ií]as\s+del\s+mes\s+de\s+([a-z]+)\s+de\s+(\d{4}))/i;
      const matchFirma = regexFirma.exec(texto);

      if (matchFirma) {
        if (matchFirma[1] && matchFirma[2]) {
          // Solo mes y año: usar el ÚLTIMO día de ese mes
          const mesNom = matchFirma[1].toLowerCase();
          const anio = Number(matchFirma[2]);
          const mesNum = MESES[mesNom];
          if (mesNum && !isNaN(anio)) {
            const ultimoDia = obtenerUltimoDiaMes(anio, mesNum);
            return {
              valor: formatearFecha(anio, mesNum, ultimoDia),
              confianza: reglas.niveles_confianza.inferido,
              evidencia: matchFirma[0].trim(),
            };
          }
        } else if (matchFirma[3] && matchFirma[4] && matchFirma[5]) {
          const parsed = parsearFechaEspanol(`el ${matchFirma[3]} de ${matchFirma[4]} de ${matchFirma[5]}`);
          if (parsed) {
            return {
              valor: parsed,
              confianza: reglas.niveles_confianza.inferido,
              evidencia: matchFirma[0].trim(),
            };
          }
        }
      }
    }
  }

  return {
    valor: null,
    confianza: reglas.niveles_confianza.ausente,
  };
}

// 7. fecha_fin (de PLAZO "hasta" o cálculo en meses)
export function extraerFechaFin(
  texto: string,
  fechaInicio: string | null,
  reglas: ReglasNegocio
): {
  fecha_fin: CampoExtraccion<string | null>;
  advertenciaProrroga?: string;
} {
  let cuerpoPlazo = aislarClausula(texto, ['PLAZO', 'DURACIÓN', 'VIGENCIA']);
  if (!cuerpoPlazo) {
    const matchModPlazo = /(?:Modificar[^.\n]*?\bPLAZO\b[^\n]*?)([\s\S]*?)(?=(?:\n\s*[A-ZÁÉÍÓÚ0-9]+\.|\n\s*Se firma|\n\s*Para constancia|$))/i.exec(texto);
    if (matchModPlazo) {
      cuerpoPlazo = matchModPlazo[0].trim();
    }
  }
  let advertenciaProrroga: string | undefined;

  if (cuerpoPlazo && /prorrogables\s+autom[aá]ticamente/i.test(cuerpoPlazo)) {
    advertenciaProrroga = 'El contrato menciona prórroga automática';
  }

  if (cuerpoPlazo) {
    // Buscar "hasta el ..."
    const regexHasta = /hasta\s+(?:el\s+)?([a-záéíóú0-9\s()]+?\s+de\s+[a-z]+\s+de\s+\d{4})/i;
    const matchHasta = regexHasta.exec(cuerpoPlazo);
    if (matchHasta && matchHasta[1]) {
      const parsed = parsearFechaEspanol(matchHasta[1]);
      if (parsed) {
        return {
          fecha_fin: {
            valor: parsed,
            confianza: reglas.niveles_confianza.etiquetado,
            evidencia: matchHasta[0].trim(),
          },
          advertenciaProrroga,
        };
      }
    }

    // Plazo en meses (ej. "doce (12) meses")
    const regexMeses = /(?:duraci[oó]n|plazo)\s+(?:de\s+ejecuci[oó]n\s+)?(?:ser[aá]\s+)?(?:de\s+)?([a-z0-9\s()]+?)\s+meses/i;
    const matchMeses = regexMeses.exec(cuerpoPlazo);

    if (matchMeses && fechaInicio) {
      const strMeses = matchMeses[1] ?? '';
      let cantidadMeses = 12;
      const numMatch = /\b(\d{1,2})\b/.exec(strMeses);
      if (numMatch && numMatch[1]) {
        cantidadMeses = Number(numMatch[1]);
      } else if (strMeses.includes('doce')) {
        cantidadMeses = 12;
      } else if (strMeses.includes('seis')) {
        cantidadMeses = 6;
      }

      const calculada = sumarMesesCalendario(fechaInicio, cantidadMeses);
      return {
        fecha_fin: {
          valor: calculada,
          confianza: reglas.niveles_confianza.derivado,
          evidencia: `${matchMeses[0]} calculados a partir de ${fechaInicio}`,
        },
        advertenciaProrroga,
      };
    }
  }

  return {
    fecha_fin: {
      valor: null,
      confianza: reglas.niveles_confianza.ausente,
    },
    advertenciaProrroga,
  };
}

// 8. requiere_poliza y tipo_poliza (de cláusula GARANTÍAS)
export function extraerGarantias(texto: string, esOtrosi: boolean, reglas: ReglasNegocio): {
  requiere_poliza: CampoExtraccion<boolean | null>;
  tipo_poliza: CampoExtraccion<string | null>;
  estado_poliza: EstadoPoliza | null;
  evidenciaOtrosiGarantias?: string;
} {
  const cuerpoGarantias = aislarClausula(texto, ['GARANTÍAS', 'GARANTIAS', 'PÓLIZAS', 'POLIZAS']);

  // En otrosí: revisar cláusula TERCERA o texto relativo a garantías
  if (esOtrosi) {
    const regexGarantiasOtrosi = /(?:garant[ií]as|p[oó]lizas)\s+de\s+([^\n.]+?)(?:,?\s*permanecen|\s+deber[aá]n\s+ampliarse)/i;
    const matchOtrosi = regexGarantiasOtrosi.exec(texto);
    if (matchOtrosi && /ampliarse/i.test(texto)) {
      const tipos: string[] = [];
      const fragmento = (matchOtrosi[1] ?? '').toLowerCase();
      if (fragmento.includes('cumplimiento')) tipos.push('cumplimiento');
      if (fragmento.includes('responsabilidad civil')) tipos.push('responsabilidad_civil');
      if (fragmento.includes('salarios')) tipos.push('salarios_prestaciones');
      if (fragmento.includes('calidad')) tipos.push('calidad');

      const tipoStr = tipos.length > 0 ? tipos.join(';') : 'cumplimiento';
      return {
        requiere_poliza: {
          valor: true,
          confianza: reglas.niveles_confianza.etiquetado,
          evidencia: matchOtrosi[0].trim(),
        },
        tipo_poliza: {
          valor: tipoStr,
          confianza: reglas.niveles_confianza.etiquetado,
          evidencia: matchOtrosi[0].trim(),
        },
        estado_poliza: 'pendiente',
        evidenciaOtrosiGarantias: matchOtrosi[0].trim(),
      };
    }
  }

  if (!cuerpoGarantias) {
    return {
      requiere_poliza: {
        valor: false,
        confianza: reglas.niveles_confianza.inferido,
        evidencia: 'Sin cláusula de garantías en el texto del contrato',
      },
      tipo_poliza: {
        valor: null,
        confianza: reglas.niveles_confianza.inferido,
      },
      estado_poliza: 'no_aplica',
    };
  }

  const normalizado = cuerpoGarantias.toLowerCase();

  for (const frase of reglas.vocabularios.contrato.frases_no_requiere_poliza) {
    if (normalizado.includes(frase.toLowerCase())) {
      return {
        requiere_poliza: {
          valor: false,
          confianza: reglas.niveles_confianza.etiquetado,
          evidencia: cuerpoGarantias.trim(),
        },
        tipo_poliza: {
          valor: null,
          confianza: reglas.niveles_confianza.etiquetado,
        },
        estado_poliza: 'no_aplica',
      };
    }
  }

  const tiposEncontrados: string[] = [];
  const tiposDef = reglas.vocabularios.contrato.tipos_poliza;

  for (const [clave, def] of Object.entries(tiposDef)) {
    for (const palabra of def.palabras_clave) {
      if (normalizado.includes(palabra.toLowerCase())) {
        tiposEncontrados.push(clave);
        break;
      }
    }
  }

  const requiere = tiposEncontrados.length > 0 || /constituir[aá]\s+p[oó]liza|p[oó]liza\s+de\s+cumplimiento/i.test(cuerpoGarantias);

  if (requiere) {
    const tiposStr = tiposEncontrados.length > 0 ? tiposEncontrados.join(';') : 'cumplimiento';
    return {
      requiere_poliza: {
        valor: true,
        confianza: reglas.niveles_confianza.etiquetado,
        evidencia: cuerpoGarantias.slice(0, 180).trim(),
      },
      tipo_poliza: {
        valor: tiposStr,
        confianza: reglas.niveles_confianza.etiquetado,
        evidencia: cuerpoGarantias.slice(0, 180).trim(),
      },
      estado_poliza: 'pendiente',
    };
  }

  return {
    requiere_poliza: {
      valor: false,
      confianza: reglas.niveles_confianza.etiquetado,
      evidencia: cuerpoGarantias.trim(),
    },
    tipo_poliza: {
      valor: null,
      confianza: reglas.niveles_confianza.etiquetado,
    },
    estado_poliza: 'no_aplica',
  };
}

export function resolverComercial(emailRemitente: string, baseDir = process.cwd()): string {
  try {
    const rutaComerciales = path.join(baseDir, 'fixtures', 'reto-02', 'comerciales.json');
    if (fs.existsSync(rutaComerciales)) {
      const data = JSON.parse(fs.readFileSync(rutaComerciales, 'utf-8')) as { email: string; nombre: string }[];
      const encontrado = data.find((c) => c.email.toLowerCase() === emailRemitente.toLowerCase());
      if (encontrado) return encontrado.nombre;
    }
  } catch {
    // Si no se encuentra o falla, devolver el correo
  }
  return emailRemitente;
}

export function procesarExtraccion(
  mensajeId: string,
  baseDir = process.cwd()
): ResultadoExtraccion {
  const reglas = cargarReglas(baseDir);
  const dirMensaje = path.join(baseDir, 'fixtures', 'reto-02', 'buzon', mensajeId);

  if (!fs.existsSync(dirMensaje)) {
    throw new Error(`El mensaje ${mensajeId} no existe en ${dirMensaje}`);
  }

  const rutaCorreo = path.join(dirMensaje, 'correo.json');
  if (!fs.existsSync(rutaCorreo)) {
    throw new Error(`El archivo correo.json no existe para el mensaje ${mensajeId}`);
  }

  const correoData = JSON.parse(fs.readFileSync(rutaCorreo, 'utf-8')) as CorreoData;

  // Recorrer TODOS los nombres de correoData.adjuntos
  let adjuntoElegido: string | null = null;
  let contenidoElegido = '';
  let tipoDocElegido: TipoDocumento = 'no_contrato';

  for (const nombreAdjunto of correoData.adjuntos) {
    const rutaAdjunto = path.join(dirMensaje, nombreAdjunto);
    if (!fs.existsSync(rutaAdjunto)) continue;

    const contenido = fs.readFileSync(rutaAdjunto, 'utf-8');
    const tipo = clasificarDocumento(contenido, reglas);

    if (tipo === 'contrato' || tipo === 'otrosi') {
      adjuntoElegido = nombreAdjunto;
      contenidoElegido = contenido;
      tipoDocElegido = tipo;
      break;
    }
  }

  if (!adjuntoElegido || tipoDocElegido === 'no_contrato') {
    throw new Error(`el mensaje ${mensajeId} no trae adjunto de contrato (adjuntos: ${correoData.adjuntos.join(', ')})`);
  }

  const esOtrosi = tipoDocElegido === 'otrosi';
  const advertencias: string[] = [];

  // Extraer campo por campo
  const idContratoCampo = extraerIdContrato(contenidoElegido, esOtrosi, reglas);
  const clienteCampo = extraerCliente(contenidoElegido, reglas);
  const { nit: nitCampo, pais: paisCampo } = extraerNitCliente(contenidoElegido, reglas);
  const objetoCampo = extraerObjeto(contenidoElegido, esOtrosi, reglas);
  const { valor: valorCampo, moneda: monedaCampo, valor_indeterminado } = extraerValorYMoneda(contenidoElegido, paisCampo.valor, reglas);
  const fechaInicioCampo = extraerFechaInicio(contenidoElegido, reglas);
  const { fecha_fin: fechaFinCampo, advertenciaProrroga } = extraerFechaFin(contenidoElegido, fechaInicioCampo.valor, reglas);
  if (advertenciaProrroga) {
    advertencias.push(advertenciaProrroga);
  }

  const garantiasResult = extraerGarantias(contenidoElegido, esOtrosi, reglas);
  const nombreComercial = resolverComercial(correoData.de, baseDir);

  const confianzaMap: Record<string, number> = {
    id_contrato: idContratoCampo.confianza,
    cliente: clienteCampo.confianza,
    nit_cliente: nitCampo.confianza,
    pais: paisCampo.confianza,
    objeto: objetoCampo.confianza,
    valor: valorCampo.confianza,
    moneda: monedaCampo.confianza,
    fecha_inicio: fechaInicioCampo.confianza,
    fecha_fin: fechaFinCampo.confianza,
    requiere_poliza: garantiasResult.requiere_poliza.confianza,
    tipo_poliza: garantiasResult.tipo_poliza.confianza,
  };

  const evidenciaMap: Record<string, string> = {};
  if (idContratoCampo.evidencia) evidenciaMap['id_contrato'] = idContratoCampo.evidencia;
  if (clienteCampo.evidencia) evidenciaMap['cliente'] = clienteCampo.evidencia;
  if (nitCampo.evidencia) evidenciaMap['nit_cliente'] = nitCampo.evidencia;
  if (paisCampo.evidencia) evidenciaMap['pais'] = paisCampo.evidencia;
  if (objetoCampo.evidencia) evidenciaMap['objeto'] = objetoCampo.evidencia;
  if (valorCampo.evidencia) evidenciaMap['valor'] = valorCampo.evidencia;
  if (monedaCampo.evidencia) evidenciaMap['moneda'] = monedaCampo.evidencia;
  if (fechaInicioCampo.evidencia) evidenciaMap['fecha_inicio'] = fechaInicioCampo.evidencia;
  if (fechaFinCampo.evidencia) evidenciaMap['fecha_fin'] = fechaFinCampo.evidencia;
  if (garantiasResult.requiere_poliza.evidencia) evidenciaMap['requiere_poliza'] = garantiasResult.requiere_poliza.evidencia;
  if (garantiasResult.tipo_poliza.evidencia) evidenciaMap['tipo_poliza'] = garantiasResult.tipo_poliza.evidencia;

  const fechaHoy = new Date().toISOString().split('T')[0] ?? '2026-09-03';

  const contrato: Contrato = {
    id_contrato: idContratoCampo.valor,
    cliente: clienteCampo.valor,
    nit_cliente: nitCampo.valor,
    pais: paisCampo.valor,
    objeto: objetoCampo.valor,
    valor: valorCampo.valor,
    moneda: monedaCampo.valor,
    fecha_inicio: fechaInicioCampo.valor,
    fecha_fin: fechaFinCampo.valor,
    requiere_poliza: garantiasResult.requiere_poliza.valor,
    tipo_poliza: garantiasResult.tipo_poliza.valor,
    estado_poliza: null,
    comercial: null,
    ruta_sharepoint: null,
    fecha_registro: fechaHoy,
    fuente: 'buzon',
    valor_indeterminado,
    es_otrosi: esOtrosi,
    confianza: confianzaMap,
    evidencia: evidenciaMap,
  };

  return {
    mensaje_id: mensajeId,
    adjunto: adjuntoElegido,
    contrato,
    advertencias,
  };
}
