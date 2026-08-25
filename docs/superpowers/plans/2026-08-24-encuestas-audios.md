# Audios de encuestas (Encuestas Okrean) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Recibir los audios grabados durante cada encuesta (`POST /api/v1/encuestas/{idLocal}/audios`, multipart, 1..N segmentos por encuesta), mostrarlos/reproducirlos en el portal del revisor, y alinear el catálogo P8 de la v4 con el contrato del equipo móvil.

**Architecture:** Tabla hija `encuestas_audios` (unique `(encuesta_id, segmento)`), blob content-addressed en `ENCUESTAS_AUDIO_DIR/<sha256>.m4a` (escrito antes de la fila, atómico), ruta nueva en el MISMO router de ingesta (misma API key, mismo cubo de rate-limit), 404 anidado exacto del contrato ANTES de parsear el multipart, dedup por `(encuesta, segmento, sha256)` con un reintento ante P2002. Lectura: `GET /api/encuestas/:id` (detalle + audios) y `GET|HEAD /api/encuestas/:id/audios/:audioId` servido con `sendPrivateFile` + soporte `Range`. Web: filtro/indicador en el listado y página de detalle con `<audio>`.

**Tech Stack:** Node 20 · Express 4 · TS 5 · zod 4 (`zod` plano en la cara dispositivo, `zod/v4` en la de revisor) · multer 2 (memoryStorage) · Prisma 6.19 · PostgreSQL 16 · vitest + supertest · Next.js 16 / React 19 · TanStack Query/Table.

**Spec:** `docs/superpowers/specs/2026-08-24-encuestas-audios-design.md` (diseño aprobado por el usuario el 24 ago 2026; es la autoridad ante cualquier duda de este plan).

## Global Constraints

- Rama de trabajo: **`feat/encuestas-audios`** (ya creada desde `main` = `924de93`). Todos los tasks committean ahí. NUNCA tocar `feat/qa-externa-comites`.
- **WSL + node_modules de Windows:** todo `npm`/`npx` dentro de `api/` y `web/` se corre vía `cmd.exe /c "..."` (los binarios nativos de vitest/esbuild/Tailwind son de Windows). vitest SIEMPRE con salida a log para no inundar el contexto:
  `cd api && cmd.exe /c "set NO_COLOR=1&& npx vitest run tests/sprint5/<archivo>.test.ts --reporter=dot > ../.superpowers/sdd/2026-08-24-encuestas-audios/vitest-<archivo>.log 2>&1"; tail -40 ../.superpowers/sdd/2026-08-24-encuestas-audios/vitest-<archivo>.log`.
  `npx tsc --noEmit` y `npx prisma validate|generate` sí corren nativos en WSL.
- Los tests de sprint5 usan Prisma en memoria y mocks: **no necesitan Postgres ni Redis**. El CI ya corre `npm run test:sprint5`: todo test nuevo va en `api/tests/sprint5/`.
- El módulo de encuestas **no importa nada de qa_externa** (ni `qaExternaStorage`, ni sus validators): debe poder borrarse entero. Sí puede usar libs transversales (`privateFileResponse`, `http.ts`, `errorHandler`, `asyncHandler`, `rateLimit`).
- **No loguear contenido**: ni bodies, ni bytes del audio, ni API keys. Solo `requestId`/ids.
- **Contrato del cliente móvil para `POST /api/v1/encuestas/{idLocal}/audios` (RÍGIDO, el cliente ya está escrito):**
  - Partes multipart (nombres exactos): `segmento` (p. ej. `seg1.m4a`), `sha256` (hex 64 minúsculas), `tamano_bytes` (entero > 0), `audio` (binario). `Authorization: Bearer <device_api_key>` (misma key que `/api/v1/encuestas`).
  - `{idLocal}` es el UUID que la encuesta trajo en su JSON; se resuelve **dentro del dispositivo autenticado** (encuesta de otro dispositivo ≡ inexistente).
  - Encuesta desconocida → **`404` con cuerpo EXACTO `{"error":{"code":"ENCUESTA_NO_ENCONTRADA"}}`** (sin `requestId`, sin `message`). Es la ÚNICA envolvente anidada del API (desviación deliberada del `{error:string,code,requestId}` del repo).
  - Éxito → `201` (creado) o `200` (ya existía) con `{"audio_id":"<string no vacío>"}`; nunca 2xx sin `audio_id`; nunca 2xx antes de persistir el archivo.
  - Hash o tamaño no coinciden, parte faltante, campo inválido → **`422`** `{error:'Datos inválidos', code:'VALIDATION_ERROR', issues:[{field,message}], requestId}`. **NUNCA 400** en esta ruta (el cliente trata 400 como transitorio y reintentaría para siempre).
  - Archivo > `ENCUESTAS_AUDIO_MAX_FILE_SIZE_MB` → **`413`** `{error, code:'PAYLOAD_TOO_LARGE', requestId}` (desviación deliberada: el resto del repo mapea multer a 400).
  - Dedup por `(encuesta, segmento, sha256)`: reenvío idéntico → `200` con el **mismo** `audio_id` sin reescribir el archivo. Mismo `(encuesta, segmento)` con sha distinto → reemplaza contenido, `200`, mismo `audio_id`. Dos segmentos distintos con bytes idénticos → dos filas (el blob se comparte).
  - `401` solo del middleware de dispositivo; `429` + `Retry-After` solo del rate-limit; **no usar 409**; `GET` en la ruta → `405` (red de seguridad).
- **Catálogo P8 v4 (`preferenciaElectoral`) = exactamente** `irineo_molina | fernando_huerta | lalo_ximenez | paco_nino | ana_gabriela_delgado | goyo_castaneda | otro | no_sabe_no_contesta`. `paola_barrera` sale de v4 y sigue válida en v3. P9 no cambia.
- Comentarios densos en español explicando el porqué (estilo del repo). Commits en español con prefijo `feat(encuestas):` / `test(encuestas):` / `docs(encuestas):` / `fix(encuestas):`, terminados en:
  ```
  Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01QSW9NZkT7fa1Jp1sfFuUnB
  ```
- Si `git commit` falla por `index.lock`, esperar 2 s y reintentar (otro proceso puede estar tocando el índice).

---

### Task 1: Catálogo P8 de la v4 alineado al contrato

**Files:**
- Modify: `api/src/validators/encuestasIngestValidator.ts:70-72`
- Modify: `api/tests/sprint5/encuestas-validator.test.ts:747-756`
- Modify: `docs/encuestas-okrean.md` (líneas ~212-236) y `docs/encuestas-okrean-openapi.yaml` (~497-506)

**Interfaces:**
- Produces: `PREFERENCIAS_ELECTORALES_V4` con los 8 códigos del contrato. Nada más cambia (el canónico `api/src/lib/encuestasCanonical.ts` pasa el valor como dato; las golden hashes usan `lalo_ximenez`/`otro` y NO se tocan).

- [ ] **Step 1: Validator**

En `api/src/validators/encuestasIngestValidator.ts` sustituir el bloque:

```ts
// P8 de la v4 NO es un superconjunto de v3: el cuestionario v4 retiró a
// paola_barrera (sigue válida en registros v3) y añadió a paco_nino y
// goyo_castaneda. Lista EXACTA al contrato del equipo móvil (24 ago 2026).
export const PREFERENCIAS_ELECTORALES_V4 = [
  'irineo_molina', 'fernando_huerta', 'lalo_ximenez', 'paco_nino', 'ana_gabriela_delgado', 'goyo_castaneda', 'otro', 'no_sabe_no_contesta',
] as const;
```

- [ ] **Step 2: Test**

En `api/tests/sprint5/encuestas-validator.test.ts` reemplazar el `it('acepta todos los candidatos de v3 en v4 SIN campo de texto', …)` (líneas 747-756) por dos tests. Importar `PREFERENCIAS_ELECTORALES_V4` y `PREFERENCIAS_ELECTORALES_V3` desde el validator (añadir al `import {…} from '../../src/validators/encuestasIngestValidator'` existente; comprobar que el schema v3 se prueba con el helper de v3 que ya use el archivo — buscar `conRespuestasV3`/`encuestaCompletaValida`):

