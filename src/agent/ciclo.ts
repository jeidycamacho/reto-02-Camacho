import path from 'node:path';
import type { AdaptadorLLM, MensajeLLM, LlamadaHerramienta } from '../llm/adapter.ts';
import { registroHerramientas } from './registro.ts';
import { construirPromptSistema } from './prompt.ts';
import {
  obtenerOCrearSesion,
  guardarSesion,
  desbloquearSesion,
  type EstadoSesion,
  type MensajeChatVisible,
} from './sesion.ts';
import { registrarLog } from '../tools/lib/almacen.ts';

export interface LlamadaToolVisible {
  nombre: string;
  argumentos: Record<string, unknown>;
  ok: boolean;
  resumen: string;
}

export interface ResultadoTurno {
  reply: string;
  toolCalls: LlamadaToolVisible[];
  needsConfirmation: boolean;
}

export type ListenerEventoCiclo = (evento: {
  tipo: 'pensando' | 'herramienta' | 'respuesta';
  llamada?: LlamadaToolVisible;
  texto?: string;
  needsConfirmation?: boolean;
}) => void;

export class CicloAgente {
  private readonly maxIteraciones: number;
  private readonly maxTokensSesion: number;
  private readonly timeoutMs: number;

  public constructor(
    private readonly llm: AdaptadorLLM,
    opciones?: {
      maxIteraciones?: number;
      maxTokensSesion?: number;
      timeoutMs?: number;
    }
  ) {
    this.maxIteraciones = opciones?.maxIteraciones ?? Number(process.env['MAX_ITERACIONES'] ?? 25);
    this.maxTokensSesion = opciones?.maxTokensSesion ?? Number(process.env['MAX_TOKENS_SESION'] ?? 400000);
    this.timeoutMs = opciones?.timeoutMs ?? Number(process.env['LLM_TIMEOUT_MS'] ?? 60000);
  }

