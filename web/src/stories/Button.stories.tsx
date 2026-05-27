import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { Button } from '@/components/ui/button';

const meta: Meta<typeof Button> = {
  title: 'UI/Button',
  component: Button,
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
  argTypes: {
    variant: {
      control: 'select',
      options: ['default', 'destructive', 'outline', 'secondary', 'ghost', 'link'],
    },
    size: {
      control: 'select',
      options: ['default', 'sm', 'lg', 'icon'],
    },
  },
};

export default meta;
type Story = StoryObj<typeof Button>;

export const Default: Story = { args: { children: 'Continuar' } };
export const Destructive: Story = { args: { variant: 'destructive', children: 'Eliminar' } };
export const Outline: Story = { args: { variant: 'outline', children: 'Cancelar' } };
export const Small: Story = { args: { size: 'sm', children: 'Pequeño' } };
export const Large: Story = { args: { size: 'lg', children: 'Grande' } };
export const Disabled: Story = { args: { disabled: true, children: 'Bloqueado' } };
