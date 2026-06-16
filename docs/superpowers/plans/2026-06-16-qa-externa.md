# qa_externa Ingest Module — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an additive `POST /api/qa-externa/ingest` endpoint to the Node/Express/TS API that receives multipart field-evidence (one JPEG + geo metadata) from the GeoCampo mobile app, authenticated by a per-device Bearer API key, with idempotent upsert by client UUID and image dedupe by sha256.

**Architecture:** A self-contained module (router + device-auth guard + validator + storage helper + service + Prisma models) mounted at `/api/qa-externa`, fully behind a device-key guard that is separate from the existing JWT auth. Idempotency is enforced by DB unique constraints (`cliente_registro_id`, `sha256`) plus ON-CONFLICT-style upserts with P2002 fallback; images are content-addressed on disk (`<sha256>.jpg`) under the existing `/app/uploads` bind mount. Provisioning is via two CLI scripts mirroring `create-user.ts`.

**Tech Stack:** Node 20, Express 4, TypeScript 5, Prisma 6.19 + PostgreSQL 16, multer 2 (memoryStorage), file-type 22 (magic bytes), image-size 1 (dimensions), zod 4, Caddy 2.

---

## ⚠️ Testing reality (read before executing)

This repo has **NO test framework** (`CLAUDE.md`: no vitest/jest/pytest, no `npm test` — do not invent one). The TDD "write a failing test" loop is therefore replaced by the project's real quality gate:

- **Per task:** `npx tsc --noEmit` (must report 0 errors) and, for the schema task, `npx prisma validate` + `npx prisma generate`.
- **Behavioral acceptance (Task 14):** a `curl` smoke-test script run against a locally running dev stack.
- All API commands run **inside `api/`**.

**Branch & commits:** the repo default branch is `main`. Before Task 1, create a feature branch:
```bash
cd "/mnt/c/Users/paulo/Claude Code/flotillas-v2" && git checkout -b feat/qa-externa
```
Commit after each task. Commit messages follow the repo's Spanish conventional-commit style and **must end with**:
```
Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
```

**Do not touch:** any `sas-*` container, existing routers/models/middlewares (other than the explicit edits below), the JWT auth, or `env.ts` invariants (JWT/CORS/bcrypt/Turnstile).

---

## File structure

| File | Action | Responsibility |
|---|---|---|
| `api/prisma/schema.prisma` | modify (append) | enum `QaExternaTipo` + 4 models (dispositivo, registro, imagen, pivote) |
| `api/prisma/migrations/<ts>_add_qa_externa/` | create (via `migrate dev`) | DDL with uniques + indexes |
| `api/src/config/env.ts` | modify | `QA_EXTERNA_*` optional env vars |
| `api/src/types/express.d.ts` | modify | `req.device` typing |
| `api/src/lib/deviceKeyHash.ts` | create | `hashDeviceKey()` — single source of truth (SHA-256 / HMAC) |
| `api/src/middlewares/deviceAuthMiddleware.ts` | create | device Bearer-key guard → `req.device` |
| `api/src/lib/qaExternaStorage.ts` | create | sha256 + JPEG magic-byte validation + dims + content-addressed write + dir ensure |
| `api/src/validators/qaExternaValidator.ts` | create | zod schema for the multipart fields |
| `api/src/services/qaExternaService.ts` | create | idempotent upsert + dedupe + pivot link |
| `api/src/routes/qaExternaRouter.ts` | create | `POST /ingest`, `GET /ping`, `GET /ingest`→405 |
| `api/src/index.ts` | modify | imports + mount + `ensureQaExternaDir()` at boot |
| `api/src/scripts/qa-externa-device-register.ts` | create | generate key, store hash, print once |
| `api/src/scripts/qa-externa-device-revoke.ts` | create | set `activo=false` |
| `api/package.json` | modify | `qa:device:*` scripts + `image-size` dep |
| `Caddyfile`, `Caddyfile.public` | modify | generous upstream timeouts (slow VPN) |
| `docs/qa-externa.md` | create | contract + device provisioning + TLS note |
| `docs/qa-externa-smoke.sh` | create | curl smoke tests |

---

### Task 1: Prisma schema + migration

**Files:**
- Modify: `api/prisma/schema.prisma` (append at end of file)
- Create: `api/prisma/migrations/<timestamp>_add_qa_externa/migration.sql` (generated)

- [ ] **Step 1: Append the enum and four models to `api/prisma/schema.prisma`**

Append exactly this at the END of the file:

```prisma
// ============================================
// QA EXTERNA (ingesta de Evidencia Externa de GeoCampo) — módulo aditivo
// ============================================
enum QaExternaTipo {
  lona
  reunion
  barda
  otro
}

model QaExternaDispositivo {
  id            Int       @id @default(autoincrement())
  identificador String
  keyHash       String    @unique @map("key_hash")
  activo        Boolean   @default(true)
  lastUsedAt    DateTime? @map("last_used_at")
  createdAt     DateTime  @default(now()) @map("created_at")
  updatedAt     DateTime  @updatedAt @map("updated_at")

  registros QaExternaRegistro[]

  @@map("qa_externa_dispositivos")
}

model QaExternaRegistro {
  id                Int           @id @default(autoincrement())
  clienteRegistroId String        @unique @map("cliente_registro_id")
  dispositivoId     Int           @map("dispositivo_id")
  dispositivo       QaExternaDispositivo @relation(fields: [dispositivoId], references: [id])
  identificadorApp  String        @map("identificador_app")
  tipo              QaExternaTipo
  lat               Float
  lng               Float
  accuracy          Float?
  capturadoAt       DateTime      @map("capturado_at")
  notas             String?       @db.Text
  metadataRaw       String        @map("metadata_raw") @db.Text
  createdAt         DateTime      @default(now()) @map("created_at")
  updatedAt         DateTime      @updatedAt @map("updated_at")

  imagenes QaExternaRegistroImagen[]

  @@index([dispositivoId])
  @@index([capturadoAt])
  @@map("qa_externa_registros")
}

model QaExternaImagen {
  id        Int      @id @default(autoincrement())
  sha256    String   @unique
  ruta      String
  mime      String
  bytes     Int
  width     Int?
  height    Int?
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  registros QaExternaRegistroImagen[]

  @@map("qa_externa_imagenes")
}

model QaExternaRegistroImagen {
  registroId Int      @map("registro_id")
  imagenId   Int      @map("imagen_id")
  registro   QaExternaRegistro @relation(fields: [registroId], references: [id], onDelete: Cascade)
  imagen     QaExternaImagen   @relation(fields: [imagenId], references: [id], onDelete: Cascade)
  createdAt  DateTime @default(now()) @map("created_at")

  @@id([registroId, imagenId])
  @@index([imagenId])
  @@map("qa_externa_registro_imagenes")
}
```

