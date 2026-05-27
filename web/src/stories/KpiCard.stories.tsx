import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { KpiCard } from '@/components/ui/kpi-card';

const meta: Meta<typeof KpiCard> = {
  title: 'UI/KpiCard',
  component: KpiCard,
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof KpiCard>;

export const VehiclesActive: Story = {
  args: {
    label: 'Vehículos activos',
    value: '247',
    hint: 'En operación hoy',
    delta: { value: '+12%', trend: 'up', meaning: 'good' },
  },
};

export const FuelSpent: Story = {
  args: {
    label: 'Combustible este mes',
    value: '1,234,567',
    unit: 'MXN',
    hint: '78% del presupuesto',
    delta: { value: '-4%', trend: 'down', meaning: 'good' },
    spark: [10, 12, 15, 14, 18, 22, 25, 30, 28, 32, 35, 33],
  },
};

export const Linked: Story = {
  args: {
    label: 'Documentos por vencer',
    value: '8',
    href: '/vehiculos',
    delta: { value: '+3', trend: 'up', meaning: 'bad' },
  },
};
