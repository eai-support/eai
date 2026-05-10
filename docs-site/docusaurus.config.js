// @ts-check

import { themes as prismThemes } from 'prism-react-renderer';

/** @type {import('@docusaurus/types').Config} */
const config = {
  title: 'EAI CLI',
  tagline: 'Nightly-generated technical documentation sourced from .tech-docs',
  favicon: 'img/favicon.ico',
  url: 'https://eai-tools.github.io',
  baseUrl: '/eai-cli/',
  organizationName: 'eai-tools',
  projectName: 'eai-cli',
  deploymentBranch: 'gh-pages',
  trailingSlash: false,
  onBrokenLinks: 'warn',
  markdown: {
    format: 'md',
    mermaid: false,
    mdx1Compat: {
      comments: true,
      admonitions: true,
      headingIds: true,
    },
    hooks: {
      onBrokenMarkdownLinks: 'warn',
      onBrokenMarkdownImages: 'warn',
    },
  },
  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },
  presets: [
    [
      'classic',
      {
        docs: {
          path: '../.tech-docs',
          sidebarPath: './sidebars.js',
          exclude: ['legacy-src/**'],
          onInlineTags: 'ignore',
        },
        blog: false,
        pages: false,
        theme: {
          customCss: './src/css/custom.css',
        },
      },
    ],
  ],
  plugins: [
    [
      '@docusaurus/plugin-content-pages',
      {
        path: 'src/pages',
        routeBasePath: '/',
      },
    ],
  ],
  themeConfig: {
    navbar: {
      title: 'EAI CLI',
      items: [
        {
          type: 'docSidebar',
          sidebarId: 'docsSidebar',
          position: 'left',
          label: 'Documentation',
        },
        {
          href: 'https://github.com/eai-tools/eai-cli',
          label: 'GitHub',
          position: 'right',
        },
      ],
    },
    footer: {
      style: 'dark',
      links: [
        {
          title: 'Docs',
          items: [
            {label: 'Overview', to: '/docs/overview'},
            {label: 'API Reference', to: '/docs/api-reference'},
            {label: 'Configuration', to: '/docs/configuration'},
            {
              label: 'Registry',
              href: 'https://eai-tools.github.io/eai-cli/registry/',
            },
          ],
        },
      ],
      copyright: `Copyright © ${new Date().getFullYear()} EAI Tools.`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
      additionalLanguages: ['bash', 'json', 'typescript'],
    },
  },
};

export default config;
