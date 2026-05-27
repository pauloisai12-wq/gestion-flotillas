import { PageHeader } from '@/components/ui/page-header';
import { EmptyState } from '@/components/ui/empty-state';
import { Settings } from 'lucide-react';

export default function SettingsPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Configuración"
        description="Preferencias del sistema y parámetros globales"
      />
      <EmptyState
        icon={Settings}
        title="En construcción"
        description="La configuración del sistema se implementará en la Fase 5."
      />
    </div>
  );
}
