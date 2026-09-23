import React, { useState } from "react";
import styles from "./styles.module.css";

const routes = [
  ["GET", "/v4/identity/tenants", "List the current user's tenant memberships."],
  ["GET", "/v4/data/resources/{tenant-id}/{object-type}", "List resources for a known Object Type in a tenant."],
];

const safeIdentifier = (value, fallback) => (/^[a-zA-Z0-9-]{1,128}$/.test(value) ? value : fallback);

export default function RequestBuilder() {
  const [selected, setSelected] = useState(0);
  const [tenantId, setTenantId] = useState("");
  const [objectType, setObjectType] = useState("your-object-type");
  const [copied, setCopied] = useState(false);
  const [method, endpoint] = routes[selected];
  const resolvedEndpoint = endpoint
    .replace("{tenant-id}", encodeURIComponent(safeIdentifier(tenantId.trim(), "your-tenant-id")))
    .replace("{object-type}", encodeURIComponent(safeIdentifier(objectType.trim(), "your-object-type")));
  const command = `curl -X ${method} \"$BASE_URL_PUBLIC_API${resolvedEndpoint}\" \\
  -H 'Authorization: Bearer $EAI_ACCESS_TOKEN'`;
  const copy = async () => { await navigator.clipboard.writeText(command); setCopied(true); setTimeout(() => setCopied(false), 1800); };

  return <section className={styles.builder} aria-labelledby="request-builder-title">
    <div><p className={styles.eyebrow}>Safe request builder</p><h2 id="request-builder-title">Prepare a request. Run it in your own terminal.</h2><p>This page never receives a token or sends a request.</p></div>
    <label>Endpoint<select value={selected} onChange={(event) => setSelected(Number(event.target.value))}>{routes.map(([routeMethod, route], index) => <option key={route} value={index}>{routeMethod} {route}</option>)}</select></label>
    <p className={styles.description}>{routes[selected][2]}</p>
    {endpoint.includes("{tenant-id}") && <label>Tenant ID<input value={tenantId} onChange={(event) => setTenantId(event.target.value)} placeholder="Your tenant ID" /></label>}
    {endpoint.includes("{object-type}") && <label>Object Type slug<input value={objectType} onChange={(event) => setObjectType(event.target.value)} /></label>}
    <pre><code>{command}</code></pre>
    <button type="button" onClick={copy}>{copied ? "Copied" : "Copy command"}</button>
  </section>;
}