```ts
    it('acepta todos los candidatos del catálogo v4 (salvo "otro", que exige texto) SIN campo de texto', () => {
      for (const candidato of PREFERENCIAS_ELECTORALES_V4) {
        if (candidato === 'otro') continue;
        const payload = conRespuestasV4({
          preferenciaElectoral: candidato,
          preferenciaElectoralOtro: undefined,
        });
        expect(acepta(payload), `falla con candidato ${candidato}`).toBe(true);
      }
    });

    it('paola_barrera queda fuera de v4 pero sigue válida en v3', () => {
      expect(PREFERENCIAS_ELECTORALES_V4).not.toContain('paola_barrera');
      expect(PREFERENCIAS_ELECTORALES_V3).toContain('paola_barrera');
      expect(acepta(conRespuestasV4({ preferenciaElectoral: 'paola_barrera', preferenciaElectoralOtro: undefined }))).toBe(false);
      // v3: usar el fixture/helper v3 del archivo con preferenciaElectoral: 'paola_barrera' → true
    });

    it('acepta paco_nino y goyo_castaneda en v4 (añadidos por el cuestionario v4)', () => {
      for (const candidato of ['paco_nino', 'goyo_castaneda']) {
        expect(acepta(conRespuestasV4({ preferenciaElectoral: candidato, preferenciaElectoralOtro: undefined }))).toBe(true);
      }
    });
```

- [ ] **Step 3: Docs**

`docs/encuestas-okrean.md`: en "Contenido de `respuestas` (v4)" (punto 1) reescribir la viñeta de `preferenciaElectoral` como "cambia de catálogo (NO es v3 + dos códigos): `irineo_molina`, `fernando_huerta`, `lalo_ximenez`, `paco_nino`, `ana_gabriela_delgado`, `goyo_castaneda`, `otro`, `no_sabe_no_contesta`. `paola_barrera` ya no se envía en v4 (sigue siendo válida en registros v3)". Actualizar la fila **Preferencia electoral** de "Catálogos de v4". Añadir una frase: "Filas v4 ya guardadas con `paola_barrera` (si las hubiera) siguen leyéndose y exportándose; solo un reenvío idéntico devolvería 422". `docs/encuestas-okrean-openapi.yaml`: enum de `PreferenciaElectoralV4` (NO tocar `PreferenciaElectoralV3`) + su `description`.

- [ ] **Step 4: Verificar y commit**

`cd api && npx tsc --noEmit` y el test del validador vía cmd.exe a log (patrón de Global Constraints). Commit: `fix(encuestas): catálogo P8 de la v4 alineado al contrato móvil`.

---

### Task 2: Modelo, migración, config, almacenamiento y duración

**Files:**
- Modify: `api/prisma/schema.prisma` (modelo `Encuesta` + modelo nuevo)
- Create: `api/prisma/migrations/20260824120000_add_encuestas_audios/migration.sql`
- Modify: `api/src/config/env.ts` (dos vars tras `ENCUESTAS_KEY_PEPPER`)
- Modify: `api/Dockerfile` (mkdir), `api/src/index.ts` (ensure dir junto a `ensureQaExternaDir`, líneas ~364-370)
- Create: `api/src/lib/encuestasAudioStorage.ts`, `api/src/lib/audioDuration.ts`
- Create: `api/tests/sprint5/audioFixtures.ts`, `api/tests/sprint5/audio-duration.test.ts`, `api/tests/sprint5/encuestas-audio-storage.test.ts`

**Interfaces:**
- Produces: modelo Prisma `EncuestaAudio` (relación `audios` en `Encuesta`; clave compuesta `encuestaId_segmento`); `env.ENCUESTAS_AUDIO_DIR`, `env.ENCUESTAS_AUDIO_MAX_FILE_SIZE_MB`; `sha256Of(buffer)`, `guardarAudio(buffer, sha256) → Promise<string /*ruta relativa*/>`, `rutaAbsolutaAudio(ruta)`, `ensureEncuestasAudioDir()`; `duracionMsIsoBmff(buffer): number | null`; fixture `audioM4aMinimo({ duracionMs, timescale, relleno })`.

- [ ] **Step 1: schema.prisma**

Añadir `audios EncuestaAudio[]` al modelo `Encuesta` (junto a la relación `dispositivo`). Añadir tras `Encuesta`:

```prisma
/// Segmento de audio grabado durante una encuesta. La app graba un archivo por
/// tramo (pausa/reanudación como borrador) y los sube uno a uno DESPUÉS de que
/// la encuesta fue aceptada. Los segmentos son inmutables: nunca se regraba
/// `segmento`, siempre nace `segN+1`. Sin `dispositivo_id`: quien sube es por
/// contrato el dueño de la encuesta (se resuelve dentro del dispositivo
/// autenticado), así que se deriva de `encuesta.dispositivo`.
model EncuestaAudio {
  id            Int      @id @default(autoincrement())
  encuestaId    Int      @map("encuesta_id")
  /// Nombre de archivo lógico que manda la app (`seg1.m4a`). Único por encuesta.
  segmento      String   @db.VarChar(64)
  /// SHA-256 hex del contenido. NO es único por encuesta: dos segmentos con
  /// bytes idénticos son dos filas que apuntan al mismo blob.
  sha256        String   @db.Char(64)
  tamanoBytes   Int      @map("tamano_bytes")
  /// Content-Type declarado por el multipart. No se valida ni se confía en él
  /// más allá de elegir el Content-Type con que se sirve.
  mimeDeclarado String?  @map("mime_declarado") @db.VarChar(120)
  /// Relativa a /app/uploads: `encuestas-audio/<sha256>.m4a`.
  ruta          String
  /// Best-effort (mvhd de ISO-BMFF). NULL = no se pudo calcular (p. ej. AMR).
  duracionMs    Int?     @map("duracion_ms")
  recibidoEn    DateTime @default(now()) @map("recibido_en")
  createdAt     DateTime @default(now()) @map("created_at")
  updatedAt     DateTime @updatedAt @map("updated_at")
  encuesta      Encuesta @relation(fields: [encuestaId], references: [id], onDelete: Cascade)

  @@unique([encuestaId, segmento])
  @@index([sha256])
  @@map("encuestas_audios")
}
```

- [ ] **Step 2: Migración** (`api/prisma/migrations/20260824120000_add_encuestas_audios/migration.sql`) — PURAMENTE ADITIVA, sin `DROP`/`DELETE`/`TRUNCATE` (el gate `check-qa-migrations-safe.js` protege `encuestas*`):

```sql
-- Módulo "Encuestas Okrean": audios grabados durante la encuesta (1..N
-- segmentos por encuesta). Migración PURAMENTE ADITIVA: una tabla hija nueva
-- con su unique, su índice y su FK. No toca ninguna fila ni columna existente.

-- CreateTable
CREATE TABLE "encuestas_audios" (
    "id" SERIAL NOT NULL,
    "encuesta_id" INTEGER NOT NULL,
    "segmento" VARCHAR(64) NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "tamano_bytes" INTEGER NOT NULL,
    "mime_declarado" VARCHAR(120),
    "ruta" TEXT NOT NULL,
    "duracion_ms" INTEGER,
    "recibido_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "encuestas_audios_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "encuestas_audios_encuesta_id_segmento_key" ON "encuestas_audios"("encuesta_id", "segmento");

-- CreateIndex
CREATE INDEX "encuestas_audios_sha256_idx" ON "encuestas_audios"("sha256");

-- AddForeignKey
ALTER TABLE "encuestas_audios" ADD CONSTRAINT "encuestas_audios_encuesta_id_fkey" FOREIGN KEY ("encuesta_id") REFERENCES "encuestas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

- [ ] **Step 3: env.ts** — tras `ENCUESTAS_KEY_PEPPER`, mismo patrón que `QA_EXTERNA_DIR`/`QA_EXTERNA_MAX_FILE_SIZE_MB`:

```ts
  // Audios de encuesta (POST /api/v1/encuestas/:idLocal/audios). Bajo
  // /app/uploads para que lo cubran los mismos volúmenes/bind mounts que las
  // fotos de qa_externa. 50 MB es el "sugerido" del contrato móvil (~3.5 h de
  // AAC a 32 kbps); el operador puede bajarlo sin tocar código. NO van en las
  // plantillas .env: opcionales con default, como el resto de ENCUESTAS_*.
  ENCUESTAS_AUDIO_DIR: z.string().default('/app/uploads/encuestas-audio'),
  ENCUESTAS_AUDIO_MAX_FILE_SIZE_MB: z.coerce.number().int().min(1).max(100).default(50),