- [ ] **Step 2: Validate the schema**

Run: `cd api && npx prisma validate`
Expected: `The schema at prisma/schema.prisma is valid 🚀`

- [ ] **Step 3: Create the migration and regenerate the client**

Run: `cd api && npx prisma migrate dev --name add_qa_externa`
Expected: a new folder `prisma/migrations/<timestamp>_add_qa_externa/migration.sql` is created, applied to the dev DB, and the Prisma client is regenerated. The SQL must contain `CREATE UNIQUE INDEX` on `qa_externa_dispositivos.key_hash`, `qa_externa_registros.cliente_registro_id`, and `qa_externa_imagenes.sha256`.

> If no dev database is reachable, instead run `npx prisma migrate dev --create-only --name add_qa_externa` to generate the SQL without applying, then `npx prisma generate`. The migration is applied on the server with `prisma migrate deploy`.

- [ ] **Step 4: Confirm the generated client exposes the new models**

Run: `cd api && node -e "const{PrismaClient}=require('@prisma/client');const p=new PrismaClient();console.log(typeof p.qaExternaDispositivo,typeof p.qaExternaRegistro,typeof p.qaExternaImagen,typeof p.qaExternaRegistroImagen)"`
Expected: `object object object object`

- [ ] **Step 5: Commit**

```bash
cd "/mnt/c/Users/paulo/Claude Code/flotillas-v2"
git add api/prisma/schema.prisma api/prisma/migrations
git commit -m "feat(qa-externa): modelos Prisma + migración (dispositivos, registros, imágenes, pivote M2M)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Environment variables

**Files:**
- Modify: `api/src/config/env.ts`

- [ ] **Step 1: Add the `QA_EXTERNA_*` fields to `envSchema`**

Insert these lines inside the `z.object({ ... })` in `api/src/config/env.ts`, immediately AFTER the `REPORTS_DIR` field (around line 41):

```typescript
  // qa_externa (ingesta de Evidencia Externa de GeoCampo). Todas opcionales con
  // default: NO añaden un secreto obligatorio en producción (no rompen env.ts).
  QA_EXTERNA_DIR: z.string().default('/app/uploads/qa-externa'),
  QA_EXTERNA_MAX_FILE_SIZE_MB: z.coerce.number().int().min(1).max(100).default(12),
  QA_EXTERNA_MAX_FILES: z.coerce.number().int().min(1).max(20).default(5),
  QA_EXTERNA_RATE_MAX: z.coerce.number().int().min(1).default(60),
  QA_EXTERNA_RATE_WINDOW_SEC: z.coerce.number().int().min(10).default(60),
  // Pepper opcional para HMAC-SHA256 de las API keys (defensa en profundidad).
  QA_EXTERNA_KEY_PEPPER: z.string().optional(),
```

- [ ] **Step 2: Typecheck**

Run: `cd api && npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
cd "/mnt/c/Users/paulo/Claude Code/flotillas-v2"
git add api/src/config/env.ts
git commit -m "feat(qa-externa): variables de entorno QA_EXTERNA_* (opcionales con default)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Express `req.device` typing

**Files:**
- Modify: `api/src/types/express.d.ts`

- [ ] **Step 1: Add `device` to the `Request` interface**

Replace the `interface Request { ... }` block in `api/src/types/express.d.ts` with:

```typescript
    interface Request {
      user?: JwtPayload;
      // Populado por deviceAuthMiddleware en las rutas /api/qa-externa/* tras
      // validar la API key del dispositivo (separado de req.user / JWT).
      device?: { id: number; identificador: string };
    }
```

- [ ] **Step 2: Typecheck**

Run: `cd api && npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
cd "/mnt/c/Users/paulo/Claude Code/flotillas-v2"
git add api/src/types/express.d.ts
git commit -m "feat(qa-externa): tipa req.device para el guard de dispositivo

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Shared key-hash helper

**Files:**
- Create: `api/src/lib/deviceKeyHash.ts`

Single source of truth for hashing device keys, used by BOTH the guard and the CLIs (if they diverge, no device authenticates). Reads the pepper from `process.env` directly so the CLIs can use it without importing the full `env` validation.

- [ ] **Step 1: Create `api/src/lib/deviceKeyHash.ts`**

```typescript
// Hash de las API keys de dispositivo qa_externa. ÚNICO punto de verdad:
// lo usan tanto el guard (deviceAuthMiddleware) como los CLIs de alta. Si el
// alta y la verificación hashearan distinto, ningún dispositivo autenticaría.
//
// Las keys son tokens aleatorios de 256 bits (sin diccionario que atacar), así
// que SHA-256 indexado basta y permite lookup O(1). Con QA_EXTERNA_KEY_PEPPER
// definido se usa HMAC-SHA256 (defensa en profundidad ante fuga de la BD).

import { createHash, createHmac } from 'crypto';

export function hashDeviceKey(key: string): string {
  const pepper = process.env.QA_EXTERNA_KEY_PEPPER;
  return pepper
    ? createHmac('sha256', pepper).update(key).digest('hex')
    : createHash('sha256').update(key).digest('hex');
}
```

- [ ] **Step 2: Typecheck**

Run: `cd api && npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
cd "/mnt/c/Users/paulo/Claude Code/flotillas-v2"
git add api/src/lib/deviceKeyHash.ts
git commit -m "feat(qa-externa): helper compartido hashDeviceKey (SHA-256 / HMAC)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Device-auth guard

**Files:**
- Create: `api/src/middlewares/deviceAuthMiddleware.ts`

- [ ] **Step 1: Create `api/src/middlewares/deviceAuthMiddleware.ts`**

