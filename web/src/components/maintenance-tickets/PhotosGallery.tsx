// Galería simple de fotos adjuntas. Click → abre en pestaña nueva.

import { ImageOff } from 'lucide-react';
import type { TicketAttachment } from '@/hooks/useMaintenanceTickets';

export function PhotosGallery({
  attachments,
  apiBase,
}: {
  attachments: TicketAttachment[];
  apiBase?: string;
}) {
  if (!attachments || attachments.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center text-muted-foreground py-6 border border-dashed border-border rounded-md">
        <ImageOff className="size-5 mb-1.5" />
        <span className="text-xs">Sin fotos adjuntas</span>
      </div>
    );
  }

  const url = (path: string) => (apiBase ? `${apiBase}${path}` : path);

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2">
      {attachments.map((att) => (
        <a
          key={att.id}
          href={url(att.fileUrl)}
          target="_blank"
          rel="noopener noreferrer"
          className="aspect-square rounded-md overflow-hidden border border-border bg-muted hover:border-primary transition-colors group"
          title={att.fileName}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- thumbnails de uploads dinámicos sin dimensiones conocidas */}
          <img
            src={url(att.fileUrl)}
            alt={att.fileName}
            className="size-full object-cover group-hover:scale-105 transition-transform"
            loading="lazy"
          />
        </a>
      ))}
    </div>
  );
}