```

- [ ] **Step 4: Dockerfile e index.ts**

`api/Dockerfile`: añadir `/app/uploads/encuestas-audio \` en el `mkdir -p` (entre `qa-externa/lx` y `storage/reports`). `api/src/index.ts`: importar `ensureEncuestasAudioDir` y llamarla dentro del MISMO `try` que `ensureQaExternaDir()` (best-effort, log de error; NO tocar `ensureUploadDirectories()`, que es fail-closed y `__dirname`-relativo).

- [ ] **Step 5: `api/src/lib/encuestasAudioStorage.ts`**

```ts
// Almacenamiento content-addressed de los audios de encuesta: cada blob vive
// una sola vez como <sha256>.m4a bajo ENCUESTAS_AUDIO_DIR (subdir del bind
// mount /app/uploads). Se guarda TAL CUAL llega —sin transcodificar ni validar
// formato: archivos antiguos pueden ser 3GP/AMR con extensión .m4a— y la
// escritura es atómica (tmp + fsync + rename): el POST solo responde 2xx cuando
// el archivo está persistido, y una lectura concurrente nunca ve un archivo a
// medias. Módulo propio de encuestas: NO importa nada de qa_externa.

import { createHash, randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';
import { env } from '../config/env';

const SHA256_RE = /^[a-f0-9]{64}$/;
const SUBDIR = 'encuestas-audio';

export function sha256Of(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

/** Crea el directorio (idempotente). Best-effort al arranque; se reintenta al escribir. */
export async function ensureEncuestasAudioDir(): Promise<void> {
  await fs.mkdir(env.ENCUESTAS_AUDIO_DIR, { recursive: true });
}

function nombreArchivo(sha256: string): string {
  if (!SHA256_RE.test(sha256)) throw new Error('sha256 inválido para nombre de archivo');
  // Derivado de un hex validado + basename: no es input crudo (nosemgrep).
  return path.basename(`${sha256}.m4a`);
}

/**
 * Ruta absoluta de un blob a partir de la `ruta` guardada en BD. Solo se usa el
 * basename y se comprueba que quede bajo ENCUESTAS_AUDIO_DIR: la BD es de
 * confianza, pero la comprobación cuesta una línea.
 */
export function rutaAbsolutaAudio(ruta: string): string {
  const baseDir = path.resolve(env.ENCUESTAS_AUDIO_DIR);
  const absoluta = path.resolve(baseDir, path.basename(ruta)); // nosemgrep
  if (!absoluta.startsWith(baseDir + path.sep)) throw new Error('Ruta de audio inválida');
  return absoluta;
}

/**
 * Escribe el blob si no existe y devuelve su ruta relativa a /app/uploads
 * (`encuestas-audio/<sha256>.m4a`). Si ya existe (mismo contenido = mismo
 * nombre), no lo toca: es la dedupe física.
 */
export async function guardarAudio(buffer: Buffer, sha256: string): Promise<string> {
  const filename = nombreArchivo(sha256);
  const dir = path.resolve(env.ENCUESTAS_AUDIO_DIR);
  const absoluta = path.join(dir, filename); // nosemgrep
  const ruta = `${SUBDIR}/${filename}`;
  try {
    await fs.access(absoluta);
    return ruta;
  } catch {
    // No existe todavía: se escribe abajo.
  }
  await fs.mkdir(dir, { recursive: true });
  const tmp = path.join(dir, `.${filename}.${randomUUID()}.tmp`); // nosemgrep
  try {
    const fh = await fs.open(tmp, 'wx');
    try {
      await fh.writeFile(buffer);
      await fh.sync();
    } finally {
      await fh.close();
    }
    await fs.rename(tmp, absoluta);
  } catch (err) {
    await fs.rm(tmp, { force: true }).catch(() => undefined);
    throw err;
  }
  return ruta;
}
```

- [ ] **Step 6: `api/src/lib/audioDuration.ts`**

```ts
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
  return Number.isFinite(ms) && ms >= 0 ? ms : null;
}
```

- [ ] **Step 7: Fixture y tests**

`api/tests/sprint5/audioFixtures.ts`:

```ts
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
```

`api/tests/sprint5/audio-duration.test.ts`: v0 → 12345; v1 → 90_000 con timescale 48000; `moov` tras `mdat` (ya lo hace la fixture) → ok; `AMR_CRUDO` → null; `Buffer.alloc(3)` → null; mvhd v0 con timescale 0 → null; duración 0xFFFFFFFF → null; caja con size=1 (64 bits) → se salta correctamente (construir un `free` con size=1 antes del moov).

`api/tests/sprint5/encuestas-audio-storage.test.ts`: `vi.hoisted` asíncrono que fija `process.env.ENCUESTAS_AUDIO_DIR` a un `fs.mkdtempSync(path.join(os.tmpdir(), 'enc-audio-'))` ANTES de importar (patrón: `const dir = await vi.hoisted(async () => { const fs = await import('node:fs'); const os = await import('node:os'); const path = await import('node:path'); const d = fs.mkdtempSync(path.join(os.tmpdir(), 'enc-audio-')); process.env.ENCUESTAS_AUDIO_DIR = d; return d; });`), `afterAll` lo borra. Tests: `guardarAudio` crea `<sha>.m4a` con los bytes exactos y devuelve `encuestas-audio/<sha>.m4a`; segunda llamada con el mismo sha no reescribe (mtime idéntico) ; no quedan `.tmp`; `rutaAbsolutaAudio('encuestas-audio/<sha>.m4a')` apunta dentro del dir; `rutaAbsolutaAudio('../../etc/passwd')` no escapa (usa basename → queda `dir/passwd`); `sha256Of` coincide con `createHash`.

- [ ] **Step 8: Verificar y commit**

`cd api && npx prisma validate && npx prisma generate && npx tsc --noEmit`; los dos tests vía cmd.exe a log; `node scripts/check-qa-migrations-safe.js`. Commit: `feat(encuestas): modelo, migración y almacenamiento de audios de encuesta`.

---

### Task 3: `sendPrivateFile` con soporte `Range`

**Files:**
- Modify: `api/src/lib/privateFileResponse.ts`
- Create: `api/tests/sprint5/private-file-range.test.ts`

**Interfaces:**
- Produces: opción `acceptRanges?: boolean` en `PrivateFileOptions`. Con el flag apagado (default) el comportamiento es byte a byte el actual (todos los callers existentes intactos).

- [ ] **Step 1: Implementación**

Añadir a `PrivateFileOptions`: `/** Anuncia Accept-Ranges y atiende un Range de UN solo tramo (206/416). Para media que el navegador busca (seek). */ acceptRanges?: boolean;`

Helper (mismo archivo):

```ts
type Rango = { start: number; end: number } | 'insatisfacible' | null;

/**
 * Un solo tramo `bytes=a-b`, `bytes=a-` o `bytes=-n` (RFC 7233). Cualquier otra
 * sintaxis (multi-rango, otra unidad) se IGNORA y se sirve el archivo completo:
 * es lo que el estándar permite y lo que el <audio> del navegador espera; un
 * tramo fuera del archivo es 416.
 */
function rangoSolicitado(header: string | undefined, size: number): Rango {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m || (m[1] === '' && m[2] === '')) return null;
  if (size === 0) return 'insatisfacible';
  if (m[1] === '') {
    const n = Number(m[2]);
    if (n === 0) return 'insatisfacible';
    return { start: Math.max(0, size - n), end: size - 1 };
  }
  const start = Number(m[1]);
  const end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
  if (start >= size || start > end) return 'insatisfacible';
  return { start, end };
}
```

En `sendPrivateFile`, tras `if (!stat.isFile()) return false;` y ANTES de `Content-Length`:

```ts
    let status = 200;
    let tramo: { start: number; end: number } | undefined;
    if (options.acceptRanges) {
      res.setHeader('Accept-Ranges', 'bytes');
      const rango = rangoSolicitado(req.headers.range, stat.size);
      if (rango === 'insatisfacible') {
        res.setHeader('Content-Range', `bytes */${stat.size}`);
        res.setHeader('Cache-Control', options.cacheControl);
        res.status(416).end();
        return true;
      }
      if (rango) {
        tramo = rango;
        status = 206;
        res.setHeader('Content-Range', `bytes ${rango.start}-${rango.end}/${stat.size}`);
      }
    }
