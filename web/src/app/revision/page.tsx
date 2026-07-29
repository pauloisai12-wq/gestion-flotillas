// El portal ya no tiene una sola pantalla: /revision es solo la puerta de
// entrada y manda a la primera sección real. Se resuelve en el servidor
// (redirect() de next/navigation, sin 'use client') para que el revisor no
// llegue a pintar una pantalla intermedia antes del salto; el guard de rol lo
// sigue aplicando el layout cliente sobre la ruta de destino.

import { redirect } from 'next/navigation';

export default function RevisionIndexPage() {
  redirect('/revision/evidencias');
}
