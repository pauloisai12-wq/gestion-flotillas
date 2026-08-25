// Almacenamiento content-addressed de los audios de encuesta. Se prueba contra
// un directorio temporal REAL (no un mock de fs): lo que importa aquí es el
// efecto en disco —bytes exactos, dedupe sin reescritura, sin .tmp huérfanos— y
// un doble de fs solo probaría que se llamó a fs.
//
// `vi.hoisted` fija ENCUESTAS_AUDIO_DIR ANTES de que se importe env.ts, que lee
// process.env una sola vez al cargarse.

import { afterAll, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const dir = await vi.hoisted(async () => {
  const fsm = await import('node:fs');
  const osm = await import('node:os');
  const pathm = await import('node:path');
  const d = fsm.mkdtempSync(pathm.join(osm.tmpdir(), 'enc-audio-'));
  process.env.ENCUESTAS_AUDIO_DIR = d;
  return d;
});

import {
  guardarAudio,
  rutaAbsolutaAudio,
  sha256Of,
} from '../../src/lib/encuestasAudioStorage';
import { audioM4aMinimo } from './audioFixtures';

afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('sha256Of', () => {
  it('coincide con el sha256 hex del contenido', () => {
    const buf = audioM4aMinimo({ relleno: 16 });
    expect(sha256Of(buf)).toBe(createHash('sha256').update(buf).digest('hex'));
  });
});

describe('guardarAudio', () => {
  it('escribe <sha>.m4a con los bytes exactos y devuelve la ruta relativa a /app/uploads', async () => {
    const buf = audioM4aMinimo({ duracionMs: 4_000, relleno: 128 });
    const sha = sha256Of(buf);

    const ruta = await guardarAudio(buf, sha);

    expect(ruta).toBe(`encuestas-audio/${sha}.m4a`);
    expect(fs.readFileSync(path.join(dir, `${sha}.m4a`)).equals(buf)).toBe(true);
  });

  it('no reescribe el blob si ya existe (dedupe física)', async () => {
    const buf = audioM4aMinimo({ duracionMs: 9_000, relleno: 200 });
    const sha = sha256Of(buf);
    await guardarAudio(buf, sha);

    // Centinela: se ensucia el archivo a propósito. Si la segunda llamada
    // reescribiera, el centinela desaparecería. Es una comprobación
    // determinista, a diferencia de comparar mtime (resolución de ms: dos
    // escrituras seguidas pueden compartir marca de tiempo y el test pasaría
    // igual siendo falso).
    const absoluta = path.join(dir, `${sha}.m4a`);
    fs.writeFileSync(absoluta, Buffer.from('CENTINELA'));

    const ruta = await guardarAudio(buf, sha);

    expect(ruta).toBe(`encuestas-audio/${sha}.m4a`);
    expect(fs.readFileSync(absoluta).toString()).toBe('CENTINELA');
  });

  it('no deja archivos temporales tras escribir', async () => {
    const buf = audioM4aMinimo({ duracionMs: 1_500, relleno: 32 });
    await guardarAudio(buf, sha256Of(buf));
    expect(fs.readdirSync(dir).filter((f) => f.endsWith('.tmp'))).toEqual([]);
  });

  it('rechaza un sha que no sea hex de 64 minúsculas (el nombre del blob ES el hash)', async () => {
    const buf = audioM4aMinimo({ relleno: 8 });
    // Mayúsculas: el contrato fija hex en minúsculas y el nombre del archivo se
    // deriva de él; admitirlas rompería la dedupe física en sistemas de
    // archivos sensibles a mayúsculas (dos blobs del mismo contenido).
    await expect(guardarAudio(buf, sha256Of(buf).toUpperCase())).rejects.toThrow(
      /sha256 inválido/,
    );
    await expect(guardarAudio(buf, 'XYZ')).rejects.toThrow(/sha256 inválido/);
  });
});

describe('rutaAbsolutaAudio', () => {
  it('resuelve la ruta guardada en BD dentro del directorio de audios', () => {
    const sha = 'a'.repeat(64);
    expect(rutaAbsolutaAudio(`encuestas-audio/${sha}.m4a`)).toBe(
      path.join(path.resolve(dir), `${sha}.m4a`),
    );
  });

  // El basename debe tener la forma content-addressed que escribe este módulo.
  // Cualquier otra cosa es una `ruta` corrupta en BD, no una lectura legítima:
  // lanzar es mejor que abrir un archivo arbitrario del directorio (o el propio
  // directorio, que es lo que devolvía `path.basename('/')`).
  it('rechaza una ruta con ../ en vez de quedarse con el basename', () => {
    expect(() => rutaAbsolutaAudio('../../etc/passwd')).toThrow(/Ruta de audio inválida/);
    expect(() => rutaAbsolutaAudio('encuestas-audio/../x.m4a')).toThrow(/Ruta de audio inválida/);
  });

  it('rechaza "/" (su basename es el propio directorio, no un blob)', () => {
    expect(() => rutaAbsolutaAudio('/')).toThrow(/Ruta de audio inválida/);
  });

  it('rechaza un basename que no sea <sha256 en minúsculas>.m4a', () => {
    expect(() => rutaAbsolutaAudio(`encuestas-audio/${'A'.repeat(64)}.m4a`)).toThrow(
      /Ruta de audio inválida/,
    );
    expect(() => rutaAbsolutaAudio(`encuestas-audio/${'a'.repeat(64)}.mp3`)).toThrow(
      /Ruta de audio inválida/,
    );
  });
});