```

`Content-Length` = `tramo ? tramo.end - tramo.start + 1 : stat.size`; HEAD → `res.status(status).end()`; el stream → `handle.createReadStream({ autoClose: false, ...(tramo ?? {}) })` y `res.status(status)` antes del `pipeline`. Actualizar el comentario de cabecera del helper.

- [ ] **Step 2: Test** (`api/tests/sprint5/private-file-range.test.ts`)

App express mínima con una ruta que llama `sendPrivateFile(req, res, archivoTmp, { cacheControl: 'private, no-store', contentType: 'audio/mp4', acceptRanges: true })` (y otra ruta SIN `acceptRanges`), archivo temporal de 10 bytes `0123456789` (mkdtemp en `beforeAll`, borrado en `afterAll`). Casos: sin `Range` → 200, cuerpo completo, `Accept-Ranges: bytes`, `Content-Length: 10`; `Range: bytes=2-5` → 206, cuerpo `2345`, `Content-Range: bytes 2-5/10`, `Content-Length: 4`; `bytes=7-` → 206 `789`; `bytes=-3` → 206 `789`, `Content-Range: bytes 7-9/10`; `bytes=100-` → 416 + `Content-Range: bytes */10` sin cuerpo; `bytes=5-2` → 416; `bytes=0-99` → 206 cuerpo completo (end recortado a 9); `Range: bytes=0-1,3-4` → 200 completo (multi-rango ignorado); HEAD con `bytes=2-5` → 206 sin cuerpo y `Content-Length: 4`; ruta sin `acceptRanges` + `Range: bytes=2-5` → 200 completo y sin `Accept-Ranges`. Usar `request(app).get(...).set('Range', ...)` y `.buffer(true).parse(...)`? — supertest con `Content-Type: audio/mp4` entrega `response.body` como Buffer; si no, usar `.responseType('blob')`/`.buffer()` y comparar `response.body.toString()`; el implementador comprueba cuál funciona.

- [ ] **Step 3: Verificar y commit**

`npx tsc --noEmit`, el test a log, y además el test existente que use `sendPrivateFile` si lo hay (grep en `api/tests`). Commit: `feat(api): sendPrivateFile atiende Range de un tramo para media con seek`.

---

### Task 4: Endpoint `POST /api/v1/encuestas/:idLocal/audios`

**Files:**
- Create: `api/src/validators/encuestasAudioValidator.ts`, `api/src/services/encuestasAudioService.ts`
- Modify: `api/src/routes/encuestasIngestRouter.ts`
- Create: `api/tests/sprint5/encuestas-audios-http.test.ts`, `api/tests/sprint5/encuestas-audios-service.test.ts`

**Interfaces:**
- Consumes (Task 2): `env.ENCUESTAS_AUDIO_MAX_FILE_SIZE_MB`, `sha256Of`, `guardarAudio`, `duracionMsIsoBmff`, modelo `encuestaAudio` (clave compuesta `encuestaId_segmento`), fixture `audioM4aMinimo`.
- Produces: `audioCamposSchema`, `guardarAudioEncuesta(input)` / `guardarAudioEncuestaWithDeps(input, deps)`, ruta HTTP con el contrato de Global Constraints.

- [ ] **Step 1: Validator** (`api/src/validators/encuestasAudioValidator.ts`, `import { z } from 'zod'` — subpath plano como la cara de dispositivo):

```ts
// Campos de texto del multipart de POST /api/v1/encuestas/:idLocal/audios. Es la
// cara de DISPOSITIVO (zod plano + safeParse manual, 422 inline), no la del
// revisor. Los valores llegan como strings (multer no convierte nada), de ahí
// que tamano_bytes se valide como texto y se convierta después.

import { z } from 'zod';

export const SEGMENTO_RE = /^[A-Za-z0-9._-]{1,64}$/;
export const SHA256_HEX_RE = /^[a-f0-9]{64}$/;
// 10 dígitos como máximo: cualquier entero que quepa en INTEGER de Postgres.
const ENTERO_POSITIVO_RE = /^[1-9]\d{0,9}$/;

export const audioCamposSchema = z.object({
  segmento: z.string().regex(SEGMENTO_RE, 'segmento debe ser un nombre simple (letras, dígitos, ".", "_", "-"; máximo 64)'),
  sha256: z.string().regex(SHA256_HEX_RE, 'sha256 debe ser hexadecimal de 64 caracteres en minúsculas'),
  tamano_bytes: z
    .string()
    .regex(ENTERO_POSITIVO_RE, 'tamano_bytes debe ser un entero positivo')
    .transform(Number)
    .refine((n) => n <= 2_147_483_647, 'tamano_bytes fuera de rango'),
});

export type AudioCampos = z.infer<typeof audioCamposSchema>;
```

- [ ] **Step 2: Servicio** (`api/src/services/encuestasAudioService.ts`) — SIN `$transaction` (misma filosofía que `encuestasIngestService.ts`: una escritura y un reintento; el UNIQUE es quien arbitra la carrera):

```ts
// Persistencia de un segmento de audio ya validado (hash y tamaño comprobados
// por el router). Orden: blob a disco PRIMERO (content-addressed, atómico) y
// fila DESPUÉS: nunca existe una fila sin archivo; a lo sumo un blob huérfano si
// la BD falla, que el siguiente reintento reutiliza.
//
//   findUnique(encuestaId, segmento)
//     sin fila            → create → {created:true}
//     misma sha256        → {created:false}, mismo id (reenvío idempotente)
//     sha256 distinta     → update (gana el último) → {created:false}, mismo id
//   P2002 en el create    → un reintento entero (la carrera la ganó otro POST)

import type { PrismaClient } from '@prisma/client';
import prisma from '../lib/prisma';
import { isPrismaKnownError } from '../middlewares/errorHandler';
import { guardarAudio } from '../lib/encuestasAudioStorage';
import { duracionMsIsoBmff } from '../lib/audioDuration';

export interface GuardarAudioInput {
  encuestaId: number;
  segmento: string;
  sha256: string;
  tamanoBytes: number;
  mimeDeclarado: string | null;
  buffer: Buffer;
}

export interface GuardarAudioResult {
  audioId: number;
  created: boolean;
}

export interface GuardarAudioDeps {
  db: Pick<PrismaClient, 'encuestaAudio'>;
  guardarEnDisco: (buffer: Buffer, sha256: string) => Promise<string>;
}

export function guardarAudioEncuesta(input: GuardarAudioInput): Promise<GuardarAudioResult> {
  return guardarAudioEncuestaWithDeps(input, { db: prisma, guardarEnDisco: guardarAudio });
}

