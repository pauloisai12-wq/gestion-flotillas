// Declaración local para `file-type` v18+ (ESM puro).
//
// El paquete vive en `node_modules/file-type` pero TypeScript no resuelve sus
// tipos bajo `moduleResolution: "node"` (legacy) porque usa el campo `exports`
// condicional. Las opciones "correctas" requerirían migrar todo el tsconfig a
// `node16/nodenext` (con extensiones `.js` en imports relativos), lo cual
// sería un refactor masivo por una sola dependencia. En su lugar, declaramos
// aquí solo la API que el proyecto usa.
//
// En runtime, `vehicleImportRouter` carga el paquete vía `await import('file-type')`,
// lo cual funciona en Node 18+ desde un módulo CommonJS gracias al soporte
// nativo de dynamic import para ESM.

declare module 'file-type' {
  export interface FileTypeResult {
    ext: string;
    mime: string;
  }

  export function fileTypeFromBuffer(
    buffer: Buffer | Uint8Array | ArrayBuffer,
  ): Promise<FileTypeResult | undefined>;
}
