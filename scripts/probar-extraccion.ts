import { extraer, type ToolContext } from '../src/tools/contratos.ts';
import type { Contrato } from '../src/tools/lib/esquema.ts';

interface ResultadoExtraerData {
  mensaje_id: string;
  adjunto: string;
  contrato: Contrato;
  advertencias: string[];
}

interface RespuestaExtraer {
  ok: boolean;
  data?: ResultadoExtraerData;
  error?: string;
}

async function probar(): Promise<void> {
  console.log('===============================================================');
  console.log('PRUEBA DE EXTRACCIÓN DETERMINISTA (msg-001 a msg-006)');
  console.log('===============================================================\n');

  const mensajes = ['msg-001', 'msg-002', 'msg-003', 'msg-004', 'msg-005', 'msg-006'];
  const ctx: ToolContext = {
    directory: process.cwd(),
    sessionId: 'session-test-extraccion',
  };

  for (const id of mensajes) {
    console.log(`---------------------------------------------------------------`);
    console.log(`PROCESANDO: ${id}`);
    console.log(`---------------------------------------------------------------`);

    const rawRes = await extraer.execute({ mensaje_id: id }, ctx);
    const res = JSON.parse(rawRes) as RespuestaExtraer;

    if (!res.ok || !res.data) {
      console.log(`❌ ERROR / RECHAZO: ${res.error ?? 'Error desconocido'}\n`);
      continue;
    }

    const { adjunto, contrato, advertencias } = res.data;
    console.log(`📄 Adjunto procesado: ${adjunto}`);
    console.log(`📋 Es otrosí: ${contrato.es_otrosi ? 'SÍ' : 'NO'}`);
    if (contrato.valor_indeterminado) {
      console.log(`⚠️ Valor indeterminado (por demanda): SÍ`);
    }

    console.log('\nCampos extraídos:');
    const campos: (keyof Omit<Contrato, 'confianza' | 'evidencia'>)[] = [
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
    ];

    for (const campo of campos) {
      const val = contrato[campo];
      const conf = contrato.confianza[campo as string];
      const evid = contrato.evidencia?.[campo as string];
      const confStr = conf !== undefined ? `(confianza: ${conf})` : '';
      console.log(` • ${campo.padEnd(16)}: ${String(val).padEnd(36)} ${confStr}`);
      if (evid && evid.length > 0) {
        const evidCorta = evid.length > 70 ? evid.slice(0, 67) + '...' : evid;
        console.log(`   └─ evidencia: "${evidCorta}"`);
      }
    }

    if (advertencias.length > 0) {
      console.log('\nAdvertencias:');
      for (const adv of advertencias) {
        console.log(` ⚠️ ${adv}`);
      }
    }
    console.log('');
  }

  console.log('===============================================================');
  console.log('PRUEBA FINALIZADA');
  console.log('===============================================================');
}

void probar();
