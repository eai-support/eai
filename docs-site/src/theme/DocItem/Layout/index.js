import React from "react";
import OriginalDocItemLayout from "@theme-original/DocItem/Layout";
import { useDoc } from "@docusaurus/plugin-content-docs/client";
import PageFeedback from "@site/src/components/PageFeedback";
import RequestBuilder from "@site/src/components/RequestBuilder";

export default function DocItemLayout(props) {
  const { metadata } = useDoc();
  return <>
    <OriginalDocItemLayout {...props} />
    {metadata.id === "api-reference" && <div className="container padding-bottom--lg"><RequestBuilder /></div>}
    <PageFeedback />
  </>;
}
