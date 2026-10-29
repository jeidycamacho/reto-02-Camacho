import fs from 'node:fs';
import path from 'node:path';
import { cargarReglas } from './extraccion.ts';
import { leerMaestro, asegurarDirectorios, type FilaMaestro } from './almacen.ts';

export interface ContratoAlertaVencimiento {
  id_contrato: string;
  cliente: string;
  fecha_fin: string;
  dias_restantes: number;
  estado_poliza: string;
  comercial: string;
}

export interface ContratoAlertaPoliza {
  id_contrato: string;
  cliente: string;
  tipo_poliza: string;
  estado_poliza: string;
  fecha_fin: string;
  comercial: string;
}

export interface ContratoAlertaCorte {
  id_contrato: string;
  cliente: string;
  valor: number;
  moneda: string;
  fecha_registro: string;
  fuente: string;
  comercial: string;
}

export interface AnexoCalidad {
  columnas_incompletas: { id_contrato: string; columnas_vacias: string[] }[];
  filas_sin_documento: string[];
  identificadores_invalidos: { id_contrato: string; nit_cliente: string; motivo: string }[];
  advertencias_prorroga: string[];
}

export interface ResultadoAlertas {
  ruta: string;
  vencen: ContratoAlertaVencimiento[];
  polizas_pendientes: ContratoAlertaPoliza[];
  registrados_desde_corte: ContratoAlertaCorte[];
  anexo_calidad: AnexoCalidad;
}

export function calcularDiasDiferencia(fechaFin: string, fechaHoy: string): number {
  const tFin = new Date(fechaFin + 'T00:00:00Z').getTime();
  const tHoy = new Date(fechaHoy + 'T00:00:00Z').getTime();
  const msPorDia = 1000 * 60 * 60 * 24;
  return Math.round((tFin - tHoy) / msPorDia);
}

export function validarFormatoFecha(fecha: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return false;
  const partes = fecha.split('-');
  const anio = Number(partes[0]);
  const mes = Number(partes[1]);
  const dia = Number(partes[2]);

  if (mes < 1 || mes > 12 || dia < 1 || dia > 31) return false;
  const fechaObj = new Date(Date.UTC(anio, mes - 1, dia));
  return (
    fechaObj.getUTCFullYear() === anio &&
    fechaObj.getUTCMonth() === mes - 1 &&
    fechaObj.getUTCDate() === dia
  );
}

