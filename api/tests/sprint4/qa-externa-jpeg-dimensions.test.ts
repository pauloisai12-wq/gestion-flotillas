import { describe, expect, it } from 'vitest';
import { jpegDimensions } from '../../src/lib/qaExternaStorage';

/**
 * JPEG mínimo bien formado: SOI + APP0 (JFIF) + SOF0 con las dimensiones dadas.
 * Suficiente para el parser, que solo necesita llegar al SOF.
 */
function jpegMinimo(width: number, height: number): Buffer {
  const soi = Buffer.from([0xff, 0xd8]);
  const app0 = Buffer.from([
    0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00,
    0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
  ]);
  const sof0 = Buffer.from([
    0xff, 0xc0, 0x00, 0x11, 0x08,
    (height >> 8) & 0xff, height & 0xff,
    (width >> 8) & 0xff, width & 0xff,
    0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01,
  ]);
  return Buffer.concat([soi, app0, sof0]);
}

describe('jpegDimensions — parser propio sin image-size', () => {
  it('lee ancho y alto del SOF0 de un JPEG bien formado', () => {
    expect(jpegDimensions(jpegMinimo(320, 240))).toEqual({ width: 320, height: 240 });
  });

  it('lee dimensiones grandes (dos bytes) sin desbordar', () => {
    expect(jpegDimensions(jpegMinimo(4032, 3024))).toEqual({ width: 4032, height: 3024 });
  });

  it('devuelve null si el buffer no es JPEG (magic bytes ajenos)', () => {
    expect(jpegDimensions(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBeNull();
    expect(jpegDimensions(Buffer.alloc(0))).toBeNull();
  });

  it('devuelve null si el JPEG viene truncado antes del SOF', () => {
    expect(jpegDimensions(Buffer.from([0xff, 0xd8]))).toBeNull();
    expect(jpegDimensions(jpegMinimo(320, 240).subarray(0, 10))).toBeNull();
  });

  it('termina (null) ante un segmento con longitud corrupta, sin colgarse', () => {
    // Longitud de segmento 0: el caso de bucle infinito del advisory de image-size.
    const corrupto = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
    expect(jpegDimensions(corrupto)).toBeNull();
  });
});
