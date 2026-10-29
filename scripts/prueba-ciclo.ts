import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import type {
  AdaptadorLLM,
  MensajeLLM,
  RespuestaLLM,
  EsquemaHerramienta,
  OpcionesEnvio,
} from '../src/llm/adapter.ts';
import { CicloAgente } from '../src/agent/ciclo.ts';
import { obtenerOCrearSesion } from '../src/agent/sesion.ts';
import { asegurarDirectorios } from '../src/tools/lib/almacen.ts';
import { extraer } from '../src/tools/contratos.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

// Función para reiniciar el entorno de pruebas de out/ a partir de fixtures
function reiniciarEntornoPruebas(): void {
  asegurarDirectorios(rootDir);
  const maestroFixture = path.join(rootDir, 'fixtures', 'reto-02', 'maestro-contratos.csv');
  const maestroOut = path.join(rootDir, 'out', 'sharepoint', 'maestro-contratos.csv');
  fs.copyFileSync(maestroFixture, maestroOut);

  const procesadosPath = path.join(rootDir, 'out', 'procesados.json');
  if (fs.existsSync(procesadosPath)) {
    fs.unlinkSync(procesadosPath);
  }
}

// Clase simuladora de LLM para pruebas deterministas sin API KEY
class MockAdaptadorLLM implements AdaptadorLLM {
  public readonly proveedor = 'simulador';
  public readonly modelo = 'mock-llm-v1';

  public comportamiento: (
    mensajes: readonly MensajeLLM[],
    herramientas?: readonly EsquemaHerramienta[],
    opciones?: OpcionesEnvio
  ) => Promise<RespuestaLLM>;

  public constructor(
    comportamiento?: (
      mensajes: readonly MensajeLLM[],
      herramientas?: readonly EsquemaHerramienta[],
      opciones?: OpcionesEnvio
    ) => Promise<RespuestaLLM>
  ) {
    this.comportamiento =
      comportamiento ??
      (async () => ({
        texto: 'Respuesta por defecto del simulador',
        llamadas: [],
        uso: { entrada: 10, salida: 10 },
      }));
  }

  public async enviar(
    mensajes: readonly MensajeLLM[],
    herramientas?: readonly EsquemaHerramienta[],
    opciones?: OpcionesEnvio
  ): Promise<RespuestaLLM> {
    return this.comportamiento(mensajes, herramientas, opciones);
  }
}

