import React from "react";
import DocsAssistant from "@site/src/components/DocsAssistant";
import DocsSearch from "@site/src/components/DocsSearch";

export default function Root({ children }) {
  return <>{children}<DocsAssistant /><DocsSearch /></>;
}