  public async ejecutarTurno(
    sessionId: string,
    mensajeUsuario: string,
    baseDir = process.cwd(),
    onEvento?: ListenerEventoCiclo
  ): Promise<ResultadoTurno> {
    const sesion = obtenerOCrearSesion(sessionId, baseDir);

    // 1. Validar límite de tokens por sesión
    const tokensUsados = sesion.tokensEntradaTotal + sesion.tokensSalidaTotal;
    if (tokensUsados >= this.maxTokensSesion) {
      const msgLimite = `Se ha alcanzado el límite máximo de tokens configurado para esta sesión (${tokensUsados} / ${this.maxTokensSesion} tokens). Por favor inicie una nueva sesión.`;
      const chatVisibleItem: MensajeChatVisible = {
        id: `msg-${Date.now()}-limit`,
        remitente: 'agent',
        texto: msgLimite,
        ts: new Date().toISOString(),
      };
      sesion.chatVisible.push(chatVisibleItem);
      guardarSesion(sesion, baseDir);
      desbloquearSesion(sessionId, baseDir);
      return {
        reply: msgLimite,
        toolCalls: [],
        needsConfirmation: sesion.mensajesPendientesConfirmacion.length > 0,
      };
    }

    // Registrar mensaje de usuario
    sesion.chatVisible.push({
      id: `msg-${Date.now()}-user`,
      remitente: 'user',
      texto: mensajeUsuario,
      ts: new Date().toISOString(),
    });

    sesion.mensajesLLM.push({
      rol: 'user',
      texto: mensajeUsuario,
    });

    // GUARDIA DE CONFIRMACIÓN: Guardar los pendientes reconocidos al CIERRE del turno anterior
    const pendientesAlInicioTurno = new Set<string>(sesion.mensajesPendientesConfirmacion);
    const pendientesActuales = new Set<string>(sesion.mensajesPendientesConfirmacion);

    const toolCallsTurno: LlamadaToolVisible[] = [];
    let respuestaFinalTexto = '';
    let iteracion = 0;

    const systemInstruction = construirPromptSistema(baseDir);
    const esquemasHerramientas = registroHerramientas.obtenerEsquemas();

    const ctx = {
      directory: baseDir,
      sessionId,
    };

    try {
      while (iteracion < this.maxIteraciones) {
        iteracion++;

        if (onEvento) {
          onEvento({ tipo: 'pensando' });
        }

        // Consultar adaptador LLM
        let resLLM;
        try {
          resLLM = await this.llm.enviar(sesion.mensajesLLM, esquemasHerramientas, {
            timeoutMs: this.timeoutMs,
            systemInstruction,
          });
        } catch (error) {
          // El error del proveedor se muestra en el chat y la sesión sigue viva
          const errMsg = error instanceof Error ? error.message : String(error);
          respuestaFinalTexto = `⚠️ Ocurrió una incidencia con el modelo de lenguaje: ${errMsg}`;
          break;
        }

        // Acumular consumo de tokens
        sesion.tokensEntradaTotal += resLLM.uso.entrada;
        sesion.tokensSalidaTotal += resLLM.uso.salida;

        // Registrar respuesta del modelo en historial
        sesion.mensajesLLM.push({
          rol: 'model',
          texto: resLLM.texto,
          llamadas: resLLM.llamadas,
        });

        if (resLLM.texto) {
          respuestaFinalTexto = resLLM.texto;
        }

        // Si no hay llamadas a herramientas, fin del turno
        if (!resLLM.llamadas || resLLM.llamadas.length === 0) {
          break;
        }

        // Ejecutar cada llamada a herramienta
        for (const llamada of resLLM.llamadas) {
          let salidaJson = '';
          const args = llamada.argumentos as Record<string, unknown>;
          const mensajeIdArg = String(args['mensaje_id'] ?? 'lote');

          // Verificación de GUARDIA DE CONFIRMACIÓN para contratos_registrar
          if (llamada.nombre === 'contratos_registrar' && args['confirmado'] === true) {
            if (!pendientesAlInicioTurno.has(mensajeIdArg)) {
              // Bloqueado por la guardia: la confirmación no provino de un turno anterior
              salidaJson = JSON.stringify({
                ok: false,
                error: 'confirmado=true no es válido: la confirmación debe venir de la persona en un turno posterior',
              });

              registrarLog(
                {
                  ts: new Date().toISOString(),
                  herramienta: llamada.nombre,
                  mensaje_id: mensajeIdArg,
                  ok: false,
                  resumen: 'Guardia de confirmación bloqueó confirmado=true: no estaba pendiente al inicio del turno',
                },
                baseDir
              );
            }
          }

          // Si no fue bloqueado por la guardia, ejecutar la herramienta
          if (!salidaJson) {
            salidaJson = await registroHerramientas.ejecutar(llamada.nombre, args, ctx);
          }

          // Analizar salida para actualizar pendientes de confirmación
          try {
            const parsed = JSON.parse(salidaJson) as {
              ok: boolean;
              data?: {
                clasificacion?: string;
                requiere_revision?: string[];
              };
              error?: string;
            };

            if (llamada.nombre === 'contratos_validar' && parsed.ok && parsed.data) {
              const req = parsed.data.requiere_revision ?? [];
              if (req.length > 0) {
                pendientesActuales.add(mensajeIdArg);
              }
            } else if (llamada.nombre === 'contratos_registrar') {
              if (!parsed.ok && parsed.error && parsed.error.includes('requiere revisión')) {
                pendientesActuales.add(mensajeIdArg);
              } else if (parsed.ok) {
                pendientesActuales.delete(mensajeIdArg);
              }
            } else if (llamada.nombre === 'contratos_descartar' && parsed.ok) {
              pendientesActuales.delete(mensajeIdArg);
            }
          } catch {
            // Ignorar parseo si la salida no es JSON
          }

          // Extraer resumen para UI y chat visible
          let resumenLlamada = 'Ejecutado';
          let okLlamada = true;
          try {
            const p = JSON.parse(salidaJson) as { ok?: boolean; error?: string; data?: unknown };
            okLlamada = p.ok ?? true;
            if (!okLlamada) {
              resumenLlamada = p.error ?? 'Error en herramienta';
            } else if (p.data && typeof p.data === 'object' && 'clasificacion' in p.data) {
              resumenLlamada = `Clasificación: ${(p.data as { clasificacion: string }).clasificacion}`;
            } else if (p.data && typeof p.data === 'object' && 'id_contrato' in p.data) {
              resumenLlamada = `Contrato: ${(p.data as { id_contrato: string }).id_contrato}`;
            }
          } catch {
            resumenLlamada = salidaJson.slice(0, 80);
          }

          const llamadaVisible: LlamadaToolVisible = {
            nombre: llamada.nombre,
            argumentos: args,
            ok: okLlamada,
            resumen: resumenLlamada,
          };
          toolCallsTurno.push(llamadaVisible);

          if (onEvento) {
            onEvento({ tipo: 'herramienta', llamada: llamadaVisible });
          }

          // Agregar respuesta de herramienta para el modelo
          sesion.mensajesLLM.push({
            rol: 'tool',
            respuestaHerramienta: {
              llamadaId: llamada.id,
              nombre: llamada.nombre,
              contenido: salidaJson,
            },
          });
        }
      }

      if (iteracion >= this.maxIteraciones && !respuestaFinalTexto) {
        respuestaFinalTexto = `Se alcanzó el tope máximo de ${this.maxIteraciones} iteraciones para este turno. Operaciones realizadas: ${toolCallsTurno.length} llamadas a herramientas. Pendientes de confirmación: [${Array.from(pendientesActuales).join(', ') || 'ninguno'}].`;
      }
    } finally {
      // Actualizar estado de pendientes y guardar sesión
      sesion.mensajesPendientesConfirmacion = Array.from(pendientesActuales);
      const needsConfirmation = sesion.mensajesPendientesConfirmacion.length > 0;

      sesion.chatVisible.push({
        id: `msg-${Date.now()}-agent`,
        remitente: 'agent',
        texto: respuestaFinalTexto,
        ts: new Date().toISOString(),
        llamadasHerramientas: toolCallsTurno,
      });

      guardarSesion(sesion, baseDir);
      desbloquearSesion(sessionId, baseDir);

      if (onEvento) {
        onEvento({
          tipo: 'respuesta',
          texto: respuestaFinalTexto,
          needsConfirmation,
        });
      }
    }

    return {
      reply: respuestaFinalTexto,
      toolCalls: toolCallsTurno,
      needsConfirmation: sesion.mensajesPendientesConfirmacion.length > 0,
    };
  }
}
