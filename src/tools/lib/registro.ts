import fs from 'node:fs';
import path from 'node:path';
import type { Contrato, EstadoPoliza } from './esquema.ts';
import { procesarExtraccion } from './extraccion.ts';
import { validarContrato } from './validacion.ts';
import {
  leerMaestro,
  escribirMaestroAtomico,
  marcarProcesado,
  registrarEnHistorial,
  archivarDocumentoContrato,
  type FilaMaestro,
  type CambioHistorial,
} from './almacen.ts';

export interface ResultadoRegistro {
  id_contrato: string;
  accion: 'nuevo' | 'actualizacion';
  ruta_archivo: string;
}

export interface ResultadoDescarte {
  mensaje_id: string;
  accion: 'descartado';
  motivo: string;
  id_contrato?: string;
}

export function registrarContrato(
  mensajeId: string,
  contratoEntrante: Contrato,
  confirmado = false,
  baseDir = process.cwd()
): ResultadoRegistro {
  // 1. Extraer y validar directamente desde el archivo para garantizar integridad
  const extraccion = procesarExtraccion(mensajeId, baseDir);
  const validacion = validarContrato(mensajeId, extraccion.contrato, baseDir);

  if (validacion.clasificacion === 'duplicado' || validacion.clasificacion === 'rechazado') {
    throw new Error(
      `El contrato fue clasificado como '${validacion.clasificacion}' (${validacion.motivo}); usa contratos_descartar`
    );
  }

  // 2. Si hay campos en revisión y no está confirmado
  if (validacion.requiere_revision.length > 0 && !confirmado) {
    const motivos = validacion.detalle_revision
      .map((d) => `${d.campo} = ${d.valor_propuesto} (${d.motivo})`)
      .join('; ');
    throw new Error(`requiere revisión: ${motivos}`);
  }

  // 3. LINAJE de datos
  const baseContrato = validacion.contrato_resultante;
  const contratoFinal: Contrato = { ...baseContrato };
  const origenMap: Record<string, 'extraccion' | 'maestro' | 'confirmacion_humana'> = {};

  const camposTotales: (keyof Contrato)[] = [
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
  ];

  for (const c of camposTotales) {
    if (validacion.requiere_revision.includes(c as string)) {
      if (confirmado) {
        // En campos de revisión se acepta el valor confirmado por el usuario si difiere
        const valEntrante = contratoEntrante[c];
        if (valEntrante !== undefined && valEntrante !== null) {
          (contratoFinal as Record<string, unknown>)[c as string] = valEntrante;
        }
        origenMap[c as string] = 'confirmacion_humana';
      } else {
        origenMap[c as string] = 'extraccion';
      }
    } else {
      // Verificar que ningún campo fuera de revisión haya sido alterado indebidamente
      const valEntrante = contratoEntrante[c];
      const valEsperado = baseContrato[c];
      if (
        valEntrante !== undefined &&
        valEntrante !== null &&
        valEsperado !== undefined &&
        valEsperado !== null &&
        String(valEntrante) !== String(valEsperado)
      ) {
        throw new Error(
          `Campo no autorizado alterado en confirmación: ${String(c)} (esperado: "${String(valEsperado)}", recibido: "${String(valEntrante)}")`
        );
      }

      if (extraccion.contrato.es_otrosi && baseContrato.evidencia?.[c as string] === 'Heredado del maestro') {
        origenMap[c as string] = 'maestro';
      } else {
        origenMap[c as string] = 'extraccion';
      }
    }
  }

  // 4. Generar ID si no viene asignado
  const maestro = leerMaestro(baseDir);
  let idContrato = contratoFinal.id_contrato;
  if (!idContrato || idContrato.trim() === '') {
    const anioActual = new Date().getFullYear();
    const secuencia = maestro.filter((f) => f.id_contrato.startsWith(`AUTO-${anioActual}`)).length + 1;
    idContrato = `AUTO-${anioActual}-${String(secuencia).padStart(3, '0')}`;
    contratoFinal.id_contrato = idContrato;
  }

  // 5. Archivar documento en SharePoint
  const rutaSharepoint = archivarDocumentoContrato(
    mensajeId,
    extraccion.adjunto,
    idContrato,
    contratoFinal.cliente ?? 'SinCliente',
    contratoFinal.fecha_inicio ?? '2026-09-03',
    contratoFinal.es_otrosi ?? false,
    baseDir
  );
  contratoFinal.ruta_sharepoint = rutaSharepoint;

  const fechaHoy = new Date().toISOString().split('T')[0] ?? '2026-09-03';
  const ts = new Date().toISOString();

  // 6. Actualizar Maestro e Historial
  if (validacion.clasificacion === 'nuevo') {
    const nuevaFila: FilaMaestro = {
      id_contrato: idContrato,
      cliente: contratoFinal.cliente ?? '',
      nit_cliente: contratoFinal.nit_cliente ?? '',
      pais: contratoFinal.pais ?? 'CO',
      objeto: contratoFinal.objeto ?? '',
      valor: contratoFinal.valor ?? 0,
      moneda: contratoFinal.moneda ?? 'COP',
      fecha_inicio: contratoFinal.fecha_inicio ?? '',
      fecha_fin: contratoFinal.fecha_fin ?? '',
      requiere_poliza: contratoFinal.requiere_poliza ?? false,
      tipo_poliza: contratoFinal.tipo_poliza ?? '',
      estado_poliza: contratoFinal.estado_poliza ?? (contratoFinal.requiere_poliza ? 'pendiente' : 'no_aplica'),
      comercial: validacion.comercial,
      ruta_sharepoint: rutaSharepoint,
      fecha_registro: fechaHoy,
      fuente: 'buzon',
    };

    const nuevoMaestro = [...maestro, nuevaFila];
    escribirMaestroAtomico(nuevoMaestro, baseDir);

    const cambios: Record<string, CambioHistorial> = {};
    for (const c of camposTotales) {
      cambios[c as string] = {
        antes: null,
        despues: nuevaFila[c as keyof FilaMaestro] as string | number | boolean | null,
        origen: origenMap[c as string] ?? 'extraccion',
      };
    }

    registrarEnHistorial(
      {
        ts,
        id_contrato: idContrato,
        accion: 'nuevo',
        cambios,
        mensaje_id: mensajeId,
      },
      baseDir
    );

    marcarProcesado(
      {
        ts,
        mensaje_id: mensajeId,
        accion: 'registrado',
        id_contrato: idContrato,
      },
      baseDir
    );

    return {
      id_contrato: idContrato,
      accion: 'nuevo',
      ruta_archivo: rutaSharepoint,
    };
  }

  // Caso: actualizacion (otrosí o reenvío confirmado)
  const indice = maestro.findIndex(
    (f) => f.id_contrato.toUpperCase() === (validacion.id_contrato_existente ?? idContrato).toUpperCase()
  );
  if (indice === -1) {
    throw new Error(`Contrato base ${validacion.id_contrato_existente} no encontrado en el maestro para actualizar`);
  }

  const filaAnterior = maestro[indice];
  if (!filaAnterior) {
    throw new Error(`Error inesperado al recuperar la fila del maestro`);
  }

  // RN8: si un otrosí cambia fecha_fin de un contrato con póliza -> estado_poliza = pendiente
  let nuevoEstadoPoliza = filaAnterior.estado_poliza;
  if (contratoFinal.es_otrosi) {
    if (filaAnterior.requiere_poliza || contratoFinal.requiere_poliza) {
      nuevoEstadoPoliza = 'pendiente';
    }
  }

  const filaActualizada: FilaMaestro = {
    ...filaAnterior,
    cliente: contratoFinal.cliente ?? filaAnterior.cliente,
    nit_cliente: contratoFinal.nit_cliente ?? filaAnterior.nit_cliente,
    pais: contratoFinal.pais ?? filaAnterior.pais,
    objeto: contratoFinal.objeto ?? filaAnterior.objeto,
    valor: contratoFinal.valor ?? filaAnterior.valor,
    moneda: contratoFinal.moneda ?? filaAnterior.moneda,
    fecha_inicio: contratoFinal.fecha_inicio ?? filaAnterior.fecha_inicio,
    fecha_fin: contratoFinal.fecha_fin ?? filaAnterior.fecha_fin,
    requiere_poliza: contratoFinal.requiere_poliza ?? filaAnterior.requiere_poliza,
    tipo_poliza: contratoFinal.tipo_poliza ?? filaAnterior.tipo_poliza,
    estado_poliza: nuevoEstadoPoliza,
    comercial: validacion.comercial || filaAnterior.comercial,
    ruta_sharepoint: rutaSharepoint,
  };

  const nuevoMaestro = [...maestro];
  nuevoMaestro[indice] = filaActualizada;
  escribirMaestroAtomico(nuevoMaestro, baseDir);

  const cambios: Record<string, CambioHistorial> = {};
  for (const c of camposTotales) {
    const vAnt = filaAnterior[c as keyof FilaMaestro];
    const vDes = filaActualizada[c as keyof FilaMaestro];
    if (String(vAnt) !== String(vDes)) {
      cambios[c as string] = {
        antes: vAnt as string | number | boolean | null,
        despues: vDes as string | number | boolean | null,
        origen: origenMap[c as string] ?? 'extraccion',
      };
    }
  }

  registrarEnHistorial(
    {
      ts,
      id_contrato: idContrato,
      accion: 'actualizacion',
      cambios,
      mensaje_id: mensajeId,
    },
    baseDir
  );

  marcarProcesado(
    {
      ts,
      mensaje_id: mensajeId,
      accion: 'actualizado',
      id_contrato: idContrato,
    },
    baseDir
  );

  return {
    id_contrato: idContrato,
    accion: 'actualizacion',
    ruta_archivo: rutaSharepoint,
  };
}