export async function guardarAudioEncuestaWithDeps(
  input: GuardarAudioInput,
  deps: GuardarAudioDeps,
): Promise<GuardarAudioResult> {
  const ruta = await deps.guardarEnDisco(input.buffer, input.sha256);
  const duracionMs = duracionMsIsoBmff(input.buffer);
  const { encuestaId, segmento, sha256, tamanoBytes, mimeDeclarado } = input;

  const escribir = async (): Promise<GuardarAudioResult> => {
    const existente = await deps.db.encuestaAudio.findUnique({
      where: { encuestaId_segmento: { encuestaId, segmento } },
      select: { id: true, sha256: true },
    });
    if (existente) {
      if (existente.sha256 === sha256) return { audioId: existente.id, created: false };
      // Por contrato los segmentos son inmutables; si aun así llega otro
      // contenido, se reemplaza y el audio_id no cambia (lo pide el contrato).
      await deps.db.encuestaAudio.update({
        where: { id: existente.id },
        data: { sha256, tamanoBytes, mimeDeclarado, ruta, duracionMs, recibidoEn: new Date() },
        select: { id: true },
      });
      return { audioId: existente.id, created: false };
    }
    const fila = await deps.db.encuestaAudio.create({
      data: { encuestaId, segmento, sha256, tamanoBytes, mimeDeclarado, ruta, duracionMs },
      select: { id: true },
    });
    return { audioId: fila.id, created: true };
  };

  try {
    return await escribir();
  } catch (e) {
    if (!isPrismaKnownError(e, 'P2002')) throw e;
    return escribir();
  }
}
```

- [ ] **Step 3: Router** (`api/src/routes/encuestasIngestRouter.ts`) — añadir imports (`multer`, `RequestHandler`, `prisma` desde `../lib/prisma`, `audioCamposSchema`, `sha256Of`, `guardarAudioEncuesta`) y, tras `perDeviceLimit`, este bloque. Actualizar el comentario de cabecera del archivo (ahora también audios; la 4ª regla: el 404 anidado):

```ts
// ─── Audios de la encuesta ───────────────────────────────────────────────────
//
// POST /:idLocal/audios (multipart). Cuatro reglas del contrato que difieren del
// resto del repo y NO se "arreglan":
//   1. Encuesta desconocida (o de otro dispositivo) → 404 con cuerpo EXACTO
//      {"error":{"code":"ENCUESTA_NO_ENCONTRADA"}}. Es la única envolvente
//      anidada del API: el cliente distingue por ese código "encuesta
//      desconocida, reintentar luego" de "la ruta no existe, cortar la pasada".
//      Sin requestId ni message: el cliente no los espera.
//   2. Archivo demasiado grande → 413 (rechazo definitivo del segmento), aunque
//      el errorHandler global mapea multer a 400.
//   3. Toda validación → 422 con issues[]. NUNCA 400: el cliente lo trata como
//      transitorio y reencolaría el archivo para siempre.
//   4. Se resuelve la encuesta ANTES de parsear el multipart: un idLocal
//      desconocido no debe costar 50 MB de RAM. Node drena el cuerpo no leído al
//      responder (req._dump), así que el cliente recibe el 404 limpio.

const uploadAudio = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: env.ENCUESTAS_AUDIO_MAX_FILE_SIZE_MB * 1024 * 1024,
    files: 1,
    fields: 10,
    fieldSize: 1024,
    parts: 12,
  },
}).single('audio');

const MULTER_ISSUES: Record<string, { field: string; message: string }> = {
  LIMIT_FILE_COUNT: { field: 'audio', message: 'Solo se admite un archivo por petición' },
  LIMIT_UNEXPECTED_FILE: { field: 'audio', message: 'La parte de archivo debe llamarse "audio"' },
  LIMIT_FIELD_COUNT: { field: 'segmento', message: 'Demasiados campos en el formulario' },
  LIMIT_FIELD_KEY: { field: 'segmento', message: 'Nombre de campo demasiado largo' },
  LIMIT_FIELD_VALUE: { field: 'segmento', message: 'Un campo del formulario excede el tamaño permitido' },
  LIMIT_PART_COUNT: { field: 'audio', message: 'Demasiadas partes en el formulario' },
};

function responder422(res: Response, issues: { field: string; message: string }[]): void {
  res.status(422).json({
    error: 'Datos inválidos',
    code: 'VALIDATION_ERROR',
    issues,
    requestId: requestIdDe(res),
  });
}

/** multer con los errores traducidos al contrato (413 tamaño, 422 el resto). */
const uploadAudioConContrato: RequestHandler = (req, res, next) => {
  uploadAudio(req, res, (err: unknown) => {
    if (!err) return next();
    const m = err as { name?: string; code?: string; field?: string };
    if (m.name !== 'MulterError') return next(err);
    if (m.code === 'LIMIT_FILE_SIZE') {
      res.status(413).json({
        error: `El audio supera el máximo de ${env.ENCUESTAS_AUDIO_MAX_FILE_SIZE_MB} MB`,
        code: 'PAYLOAD_TOO_LARGE',
        requestId: requestIdDe(res),
      });
      return;
    }
    const conocido = MULTER_ISSUES[m.code ?? ''] ?? { field: 'audio', message: 'Formulario multipart inválido' };
    responder422(res, [{ field: m.field ?? conocido.field, message: conocido.message }]);
  });
};

/** Resuelve la encuesta por idLocal DENTRO del dispositivo autenticado; deja el id en res.locals. */
const resolverEncuestaDelDispositivo = ah(async (req: Request, res: Response, next) => {
  const encuesta = await prisma.encuesta.findFirst({
    where: { idLocal: req.params.idLocal, dispositivoId: req.encuestaDevice!.id },
    select: { id: true },
  });
  if (!encuesta) {
    res.status(404).json({ error: { code: 'ENCUESTA_NO_ENCONTRADA' } });
    return;
  }
  res.locals.encuestaId = encuesta.id;
  next();
});

router.get('/:idLocal/audios', (_req: Request, res: Response) => {
  res.status(405).json({ error: 'Method Not Allowed', code: 'METHOD_NOT_ALLOWED' });
});

