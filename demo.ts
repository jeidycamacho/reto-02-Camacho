import fs from 'node:fs';
import path from 'node:path';
import {
  leer_buzon,
  extraer,
  validar,
  registrar,
  descartar,
  alertas,
  type ToolContext,
} from './src/tools/contratos.ts';
import type { Contrato } from './src/tools/lib/esquema.ts';
import type { ResultadoValidacion } from './src/tools/lib/validacion.ts';

interface ApiResponse<T> {
  ok: boolean;
  data?: T;
  error?: string;
}

async function runDemo(): Promise<void> {
  console.log('======================================================================');
  console.log('  DEMO VERIFICACIÓN SIN MODELO — REGISTRO DE CONTRATOS VIGENTES');
  console.log('======================================================================\n');

  const baseDir = process.cwd();
  const ctx: ToolContext = {
    directory: baseDir,
    sessionId: 'demo-sin-modelo',
  };

  // 1. Limpiar carpeta out/ para garantizar determinismo (RN6 y requisitos)
  const outDir = path.join(baseDir, 'out');
  if (fs.existsSync(outDir)) {
    fs.rmSync(outDir, { recursive: true, force: true });
    console.log('🧹 Directorio out/ limpiado exitosamente.\n');
  }

  // 2. Leer buzón inicial
  console.log('PASO 1: Leyendo buzón de contratos (contratos_leer_buzon)...');
  const resBuzonRaw = await leer_buzon.execute({}, ctx);
  const resBuzon = JSON.parse(resBuzonRaw) as ApiResponse<{
    mensajes: Array<{
      id: string;
      de: string;
      asunto: string;
      fecha: string;
      adjuntos: string[];
      tiene_contrato: boolean;
      remitente_registrado: boolean;
      clasificacion_preliminar?: string;
      motivo?: string;
    }>;
  }>;

  if (!resBuzon.ok || !resBuzon.data) {
    console.error('❌ Error al leer buzón:', resBuzon.error);
    return;
  }

  console.log(`📥 Total de mensajes detectados en buzón: ${resBuzon.data.mensajes.length}\n`);

  let validacionMsg006: ResultadoValidacion | null = null;

  // 3. Procesar mensajes en orden (msg-001 a msg-006)
  console.log('PASO 2: Procesando mensajes en orden (msg-001 a msg-006)...\n');

  for (const item of resBuzon.data.mensajes) {
    console.log(`----------------------------------------------------------------------`);
    console.log(`📩 Mensaje: ${item.id} | De: ${item.de} | Asunto: "${item.asunto}"`);

    if (!item.tiene_contrato) {
      // Caso msg-005: Sin contrato adjunto
      console.log(` • Adjuntos: [${item.adjuntos.join(', ')}] (NO es contrato)`);
      console.log(` • Clasificación preliminar: ${item.clasificacion_preliminar ?? 'rechazado'}`);
      console.log(` • Motivo: ${item.motivo ?? 'Sin contrato'}`);

      const resDescRaw = await descartar.execute(
        {
          mensaje_id: item.id,
          motivo: item.motivo ?? 'Mensaje sin contrato adjunto',
        },
        ctx
      );
      const resDesc = JSON.parse(resDescRaw) as ApiResponse<{ accion: string }>;
      console.log(` • Acción tomada: ${resDesc.ok ? 'Descartado correctamente' : 'Error al descartar'}`);
      console.log('');
      continue;
    }

    // A) Extraer
    const resExtRaw = await extraer.execute({ mensaje_id: item.id }, ctx);
    const resExt = JSON.parse(resExtRaw) as ApiResponse<{
      mensaje_id: string;
      adjunto: string;
      contrato: Contrato;
      advertencias: string[];
    }>;

    if (!resExt.ok || !resExt.data) {
      console.log(` • Error en extracción: ${resExt.error}`);
      console.log('');
      continue;
    }

    const { adjunto, contrato } = resExt.data;
    console.log(` • Adjunto contractual: ${adjunto}`);

    // B) Validar
    const resValRaw = await validar.execute({ mensaje_id: item.id, contrato }, ctx);
    const resVal = JSON.parse(resValRaw) as ApiResponse<ResultadoValidacion>;

    if (!resVal.ok || !resVal.data) {
      console.log(` • Error en validación: ${resVal.error}`);
      console.log('');
      continue;
    }

    const val = resVal.data;
    console.log(` • Clasificación: ${val.clasificacion.toUpperCase()}`);
    console.log(` • Motivo: ${val.motivo}`);
    console.log(
      ` • Campos en revisión (${val.requiere_revision.length}): [${val.requiere_revision.join(', ') || 'ninguno'}]`
    );

    if (val.advertencias.length > 0) {
      console.log(` • Advertencias: ${val.advertencias.join('; ')}`);
    }

    // C) Decisión y Acción
    if (val.clasificacion === 'duplicado') {
      // Caso msg-004: Duplicado exacto -> descartar
      const resDescRaw = await descartar.execute(
        {
          mensaje_id: item.id,
          motivo: val.motivo,
        },
        ctx
      );
      const resDesc = JSON.parse(resDescRaw) as ApiResponse<unknown>;
      console.log(` • Acción tomada: Descartado (duplicado verificado, sin escritura en maestro)`);
    } else if (val.clasificacion === 'nuevo' || val.clasificacion === 'actualizacion') {
      if (val.requiere_revision.length > 0) {
        // Caso msg-006 primera pasada: tiene campos en revisión -> intentar sin confirmar debe rechazar
        console.log(` • Intento de registro sin confirmación humana:`);
        const resRegSinConfRaw = await registrar.execute(
          {
            mensaje_id: item.id,
            contrato: val.contrato_resultante,
            confirmado: false,
          },
          ctx
        );
        const resRegSinConf = JSON.parse(resRegSinConfRaw) as ApiResponse<unknown>;
        console.log(`   └─ Resultado esperado: ${resRegSinConf.error}`);
        console.log(` • Acción tomada: PAUSADO / SIN REGISTRAR (espera confirmación humana)`);

        if (item.id === 'msg-006') {
          validacionMsg006 = val;
        }
      } else {
        // Caso msg-001 (nuevo limpio), msg-002 (nuevo limpio), msg-003 (otrosí limpio)
        const resRegRaw = await registrar.execute(
          {
            mensaje_id: item.id,
            contrato: val.contrato_resultante,
            confirmado: false,
          },
          ctx
        );
        const resReg = JSON.parse(resRegRaw) as ApiResponse<{
          id_contrato: string;
          accion: string;
          ruta_archivo: string;
        }>;

        if (resReg.ok && resReg.data) {
          console.log(
            ` • Acción tomada: REGISTRADO exitosamente (${resReg.data.accion}) -> ${resReg.data.id_contrato}`
          );
          console.log(`   └─ Archivo: ${resReg.data.ruta_archivo}`);
        } else {
          console.log(` • Acción fallida: ${resReg.error}`);
        }
      }
    }
    console.log('');
  }

  // 4. Segunda pasada para msg-006 con confirmado: true
  console.log('======================================================================');
  console.log('PASO 3: Segunda pasada de msg-006 con confirmado: true...');
  console.log('======================================================================');

  if (validacionMsg006) {
    console.log('Detalle de campos en revisión para msg-006:');
    for (const det of validacionMsg006.detalle_revision) {
      console.log(
        ` • ${det.campo} = ${det.valor_propuesto} | motivo: ${det.motivo} (confianza: ${det.confianza})`
      );
    }

    console.log('\nEjecutando contratos_registrar con confirmado: true...');
    const resReg6Raw = await registrar.execute(
      {
        mensaje_id: 'msg-006',
        contrato: validacionMsg006.contrato_resultante,
        confirmado: true,
      },
      ctx
    );
    const resReg6 = JSON.parse(resReg6Raw) as ApiResponse<{
      id_contrato: string;
      accion: string;
      ruta_archivo: string;
    }>;

    if (resReg6.ok && resReg6.data) {
      console.log(`✅ msg-006 REGISTRADO con éxito: ${resReg6.data.id_contrato}`);
      console.log(`   └─ Archivo archivado en: ${resReg6.data.ruta_archivo}\n`);
    } else {
      console.log(`❌ Error al registrar msg-006: ${resReg6.error}\n`);
    }
  }

  // 5. Pruebas de robustez y casos anómalos (no deben detener el lote)
  console.log('======================================================================');
  console.log('PASO 4: Pruebas de robustez y casos anómalos (resiliencia del lote)...');
  console.log('======================================================================');

  // Caso A: Mensaje inexistente msg-999
  console.log('\nPrueba A: Mensaje inexistente "msg-999":');
  const resInexistenteRaw = await extraer.execute({ mensaje_id: 'msg-999' }, ctx);
  const resInexistente = JSON.parse(resInexistenteRaw) as ApiResponse<unknown>;
  console.log(` • Respuesta recibida (sin lanzar excepción): ok=${resInexistente.ok}, error="${resInexistente.error}"`);

  // Caso B: Fecha inválida 2026-02-30 en alertas
  console.log('\nPrueba B: Fecha calendario inválida "2026-02-30" en contratos_alertas:');
  const resFechaInvalidaRaw = await alertas.execute({ hoy: '2026-02-30' }, ctx);
  const resFechaInvalida = JSON.parse(resFechaInvalidaRaw) as ApiResponse<unknown>;
  console.log(` • Respuesta recibida (sin lanzar excepción): ok=${resFechaInvalida.ok}, error="${resFechaInvalida.error}"`);

  // Caso C: Moneda no soportada "EUR"
  console.log('\nPrueba C: Validación ante moneda no soportada "EUR":');
  const muestraContratoEur: Contrato = {
    id_contrato: 'CT-EUR-001',
    cliente: 'Empresa Europea S.A.',
    nit_cliente: '999888777',
    pais: 'CO',
    objeto: 'Servicios de consultoría',
    valor: 50000,
    moneda: 'EUR' as never,
    fecha_inicio: '2026-08-01',
    fecha_fin: '2027-08-01',
    requiere_poliza: false,
    tipo_poliza: null,
    estado_poliza: 'no_aplica',
    comercial: 'Laura Gómez',
    ruta_sharepoint: null,
    fecha_registro: '2026-09-03',
    fuente: 'buzon',
    confianza: {},
  };
  const resEurRaw = await validar.execute({ mensaje_id: 'msg-001', contrato: muestraContratoEur }, ctx);
  const resEur = JSON.parse(resEurRaw) as ApiResponse<unknown>;
  console.log(` • Respuesta recibida (sin lanzar excepción): ok=${resEur.ok}`);

  // 6. Reporte final de alertas al 2026-09-03
  console.log('\n======================================================================');
  console.log('PASO 5: Generando reporte de alertas a fecha 2026-09-03...');
  console.log('======================================================================');

  const resAlertasRaw = await alertas.execute({ hoy: '2026-09-03' }, ctx);
  const resAlertas = JSON.parse(resAlertasRaw) as ApiResponse<{
    ruta: string;
    vencen: Array<{ id_contrato: string; cliente: string; dias_restantes: number; estado_poliza: string }>;
    polizas_pendientes: Array<{ id_contrato: string; cliente: string; tipo_poliza: string; estado_poliza: string }>;
    registrados_desde_corte: Array<{ id_contrato: string; cliente: string; valor: number; moneda: string }>;
    anexo_calidad: {
      columnas_incompletas: unknown[];
      filas_sin_documento: string[];
      identificadores_invalidos: unknown[];
    };
  }>;

  if (resAlertas.ok && resAlertas.data) {
    const { ruta, vencen, polizas_pendientes, registrados_desde_corte, anexo_calidad } = resAlertas.data;
    console.log(`📄 Archivo de alertas generado en: ${ruta}`);
    console.log(` • Contratos que vencen en ≤ 60 días: ${vencen.length}`);
    for (const v of vencen) {
      console.log(`   - ${v.id_contrato} (${v.cliente}): vence en ${v.dias_restantes} días [póliza: ${v.estado_poliza}]`);
    }

    console.log(` • Pólizas pendientes o vencidas: ${polizas_pendientes.length}`);
    for (const p of polizas_pendientes) {
      console.log(`   - ${p.id_contrato} (${p.cliente}): tipo "${p.tipo_poliza}" [estado: ${p.estado_poliza}]`);
    }

    console.log(` • Contratos registrados post-corte (gap cubierto): ${registrados_desde_corte.length}`);
    for (const r of registrados_desde_corte) {
      console.log(`   - ${r.id_contrato} (${r.cliente}): ${r.moneda} $${r.valor}`);
    }

    console.log(` • Calidad: ${anexo_calidad.filas_sin_documento.length} filas históricas sin documento físico en SharePoint.`);
  } else {
    console.log(`❌ Error al generar alertas: ${resAlertas.error}`);
  }

  // 7. Verificar contenido de log.jsonl
  const logPath = path.join(baseDir, 'out', 'log.jsonl');
  if (fs.existsSync(logPath)) {
    const lineasLog = fs.readFileSync(logPath, 'utf-8').trim().split('\n');
    console.log(`\n📋 Trazabilidad en out/log.jsonl: ${lineasLog.length} llamadas registradas.`);
  }

  console.log('\n======================================================================');
  console.log('  DEMO FINALIZADA CON ÉXITO');
  console.log('======================================================================');
}

void runDemo();