export function generarReporteAlertas(
  hoy: string,
  baseDir = process.cwd()
): ResultadoAlertas {
  if (!validarFormatoFecha(hoy)) {
    throw new Error(`Fecha inválida o formato incorrecto: "${hoy}". Debe ser una fecha de calendario válida YYYY-MM-DD.`);
  }

  const reglas = cargarReglas(baseDir);
  const maestro = leerMaestro(baseDir);
  asegurarDirectorios(baseDir);

  const diasUmbral = reglas.dias_alerta_vencimiento; // 60
  const fechaCorte = reglas.fecha_corte_maestro; // 2026-05-30

  const vencen: ContratoAlertaVencimiento[] = [];
  const polizasPendientes: ContratoAlertaPoliza[] = [];
  const registradosDesdeCorte: ContratoAlertaCorte[] = [];

  const anexoCalidad: AnexoCalidad = {
    columnas_incompletas: [],
    filas_sin_documento: [],
    identificadores_invalidos: [],
    advertencias_prorroga: [],
  };

  const columnasObligatorias: (keyof FilaMaestro)[] = [
    'id_contrato',
    'cliente',
    'nit_cliente',
    'pais',
    'objeto',
    'valor',
    'moneda',
    'fecha_inicio',
    'fecha_fin',
    'estado_poliza',
    'comercial',
    'fecha_registro',
  ];

  for (const fila of maestro) {
    // 1. Vencimientos
    if (fila.fecha_fin) {
      const diasRestantes = calcularDiasDiferencia(fila.fecha_fin, hoy);
      if (diasRestantes <= diasUmbral) {
        vencen.push({
          id_contrato: fila.id_contrato,
          cliente: fila.cliente,
          fecha_fin: fila.fecha_fin,
          dias_restantes: diasRestantes,
          estado_poliza: fila.estado_poliza,
          comercial: fila.comercial,
        });
      }
    }

    // 2. Pólizas pendientes o no vigentes
    if (fila.requiere_poliza && fila.estado_poliza !== 'vigente') {
      polizasPendientes.push({
        id_contrato: fila.id_contrato,
        cliente: fila.cliente,
        tipo_poliza: fila.tipo_poliza || 'cumplimiento',
        estado_poliza: fila.estado_poliza,
        fecha_fin: fila.fecha_fin,
        comercial: fila.comercial,
      });
    }

    // 3. Registrados después de fecha_corte_maestro
    if (fila.fecha_registro && fila.fecha_registro > fechaCorte) {
      registradosDesdeCorte.push({
        id_contrato: fila.id_contrato,
        cliente: fila.cliente,
        valor: fila.valor,
        moneda: fila.moneda,
        fecha_registro: fila.fecha_registro,
        fuente: fila.fuente,
        comercial: fila.comercial,
      });
    }

    // 4. Anexo de Calidad: columnas vacías
    const vacias: string[] = [];
    for (const col of columnasObligatorias) {
      const val = fila[col];
      if (val === null || val === undefined || (typeof val === 'string' && val.trim() === '')) {
        vacias.push(col);
      }
    }
    if (vacias.length > 0) {
      anexoCalidad.columnas_incompletas.push({
        id_contrato: fila.id_contrato,
        columnas_vacias: vacias,
      });
    }

    // Anexo de Calidad: archivo en SharePoint
    if (fila.ruta_sharepoint) {
      const rutaFisica = path.join(baseDir, 'out', 'sharepoint', fila.ruta_sharepoint);
      if (!fs.existsSync(rutaFisica)) {
        anexoCalidad.filas_sin_documento.push(`${fila.id_contrato} (${fila.ruta_sharepoint})`);
      }
    } else {
      anexoCalidad.filas_sin_documento.push(`${fila.id_contrato} (Sin ruta asignada)`);
    }

    // Anexo de Calidad: formato de identificadores
    if (fila.nit_cliente) {
      const limpio = fila.nit_cliente.replace(/\D/g, '');
      if (limpio.length < 5) {
        anexoCalidad.identificadores_invalidos.push({
          id_contrato: fila.id_contrato,
          nit_cliente: fila.nit_cliente,
          motivo: 'Longitud de identificador sospechosamente corta',
        });
      }
    }
  }

  // Ordenar vencimientos por días restantes ascendente
  vencen.sort((a, b) => a.dias_restantes - b.dias_restantes);

  // Generar contenido Markdown para out/alertas.md
  const lineasMd: string[] = [
    `# Reporte de Alertas y Riesgos de Contratos Vigentes`,
    `> Fecha de corte de evaluación: **${hoy}** | Umbral de anticipación: **${diasUmbral} días**`,
    ``,
    `---`,
    ``,
    `## 1. Contratos que Vencen en ≤ ${diasUmbral} Días (${vencen.length})`,
  ];

  if (vencen.length === 0) {
    lineasMd.push(`*No hay contratos próximos a vencer dentro del umbral de ${diasUmbral} días.*`, ``);
  } else {
    lineasMd.push(
      `| ID Contrato | Cliente | Fecha Fin | Días Restantes | Estado Póliza | Comercial Responsable |`,
      `| :--- | :--- | :--- | :---: | :--- | :--- |`
    );
    for (const v of vencen) {
      const estadoDias = v.dias_restantes < 0 ? `⚠️ VENCIDO (${Math.abs(v.dias_restantes)}d)` : `${v.dias_restantes}d`;
      lineasMd.push(
        `| ${v.id_contrato} | ${v.cliente} | ${v.fecha_fin} | ${estadoDias} | \`${v.estado_poliza}\` | ${v.comercial} |`
      );
    }
    lineasMd.push(``);
  }

  lineasMd.push(`## 2. Pólizas Exigidas Pendientes o No Vigentes (${polizasPendientes.length})`);
  if (polizasPendientes.length === 0) {
    lineasMd.push(`*Todas las pólizas exigidas contractualmente se encuentran al día.*`, ``);
  } else {
    lineasMd.push(
      `| ID Contrato | Cliente | Tipos de Póliza | Estado Actual | Vencimiento Contrato | Comercial Responsable |`,
      `| :--- | :--- | :--- | :--- | :--- | :--- |`
    );
    for (const p of polizasPendientes) {
      lineasMd.push(
        `| ${p.id_contrato} | ${p.cliente} | \`${p.tipo_poliza}\` | **${p.estado_poliza.toUpperCase()}** | ${p.fecha_fin} | ${p.comercial} |`
      );
    }
    lineasMd.push(``);
  }

  lineasMd.push(`## 3. Contratos Registrados Post-Corte del Maestro (> ${fechaCorte}) (${registradosDesdeCorte.length})`);
  if (registradosDesdeCorte.length === 0) {
    lineasMd.push(`*No se registran nuevos contratos posteriores a la fecha de corte ${fechaCorte}.*`, ``);
  } else {
    lineasMd.push(
      `| ID Contrato | Cliente | Valor Total | Fecha Registro | Fuente | Comercial |`,
      `| :--- | :--- | :--- | :---: | :--- | :--- |`
    );
    for (const c of registradosDesdeCorte) {
      const valorFmt = `${c.moneda} $${c.valor.toLocaleString('es-CO')}`;
      lineasMd.push(
        `| ${c.id_contrato} | ${c.cliente} | ${valorFmt} | ${c.fecha_registro} | \`${c.fuente}\` | ${c.comercial} |`
      );
    }
    lineasMd.push(``);
  }

  lineasMd.push(`---`, `## 4. Anexo de Calidad y Gobierno de Datos`, ``);

  lineasMd.push(`- **Columnas obligatorias incompletas**: ${anexoCalidad.columnas_incompletas.length} registros`);
  for (const c of anexoCalidad.columnas_incompletas) {
    lineasMd.push(`  - \`${c.id_contrato}\`: faltan columnas [${c.columnas_vacias.join(', ')}]`);
  }

  lineasMd.push(`- **Filas sin archivo físico en SharePoint**: ${anexoCalidad.filas_sin_documento.length}`);
  for (const s of anexoCalidad.filas_sin_documento) {
    lineasMd.push(`  - ⚠️ ${s}`);
  }

  lineasMd.push(`- **Identificadores con formato atípico**: ${anexoCalidad.identificadores_invalidos.length}`);
  for (const inv of anexoCalidad.identificadores_invalidos) {
    lineasMd.push(`  - \`${inv.id_contrato}\`: NIT/RUC "${inv.nit_cliente}" (${inv.motivo})`);
  }

  lineasMd.push(
    ``,
    `*Reporte generado automáticamente por la herramienta contratos_alertas.*`
  );

  const rutaAlertas = path.join(baseDir, 'out', 'alertas.md');
  fs.writeFileSync(rutaAlertas, lineasMd.join('\n'), 'utf-8');

  return {
    ruta: 'out/alertas.md',
    vencen,
    polizas_pendientes: polizasPendientes,
    registrados_desde_corte: registradosDesdeCorte,
    anexo_calidad: anexoCalidad,
  };
}