router.post(
  '/:idLocal/audios',
  perDeviceLimit,
  resolverEncuestaDelDispositivo,
  uploadAudioConContrato,
  ah(async (req: Request, res: Response) => {
    const campos = audioCamposSchema.safeParse(req.body ?? {});
    const issues = campos.success
      ? []
      : campos.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message }));
    const archivo = req.file;
    if (!archivo) issues.push({ field: 'audio', message: 'Falta la parte "audio" con el archivo' });
    if (!campos.success || !archivo) {
      responder422(res, issues);
      return;
    }

    // Integridad de la subida: hash y tamaño declarados contra lo recibido. Un
    // fallo aquí es una subida truncada/corrupta; el cliente reencola y reintenta.
    const sha256 = sha256Of(archivo.buffer);
    const integridad: { field: string; message: string }[] = [];
    if (sha256 !== campos.data.sha256) {
      integridad.push({ field: 'sha256', message: 'El SHA-256 del contenido recibido no coincide con el declarado' });
    }
    if (archivo.buffer.length !== campos.data.tamano_bytes) {
      integridad.push({ field: 'tamano_bytes', message: `Se recibieron ${archivo.buffer.length} bytes y se declararon ${campos.data.tamano_bytes}` });
    }
    if (integridad.length) {
      responder422(res, integridad);
      return;
    }

    const { audioId, created } = await guardarAudioEncuesta({
      encuestaId: res.locals.encuestaId as number,
      segmento: campos.data.segmento,
      sha256,
      tamanoBytes: campos.data.tamano_bytes,
      mimeDeclarado: archivo.mimetype || null,
      buffer: archivo.buffer,
    });
    res.status(created ? 201 : 200).json({ audio_id: String(audioId) });
  }),
);
```

Nota: `ah` tipa `(req, res, next)`; `resolverEncuestaDelDispositivo` necesita `next` — si `AsyncFn` no acepta el tercer parámetro con ese nombre, tiparlo como `NextFunction`. Registrar estas rutas ANTES del `export default router`.

- [ ] **Step 4: Test HTTP** (`api/tests/sprint5/encuestas-audios-http.test.ts`)

Molde: `crearApp()` de `encuestas-ingest-http.test.ts` (rateLimit y logger mockeados igual; `req.encuestaDevice = { id: 1, … }` inyectado; router real; errorHandler real). Entorno: `vi.hoisted` asíncrono que crea un mkdtemp y fija `process.env.ENCUESTAS_AUDIO_DIR = dir` y `process.env.ENCUESTAS_AUDIO_MAX_FILE_SIZE_MB = '1'` ANTES de los imports; `afterAll` borra el dir. Doble de Prisma (`vi.mock('../../src/lib/prisma')`): `encuesta.findFirst({ where: { idLocal, dispositivoId } })` sobre una lista fija `[{ id: 10, idLocal: 'e1-uuid', dispositivoId: 1 }, { id: 20, idLocal: 'ajena-uuid', dispositivoId: 2 }]`; `encuestaAudio` con Map clave `${encuestaId}|${segmento}` y `findUnique`/`create` (P2002 real de `@prisma/client` vía import diferido si la clave existe)/`update`. Helper:

```ts
function subir(app, idLocal: string, buffer: Buffer, campos: Record<string, string | undefined>) {
  let r = request(app).post(`${RUTA}/${idLocal}/audios`);
  for (const [k, v] of Object.entries(campos)) if (v !== undefined) r = r.field(k, v);
  return r.attach('audio', buffer, { filename: 'seg1.m4a', contentType: 'audio/mp4' });
}
const AUDIO = audioM4aMinimo({ duracionMs: 12_345 });
const camposDe = (buf: Buffer, segmento = 'seg1.m4a') => ({ segmento, sha256: sha256Of(buf), tamano_bytes: String(buf.length) });
```

Casos (assert de status Y cuerpo):
1. idLocal desconocido → 404, `body` **igual** a `{ error: { code: 'ENCUESTA_NO_ENCONTRADA' } }` (`toEqual`, sin claves extra).
2. idLocal de otro dispositivo (`ajena-uuid`) → mismo 404.
3. Subida válida → 201 `{ audio_id: '1' }` (string), fila con `sha256`, `tamanoBytes`, `mimeDeclarado: 'audio/mp4'`, `duracionMs: 12345`, `ruta: 'encuestas-audio/<sha>.m4a'`, y el archivo existe en `dir` con los bytes exactos.
4. Reenvío idéntico → 200 `{ audio_id: '1' }`, sigue habiendo una fila, mtime del archivo idéntico.
5. Mismo segmento, contenido distinto → 200 mismo `audio_id`, fila actualizada (sha nueva).
6. `seg2.m4a` con los MISMOS bytes que seg1 → 201 con `audio_id` distinto; dos filas; un solo archivo en disco.
7. `sha256` declarado incorrecto → 422 `issues[0].field === 'sha256'`; sin fila ni archivo nuevo.
8. `tamano_bytes` incorrecto → 422 `field === 'tamano_bytes'`.
9. Sin parte `audio` (solo `.field(...)`) → 422 `field === 'audio'`.
10. `segmento` inválido (`../x`), `sha256` en mayúsculas, `tamano_bytes: '0'` → 422 con el `field` correspondiente.
11. Archivo de `1 MB + 1` bytes → 413 `{ code: 'PAYLOAD_TOO_LARGE' }`.
12. `GET /:idLocal/audios` → 405.
13. Parte de archivo con otro nombre (`.attach('foto', …)`) → 422 (`LIMIT_UNEXPECTED_FILE`), no 400.

- [ ] **Step 5: Test del servicio** (`api/tests/sprint5/encuestas-audios-service.test.ts`): con `guardarAudioEncuestaWithDeps` y un `db` falso: (a) `create` lanza P2002 la primera vez y `findUnique` devuelve la fila en el reintento → `{ audioId, created: false }` y `guardarEnDisco` llamado una sola vez; (b) error distinto de P2002 → se propaga; (c) `guardarEnDisco` falla → no se toca la BD.

- [ ] **Step 6: Verificar y commit**

`npx tsc --noEmit`; los dos tests nuevos + `encuestas-ingest-http.test.ts` a log (ninguna regresión). Commit: `feat(encuestas): recepción de audios por segmento (POST /api/v1/encuestas/:idLocal/audios)`.

---

### Task 5: Lectura del revisor — filtro, detalle y stream del audio

**Files:**
- Modify: `api/src/validators/encuestasRevisionValidator.ts`, `api/src/services/encuestasRevisionService.ts`, `api/src/routes/encuestasRevisionRouter.ts`
- Modify: `api/tests/sprint5/encuestas-revision-lectura.test.ts` (y `encuestas-export-http.test.ts` si su `CLAVES`/where cambia)

**Interfaces:**
- Consumes (Task 2/3): `rutaAbsolutaAudio`, `sendPrivateFile({ acceptRanges })`, modelo `encuestaAudio`.
- Produces: query `conAudio=true|false` en listado y export; `EncuestaDto.audiosCount: number` (18 claves); `GET /api/encuestas/:id` → `EncuestaDetalleDto` (= DTO + `idLocal` + `audios: EncuestaAudioDto[]`); `GET|HEAD /api/encuestas/:id/audios/:audioId` (+ `?download=1`).

- [ ] **Step 1: Validator** — en AMBOS schemas (`encuestasQuerySchema`, `encuestasExportQuerySchema`): `conAudio: z.enum(['true', 'false']).optional().transform((v) => (v === undefined ? undefined : v === 'true'))` con comentario: NO `z.coerce.boolean()` (convierte el string `'false'` en `true`).

- [ ] **Step 2: Servicio**

- `EncuestasListQuery.conAudio?: boolean`; en `buildWhere`: `if (params.conAudio !== undefined) where.audios = params.conAudio ? { some: {} } : { none: {} };` (compartido con el CSV, por el invariante del comentario).
- `encuestaListSelect` += `_count: { select: { audios: true } }`. `EncuestaDto` += `/** Segmentos de audio recibidos; 0 = sin audio. */ audiosCount: number;`. `toDto` pasa a recibir `EncuestaListRow = Omit<EncuestaDto, 'audiosCount'> & { _count: { audios: number } }` y mapea `audiosCount: row._count.audios`. NO añadir columna al CSV.
- Nuevos tipos y funciones:

```ts
export interface EncuestaAudioDto {
  id: number;
  segmento: string;
  sha256: string;
  tamanoBytes: number;
  mimeDeclarado: string | null;
  duracionMs: number | null;
  recibidoEn: Date;
  /** Ruta relativa same-origin para <audio src> y descarga (`?download=1`). */
  url: string;
}
export interface EncuestaDetalleDto extends EncuestaDto {
  idLocal: string;
  audios: EncuestaAudioDto[];
}
export function audioUrl(encuestaId: number, audioId: number): string {
  return `/api/encuestas/${encuestaId}/audios/${audioId}`;
}
export async function getById(id: number): Promise<EncuestaDetalleDto | null> {
  const row = await prisma.encuesta.findUnique({
    where: { id },
    select: {
      ...encuestaListSelect,
      idLocal: true,
      // Orden de llegada = orden de grabación (seg1, seg2…); ordenar por el
      // nombre fallaría en seg10 < seg2.
      audios: {
        orderBy: [{ recibidoEn: 'asc' }, { id: 'asc' }],
        select: { id: true, segmento: true, sha256: true, tamanoBytes: true, mimeDeclarado: true, duracionMs: true, recibidoEn: true },
      },
    },
  });
  if (!row) return null;
  return { ...toDto(row), idLocal: row.idLocal, audios: row.audios.map((a) => ({ ...a, url: audioUrl(id, a.id) })) };
}
export interface AudioParaServir { ruta: string; mimeDeclarado: string | null; segmento: string; idLocal: string }
export async function getAudioParaServir(encuestaId: number, audioId: number): Promise<AudioParaServir | null> {
  const a = await prisma.encuestaAudio.findFirst({
    where: { id: audioId, encuestaId },
    select: { ruta: true, mimeDeclarado: true, segmento: true, encuesta: { select: { idLocal: true } } },
  });
  return a ? { ruta: a.ruta, mimeDeclarado: a.mimeDeclarado, segmento: a.segmento, idLocal: a.encuesta.idLocal } : null;
}
/** Content-Type con que se sirve: el declarado si es un tipo audio/*, si no audio/mp4 (AAC en MP4, lo habitual). */
export function contentTypeDeAudio(mimeDeclarado: string | null): string {
  return mimeDeclarado && /^audio\/[A-Za-z0-9.+-]{1,60}$/.test(mimeDeclarado) ? mimeDeclarado : 'audio/mp4';
}
```

- [ ] **Step 3: Router** — pasar `conAudio: q.conAudio` en los DOS call sites (`list` e `iterateForExport`). Añadir imports (`parseId`, `ensureFound` de `../lib/http`; `NotFound` de `../middlewares/errorHandler`; `sendPrivateFile`; `rutaAbsolutaAudio`). **Registrar al FINAL del archivo, después de `GET /export.csv`** (si `/:id` fuera antes, `/export.csv` caería en `parseId` → 400 y el CSV moriría):

```ts
// ─── Detalle y audios ────────────────────────────────────────────────────────
// Van al final a propósito: `/:id` registrado antes de `/export.csv` se comería
// esa ruta (parseId('export.csv') → 400) y mataría la exportación.

router.get(
  '/:id',
  requireRole([Roles.REVISOR_QA]),
  ah(async (req: Request, res: Response) => {
    const encuesta = ensureFound(await service.getById(parseId(req)), 'Encuesta');
    res.setHeader('Cache-Control', 'private, no-store');
    res.json(encuesta);
  }),
);

