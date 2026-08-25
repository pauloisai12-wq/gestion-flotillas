// Contrato del servicio que persiste un segmento de audio, en los tres puntos
// que no se ven desde el HTTP:
//
//   · la carrera: dos POST del mismo (encuesta, segmento) a la vez. El UNIQUE
//     arbitra con un P2002 y el perdedor REPITE la lectura y devuelve la fila
//     del ganador — sin volver a escribir el blob;
//   · un error de BD que NO sea el UNIQUE no se traga: propaga (500) para que el
//     teléfono reintente;
//   · el orden disco→BD: si el disco falla, la BD no se toca (nunca una fila que
//     apunte a un archivo inexistente).
//
// El doble de `db` es explícito por caso —no un Map con memoria— porque lo que
// se prueba aquí es la SECUENCIA de llamadas, no el resultado agregado.

import { describe, expect, it, vi } from 'vitest';

// El servicio importa el cliente Prisma real solo para el default de deps; en
// los tests se inyecta un db falso, así que basta con neutralizar el módulo.
vi.mock('../../src/lib/prisma', () => ({ default: {} }));

vi.mock('../../src/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { Prisma } from '@prisma/client';
import {
  guardarAudioEncuestaWithDeps,
  type GuardarAudioDeps,
  type GuardarAudioInput,
} from '../../src/services/encuestasAudioService';
import { audioM4aMinimo } from './audioFixtures';
import { sha256Of } from '../../src/lib/encuestasAudioStorage';

const BUFFER = audioM4aMinimo({ duracionMs: 7_000, relleno: 32 });
const SHA = sha256Of(BUFFER);

const entrada: GuardarAudioInput = {
  encuestaId: 10,
  segmento: 'seg1.m4a',
  sha256: SHA,
  tamanoBytes: BUFFER.length,
  mimeDeclarado: 'audio/mp4',
  buffer: BUFFER,
};

type Db = GuardarAudioDeps['db'];

function fakeDb(parts: {
  findUnique: ReturnType<typeof vi.fn>;
  create: ReturnType<typeof vi.fn>;
  update?: ReturnType<typeof vi.fn>;
}): Db {
  return { encuestaAudio: { update: vi.fn(), ...parts } } as unknown as Db;
}

const p2002 = () =>
  new Prisma.PrismaClientKnownRequestError('unique violation', {
    code: 'P2002',
    clientVersion: 'test',
  });

describe('guardarAudioEncuestaWithDeps', () => {
  it('ante un P2002 repite la lectura y devuelve la fila del ganador sin reescribir el blob', async () => {
    // Primera vuelta: no hay fila → create → el otro POST ya la insertó (P2002).
    // Segunda vuelta: ahora sí hay fila, con el MISMO contenido → 200.
    const findUnique = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 77, sha256: SHA });
    const create = vi.fn().mockRejectedValue(p2002());
    const guardarEnDisco = vi.fn().mockResolvedValue(`encuestas-audio/${SHA}.m4a`);

    const resultado = await guardarAudioEncuestaWithDeps(entrada, {
      db: fakeDb({ findUnique, create }),
      guardarEnDisco,
    });

    expect(resultado).toEqual({ audioId: 77, created: false });
    expect(findUnique).toHaveBeenCalledTimes(2);
    expect(create).toHaveBeenCalledTimes(1);
    // El blob es content-addressed: se escribe UNA vez, antes del bucle de BD.
    expect(guardarEnDisco).toHaveBeenCalledTimes(1);
  });

  it('un error de BD que no es el UNIQUE se propaga y no se reintenta', async () => {
    const findUnique = vi.fn().mockResolvedValue(null);
    const create = vi.fn().mockRejectedValue(new Error('conexión perdida'));
    const guardarEnDisco = vi.fn().mockResolvedValue(`encuestas-audio/${SHA}.m4a`);

    await expect(
      guardarAudioEncuestaWithDeps(entrada, {
        db: fakeDb({ findUnique, create }),
        guardarEnDisco,
      }),
    ).rejects.toThrow('conexión perdida');
    expect(create).toHaveBeenCalledTimes(1);
    expect(findUnique).toHaveBeenCalledTimes(1);
  });

  it('si el disco falla, la BD no se toca (nunca una fila sin archivo)', async () => {
    const findUnique = vi.fn();
    const create = vi.fn();
    const update = vi.fn();
    const guardarEnDisco = vi.fn().mockRejectedValue(new Error('ENOSPC'));

    await expect(
      guardarAudioEncuestaWithDeps(entrada, {
        db: fakeDb({ findUnique, create, update }),
        guardarEnDisco,
      }),
    ).rejects.toThrow('ENOSPC');
    expect(findUnique).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });
});
