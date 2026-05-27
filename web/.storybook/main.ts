import type { StorybookConfig } from '@storybook/nextjs-vite';

const config: StorybookConfig = {
  stories: [
    '../src/**/*.mdx',
    '../src/**/*.stories.@(js|jsx|ts|tsx)',
  ],
  addons: ['@storybook/addon-a11y'],
  framework: {
    name: '@storybook/nextjs-vite',
    options: {},
  },
  docs: {},
  staticDirs: ['../public'],
  typescript: {
    reactDocgen: 'react-docgen-typescript',
  },
};

export default config;
