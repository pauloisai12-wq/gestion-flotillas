// Selector de programa del portal de revisión. Vive aquí, y no duplicado en
// cada pantalla, porque las dos vistas (evidencias y personas) tienen que
// ofrecer exactamente las mismas opciones: si algún día se agregara un programa,
// una sola definición evita que una pantalla lo muestre y la otra no.

'use client';

import { Button } from '@/components/ui/button';
import { type QaPrograma } from '@/hooks/useQaRegistros';

// Cada programa (BUFFALO | LX) es una TABLA INDEPENDIENTE; se cambia con el
// switch de arriba. Por eso la tabla ya no lleva columna 'programa': siempre
// muestra un solo programa a la vez.
const PROGRAMA_TABS: { value: QaPrograma; label: string }[] = [
  { value: 'BUFFALO', label: 'Buffalo' },
  { value: 'LX', label: 'LX' },
];

export default function ProgramaSwitch({
  value,
  onChange,
}: {
  value: QaPrograma;
  onChange: (programa: QaPrograma) => void;
}) {
  return (
    <div className="inline-flex gap-1 rounded-lg border border-border bg-muted/40 p-1">
      {PROGRAMA_TABS.map((t) => (
        <Button
          key={t.value}
          variant={value === t.value ? 'default' : 'ghost'}
          size="sm"
          onClick={() => onChange(t.value)}
          aria-pressed={value === t.value}
        >
          {t.label}
        </Button>
      ))}
    </div>
  );
}