```typescript
// Guard de las rutas /api/qa-externa/*. Autentica por API key de dispositivo
// (Authorization: Bearer <key>), separado del authMiddleware JWT. Nunca loguea
// la key (Pino redacta el header authorization; tampoco la metemos en logs).

import { Request, Response, NextFunction } from 'express';
import prisma from '../lib/prisma';
import { hashDeviceKey } from '../lib/deviceKeyHash';
import { Unauthorized } from './errorHandler';

/** Extrae la API key del header Authorization: Bearer <key>. */
function deviceKeyFromRequest(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header) return null;
  const parts = header.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    throw Unauthorized('Formato inválido. Use: Bearer <api_key>');
  }
  return parts[1];
}

export async function deviceAuthMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const key = deviceKeyFromRequest(req);
    if (!key) return next(Unauthorized('API key requerida'));

    const keyHash = hashDeviceKey(key);
    const device = await prisma.qaExternaDispositivo.findUnique({ where: { keyHash } });
    if (!device || !device.activo) {
      return next(Unauthorized('API key inválida o revocada'));
    }

    req.device = { id: device.id, identificador: device.identificador };

    // Marca de uso, no bloqueante (no debe retrasar ni romper el request).
    void prisma.qaExternaDispositivo
      .update({ where: { id: device.id }, data: { lastUsedAt: new Date() } })
      .catch(() => undefined);

    next();
  } catch (err) {
    next(err);
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `cd api && npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
cd "/mnt/c/Users/paulo/Claude Code/flotillas-v2"
git add api/src/middlewares/deviceAuthMiddleware.ts
git commit -m "feat(qa-externa): deviceAuthMiddleware (Bearer key por hash, separado del JWT)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Storage helper (sha256 + JPEG validation + dims + write)

**Files:**
- Modify: `api/package.json` (add `image-size` dependency)
- Create: `api/src/lib/qaExternaStorage.ts`

- [ ] **Step 1: Install `image-size` (v1, CommonJS — safe with the Docker build)**

Run: `cd api && npm install image-size@^1.2.1`
Expected: `image-size` appears under `dependencies` in `api/package.json`.

- [ ] **Step 2: Create `api/src/lib/qaExternaStorage.ts`**

```typescript
// Almacenamiento content-addressed de imágenes qa_externa. Cada imagen se guarda
// una sola vez como <sha256>.jpg bajo QA_EXTERNA_DIR (subdir del bind mount
// /app/uploads), reforzando la dedupe. Valida JPEG real por magic bytes.

import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';
import imageSize from 'image-size';
import { env } from '../config/env';
import { BadRequest } from '../middlewares/errorHandler';

export interface StoredImage {
  sha256: string;
  ruta: string; // relativa a /app/uploads, p. ej. "qa-externa/<sha256>.jpg"
  mime: string; // siempre image/jpeg
  bytes: number;
  width: number | null;
  height: number | null;
}

/** Crea el directorio de almacenamiento si no existe (idempotente). */
export async function ensureQaExternaDir(): Promise<void> {
  await fs.mkdir(env.QA_EXTERNA_DIR, { recursive: true });
}

/**
 * Valida que el buffer sea un JPEG real (magic bytes), calcula su sha256, lee
 * dimensiones (best-effort) y lo escribe en disco SOLO si no existe ya (dedupe).
 */
export async function processImage(buffer: Buffer): Promise<StoredImage> {
  // 1. JPEG real por magic bytes (no confiar en extensión/mime declarado).
  //    file-type 22 es ESM puro → import dinámico (igual que vehicleImportRouter).
  const { fileTypeFromBuffer } = await import('file-type');
  const ft = await fileTypeFromBuffer(buffer);
  if (!ft || ft.ext !== 'jpg' || ft.mime !== 'image/jpeg') {
    throw BadRequest('La imagen no es un JPEG válido');
  }

  // 2. Hash de contenido.
  const sha256 = createHash('sha256').update(buffer).digest('hex');

  // 3. Dimensiones (opcionales; si falla el parseo quedan nulas).
  let width: number | null = null;
  let height: number | null = null;
  try {
    const dims = imageSize(buffer);
    width = dims.width ?? null;
    height = dims.height ?? null;
  } catch {
    // dimensiones opcionales
  }

  // 4. Escritura content-addressed: solo si el archivo aún no existe.
  const filename = `${sha256}.jpg`;
  const absolute = path.join(env.QA_EXTERNA_DIR, filename);
  try {
    await fs.access(absolute);
  } catch {
    await ensureQaExternaDir();
    await fs.writeFile(absolute, buffer);
  }

  return {
    sha256,
    ruta: `qa-externa/${filename}`,
    mime: 'image/jpeg',
    bytes: buffer.length,
    width,
    height,
  };
}
```

- [ ] **Step 3: Typecheck**

Run: `cd api && npx tsc --noEmit`
Expected: 0 errors.

> If `imageSize(buffer)` produces a type error about overloads, use `imageSize(new Uint8Array(buffer))` — `image-size` v1 accepts a `Uint8Array`/`Buffer`.

- [ ] **Step 4: Commit**

```bash
cd "/mnt/c/Users/paulo/Claude Code/flotillas-v2"
git add api/package.json api/package-lock.json api/src/lib/qaExternaStorage.ts
git commit -m "feat(qa-externa): storage content-addressed (sha256 + validación JPEG + dims)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Validator

**Files:**
- Create: `api/src/validators/qaExternaValidator.ts`

- [ ] **Step 1: Create `api/src/validators/qaExternaValidator.ts`**

```typescript
// Validación de los campos del POST /api/qa-externa/ingest. Tras multer, los
// campos multipart llegan como strings; el router arma el body (incluyendo
// tipo/notas extraídos del JSON `metadata`) antes de llamar a safeParse.

import { z } from 'zod';

// UUID genérico (cualquier versión); el cliente manda v4.
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const qaExternaIngestSchema = z.object({
  clienteRegistroId: z
    .string()
    .regex(UUID_RE, 'cliente_registro_id debe tener forma de UUID'),
  identificadorApp: z.string().min(1).max(200),
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
  accuracy: z.coerce.number().min(0).optional(),
  capturadoAt: z
    .string()
    .refine((s) => !Number.isNaN(Date.parse(s)), {
      message: 'capturado_at no es una fecha ISO-8601 válida',
    })
    .transform((s) => new Date(s)),
  tipo: z.enum(['lona', 'reunion', 'barda', 'otro']),
  notas: z.string().max(5000).nullable().optional(),
});

