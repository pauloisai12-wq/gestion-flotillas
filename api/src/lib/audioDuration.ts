// Duración best-effort de un contenedor ISO-BMFF (MP4/M4A/3GP): lee
// moov/mvhd (timescale + duration). Sin dependencias, sin decodificar. Devuelve
// null ante cualquier forma inesperada (AMR crudo "#!AMR", archivo truncado,
// mvhd fragmentado con duración 0xFFFFFFFF): la columna queda NULL y el
// navegador mide la duración al reproducir.

interface Caja {
  inicio: number; // primer byte del payload
  fin: number;    // exclusivo
}

/** Busca la primera caja `tipo` entre [desde, hasta). Soporta size=1 (64 bits) y size=0 (hasta el final). */
function buscarCaja(buf: Buffer, desde: number, hasta: number, tipo: string): Caja | null {
  let offset = desde;
  // El offset crece estrictamente en cada vuelta (size >= header): sin bucle infinito.
  while (offset + 8 <= hasta) {
    let size = buf.readUInt32BE(offset);
    const type = buf.toString('latin1', offset + 4, offset + 8);
    let header = 8;
    if (size === 1) {
      if (offset + 16 > hasta) return null;
      const grande = buf.readBigUInt64BE(offset + 8);
      if (grande > BigInt(Number.MAX_SAFE_INTEGER)) return null;
      size = Number(grande);
      header = 16;
    } else if (size === 0) {
      size = hasta - offset;
    }
    if (size < header) return null;
    const fin = Math.min(offset + size, hasta);
    if (type === tipo) return { inicio: offset + header, fin };
    offset += size;
  }
  return null;
}

export function duracionMsIsoBmff(buffer: Buffer): number | null {
  const moov = buscarCaja(buffer, 0, buffer.length, 'moov');
  if (!moov) return null;
  const mvhd = buscarCaja(buffer, moov.inicio, moov.fin, 'mvhd');
  if (!mvhd) return null;
  const p = mvhd.inicio;
  if (p + 4 > mvhd.fin) return null;
  const version = buffer[p];
  let timescale: number;
  let duration: number;
  if (version === 0) {
    // version(1) flags(3) creation(4) modification(4) timescale(4) duration(4)
    if (p + 20 > mvhd.fin) return null;
    timescale = buffer.readUInt32BE(p + 12);
    duration = buffer.readUInt32BE(p + 16);
    if (duration === 0xffffffff) return null;
  } else if (version === 1) {
    // version(1) flags(3) creation(8) modification(8) timescale(4) duration(8)
    if (p + 32 > mvhd.fin) return null;
    timescale = buffer.readUInt32BE(p + 20);
    const grande = buffer.readBigUInt64BE(p + 24);
    if (grande > BigInt(Number.MAX_SAFE_INTEGER)) return null;
    duration = Number(grande);
  } else {
    return null;
  }
  if (timescale === 0) return null;
  const ms = Math.round((duration * 1000) / timescale);
  // Tope INT4: la columna `duracion_ms` es INTEGER en Postgres. Un mvhd basura
  // (archivo truncado, timescale=1 con duración enorme) puede dar miles de
  // millones de ms; si eso llegara al `create`, Prisma lanzaría P2020 y la
  // subida moriría en 500 -> el móvil reintentaría el mismo segmento para
  // siempre. La duración es best-effort: ante un valor fuera de rango, null.
  return Number.isFinite(ms) && ms >= 0 && ms <= 2_147_483_647 ? ms : null;
}
