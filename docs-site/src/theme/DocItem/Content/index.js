import React from "react";
import clsx from "clsx";
import { ThemeClassNames } from "@docusaurus/theme-common";
import { useDoc } from "@docusaurus/plugin-content-docs/client";
import Heading from "@theme/Heading";
import MDXContent from "@theme/MDXContent";
import InstallerDownload from "@site/src/components/InstallerDownload";

function useSyntheticTitle() {
  const { metadata, frontMatter, contentTitle } = useDoc();
  return !frontMatter.hide_title && typeof contentTitle === "undefined" ? metadata.title : null;
}

export default function DocItemContent({ children }) {
  const syntheticTitle = useSyntheticTitle();
  const { metadata } = useDoc();
  const isInstallerGuide = metadata.id === "installer-setup";

  return <div className={clsx(ThemeClassNames.docs.docMarkdown, "markdown")}>
    {syntheticTitle && <header><Heading as="h1">{syntheticTitle}</Heading></header>}
    {isInstallerGuide && <InstallerDownload />}
    <MDXContent>{children}</MDXContent>
  </div>;
}
