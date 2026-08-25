// Constructor de un M4A mínimo (ISO-BMFF): ftyp + mdat(relleno) + moov(mvhd).
// El moov va DESPUÉS del mdat a propósito: es como lo escribe MediaRecorder de
// Android, y obliga al parser a saltar cajas. Sirve para el test del parser de
// duración y como archivo "real" en los tests HTTP de subida.
function caja(tipo: string, payload: Buffer): Buffer {
  const cabecera = Buffer.alloc(8);
  cabecera.writeUInt32BE(8 + payload.length, 0);
  cabecera.write(tipo, 4, 'latin1');
  return Buffer.concat([cabecera, payload]);
}

export function mvhdV0(duracionMs: number, timescale = 1000): Buffer {
  const p = Buffer.alloc(100); // version+flags(4) + 96 bytes de campos v0
  p.writeUInt32BE(timescale, 12);
  p.writeUInt32BE(Math.round((duracionMs * timescale) / 1000), 16);
  return caja('mvhd', p);
}

export function mvhdV1(duracionMs: number, timescale = 1000): Buffer {
  const p = Buffer.alloc(112);
  p[0] = 1;
  p.writeUInt32BE(timescale, 20);
  p.writeBigUInt64BE(BigInt(Math.round((duracionMs * timescale) / 1000)), 24);
  return caja('mvhd', p);
}

export function audioM4aMinimo(opts: { duracionMs?: number; timescale?: number; relleno?: number; mvhd?: Buffer } = {}): Buffer {
  const { duracionMs = 12_345, timescale = 1000, relleno = 64 } = opts;
  const ftyp = caja('ftyp', Buffer.from('M4A \0\0\0\0M4A mp42isom', 'latin1'));
  const mdat = caja('mdat', Buffer.alloc(relleno, 0xab));
  const moov = caja('moov', opts.mvhd ?? mvhdV0(duracionMs, timescale));
  return Buffer.concat([ftyp, mdat, moov]);
}

export const AMR_CRUDO = Buffer.concat([Buffer.from('#!AMR\n', 'latin1'), Buffer.alloc(40, 0x3c)]);
