import React, { useEffect, useState } from "react";
import useDocusaurusContext from "@docusaurus/useDocusaurusContext";
import styles from "./styles.module.css";

function score(item, query) {
  const tokens = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) return 0;
  const title = item.title.toLowerCase();
  const description = item.description.toLowerCase();
  const keywords = item.keywords.join(" ");
  const content = item.content.toLowerCase();
  return tokens.reduce((total, token) => total
    + (title.includes(token) ? 12 : 0)
    + (keywords.includes(token) ? 6 : 0)
    + (description.includes(token) ? 4 : 0)
    + (content.includes(token) ? 1 : 0), 0);
}

export default function DocsSearch() {
  const { siteConfig } = useDocusaurusContext();
  const baseUrl = siteConfig.baseUrl.replace(/\/$/, "");
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [items, setItems] = useState([]);

  useEffect(() => {
    fetch(`${baseUrl}/docs-search-index.json`)
      .then((response) => response.ok ? response.json() : Promise.reject(response.status))
      .then((index) => setItems(index.items || []))
      .catch(() => setItems([]));
  }, [baseUrl]);

  useEffect(() => {
    const onKeyDown = (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setIsOpen(true);
      }
      if (event.key === "Escape") setIsOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const results = query.trim()
    ? items.map((item) => ({ item, score: score(item, query) }))
      .filter((result) => result.score > 0)
      .sort((left, right) => right.score - left.score)
      .slice(0, 7)
    : [];

  return <>
    <button className={styles.trigger} type="button" onClick={() => setIsOpen(true)} aria-label="Search EAI documentation">
      Search docs <kbd>Ctrl K</kbd>
    </button>
    {isOpen && <div className={styles.backdrop} role="presentation" onMouseDown={() => setIsOpen(false)}>
      <section className={styles.dialog} role="dialog" aria-modal="true" aria-label="Search EAI documentation" onMouseDown={(event) => event.stopPropagation()}>
        <label className={styles.label} htmlFor="eai-docs-search">Search EAI documentation</label>
        <input id="eai-docs-search" autoFocus className={styles.input} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Try tenant, gofer, or an error code" />
        <div className={styles.results}>
          {!query && <p>Search the current public documentation. Results stay in your browser.</p>}
          {query && !results.length && <p>No matching guide. Try a shorter term.</p>}
          {results.map(({ item }) => <a key={item.route} href={`${baseUrl}${item.route}`} onClick={() => setIsOpen(false)}>
            <span>{item.section}</span><strong>{item.title}</strong><small>{item.description}</small>
          </a>)}
        </div>
      </section>
    </div>}
  </>;
}