/**
 * Stream del segmento (voz de personas encuestadas: dato personal, mismo rol que
 * el resto). `Range` para que el <audio> del navegador pueda buscar;
 * `no-transform` para que ningún intermediario recomprima un tramo.
 * `?download=1` añade Content-Disposition con un nombre útil.
 */
const servirAudio = ah(async (req: Request, res: Response) => {
  const encuestaId = parseId(req);
  const audioId = parseId(req, 'audioId');
  const audio = ensureFound(await service.getAudioParaServir(encuestaId, audioId), 'Audio');
  const descargar = req.query.download === '1';
  const sent = await sendPrivateFile(req, res, rutaAbsolutaAudio(audio.ruta), {
    contentType: service.contentTypeDeAudio(audio.mimeDeclarado),
    cacheControl: 'private, max-age=3600, must-revalidate, no-transform',
    varyCookie: true,
    acceptRanges: true,
    downloadName: descargar ? `${audio.idLocal}-${audio.segmento}` : undefined,
  });
  if (!sent) throw NotFound('Audio');
});
router.head('/:id/audios/:audioId', requireRole([Roles.REVISOR_QA]), servirAudio);
router.get('/:id/audios/:audioId', requireRole([Roles.REVISOR_QA]), servirAudio);
```

- [ ] **Step 4: Tests** (`encuestas-revision-lectura.test.ts`): `CLAVES_DTO` += `audiosCount` y la fixture `encuesta()` += `audiosCount: 0`. Extender el `vi.mock` del servicio con `getById` y `getAudioParaServir` hoisted. Casos nuevos: `?conAudio=true` llega a `list` como `conAudio: true` y `?conAudio=false` como `false` (no `true`); `?conAudio=si` → 400; `GET /api/encuestas/9` → 200 con `audios[]` y `Cache-Control: private, no-store`; `GET /api/encuestas/abc` → 400; `getById` → null → 404; sin rol → 403; **`HEAD /api/encuestas/export.csv?dateFrom=2026-01-01&dateTo=2026-01-31` sigue respondiendo 200 `text/csv`** (protege el orden de rutas); `GET /api/encuestas/9/audios/3`: con `ENCUESTAS_AUDIO_DIR` fijado por `vi.hoisted` a un mkdtemp y un archivo real → 200 `audio/mp4` + `Accept-Ranges: bytes`, con `Range: bytes=0-3` → 206, con `?download=1` → `Content-Disposition` con `attachment`; `getAudioParaServir` → null → 404; archivo ausente en disco → 404. En el último `describe` (real `list` contra el doble): `where.audios` es `{ some: {} }` con `conAudio: true` y `{ none: {} }` con `false`, y `select._count` presente; `toDto` mapea `_count.audios` → `audiosCount`. Revisar `encuestas-export-http.test.ts` por si asserta la forma exacta del `where`/params de `iterateForExport` (añadir `conAudio: undefined` donde haga falta).

- [ ] **Step 5: Verificar y commit**

`npx tsc --noEmit`; `encuestas-revision-lectura` y `encuestas-export-http` a log. Commit: `feat(encuestas): detalle con audios, stream con Range y filtro conAudio para el revisor`.

---

### Task 6: Portal web — indicador/filtro en el listado y detalle con reproductor

**Files:**
- Modify: `web/src/hooks/useEncuestas.ts`, `web/src/app/revision/encuestas/page.tsx`
- Create: `web/src/app/revision/encuestas/[id]/page.tsx`

**Interfaces:**
- Consumes (Task 5): `audiosCount`, `conAudio`, `GET /api/encuestas/:id` → `{ …Encuesta, idLocal, audios: [{ id, segmento, sha256, tamanoBytes, mimeDeclarado, duracionMs, recibidoEn, url }] }`.
- Antes de escribir código de Next: leer la guía relevante en `web/node_modules/next/dist/docs/` (regla de `web/AGENTS.md`: `params` es una Promise que se desenvuelve con `use()` en client components).

- [ ] **Step 1: Hook** (`web/src/hooks/useEncuestas.ts`)

`Encuesta` += `audiosCount: number;` (comentario: segmentos recibidos, 0 = sin audio). `EncuestaQuery` y `EncuestasCsvParams` += `conAudio?: boolean;`; `buildParams`: `if (query.conAudio !== undefined) params.set('conAudio', String(query.conAudio));`. Nuevos tipos y hook (calcados de `useQaPersonas`/`useEncuestas`):

```ts
export interface EncuestaAudio {
  id: number;
  segmento: string;
  sha256: string;
  tamanoBytes: number;
  mimeDeclarado: string | null;
  // null = el servidor no pudo leer la duración del contenedor (p. ej. AMR);
  // el navegador la mide al cargar los metadatos.
  duracionMs: number | null;
  recibidoEn: string;
  // Ruta relativa same-origin (/api/encuestas/:id/audios/:audioId); la cookie
  // httpOnly viaja sola. `?download=1` la sirve como adjunto.
  url: string;
}

export interface EncuestaDetalle extends Encuesta {
  idLocal: string;
  audios: EncuestaAudio[];
}

// `null` cuando la URL trae un id que no es entero: la pantalla avisa en vez de
// quedarse en spinner (la query no se dispara).
export function useEncuesta(id: number | null) {
  return useQuery<EncuestaDetalle>({
    queryKey: ['encuesta', id],
    queryFn: async () => {
      const res = await api.get(`/encuestas/${id}`);
      return res.data;
    },
    enabled: id !== null,
  });
}
```

- [ ] **Step 2: Listado** (`web/src/app/revision/encuestas/page.tsx`)

- Importar `useRouter` de `next/navigation` y `Badge` de `@/components/ui/badge`.
- Columna nueva antes de `dispositivo`: `{ accessorKey: 'audiosCount', header: 'Audio', cell: ({ row }) => row.original.audiosCount > 0 ? <Badge variant="info">{row.original.audiosCount} {row.original.audiosCount === 1 ? 'segmento' : 'segmentos'}</Badge> : <Badge variant="inactive">Sin audio</Badge> }`.
- Estado `const [filtroAudio, setFiltroAudio] = useState<'todas' | 'con' | 'sin'>('todas');` → `useEncuestas({ …, conAudio: filtroAudio === 'todas' ? undefined : filtroAudio === 'con' })`; `limpiarFiltros` lo resetea; `hasFilters` lo incluye; `descargarEncuestasCsv({ dateFrom, dateTo, conAudio: … })` lo propaga.
- Filtro junto a las fechas: un `<div role="group" aria-label="Filtrar por audio" className="flex gap-1">` con tres `<Button size="sm" variant={filtroAudio === v ? 'default' : 'outline'} onClick={() => { setFiltroAudio(v); setPage(1); }}>` (Todas / Con audio / Sin audio). No hay componente segmentado en `web/src/components/ui/`: NO crear uno.
- `const router = useRouter();` y en `DataTable`: `onRowClick={(row) => router.push(`/revision/encuestas/${row.id}`)}` y `rowActionLabel={(row) => `Ver encuesta ${row.folioLocal ?? row.id}`}`.

- [ ] **Step 3: Detalle** (`web/src/app/revision/encuestas/[id]/page.tsx`)

```tsx
'use client';

import { use, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useEncuesta, type EncuestaAudio } from '@/hooks/useEncuestas';
import { getApiError } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Download, Loader2 } from 'lucide-react';

// Base de la API: misma lógica que el cliente axios. Vacío → ruta relativa,
// que el rewrite /api/* de next.config.ts envía al backend (same-origin, así la
// cookie httpOnly viaja con el <audio> y con la descarga).
const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? '';

function mmss(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const min = Math.floor(total / 60);
  const seg = total % 60;
  return `${min.toString().padStart(2, '0')}:${seg.toString().padStart(2, '0')}`;
}

