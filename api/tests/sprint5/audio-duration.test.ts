// Parser de duración ISO-BMFF (moov/mvhd) de los audios de encuesta. La
// duración es best-effort: lo que se prueba aquí no es solo el camino feliz,
// sino que TODA forma inesperada devuelva null en vez de un número inventado o
// una excepción (la columna `duracion_ms` queda NULL y el navegador mide la
// duración al reproducir; una excepción, en cambio, tumbaría la subida).

import { describe, expect, it } from 'vitest';

import { duracionMsIsoBmff } from '../../src/lib/audioDuration';
import { AMR_CRUDO, audioM4aMinimo, mvhdV0, mvhdV1 } from './audioFixtures';

/** Caja con `size == 1` (longitud de 64 bits): el parser debe saltarla entera. */
function cajaGrande(tipo: string, payload: Buffer): Buffer {
  const cabecera = Buffer.alloc(16);
  cabecera.writeUInt32BE(1, 0);
  cabecera.write(tipo, 4, 'latin1');
  cabecera.writeBigUInt64BE(BigInt(16 + payload.length), 8);
  return Buffer.concat([cabecera, payload]);
}

describe('duracionMsIsoBmff', () => {
  it('lee la duración de un mvhd versión 0', () => {
    // La fixture pone el moov DESPUÉS del mdat (como MediaRecorder de Android):
    // si el parser no supiera saltar cajas, no encontraría el moov.
    expect(duracionMsIsoBmff(audioM4aMinimo({ duracionMs: 12_345 }))).toBe(12_345);
  });

  it('lee la duración de un mvhd versión 1 (duración de 64 bits) con timescale 48000', () => {
    const buf = audioM4aMinimo({ mvhd: mvhdV1(90_000, 48_000) });
    expect(duracionMsIsoBmff(buf)).toBe(90_000);
  });

  it('salta una caja con size=1 (longitud de 64 bits) antes del moov', () => {
    const conRelleno = Buffer.concat([
      cajaGrande('free', Buffer.alloc(32, 0x00)),
      audioM4aMinimo({ duracionMs: 7_500 }),
    ]);
    expect(duracionMsIsoBmff(conRelleno)).toBe(7_500);
  });

  it('devuelve null para un AMR crudo (no es ISO-BMFF)', () => {
    expect(duracionMsIsoBmff(AMR_CRUDO)).toBeNull();
  });

  it('devuelve null para un buffer demasiado corto para tener cabecera de caja', () => {
    expect(duracionMsIsoBmff(Buffer.alloc(3))).toBeNull();
  });

  it('devuelve null si el timescale es 0 (evita la división por cero)', () => {
    expect(duracionMsIsoBmff(audioM4aMinimo({ mvhd: mvhdV0(1_000, 0) }))).toBeNull();
  });

  it('devuelve null si la duración es 0xFFFFFFFF (mvhd fragmentado, duración desconocida)', () => {
    const mvhd = mvhdV0(1_000);
    mvhd.writeUInt32BE(0xffffffff, 8 + 16); // cabecera(8) + offset de `duration` en el payload
    expect(duracionMsIsoBmff(audioM4aMinimo({ mvhd }))).toBeNull();
  });
});
