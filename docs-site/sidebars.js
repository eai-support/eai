// @ts-check

/**
 * Manual public sidebar grouping. Internal/generated architecture, review,
 * deployment, and dependency snapshots are intentionally not published.
 * @type {import('@docusaurus/plugin-content-docs').SidebarsConfig}
 */
const sidebars = {
  docsSidebar: [
    {
      type: "category",
      label: "Getting Started",
      collapsed: false,
      items: [
        "start-here",
        "eai-cli",
        "eai-gofer",
        "eai-app-template",
        "examples/index",
      ],
    },
    {
      type: "category",
      label: "EAI CLI",
      items: ["configuration", "error-guidance", "api-reference"],
    },
    {
      type: "category",
      label: "EAI App Template",
      items: ["app-template/service-patterns", "app-template/config-driven-ui"],
    },
    {
      type: "category",
      label: "Examples",
      items: ["examples/task-tracker", "examples/ai-chat"],
    },
  ],
};

export default sidebars;
