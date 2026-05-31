// @ts-check

/**
 * Manual sidebar grouping. Item labels come from each page's H1 title;
 * the "Reviews" sub-category capitalizes the .tech-docs/review/ folder.
 * @type {import('@docusaurus/plugin-content-docs').SidebarsConfig}
 */
const sidebars = {
  docsSidebar: [
    {
      type: 'category',
      label: 'Getting Started',
      collapsed: false,
      items: ['overview', 'configuration', 'profiles'],
    },
    {
      type: 'category',
      label: 'Reference',
      items: ['api-reference', 'data-model'],
    },
    {
      type: 'category',
      label: 'Architecture & Internals',
      items: ['architecture', 'dependencies'],
    },
    {
      type: 'category',
      label: 'Operations',
      items: ['deployment', 'changelog'],
    },
    {
      type: 'category',
      label: 'Project',
      items: [
        'documentation-surfaces',
        {
          type: 'category',
          label: 'Reviews',
          items: ['review/code-quality', 'review/patterns'],
        },
      ],
    },
  ],
};

export default sidebars;