async function ejecutarPruebas(): Promise<void> {
  console.log('===============================================================');
  console.log('🧪 INICIANDO PRUEBAS DEL CICLO DEL AGENTE (PROVEEDOR SIMULADO)');
  console.log('===============================================================\n');

  reiniciarEntornoPruebas();

  // Obtener contrato real extraído de msg-006 para las pruebas
  const resExtraer = JSON.parse(
    await extraer.execute({ mensaje_id: 'msg-006' }, { directory: rootDir, sessionId: 'setup-test' })
  ) as { ok: boolean; data: { contrato: Record<string, unknown> } };

  if (!resExtraer.ok || !resExtraer.data?.contrato) {
    throw new Error('Fallo al extraer contrato de prueba para msg-006');
  }

  const contratoMsg006 = resExtraer.data.contrato;

  let pasoA = false;
  let pasoB = false;
  let pasoC = false;
  let pasoD = false;

  // -------------------------------------------------------------------------
  // PRUEBA A: El modelo NO puede auto-confirmarse en el mismo turno
  // -------------------------------------------------------------------------
  console.log('▶ [Prueba A] Verificando que el modelo NO puede auto-confirmarse en el mismo turno...');
  const sesionIdAB = `test-sesion-guardia-${Date.now()}`;
  let iteracionTurno1 = 0;

  const mockLLM = new MockAdaptadorLLM();

  mockLLM.comportamiento = async () => {
    iteracionTurno1++;

    if (iteracionTurno1 === 1) {
      // Iteración 1: el modelo valida el contrato de msg-006
      return {
        texto: '',
        llamadas: [
          {
            id: 'call_val_1',
            nombre: 'contratos_validar',
            argumentos: {
              mensaje_id: 'msg-006',
              contrato: contratoMsg006,
            },
          },
        ],
        uso: { entrada: 100, salida: 30 },
      };
    } else if (iteracionTurno1 === 2) {
      // Iteración 2: el modelo INTENTA auto-confirmarse en el MISMO turno
      return {
        texto: '',
        llamadas: [
          {
            id: 'call_reg_1',
            nombre: 'contratos_registrar',
            argumentos: {
              mensaje_id: 'msg-006',
              contrato: contratoMsg006,
              confirmado: true, // Intento ilegal de auto-confirmación
            },
          },
        ],
        uso: { entrada: 120, salida: 30 },
      };
    } else {
      // Iteración 3: el modelo ve que fue bloqueado por la guardia y solicita confirmación a la persona
      return {
        texto:
          'El contrato de Distribuidora Caribe (msg-006) tiene campos en revisión (valor por demanda 0 y fecha de fin estimada). Por favor confirme si desea proceder con el registro.',
        llamadas: [],
        uso: { entrada: 150, salida: 50 },
      };
    }
  };

  const cicloA = new CicloAgente(mockLLM);
  const resTurno1 = await cicloA.ejecutarTurno(
    sesionIdAB,
    'Valida y registra el contrato de msg-006',
    rootDir
  );

  const llamadaRegistrarT1 = resTurno1.toolCalls.find((c) => c.nombre === 'contratos_registrar');
  const sesionDespuesT1 = obtenerOCrearSesion(sesionIdAB, rootDir);

  const fueBloqueadoPorGuardia =
    llamadaRegistrarT1 !== undefined &&
    llamadaRegistrarT1.ok === false &&
    llamadaRegistrarT1.resumen.includes('confirmado=true no es válido');

  const quedoPendienteT1 =
    resTurno1.needsConfirmation === true &&
    sesionDespuesT1.mensajesPendientesConfirmacion.includes('msg-006');

  if (fueBloqueadoPorGuardia && quedoPendienteT1) {
    pasoA = true;
    console.log('  ✅ ÉXITO: La guardia de confirmación bloqueó confirmado=true en el mismo turno.');
    console.log(`     - Resumen llamada: ${llamadaRegistrarT1?.resumen}`);
    console.log(`     - needsConfirmation: ${resTurno1.needsConfirmation}`);
    console.log(`     - Pendientes en sesión: [${sesionDespuesT1.mensajesPendientesConfirmacion.join(', ')}]`);
  } else {
    console.error('  ❌ FALLO en Prueba A: La guardia no bloqueó adecuadamente.');
    console.log(`     - fueBloqueadoPorGuardia: ${fueBloqueadoPorGuardia}`);
    console.log(`     - quedoPendienteT1: ${quedoPendienteT1}`);
    console.log(`     - ToolCalls:`, JSON.stringify(resTurno1.toolCalls));
  }

  // -------------------------------------------------------------------------
  // PRUEBA B: Cuando la persona confirma en el turno siguiente, sí pasa y registra
  // -------------------------------------------------------------------------
  console.log('\n▶ [Prueba B] Verificando confirmación humana en el turno siguiente...');
  let iteracionTurno2 = 0;

  mockLLM.comportamiento = async () => {
    iteracionTurno2++;
    if (iteracionTurno2 === 1) {
      // Iteración 1 del segundo turno: ahora sí registra con confirmado: true
      return {
        texto: '',
        llamadas: [
          {
            id: 'call_reg_2',
            nombre: 'contratos_registrar',
            argumentos: {
              mensaje_id: 'msg-006',
              contrato: contratoMsg006,
              confirmado: true,
            },
          },
        ],
        uso: { entrada: 130, salida: 30 },
      };
    } else {
      return {
        texto: 'El contrato CM-2026-03 ha sido registrado con éxito en el maestro.',
        llamadas: [],
        uso: { entrada: 160, salida: 40 },
      };
    }
  };

  const resTurno2 = await cicloA.ejecutarTurno(
    sesionIdAB,
    'Sí, confirmo el registro del contrato msg-006 con los valores indicados',
    rootDir
  );

  const llamadaRegistrarT2 = resTurno2.toolCalls.find((c) => c.nombre === 'contratos_registrar');
  const sesionDespuesT2 = obtenerOCrearSesion(sesionIdAB, rootDir);

  const fueRegistradoExitosamente = llamadaRegistrarT2 !== undefined && llamadaRegistrarT2.ok === true;
  const noQuedaPendienteT2 =
    resTurno2.needsConfirmation === false &&
    !sesionDespuesT2.mensajesPendientesConfirmacion.includes('msg-006');

  if (fueRegistradoExitosamente && noQuedaPendienteT2) {
    pasoB = true;
    console.log('  ✅ ÉXITO: En el turno posterior la confirmación humana fue aceptada y el contrato se registró.');
    console.log(`     - Resumen llamada: ${llamadaRegistrarT2?.resumen}`);
    console.log(`     - needsConfirmation: ${resTurno2.needsConfirmation}`);
    console.log(`     - Pendientes en sesión: [${sesionDespuesT2.mensajesPendientesConfirmacion.join(', ')}]`);
  } else {
    console.error('  ❌ FALLO en Prueba B: No se registró en el turno siguiente.');
    console.log(`     - fueRegistradoExitosamente: ${fueRegistradoExitosamente}`);
    console.log(`     - noQuedaPendienteT2: ${noQuedaPendienteT2}`);
    console.log(`     - ToolCalls:`, JSON.stringify(resTurno2.toolCalls));
  }

  // -------------------------------------------------------------------------
  // PRUEBA C: Timeout del proveedor devuelve mensaje claro en español y sesión vive
  // -------------------------------------------------------------------------
  console.log('\n▶ [Prueba C] Verificando manejo de timeout del proveedor y supervivencia de sesión...');
  const sesionIdTimeout = `test-sesion-timeout-${Date.now()}`;
  let simularErrorTimeout = true;

  const mockTimeoutLLM = new MockAdaptadorLLM(async () => {
    if (simularErrorTimeout) {
      throw new Error('Tiempo de espera agotado al consultar el modelo de lenguaje.');
    }
    return {
      texto: 'Respuesta exitosa posterior a la recuperación.',
      llamadas: [],
      uso: { entrada: 20, salida: 15 },
    };
  });

  const cicloC = new CicloAgente(mockTimeoutLLM);
  const resTurnoTimeout = await cicloC.ejecutarTurno(
    sesionIdTimeout,
    'Hola agente, realiza una consulta',
    rootDir
  );

  const sesionTimeout = obtenerOCrearSesion(sesionIdTimeout, rootDir);
  const sesionViva = sesionTimeout.enEjecucion === false && sesionTimeout.chatVisible.length > 0;
  const mensajeEspañolClaro =
    resTurnoTimeout.reply.includes('incidencia') &&
    resTurnoTimeout.reply.includes('Tiempo de espera agotado');

  // Verificar que el siguiente turno funciona sin problemas
  simularErrorTimeout = false;
  const resTurnoRecuperacion = await cicloC.ejecutarTurno(
    sesionIdTimeout,
    'Intento nuevamente después del timeout',
    rootDir
  );

  if (mensajeEspañolClaro && sesionViva && resTurnoRecuperacion.reply.includes('recuperación')) {
    pasoC = true;
    console.log('  ✅ ÉXITO: El timeout generó un mensaje comprensible en español y la sesión continuó viva.');
    console.log(`     - Mensaje devuelto: "${resTurnoTimeout.reply}"`);
    console.log(`     - Estado de sesión enEjecucion: ${sesionTimeout.enEjecucion}`);
    console.log(`     - Recuperación en turno siguiente: "${resTurnoRecuperacion.reply}"`);
  } else {
    console.error('  ❌ FALLO en Prueba C: El timeout no se manejó correctamente.');
  }

  // -------------------------------------------------------------------------
  // PRUEBA D: Tope de 4 iteraciones corta el turno con resumen de lo hecho
  // -------------------------------------------------------------------------
  console.log('\n▶ [Prueba D] Verificando corte gracioso en el tope de 4 iteraciones...');
  const sesionIdIteraciones = `test-sesion-iteraciones-${Date.now()}`;

  let iteracionesCount = 0;
  const mockLoopLLM = new MockAdaptadorLLM(async () => {
    iteracionesCount++;
    return {
      texto: '',
      llamadas: [
        {
          id: `call_leer_${iteracionesCount}`,
          nombre: 'contratos_leer_buzon',
          argumentos: {},
        },
      ],
      uso: { entrada: 50, salida: 20 },
    };
  });

  const cicloD = new CicloAgente(mockLoopLLM, { maxIteraciones: 4 });
  const resTurnoIter = await cicloD.ejecutarTurno(
    sesionIdIteraciones,
    'Inicia un procesamiento masivo',
    rootDir
  );

  const seCortoEn4 = resTurnoIter.toolCalls.length === 4;
  const tieneResumenTope =
    resTurnoIter.reply.includes('tope máximo de 4 iteraciones') &&
    resTurnoIter.reply.includes('4 llamadas a herramientas');

  if (seCortoEn4 && tieneResumenTope) {
    pasoD = true;
    console.log('  ✅ ÉXITO: El turno se detuvo exactamente a las 4 iteraciones con el resumen correspondiente.');
    console.log(`     - Cantidad de llamadas ejecutadas: ${resTurnoIter.toolCalls.length}`);
    console.log(`     - Mensaje de corte: "${resTurnoIter.reply}"`);
  } else {
    console.error('  ❌ FALLO en Prueba D: No se detuvo correctamente a las 4 iteraciones.');
  }

  console.log('\n===============================================================');
  console.log('📊 RESUMEN DE EJECUCIÓN');
  console.log('===============================================================');
  console.log(`Prueba A (Guardia de confirmación bloquea en mismo turno): ${pasoA ? 'PASÓ ✅' : 'FALLÓ ❌'}`);
  console.log(`Prueba B (Confirmación humana en turno siguiente pasa):      ${pasoB ? 'PASÓ ✅' : 'FALLÓ ❌'}`);
  console.log(`Prueba C (Timeout con mensaje claro y sesión viva):         ${pasoC ? 'PASÓ ✅' : 'FALLÓ ❌'}`);
  console.log(`Prueba D (Tope de 4 iteraciones corta con resumen):         ${pasoD ? 'PASÓ ✅' : 'FALLÓ ❌'}`);
  console.log('===============================================================\n');

  if (pasoA && pasoB && pasoC && pasoD) {
    console.log('🎉 TODAS LAS VERIFICACIONES DEL CICLO DEL AGENTE PASARON EXITOSAMENTE.');
    process.exit(0);
  } else {
    console.error('💥 UNA O MÁS PRUEBAS NO PASARON.');
    process.exit(1);
  }
}

void ejecutarPruebas();