export type QaExternaIngest = z.infer<typeof qaExternaIngestSchema>;
```

- [ ] **Step 2: Typecheck**

Run: `cd api && npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
cd "/mnt/c/Users/paulo/Claude Code/flotillas-v2"
git add api/src/validators/qaExternaValidator.ts
git commit -m "feat(qa-externa): validador Zod del payload de ingesta

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Service (idempotent upsert + dedupe + pivot)

**Files:**
- Create: `api/src/services/qaExternaService.ts`

Idempotency is enforced by the DB unique constraints + upserts with a P2002 fallback (a unique violation inside a Postgres interactive transaction would abort it, so we run these idempotent operations sequentially, not inside `$transaction`).

- [ ] **Step 1: Create `api/src/services/qaExternaService.ts`**

```typescript
// Núcleo de qa_externa: upsert idempotente del registro por cliente_registro_id,
// dedupe de imágenes por sha256 y vínculo M2M idempotente. Un reintento completo
// (misma clave + mismas imágenes) NO duplica nada y devuelve el mismo registro_id.

import prisma from '../lib/prisma';
import { isPrismaKnownError } from '../middlewares/errorHandler';
import { processImage } from '../lib/qaExternaStorage';

export interface IngestInput {
  clienteRegistroId: string;
  dispositivoId: number;
  identificadorApp: string;
  tipo: 'lona' | 'reunion' | 'barda' | 'otro';
  lat: number;
  lng: number;
  accuracy?: number;
  capturadoAt: Date;
  notas: string | null;
  metadataRaw: string;
  buffers: Buffer[];
}

export interface IngestResult {
  registroId: number;
  imagenes: Array<{
    id: number;
    sha256: string;
    bytes: number;
    mime: string;
    width: number | null;
    height: number | null;
  }>;
}

export async function ingest(input: IngestInput): Promise<IngestResult> {
  const registroData = {
    dispositivoId: input.dispositivoId,
    identificadorApp: input.identificadorApp,
    tipo: input.tipo,
    lat: input.lat,
    lng: input.lng,
    accuracy: input.accuracy ?? null,
    capturadoAt: input.capturadoAt,
    notas: input.notas,
    metadataRaw: input.metadataRaw,
  };

  // 1. Upsert idempotente del registro (last-write-wins). Ante dos POST
  //    concurrentes con la misma clave, uno crea y el otro choca con el UNIQUE
  //    (P2002) → caemos a update y ambos convergen al mismo id.
  let registro;
  try {
    registro = await prisma.qaExternaRegistro.upsert({
      where: { clienteRegistroId: input.clienteRegistroId },
      create: { clienteRegistroId: input.clienteRegistroId, ...registroData },
      update: registroData,
    });
  } catch (e) {
    if (isPrismaKnownError(e, 'P2002')) {
      registro = await prisma.qaExternaRegistro.update({
        where: { clienteRegistroId: input.clienteRegistroId },
        data: registroData,
      });
    } else {
      throw e;
    }
  }

  // 2. Por imagen: validar/escribir (dedupe en disco), upsert por sha256 (dedupe
  //    en BD) y vincular al registro sin duplicar el vínculo.
  const imagenes: IngestResult['imagenes'] = [];
  for (const buffer of input.buffers) {
    const meta = await processImage(buffer);

    let imagen;
    try {
      imagen = await prisma.qaExternaImagen.upsert({
        where: { sha256: meta.sha256 },
        create: {
          sha256: meta.sha256,
          ruta: meta.ruta,
          mime: meta.mime,
          bytes: meta.bytes,
          width: meta.width,
          height: meta.height,
        },
        update: {}, // dedupe: no se reescriben bytes ni metadatos
      });
    } catch (e) {
      if (isPrismaKnownError(e, 'P2002')) {
        imagen = await prisma.qaExternaImagen.findUniqueOrThrow({
          where: { sha256: meta.sha256 },
        });
      } else {
        throw e;
      }
    }

    // Vínculo idempotente (PK compuesta → skipDuplicates evita duplicar).
    await prisma.qaExternaRegistroImagen.createMany({
      data: [{ registroId: registro.id, imagenId: imagen.id }],
      skipDuplicates: true,
    });

    imagenes.push({
      id: imagen.id,
      sha256: imagen.sha256,
      bytes: imagen.bytes,
      mime: imagen.mime,
      width: imagen.width,
      height: imagen.height,
    });
  }

  return { registroId: registro.id, imagenes };
}
```

- [ ] **Step 2: Typecheck**

Run: `cd api && npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
cd "/mnt/c/Users/paulo/Claude Code/flotillas-v2"
git add api/src/services/qaExternaService.ts
git commit -m "feat(qa-externa): servicio de ingesta idempotente + dedupe por sha256

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: Router (`POST /ingest`, `GET /ping`, `GET /ingest`→405)

**Files:**
- Create: `api/src/routes/qaExternaRouter.ts`

- [ ] **Step 1: Create `api/src/routes/qaExternaRouter.ts`**

```typescript
// Rutas qa_externa. El guard de dispositivo (deviceAuthMiddleware) y el
// rate-limit por IP se aplican en el MONTAJE (index.ts), de modo que el auth
// precede a TODA ruta/método aquí — incluido el 405 de GET /ingest (red de
// seguridad B para la app actual, que aún hace GET sobre /ingest).

import { Router, Request, Response } from 'express';
import multer from 'multer';
import { rateLimit } from '../middlewares/rateLimit';
import { ah } from '../lib/asyncHandler';
import { BadRequest } from '../middlewares/errorHandler';
import { qaExternaIngestSchema } from '../validators/qaExternaValidator';
import * as qaExternaService from '../services/qaExternaService';
import { env } from '../config/env';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: env.QA_EXTERNA_MAX_FILE_SIZE_MB * 1024 * 1024,
    files: env.QA_EXTERNA_MAX_FILES,
  },
  // Descarta archivos que no sean JPEG por extensión/mime (cb(null,false), sin
  // error → si no queda ninguno, el handler responde 400). El JPEG REAL se
  // valida por magic bytes en processImage.
  fileFilter: (_req, file, cb) => {
    const okExt = /\.jpe?g$/i.test(file.originalname);
    const okMime = file.mimetype === 'image/jpeg';
    cb(null, okExt && okMime);
  },
});

// Rate-limit por dispositivo (ya autenticado por el guard del montaje).
const perDeviceLimit = rateLimit({
  max: env.QA_EXTERNA_RATE_MAX,
  windowSec: env.QA_EXTERNA_RATE_WINDOW_SEC,
  keyBuilder: (req) => `qae:dev:${req.device?.id ?? 'unknown'}`,
  message: 'Demasiadas subidas desde este dispositivo. Intenta más tarde.',
});

