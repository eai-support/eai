import React, { useEffect, useState } from "react";
import useDocusaurusContext from "@docusaurus/useDocusaurusContext";
import styles from "./styles.module.css";

function findMatches(items, question) {
  const tokens = question.toLowerCase().match(/[a-z0-9-]{3,}/g) || [];
  return items.map((item) => ({
    item,
    score: tokens.reduce((score, token) => score
      + (item.title.toLowerCase().includes(token) ? 8 : 0)
      + (item.description.toLowerCase().includes(token) ? 4 : 0)
      + (item.content.toLowerCase().includes(token) ? 1 : 0), 0),
  })).filter((result) => result.score > 0).sort((a, b) => b.score - a.score).slice(0, 3);
}

export default function DocsAssistant() {
  const { siteConfig } = useDocusaurusContext();
  const baseUrl = siteConfig.baseUrl.replace(/\/$/, "");
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState("");
  const [items, setItems] = useState([]);

  useEffect(() => {
    fetch(`${baseUrl}/docs-search-index.json`).then((response) => response.json())
      .then((index) => setItems(index.items || [])
      ).catch(() => setItems([]));
  }, [baseUrl]);

  const matches = question.trim() ? findMatches(items, question) : [];
  return <aside className={styles.wrap} aria-label="Documentation assistant">
    <button type="button" className={styles.trigger} onClick={() => setOpen(!open)} aria-expanded={open}>Ask EAI Docs</button>
    {open && <div className={styles.panel}>
      <strong>Documentation assistant</strong>
      <p>It searches approved public guides. It does not send your question to an AI service.</p>
      <input value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="What do you need to do?" aria-label="Ask EAI documentation" />
      {question && !matches.length && <p className={styles.empty}>No source found. Try a command name or a shorter question.</p>}
      {matches.map(({ item }) => <a key={item.route} href={`${baseUrl}${item.route}`}><span>{item.section}</span>{item.title}</a>)}
    </div>}
  </aside>;
}
