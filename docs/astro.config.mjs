import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

export default defineConfig({
  site: 'https://eai-tools.github.io',
  base: '/eai-cli',
  integrations: [
    starlight({
      title: 'EAI CLI',
      description: 'Build vertical business applications with the EnterpriseAI platform',
      logo: {
        src: './src/assets/logo.svg',
        replacesTitle: false,
      },
      favicon: '/favicon.svg',
      social: {
        github: 'https://github.com/eai-tools/eai-cli',
      },
      editLink: {
        baseUrl: 'https://github.com/eai-tools/eai-cli/edit/main/docs/',
      },
      expressiveCode: {
        themes: ['github-dark', 'github-light'],
      },
      sidebar: [
        {
          label: 'Getting Started',
          items: [
            { label: 'Installation', slug: 'getting-started/installation' },
            { label: 'Prerequisites', slug: 'getting-started/prerequisites' },
            { label: 'Onboarding Walkthrough', slug: 'getting-started/onboarding-walkthrough' },
            { label: 'Quick Start', slug: 'getting-started/quickstart' },
            { label: 'Authentication', slug: 'getting-started/authentication' },
            { label: 'Your First Vertical', slug: 'getting-started/first-vertical' },
          ],
        },
        {
          label: 'Guides',
          items: [
            { label: 'Object Types', slug: 'guides/object-types' },
            { label: 'Resources', slug: 'guides/resources' },
            { label: 'Environment', slug: 'guides/environment' },
            { label: 'Deployment', slug: 'guides/deployment' },
            { label: 'AI Features', slug: 'guides/ai-features' },
            { label: 'Multi-Tenant', slug: 'guides/multi-tenant' },
            { label: 'Security', slug: 'guides/security' },
            { label: 'Troubleshooting', slug: 'guides/troubleshooting' },
          ],
        },
        {
          label: 'Concepts',
          items: [
            { label: 'Platform Overview', slug: 'concepts/platform-overview' },
            { label: 'Verticals', slug: 'concepts/verticals' },
            { label: 'Architecture', slug: 'concepts/architecture' },
            { label: 'Data Model', slug: 'concepts/data-model' },
            { label: 'Security Model', slug: 'concepts/security-model' },
          ],
        },
        {
          label: 'Command Reference',
          collapsed: true,
          autogenerate: { directory: 'reference/commands' },
        },
        {
          label: 'Reference',
          items: [
            { label: 'Object Type Schema', slug: 'reference/object-type-schema' },
            { label: 'API Surface', slug: 'reference/api-surface' },
            { label: 'Environment Variables', slug: 'reference/environment-vars' },
            { label: 'Error Codes', slug: 'reference/error-codes' },
            { label: 'Glossary', slug: 'reference/glossary' },
          ],
        },
        {
          label: 'Examples',
          collapsed: true,
          autogenerate: { directory: 'examples' },
        },
        {
          label: 'Scenarios',
          collapsed: true,
          items: [
            { label: 'All Scenarios', slug: 'scenarios' },
            { label: 'Healthcare', autogenerate: { directory: 'scenarios/healthcare' } },
            { label: 'Finance', autogenerate: { directory: 'scenarios/finance' } },
            { label: 'Government', autogenerate: { directory: 'scenarios/government' } },
            { label: 'Retail', autogenerate: { directory: 'scenarios/retail' } },
            { label: 'Education', autogenerate: { directory: 'scenarios/education' } },
            { label: 'Real Estate', autogenerate: { directory: 'scenarios/real-estate' } },
            { label: 'Manufacturing', autogenerate: { directory: 'scenarios/manufacturing' } },
            { label: 'Legal', autogenerate: { directory: 'scenarios/legal' } },
            { label: 'Non-Profit', autogenerate: { directory: 'scenarios/non-profit' } },
            { label: 'Logistics', autogenerate: { directory: 'scenarios/logistics' } },
            { label: 'Business Services', autogenerate: { directory: 'scenarios/business-services' } },
            { label: 'Marketing & Creative', autogenerate: { directory: 'scenarios/marketing-creative' } },
            { label: 'Technology Services', autogenerate: { directory: 'scenarios/technology-services' } },
          ],
        },
      ],
      customCss: [
        '@fontsource-variable/inter',
        './src/styles/custom.css',
      ],
    }),
  ],
});