export function descartarContrato(
  mensajeId: string,
  motivo: string,
  baseDir = process.cwd()
): ResultadoDescarte {
  const dirMensaje = path.join(baseDir, 'fixtures', 'reto-02', 'buzon', mensajeId);
  if (!fs.existsSync(dirMensaje)) {
    throw new Error(`El mensaje ${mensajeId} no existe en el buzón`);
  }

  let clasificacion = 'rechazado';
  let idExistente: string | undefined = undefined;

  try {
    const extraccion = procesarExtraccion(mensajeId, baseDir);
    const validacion = validarContrato(mensajeId, extraccion.contrato, baseDir);
    clasificacion = validacion.clasificacion;
    idExistente = validacion.id_contrato_existente ?? undefined;

    if (clasificacion !== 'duplicado' && clasificacion !== 'rechazado') {
      throw new Error(
        `El mensaje ${mensajeId} fue clasificado como '${clasificacion}'. Solo se pueden descartar contratos clasificados como 'duplicado' o 'rechazado'.`
      );
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes('no trae adjunto de contrato')) {
      clasificacion = 'rechazado';
    } else {
      throw error;
    }
  }

  const ts = new Date().toISOString();
  marcarProcesado(
    {
      ts,
      mensaje_id: mensajeId,
      accion: 'descartado',
      motivo,
      id_contrato: idExistente,
    },
    baseDir
  );

  return {
    mensaje_id: mensajeId,
    accion: 'descartado',
    motivo,
    id_contrato: idExistente,
  };
}