const router = Router();

// Opción A: probar conexión limpio.
router.get('/ping', (_req: Request, res: Response) => {
  res.json({ ok: true });
});

// Red de seguridad B: la app actual hace GET sobre /ingest. Tras el auth, un 405
// (no-5xx, ≠401/403) es leído por la app como "Conexión OK".
router.get('/ingest', (_req: Request, res: Response) => {
  res.status(405).json({ error: 'Method Not Allowed', code: 'METHOD_NOT_ALLOWED' });
});

router.post(
  '/ingest',
  perDeviceLimit,
  upload.array('imagenes[]', env.QA_EXTERNA_MAX_FILES),
  ah(async (req: Request, res: Response) => {
    const files = (req.files as Express.Multer.File[] | undefined) ?? [];
    if (files.length === 0) {
      throw BadRequest('Se requiere al menos una imagen JPEG (campo imagenes[])');
    }

    // metadata es un string JSON: {"tipo":"...","notas":<string|null>}
    let metadata: { tipo?: unknown; notas?: unknown };
    try {
      metadata = JSON.parse(req.body.metadata ?? '') as { tipo?: unknown; notas?: unknown };
    } catch {
      throw BadRequest('metadata no es un JSON válido');
    }

    // Multipart entrega strings: armado manual del body antes de validar.
    const body = {
      clienteRegistroId: req.body.cliente_registro_id,
      identificadorApp: req.body.identificador_app,
      lat: req.body.lat,
      lng: req.body.lng,
      ...(req.body.accuracy !== undefined && req.body.accuracy !== ''
        ? { accuracy: req.body.accuracy }
        : {}),
      capturadoAt: req.body.capturado_at,
      tipo: metadata.tipo,
      notas: metadata.notas ?? null,
    };

    const parsed = qaExternaIngestSchema.safeParse(body);
    if (!parsed.success) {
      // Mismo formato que el errorHandler global (VALIDATION_ERROR), inline para
      // no depender de instanceof entre subpaths de zod.
      res.status(400).json({
        error: 'Datos inválidos',
        code: 'VALIDATION_ERROR',
        issues: parsed.error.issues.map((i) => ({
          field: i.path.join('.'),
          message: i.message,
        })),
      });
      return;
    }

    const result = await qaExternaService.ingest({
      clienteRegistroId: parsed.data.clienteRegistroId,
      dispositivoId: req.device!.id,
      identificadorApp: parsed.data.identificadorApp,
      tipo: parsed.data.tipo,
      lat: parsed.data.lat,
      lng: parsed.data.lng,
      accuracy: parsed.data.accuracy,
      capturadoAt: parsed.data.capturadoAt,
      notas: parsed.data.notas ?? null,
      metadataRaw: req.body.metadata,
      buffers: files.map((f) => f.buffer),
    });

    res.status(200).json({ registro_id: result.registroId, imagenes: result.imagenes });
  }),
);

export default router;
```

- [ ] **Step 2: Typecheck**

Run: `cd api && npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
cd "/mnt/c/Users/paulo/Claude Code/flotillas-v2"
git add api/src/routes/qaExternaRouter.ts
git commit -m "feat(qa-externa): router de ingesta + ping + 405 (probar conexión A+B)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: Mount the router + ensure storage dir at boot

**Files:**
- Modify: `api/src/index.ts`

- [ ] **Step 1: Add imports**

In `api/src/index.ts`, after the router imports (after line 40, `import ticketQuoteRouter ...`), add:

```typescript
import qaExternaRouter from './routes/qaExternaRouter';
```

And in the middleware-import group (after line 45, `import { authMiddleware } ...`), add:

```typescript
import { deviceAuthMiddleware } from './middlewares/deviceAuthMiddleware';
import { rateLimit } from './middlewares/rateLimit';
import { ensureQaExternaDir } from './lib/qaExternaStorage';
```

- [ ] **Step 2: Mount the qa-externa route**

In `api/src/index.ts`, immediately AFTER the last protected route mount (line 198, `app.use('/api/ticket-quotes', authMiddleware, ticketQuoteRouter);`) and BEFORE the Sentry handler (line 204), insert:

```typescript

// ═══════════════════════════════════════════════════
// 6.bis RUTA DE DISPOSITIVO (qa_externa) — auth por API key, NO JWT
// ═══════════════════════════════════════════════════
// Rate-limit por IP (pre-auth, fail-open) para frenar el sondeo de keys, luego
// el guard de dispositivo envuelve TODO el router (ingest + ping + 405).
app.use(
  '/api/qa-externa',
  rateLimit({ max: env.QA_EXTERNA_RATE_MAX, windowSec: env.QA_EXTERNA_RATE_WINDOW_SEC }),
  deviceAuthMiddleware,
  qaExternaRouter,
);
```

- [ ] **Step 3: Ensure the storage dir exists at boot**

In `api/src/index.ts`, change the `app.listen` callback (lines 214-217) to create the qa-externa dir before serving:

Replace:
```typescript
const server = app.listen(env.PORT, async () => {
  logger.info({ port: env.PORT, env: env.NODE_ENV }, 'API arriba');
  await initializeJobs();
});
```
With:
```typescript
const server = app.listen(env.PORT, async () => {
  logger.info({ port: env.PORT, env: env.NODE_ENV }, 'API arriba');
  await ensureQaExternaDir();
  await initializeJobs();
});
```

- [ ] **Step 4: Typecheck + full build**

Run: `cd api && npx tsc --noEmit && npm run build`
Expected: 0 errors; build succeeds.

- [ ] **Step 5: Commit**

