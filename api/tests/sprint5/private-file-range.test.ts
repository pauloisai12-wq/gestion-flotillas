// sendPrivateFile con `acceptRanges`: peticiones parciales (RFC 7233) sobre el
// mismo descriptor ya abierto. Es lo que el <audio> del navegador necesita para
// hacer seek en un m4a sin descargarlo entero, y lo que Task 5 encenderá para
// los audios de encuestas.
//
// Se ejercita por HTTP real (supertest) y no con un doble de Response: lo que
// se está comprobando son justamente los códigos y cabeceras que salen del
// socket (206/416, Content-Range, Content-Length, Accept-Ranges) y el recorte
// exacto de los bytes; un sink falso no probaría el `createReadStream({start,end})`.
//
// La última prueba es la red de seguridad para los callers que YA existen
// (qa-externa, maintenance, reportes): sin el flag, un Range entrante se ignora
// por completo y la respuesta es idéntica a la de antes de este cambio.

import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express, { NextFunction, Request, Response } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// El logger real arrastra la validación de entorno; aquí solo interesa que
// sendPrivateFile pueda invocarlo si un stream se rompe.
vi.mock('../../src/lib/logger', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { sendPrivateFile } from '../../src/lib/privateFileResponse';

const CONTENIDO = '0123456789';

let directorio: string;
let archivo: string;

function crearApp() {
  const app = express();
  // Dos rutas sobre el MISMO archivo: la única diferencia es el flag, para que
  // cualquier divergencia observable sea atribuible a él y a nada más.
  app.all('/con-rangos', (req: Request, res: Response, next: NextFunction) => {
    sendPrivateFile(req, res, archivo, {
      cacheControl: 'private, no-store',
      contentType: 'audio/mp4',
      acceptRanges: true,
    }).then((enviado) => {
      if (!enviado) res.status(404).end();
    }, next);
  });
  app.all('/sin-rangos', (req: Request, res: Response, next: NextFunction) => {
    sendPrivateFile(req, res, archivo, {
      cacheControl: 'private, no-store',
      contentType: 'audio/mp4',
    }).then((enviado) => {
      if (!enviado) res.status(404).end();
    }, next);
  });
  return app;
}

// `responseType('blob')` obliga a superagent a bufferizar el cuerpo tal cual en
// un Buffer: con audio/mp4 el parser por defecto no es de fiar para comparar bytes.
function cuerpo(respuesta: request.Response): string {
  return Buffer.isBuffer(respuesta.body)
    ? respuesta.body.toString('utf8')
    : String(respuesta.text ?? '');
}

beforeAll(async () => {
  directorio = await fs.mkdtemp(path.join(os.tmpdir(), 'private-file-range-'));
  archivo = path.join(directorio, 'segmento.m4a');
  await fs.writeFile(archivo, CONTENIDO);
});

afterAll(async () => {
  await fs.rm(directorio, { recursive: true, force: true });
});

describe('sendPrivateFile con acceptRanges', () => {
  it('sin Range sirve el archivo completo y anuncia Accept-Ranges', async () => {
    const respuesta = await request(crearApp())
      .get('/con-rangos')
      .responseType('blob')
      .expect(200);

    expect(Buffer.isBuffer(respuesta.body)).toBe(true);
    expect(cuerpo(respuesta)).toBe(CONTENIDO);
    expect(respuesta.headers['accept-ranges']).toBe('bytes');
    expect(respuesta.headers['content-length']).toBe('10');
    expect(respuesta.headers['content-range']).toBeUndefined();
  });

  it('bytes=2-5 devuelve 206 con solo ese tramo', async () => {
    const respuesta = await request(crearApp())
      .get('/con-rangos')
      .set('Range', 'bytes=2-5')
      .responseType('blob')
      .expect(206);

    expect(cuerpo(respuesta)).toBe('2345');
    expect(respuesta.headers['content-range']).toBe('bytes 2-5/10');
    expect(respuesta.headers['content-length']).toBe('4');
    expect(respuesta.headers['accept-ranges']).toBe('bytes');
  });

  it('bytes=7- llega hasta el final del archivo', async () => {
    const respuesta = await request(crearApp())
      .get('/con-rangos')
      .set('Range', 'bytes=7-')
      .responseType('blob')
      .expect(206);

    expect(cuerpo(respuesta)).toBe('789');
    expect(respuesta.headers['content-range']).toBe('bytes 7-9/10');
    expect(respuesta.headers['content-length']).toBe('3');
  });

  it('bytes=-3 se interpreta como los últimos 3 bytes, no como "desde el 3"', async () => {
    const respuesta = await request(crearApp())
      .get('/con-rangos')
      .set('Range', 'bytes=-3')
      .responseType('blob')
      .expect(206);

    expect(cuerpo(respuesta)).toBe('789');
    expect(respuesta.headers['content-range']).toBe('bytes 7-9/10');
    expect(respuesta.headers['content-length']).toBe('3');
  });

  it('bytes=0-99 recorta el final al último byte real y sirve todo', async () => {
    const respuesta = await request(crearApp())
      .get('/con-rangos')
      .set('Range', 'bytes=0-99')
      .responseType('blob')
      .expect(206);

    expect(cuerpo(respuesta)).toBe(CONTENIDO);
    expect(respuesta.headers['content-range']).toBe('bytes 0-9/10');
    expect(respuesta.headers['content-length']).toBe('10');
  });

  it('un inicio más allá del archivo es 416 con Content-Range de tamaño y sin cuerpo', async () => {
    const respuesta = await request(crearApp())
      .get('/con-rangos')
      .set('Range', 'bytes=100-')
      .responseType('blob')
      .expect(416);

    expect(Buffer.isBuffer(respuesta.body)).toBe(true);
    expect(cuerpo(respuesta)).toBe('');
    expect(respuesta.headers['content-range']).toBe('bytes */10');
    expect(respuesta.headers['cache-control']).toBe('private, no-store');
  });

  it('un tramo invertido (bytes=5-2) también es 416', async () => {
    const respuesta = await request(crearApp())
      .get('/con-rangos')
      .set('Range', 'bytes=5-2')
      .responseType('blob')
      .expect(416);

    expect(respuesta.headers['content-range']).toBe('bytes */10');
  });

  it('un Range multi-tramo se ignora y se responde 200 completo', async () => {
    const respuesta = await request(crearApp())
      .get('/con-rangos')
      .set('Range', 'bytes=0-1,3-4')
      .responseType('blob')
      .expect(200);

    expect(cuerpo(respuesta)).toBe(CONTENIDO);
    expect(respuesta.headers['content-length']).toBe('10');
    expect(respuesta.headers['content-range']).toBeUndefined();
  });

  it('HEAD con Range publica el 206 y su Content-Length sin leer el cuerpo', async () => {
    const respuesta = await request(crearApp())
      .head('/con-rangos')
      .set('Range', 'bytes=2-5')
      .responseType('blob')
      .expect(206);

    expect(cuerpo(respuesta)).toBe('');
    expect(respuesta.headers['content-range']).toBe('bytes 2-5/10');
    expect(respuesta.headers['content-length']).toBe('4');
  });

  it('sin el flag el Range se ignora por completo: 200, todo el archivo y sin Accept-Ranges', async () => {
    const respuesta = await request(crearApp())
      .get('/sin-rangos')
      .set('Range', 'bytes=2-5')
      .responseType('blob')
      .expect(200);

    expect(cuerpo(respuesta)).toBe(CONTENIDO);
    expect(respuesta.headers['content-length']).toBe('10');
    expect(respuesta.headers['accept-ranges']).toBeUndefined();
    expect(respuesta.headers['content-range']).toBeUndefined();
  });
});
