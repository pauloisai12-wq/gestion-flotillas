import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { StatusBadge } from '@/components/ui/status-badge';

const meta: Meta<typeof StatusBadge> = {
  title: 'UI/StatusBadge',
  component: StatusBadge,
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
  argTypes: {
    status: {
      control: 'select',
      options: ['operative', 'blocked', 'expiring', 'maintenance', 'inactive', 'info'],
    },
  },
};

export default meta;
type Story = StoryObj<typeof StatusBadge>;

export const Operative: Story = { args: { status: 'operative' } };
export const Blocked: Story = { args: { status: 'blocked' } };
export const Expiring: Story = { args: { status: 'expiring' } };
export const Maintenance: Story = { args: { status: 'maintenance' } };
export const Inactive: Story = { args: { status: 'inactive' } };
export const CustomLabel: Story = { args: { status: 'blocked', label: 'Documentos vencidos' } };
