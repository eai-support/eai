import React, { useState } from "react";
import styles from "./styles.module.css";

const routes = [
  ["GET", "/v4/identity/tenants", "List the current user's tenant memberships."],
  ["GET", "/v4/data/resources/{object-type}", "List resources for a known Object Type."],
  ["GET", "/v4/data/documents", "List documents available to the active tenant."],
  ["POST", "/v4/ai/chat", "Send a governed chat request through a configured workflow."],
];

export default function RequestBuilder() {
  const [selected, setSelected] = useState(0);
  const [tenantId, setTenantId] = useState("");
  const [objectType, setObjectType] = useState("your-object-type");
  const [copied, setCopied] = useState(false);
  const [method, endpoint] = routes[selected];
  const resolvedEndpoint = endpoint.replace("{object-type}", objectType || "your-object-type");
  const tenantHeader = tenantId.trim() ? ` \\\n+  -H 'X-Tenant-Id: ${tenantId.trim()}'` : "";
  const body = method === "POST" ? " \\\n+  -H 'Content-Type: application/json' \\\n+  --data '{\"message\": \"Describe the task here\"}'" : "";
  const command = `curl -X ${method} \"$BASE_URL_PUBLIC_API${resolvedEndpoint}\" \\\n+  -H 'Authorization: Bearer $EAI_ACCESS_TOKEN'${tenantHeader}${body}`;
  const copy = async () => { await navigator.clipboard.writeText(command); setCopied(true); setTimeout(() => setCopied(false), 1800); };

  return <section className={styles.builder} aria-labelledby="request-builder-title">
    <div><p className={styles.eyebrow}>Safe request builder</p><h2 id="request-builder-title">Prepare a request. Run it in your own terminal.</h2><p>This page never receives a token or sends a request.</p></div>
    <label>Endpoint<select value={selected} onChange={(event) => setSelected(Number(event.target.value))}>{routes.map(([routeMethod, route], index) => <option key={route} value={index}>{routeMethod} {route}</option>)}</select></label>
    <p className={styles.description}>{routes[selected][2]}</p>
    <label>Tenant ID (optional)<input value={tenantId} onChange={(event) => setTenantId(event.target.value)} placeholder="Your tenant ID" /></label>
    {endpoint.includes("{object-type}") && <label>Object Type slug<input value={objectType} onChange={(event) => setObjectType(event.target.value)} /></label>}
    <pre><code>{command}</code></pre>
    <button type="button" onClick={copy}>{copied ? "Copied" : "Copy command"}</button>
  </section>;
}