```bash
cd "/mnt/c/Users/paulo/Claude Code/flotillas-v2"
git add api/src/index.ts
git commit -m "feat(qa-externa): monta /api/qa-externa tras el guard de dispositivo + crea dir al arranque

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 11: Provisioning CLIs + package.json scripts

**Files:**
- Create: `api/src/scripts/qa-externa-device-register.ts`
- Create: `api/src/scripts/qa-externa-device-revoke.ts`
- Modify: `api/package.json` (scripts)

- [ ] **Step 1: Create `api/src/scripts/qa-externa-device-register.ts`**

```typescript
// Registra un dispositivo qa_externa y emite su API key UNA sola vez.
// Persiste solo el hash (hashDeviceKey). Mismo patrón que create-user.ts.
//
// En el servidor (imagen prod):
//   $COMPOSE run --rm -e DEVICE_NAME="camara-zona-norte" \
//     api node dist/scripts/qa-externa-device-register.js
//
// Si usas QA_EXTERNA_KEY_PEPPER en la API, pásalo también aquí (-e) para que el
// hash coincida.

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { randomBytes } from 'crypto';
import { hashDeviceKey } from '../lib/deviceKeyHash';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const name = process.env.DEVICE_NAME?.trim();
  if (!name) {
    console.error('❌ DEVICE_NAME ausente.');
    console.error('   Uso: DEVICE_NAME="camara-zona-norte" node dist/scripts/qa-externa-device-register.js');
    process.exit(1);
  }

  const key = randomBytes(32).toString('base64url');
  const keyHash = hashDeviceKey(key);

  const device = await prisma.qaExternaDispositivo.create({
    data: { identificador: name, keyHash },
  });

  console.log(`✅ Dispositivo registrado: ${device.identificador} (id ${device.id}).`);
  console.log('');
  console.log('   API KEY (cópiala AHORA — NO SE VOLVERÁ A MOSTRAR):');
  console.log(`   ${key}`);
  console.log('');
  console.log('   Configúrala en la app como header: Authorization: Bearer <API KEY>');
}

