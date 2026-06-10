// @ts-check

import { themes as prismThemes } from "prism-react-renderer";

const siteUrl =
  process.env.EAI_DOCS_SITE_URL || "https://eai-tools.github.io";
const baseUrl = process.env.EAI_DOCS_BASE_URL || "/eai/";
const normalizedSiteUrl = siteUrl.replace(/\/$/, "");
const normalizedBaseUrl = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
const absoluteSitePath = (path) =>
  `${normalizedSiteUrl}${normalizedBaseUrl}${path.replace(/^\//, "")}`;

/** @type {import('@docusaurus/types').Config} */
const config = {
  title: "EAI Documentation",
  tagline: "CLI, gofer, app template, examples, and business scenarios",
  favicon: "img/favicon.ico",
  url: siteUrl,
  baseUrl,
  organizationName: "eai-tools",
  projectName: "eai",
  deploymentBranch: "gh-pages",
  trailingSlash: false,
  onBrokenLinks: "warn",
  markdown: {
    format: "md",
    mermaid: false,
    mdx1Compat: {
      comments: true,
      admonitions: true,
      headingIds: true,
    },
    hooks: {
      onBrokenMarkdownLinks: "warn",
      onBrokenMarkdownImages: "warn",
    },
  },
  i18n: {
    defaultLocale: "en",
    locales: ["en"],
  },
  presets: [
    [
      "classic",
      {
        docs: {
          path: "../.tech-docs",
          sidebarPath: "./sidebars.js",
          exclude: [
            "legacy-src/**",
            "architecture.md",
            "changelog.md",
            "data-model.md",
            "dependencies.md",
            "deployment.md",
            "documentation-surfaces.md",
            "overview.md",
            "publicapi-v4-coverage.md",
            "review/**",
          ],
          onInlineTags: "ignore",
        },
        blog: false,
        pages: false,
        theme: {
          customCss: "./src/css/custom.css",
        },
      },
    ],
  ],
  plugins: [
    [
      "@docusaurus/plugin-content-docs",
      {
        id: "scenarios",
        path: "scenarios",
        routeBasePath: "scenarios",
        sidebarPath: "./sidebars.scenarios.js",
        onInlineTags: "ignore",
      },
    ],
    [
      "@docusaurus/plugin-content-pages",
      {
        path: "src/pages",
        routeBasePath: "/",
      },
    ],
  ],
  themeConfig: {
    navbar: {
      title: "EAI Docs",
      items: [
        {
          type: "docSidebar",
          sidebarId: "docsSidebar",
          position: "left",
          label: "Docs",
        },
        {
          type: "doc",
          docId: "examples/index",
          position: "left",
          label: "Examples",
        },
        {
          type: "doc",
          docId: "index",
          docsPluginId: "scenarios",
          position: "left",
          label: "Scenarios",
        },
        {
          href: "https://github.com/eai-tools/eai/releases",
          label: "Releases",
          position: "left",
        },
        {
          href: "https://github.com/eai-tools/eai",
          label: "GitHub",
          position: "right",
        },
      ],
    },
    footer: {
      style: "dark",
      links: [
        {
          title: "Docs",
          items: [
            { label: "Start Here", to: "/docs/start-here" },
            { label: "EAI CLI", to: "/docs/eai-cli" },
            { label: "eai-gofer", to: "/docs/eai-gofer" },
            { label: "EAI App Template", to: "/docs/eai-app-template" },
            { label: "Examples", to: "/docs/examples/" },
            { label: "API Reference", to: "/docs/api-reference" },
            { label: "Scenarios", to: "/scenarios" },
            {
              label: "Registry",
              href: absoluteSitePath("registry/"),
            },
          ],
        },
      ],
      copyright: `Copyright © ${new Date().getFullYear()} EAI Tools.`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
      additionalLanguages: ["bash", "json", "typescript"],
    },
  },
};

export default config;