function tamanoLegible(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function Dato({ etiqueta, children }: { etiqueta: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{etiqueta}</dt>
      <dd className="text-sm text-foreground">{children}</dd>
    </div>
  );
}

/**
 * Un segmento: metadatos + reproductor nativo + descarga. La duración la manda
 * el servidor cuando pudo leerla del contenedor; si no, la mide el navegador al
 * cargar los metadatos (preload="metadata" solo trae la cabecera, no el audio).
 */
function SegmentoAudio({ audio }: { audio: EncuestaAudio }) {
  const [duracionMedida, setDuracionMedida] = useState<number | null>(null);
  const src = `${API_BASE}${audio.url}`;
  const duracionMs = audio.duracionMs ?? duracionMedida;
  return (
    <li className="space-y-2 py-3 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
        <span className="font-mono font-medium text-foreground">{audio.segmento}</span>
        <span className="font-mono tabular-nums text-muted-foreground">
          {duracionMs === null ? 'Duración —' : mmss(duracionMs)}
        </span>
        <span className="text-muted-foreground">{tamanoLegible(audio.tamanoBytes)}</span>
        <span className="text-muted-foreground">
          Recibido {new Date(audio.recibidoEn).toLocaleString('es-MX')}
        </span>
        <a
          href={`${src}?download=1`}
          className="inline-flex items-center gap-1 text-primary underline-offset-4 hover:underline"
        >
          <Download aria-hidden="true" className="size-4" />
          Descargar
        </a>
      </div>
      <audio
        controls
        preload="metadata"
        src={src}
        className="w-full"
        aria-label={`Audio ${audio.segmento}`}
        onLoadedMetadata={(event) => {
          const d = event.currentTarget.duration;
          if (Number.isFinite(d)) setDuracionMedida(Math.round(d * 1000));
        }}
      >
        Tu navegador no puede reproducir este audio; descárgalo para escucharlo.
      </audio>
    </li>
  );
}

export default function RevisionEncuestaDetallePage({ params }: { params: Promise<{ id: string }> }) {
  const { id: idStr } = use(params);
  const id = Number.parseInt(idStr, 10);
  const validId = Number.isInteger(id) && id > 0 ? id : null;
  const router = useRouter();
  const { data: encuesta, isLoading, isError, error, refetch } = useEncuesta(validId);

  const volver = (
    <Button variant="outline" size="sm" onClick={() => router.push('/revision/encuestas')}>
      Volver
    </Button>
  );

  if (validId === null) { /* como el molde: aviso "Encuesta inválida." */ }
  if (isError) { /* 404 → "Esta encuesta no existe o ya no está disponible."; otro → mensaje + Reintentar (getApiError(error).status) */ }
  if (isLoading || !encuesta) { /* spinner role="status" */ }

  // Render: cabecera (folio o idRemoto corto, encuestador, Badge versión vN, Badge audio),
  // Card "Encuesta" con <dl>: Folio, Encuestador, Versión, Preferencia electoral (+ texto "otro"),
  // Preferencia partido (+ texto), Conoce a Lalo, Duración (mm:ss de duracionSegundos), Finalizada,
  // Recibida, Ubicación (Sí/No/—), Dispositivo, idLocal (font-mono).
  // Card "Audios" con <ul className="divide-y divide-border"> de SegmentoAudio, o
  // "Esta encuesta no tiene audio." si audios.length === 0.
}
```

Completar los tres estados y el render siguiendo EXACTAMENTE el estilo de `web/src/app/revision/encuestas/page.tsx` (fusionar `preferenciaElectoral ?? candidatoPreferido`, etc.).

- [ ] **Step 4: Verificar y commit**

`cd web && npx tsc --noEmit && npm run lint` (nativos) y `cmd.exe /c "npm run build"` (si da `EPERM unlink .next/...`, borrar `web/.next` y repetir). Commit: `feat(revision): audios en el listado y detalle de encuestas con reproductor`.

---

### Task 7: Documentación, OpenAPI y verificación integral

**Files:**
- Modify: `docs/encuestas-okrean.md`, `docs/encuestas-okrean-openapi.yaml`

- [ ] **Step 1: `docs/encuestas-okrean.md`**

- Tabla "Cara de DISPOSITIVO": filas `POST /api/v1/encuestas/{idLocal}/audios` y `GET …/audios → 405`.
- Tabla "Cara de REVISOR": `GET /api/encuestas/:id`, `GET|HEAD /api/encuestas/:id/audios/:audioId` (`?download=1`); parámetro `conAudio` (listado y export); `EncuestaDto` pasa a **18 claves** (`audiosCount`).
- Sección nueva **"## Audios de la encuesta"** (antes de "## Códigos de respuesta"): cuándo sube la app (solo encuestas ya sincronizadas; 1 archivo por petición; segmentos inmutables `segN+1`), partes exactas del multipart, reglas (resolución dentro del dispositivo, integridad sha/tamaño, dedup `(encuesta, segmento, sha256)`, límite `ENCUESTAS_AUDIO_MAX_FILE_SIZE_MB`), tabla de códigos (`201/200 {"audio_id"}`, `404 {"error":{"code":"ENCUESTA_NO_ENCONTRADA"}}`, `413`, `422 issues[]`, `401`, `429`+`Retry-After`, `405`, sin `409`), ejemplo `curl -F segmento=seg1.m4a -F sha256=$(sha256sum seg1.m4a | cut -c1-64) -F tamano_bytes=$(stat -c%s seg1.m4a) -F audio=@seg1.m4a`, y tres callouts `> ` marcando como **divergencia deliberada** el 404 anidado, el 413 y el "todo lo demás es 422, nunca 400".
- **"### Nota para el equipo móvil — audios"**: ruta definitiva `POST https://qa.aztechcomposites.com/api/v1/encuestas/{idLocal}/audios`; **la API key de QA existente sirve tal cual** (mismo `encuestasDeviceAuthMiddleware`, misma tabla `encuestas_dispositivos`); la cuota de 60/min por dispositivo (`rl:enc:dev:`) es **compartida** con `/api/v1/encuestas`; el catálogo P8 v4 quedó en los 8 códigos (pedir confirmación de que `paola_barrera` no viaja en v4).
- "Rate limit": aclarar que el cubo por dispositivo cubre también `POST …/audios`.
- "Diccionario de datos": `### Tabla encuestas_audios` tras `encuestas_dispositivos`.
- "Variables de entorno": `ENCUESTAS_AUDIO_DIR` y `ENCUESTAS_AUDIO_MAX_FILE_SIZE_MB`.
- "Operación": migración `20260824120000_add_encuestas_audios` (aditiva); nota de que `docker-compose.yml` base NO persiste `/app/uploads` (public: `uploads_data`; staging: bind de LUKS); humo con `curl -F`; "Portal de revisión": filtro Con/Sin audio, detalle `/revision/encuestas/<id>` con reproductor y descarga; recordar rebuild de `web`.

- [ ] **Step 2: `docs/encuestas-okrean-openapi.yaml`**

`info.version: '4.1.0'`; path `/api/v1/encuestas/{idLocal}/audios` (antes de `/ping`): `post` (`operationId: subirAudioEncuesta`, `requestBody` `multipart/form-data` con `segmento`, `sha256`, `tamano_bytes`, `audio` binario, `encoding.audio.contentType: audio/mp4, audio/3gpp, application/octet-stream`; respuestas 201/200 `AudioRespuesta {audio_id: string}`, 404 `EncuestaNoEncontrada` (schema anidado `{error:{code: const ENCUESTA_NO_ENCONTRADA}}`), 413, 422 `ErrorValidacion`, 401, 429) y `get` → 405. Schemas nuevos en `components`.

- [ ] **Step 3: Verificación integral** (todo desde la raíz del repo; `cmd.exe /c` donde toque):

```
cd api && npx prisma validate && npx prisma generate && npx tsc --noEmit && npm run build
cd api && cmd.exe /c "set NO_COLOR=1&& npx vitest run --reporter=dot > ../.superpowers/sdd/2026-08-24-encuestas-audios/vitest-all.log 2>&1"; tail -60 ../.superpowers/sdd/2026-08-24-encuestas-audios/vitest-all.log
cd api && node scripts/check-qa-migrations-safe.js && node scripts/check-config-references.js && cmd.exe /c "npm audit --omit=dev"
cd web && npx tsc --noEmit && npm run lint && cmd.exe /c "npm run build"
```

Todo verde (o, si falla algo que NO sea de este branch —p. ej. un advisory nuevo de `npm audit`—, reportarlo con el output exacto sin arreglarlo).

- [ ] **Step 4: Commit**

`docs(encuestas): contrato de audios, OpenAPI 4.1 y nota para el equipo móvil`.