main()
  .catch((e) => {
    console.error('❌ Error registrando el dispositivo:', e);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
```

- [ ] **Step 2: Create `api/src/scripts/qa-externa-device-revoke.ts`**

```typescript
// Revoca (desactiva) uno o más dispositivos qa_externa por id o por nombre.
//
//   $COMPOSE run --rm -e DEVICE_ID=3 api node dist/scripts/qa-externa-device-revoke.js
//   $COMPOSE run --rm -e DEVICE_NAME="camara-zona-norte" api node dist/scripts/qa-externa-device-revoke.js

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const idRaw = process.env.DEVICE_ID;
  const name = process.env.DEVICE_NAME?.trim();

  if (!idRaw && !name) {
    console.error('❌ Indica DEVICE_ID=<n> o DEVICE_NAME="<nombre>".');
    process.exit(1);
  }

  let count: number;
  if (idRaw) {
    const id = Number(idRaw);
    if (!Number.isInteger(id) || id <= 0) {
      console.error('❌ DEVICE_ID debe ser un entero > 0.');
      process.exit(1);
    }
    ({ count } = await prisma.qaExternaDispositivo.updateMany({
      where: { id },
      data: { activo: false },
    }));
  } else {
    ({ count } = await prisma.qaExternaDispositivo.updateMany({
      where: { identificador: name },
      data: { activo: false },
    }));
  }

  console.log(
    count > 0
      ? `✅ Revocados ${count} dispositivo(s).`
      : 'ℹ️  No se encontró ningún dispositivo con ese criterio.',
  );
}

main()
  .catch((e) => {
    console.error('❌ Error revocando el dispositivo:', e);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
```

- [ ] **Step 3: Add npm scripts to `api/package.json`**

In the `"scripts"` object of `api/package.json`, after the `"user:create"` line, add:

```json
    "qa:device:register": "node dist/scripts/qa-externa-device-register.js",
    "qa:device:revoke": "node dist/scripts/qa-externa-device-revoke.js",
```

- [ ] **Step 4: Typecheck + build (scripts compile to dist/)**

Run: `cd api && npx tsc --noEmit && npm run build`
Expected: 0 errors; `dist/scripts/qa-externa-device-register.js` and `dist/scripts/qa-externa-device-revoke.js` exist.

- [ ] **Step 5: Commit**

```bash
cd "/mnt/c/Users/paulo/Claude Code/flotillas-v2"
git add api/src/scripts/qa-externa-device-register.ts api/src/scripts/qa-externa-device-revoke.ts api/package.json
git commit -m "feat(qa-externa): CLIs de alta y revocación de dispositivos

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 12: Caddy timeouts (slow VPN uploads)

**Files:**
- Modify: `Caddyfile`
- Modify: `Caddyfile.public`

Body-size enforcement is delegated to multer (per-file cap); Caddy is left unbounded on body to avoid mis-capping multi-file uploads. We only add generous upstream timeouts.

- [ ] **Step 1: Edit `Caddyfile` (staging)**

Replace the line `reverse_proxy web:3000` with:

```
	# Timeouts holgados: las subidas de qa_externa llegan por VPN lenta.
	reverse_proxy web:3000 {
		transport http {
			read_timeout 300s
			write_timeout 300s
			dial_timeout 30s
		}
	}
```

- [ ] **Step 2: Edit `Caddyfile.public`**

Replace the line `reverse_proxy web:3000` with the same block:

```
	# Timeouts holgados: las subidas de qa_externa llegan por VPN/red lenta.
	reverse_proxy web:3000 {
		transport http {
			read_timeout 300s
			write_timeout 300s
			dial_timeout 30s
		}
	}
```

- [ ] **Step 3: Validate the Caddyfiles (if Docker is available)**

Run: `docker run --rm -v "$(pwd)/Caddyfile:/etc/caddy/Caddyfile" caddy:2-alpine caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile`
Expected: `Valid configuration`. Repeat for `Caddyfile.public`.
> If Docker/network is unavailable here, skip — the syntax above is standard Caddy v2 and will be validated on the next deploy build.

- [ ] **Step 4: Commit**

```bash
cd "/mnt/c/Users/paulo/Claude Code/flotillas-v2"
git add Caddyfile Caddyfile.public
git commit -m "feat(qa-externa): timeouts holgados en Caddy para subidas por VPN lenta

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 13: Operator/mobile-team documentation

**Files:**
- Create: `docs/qa-externa.md`

- [ ] **Step 1: Create `docs/qa-externa.md`**

````markdown
# qa_externa — Ingesta de Evidencia Externa (GeoCampo)

Módulo aditivo que recibe evidencias de campo (una foto JPEG + geo-metadatos) desde la app
móvil GeoCampo. Auth por API key de dispositivo (Bearer), idempotente por UUID de cliente y
con deduplicación de imágenes por sha256.

## Endpoints

| Método | Ruta | Auth | Respuesta |
|---|---|---|---|
| POST | `/api/qa-externa/ingest` | `Authorization: Bearer <api_key>` | `200 { "registro_id": <number>, "imagenes": [ { "id", "sha256", "bytes", "mime", "width", "height" } ] }` |
| GET | `/api/qa-externa/ping` | Bearer | `200 {"ok":true}` (sin/mala key → 401) |
| GET | `/api/qa-externa/ingest` | Bearer | `405` tras autenticar (red de seguridad para la app actual) |

Campos del `multipart/form-data` del POST: `cliente_registro_id` (UUID), `identificador_app`,
`lat`, `lng`, `accuracy` (opcional), `capturado_at` (ISO-8601 UTC), `metadata`
(`{"tipo":"lona|reunion|barda|otro","notas":<string|null>}`), `imagenes[]` (1..N JPEG; nombre de
campo literal con corchetes). Errores de auth → **401**; validación → **400** `VALIDATION_ERROR`;
otros → 4xx/5xx (reintentables).

### Idempotencia y dedupe
- Reenviar el mismo `cliente_registro_id` actualiza el registro y devuelve el **mismo** `registro_id`.
- Reenviar la misma imagen (mismo sha256) no re-guarda bytes ni duplica el vínculo.

## Probar conexión (app)
La app hace hoy `GET /api/qa-externa/ingest`. Funciona ya gracias al 405-tras-auth. Cuando el
equipo móvil quiera, puede migrar a `/ping` con un cambio de una línea
(`INGEST_PATH → '/api/qa-externa/ping'` en `src/features/sync/api.ts`, función `probarConexion`).

## Alta de un dispositivo (operador)
```bash
export COMPOSE="docker compose -p flotillas -f docker-compose.yml -f docker-compose.staging.yml"
$COMPOSE run --rm -e DEVICE_NAME="camara-zona-norte" api npm run qa:device:register
```
Imprime la API key **una sola vez** (se guarda solo su hash SHA-256). Cópiala y configúrala en la
app como `Authorization: Bearer <API KEY>`.

Revocar:
```bash
$COMPOSE run --rm -e DEVICE_ID=3 api npm run qa:device:revoke
# o por nombre:
$COMPOSE run --rm -e DEVICE_NAME="camara-zona-norte" api npm run qa:device:revoke
```

(Opcional) Para HMAC en lugar de SHA-256 plano, define `QA_EXTERNA_KEY_PEPPER` en el `.env` de la
API **y** pásalo al CLI de alta (`-e QA_EXTERNA_KEY_PEPPER=...`) para que el hash coincida.

## ⚠️ Nota TLS para el equipo móvil (BLOQUEA pruebas si se ignora)
- **Despliegue público** (`Caddyfile.public`, Let's Encrypt, dominio real): certificado de confianza
  → la app funciona en **Expo Go** sin configuración extra.
- **Staging interno** (`Caddyfile`, `tls internal`, `flotillas.internal:8443`): certificado
  autofirmado → **Android lo rechaza en Expo Go**. Se necesita un **build EAS** con
  `network-security-config` que confíe la CA de Caddy. Exportar la CA:
  ```bash
  $COMPOSE cp flotillas_caddy:/data/caddy/pki/authorities/local/root.crt ./flotillas-caddy-root.crt
  ```
  Avisar al equipo móvil cuál entorno usarán: contra staging necesitan el build EAS con la CA.

## Almacenamiento
Las imágenes se guardan content-addressed como `qa-externa/<sha256>.jpg` bajo `/app/uploads`
(`QA_EXTERNA_DIR`), persistido en el bind mount LUKS (`/srv/datos/flotillas/uploads`) en staging y
en el volumen `uploads_data` en público. Son servibles para usuarios autenticados (JWT) vía
`/uploads/qa-externa/<sha256>.jpg`.

## Variables de entorno (todas opcionales, con default)
`QA_EXTERNA_DIR` (`/app/uploads/qa-externa`), `QA_EXTERNA_MAX_FILE_SIZE_MB` (12),
`QA_EXTERNA_MAX_FILES` (5), `QA_EXTERNA_RATE_MAX`/`QA_EXTERNA_RATE_WINDOW_SEC` (60/60),
`QA_EXTERNA_KEY_PEPPER` (opcional).
````

- [ ] **Step 2: Commit**

```bash
cd "/mnt/c/Users/paulo/Claude Code/flotillas-v2"
git add docs/qa-externa.md
git commit -m "docs(qa-externa): contrato, alta de dispositivo y nota TLS para el equipo móvil

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 14: Smoke-test script + behavioral acceptance

**Files:**
- Create: `docs/qa-externa-smoke.sh`

This is the behavioral acceptance for the whole module (no unit-test framework exists).

- [ ] **Step 1: Create `docs/qa-externa-smoke.sh`**

```bash
#!/usr/bin/env bash
# Smoke test de qa_externa. Cubre los criterios de aceptación con curl.
#
# Uso:
#   BASE_URL=http://localhost:3001 KEY="<api_key del dispositivo>" bash docs/qa-externa-smoke.sh
#
# BASE_URL debe apuntar a la API (directo a :3001 en dev, o vía Caddy en staging).
# Genera el dispositivo antes con: npm run qa:device:register (y usa la key impresa).
set -uo pipefail

BASE_URL="${BASE_URL:-http://localhost:3001}"
KEY="${KEY:?Define KEY con la API key del dispositivo}"
TMP="$(mktemp -d)"
IMG="$TMP/evidencia.jpg"
UUID="$(cat /proc/sys/kernel/random/uuid)"

# JPEG válido mínimo (1x1) — magic bytes FFD8FF, suficiente para file-type.
base64 -d > "$IMG" <<'B64'
/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a
HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAA
AAAAAAAAAAAAAP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AfwD/2Q==
B64

pass=0; fail=0
check () { # $1=descripción $2=esperado $3=obtenido
  if [ "$2" = "$3" ]; then echo "✅ $1 (HTTP $3)"; pass=$((pass+1));
  else echo "❌ $1 — esperado $2, obtenido $3"; fail=$((fail+1)); fi
}

post () { # imprime el código HTTP de un POST de ingesta con el UUID dado
  curl -s -o "$TMP/out.json" -w '%{http_code}' \
    -H "Authorization: Bearer $KEY" \
    -F "cliente_registro_id=$1" \
    -F "identificador_app=smoke-test" \
    -F "lat=19.432608" -F "lng=-99.133209" \
    -F "capturado_at=2026-06-15T18:30:00.000Z" \
    -F 'metadata={"tipo":"lona","notas":null}' \
    -F "imagenes[]=@$IMG;type=image/jpeg;filename=$1.jpg" \
    "$BASE_URL/api/qa-externa/ingest"
}

echo "== ping =="
code=$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $KEY" "$BASE_URL/api/qa-externa/ping")
check "ping con key válida" "200" "$code"
code=$(curl -s -o /dev/null -w '%{http_code}' "$BASE_URL/api/qa-externa/ping")
check "ping sin key" "401" "$code"
code=$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer no-sirve" "$BASE_URL/api/qa-externa/ping")
check "ping con key inválida" "401" "$code"

echo "== probar conexión (GET /ingest) =="
code=$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $KEY" "$BASE_URL/api/qa-externa/ingest")
check "GET /ingest con key → 405" "405" "$code"
code=$(curl -s -o /dev/null -w '%{http_code}' "$BASE_URL/api/qa-externa/ingest")
check "GET /ingest sin key → 401" "401" "$code"

echo "== ingesta + idempotencia =="
code=$(post "$UUID"); check "primer POST" "200" "$code"
id1=$(grep -o '"registro_id":[0-9]*' "$TMP/out.json" | grep -o '[0-9]*')
code=$(post "$UUID"); check "reintento mismo UUID" "200" "$code"
id2=$(grep -o '"registro_id":[0-9]*' "$TMP/out.json" | grep -o '[0-9]*')
if [ -n "$id1" ] && [ "$id1" = "$id2" ]; then echo "✅ idempotencia: mismo registro_id ($id1)"; pass=$((pass+1));
else echo "❌ idempotencia: registro_id distinto ($id1 vs $id2)"; fail=$((fail+1)); fi

echo "== auth + validación =="
code=$(curl -s -o /dev/null -w '%{http_code}' \
  -F "cliente_registro_id=$(cat /proc/sys/kernel/random/uuid)" \
  -F "identificador_app=x" -F "lat=0" -F "lng=0" \
  -F "capturado_at=2026-06-15T18:30:00.000Z" \
  -F 'metadata={"tipo":"lona","notas":null}' \
  -F "imagenes[]=@$IMG;type=image/jpeg;filename=x.jpg" \
  "$BASE_URL/api/qa-externa/ingest")
check "POST sin Authorization → 401" "401" "$code"

code=$(curl -s -o /dev/null -w '%{http_code}' \
  -H "Authorization: Bearer $KEY" \
  -F "cliente_registro_id=$(cat /proc/sys/kernel/random/uuid)" \
  -F "identificador_app=x" -F "lat=0" -F "lng=0" \
  -F "capturado_at=2026-06-15T18:30:00.000Z" \
  -F 'metadata={"tipo":"NO_EXISTE","notas":null}' \
  -F "imagenes[]=@$IMG;type=image/jpeg;filename=x.jpg" \
  "$BASE_URL/api/qa-externa/ingest")
check "tipo inválido → 400" "400" "$code"

echo ""
echo "Resultado: $pass OK, $fail fallos."
rm -rf "$TMP"
[ "$fail" -eq 0 ]
```

- [ ] **Step 2: Run the dev stack**

Run: `cd "/mnt/c/Users/paulo/Claude Code/flotillas-v2" && docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --build`
Then apply migrations if needed: `docker compose -f docker-compose.yml -f docker-compose.dev.yml exec api npx prisma migrate deploy`
Expected: `api`, `postgres`, `redis` healthy.

- [ ] **Step 3: Register a test device and capture the key**

Run:
```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml exec -e DEVICE_NAME=smoke-device api npm run qa:device:register
```
Expected: prints an API key once. Copy it.

- [ ] **Step 4: Run the smoke test**

Run: `BASE_URL=http://localhost:3001 KEY="<la key del paso 3>" bash docs/qa-externa-smoke.sh`
Expected: every line `✅`, final `Resultado: N OK, 0 fallos.`

> If `BASE_URL=http://localhost:3001` is not directly reachable from the host in dev, run the script from inside the `api` container or point `BASE_URL` at the Caddy URL.

- [ ] **Step 5: Verify dedupe on disk**

Run: `docker compose -f docker-compose.yml -f docker-compose.dev.yml exec api sh -c 'ls -1 /app/uploads/qa-externa | wc -l'`
Expected: `1` (the two idempotent POSTs of the same image produced a single `<sha256>.jpg`).

- [ ] **Step 6: Commit**

```bash
cd "/mnt/c/Users/paulo/Claude Code/flotillas-v2"
git add docs/qa-externa-smoke.sh
git commit -m "test(qa-externa): smoke test con curl (idempotencia, dedupe, auth, validación, ping)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Final verification (CI gate parity)

Run all of these in `api/` and confirm green before declaring done:

- [ ] `cd api && npx prisma validate` → schema valid
- [ ] `cd api && npx prisma generate` → client generated
- [ ] `cd api && npx tsc --noEmit` → 0 errors
- [ ] `cd api && npm run build` → build succeeds
- [ ] `docs/qa-externa-smoke.sh` → all ✅, 0 fallos

(web/ and worker/ are untouched; their CI jobs should remain unaffected.)

---

## Spec coverage check

| Spec requirement | Task |
|---|---|
| Migración: dispositivos, registros, imágenes + pivote, UNIQUE en cliente_registro_id y sha256 | Task 1 |
| `POST /ingest`: auth + upsert idempotente + dedupe + validación + `{registro_id, imagenes}` | Tasks 5,7,8,9 |
| Probar conexión A + red de seguridad B | Task 9 (+ mount Task 10) |
| Generación/registro de API keys (CLI) | Task 11 |
| Config de almacenamiento de imágenes | Tasks 2,6,10 |
| Doc (alta de dispositivo, contrato, nota TLS) | Task 13 |
| Pruebas (idempotencia, dedupe, auth, validación) | Task 14 |
| API keys hasheadas, nunca en logs/claro | Tasks 4,5,11 (+ Pino redaction existente) |
| Caddy enruta + timeouts; TLS documentado (ambas) | Tasks 12,13 |
| `capturado_at` en UTC | Tasks 1,7 (DateTime + ISO con Z) |
| Rate limiting por dispositivo | Tasks 9,10 |
| `accuracy`/`notas` opcionales; `tipo` fuera de los 4 → rechazo | Task 7 |
