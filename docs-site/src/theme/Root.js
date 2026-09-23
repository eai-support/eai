import React from "react";
import DocsAssistant from "@site/src/components/DocsAssistant";

export default function Root({ children }) {
  return <>{children}<DocsAssistant /></>;
}
