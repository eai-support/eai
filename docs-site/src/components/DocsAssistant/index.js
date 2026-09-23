import React, { useEffect, useRef, useState } from "react";
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

export default function DocsAssistant() {
  const { siteConfig } = useDocusaurusContext();
  const baseUrl = siteConfig.baseUrl.replace(/\/$/, "");
  const assistantApiUrl = siteConfig.customFields.docsAssistantApiUrl;
  const [isAskOpen, setIsAskOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [items, setItems] = useState([]);
  const [messages, setMessages] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef(null);

  useEffect(() => {
    fetch(`${baseUrl}/docs-search-index.json`)
      .then((response) => response.ok ? response.json() : Promise.reject(response.status))
      .then((index) => setItems(index.items || []))
      .catch(() => setItems([]));
  }, [baseUrl]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  useEffect(() => {
    const onKeyDown = (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setIsAskOpen(true);
      }
      if (event.key === "Escape") setIsAskOpen(false);
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

  const openAsk = () => {
    setIsAskOpen(true);
  };

  async function sendQuestion() {
    const message = query.trim();
    if (!message || isLoading) return;

    const userMessage = { id: `${Date.now()}-user`, role: "user", content: message };
    setMessages((current) => [...current, userMessage]);
    setQuery("");
    setIsLoading(true);

    try {
      const response = await fetch(assistantApiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message,
          history: messages.slice(-5).map(({ role, content }) => ({ role, content })),
          surface: "docs",
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "The assistant is unavailable.");
      setMessages((current) => [...current, {
        id: `${Date.now()}-assistant`,
        role: "assistant",
        content: data.message,
        sources: data.sources || [],
      }]);
    } catch (error) {
      setMessages((current) => [...current, {
        id: `${Date.now()}-assistant-error`,
        role: "assistant",
        content: "I could not reach the documentation assistant. Please try again shortly or use Search.",
        sources: [],
      }]);
    } finally {
      setIsLoading(false);
    }
  }

  return <>
    <div className={styles.triggers}>
      <button className={styles.askTrigger} type="button" onClick={openAsk} aria-expanded={isAskOpen} aria-label="Search and Ask EAI Docs">Search and Ask</button>
    </div>
    {isAskOpen && <aside className={styles.drawer} role="dialog" aria-modal="true" aria-label="Ask EAI Docs">
      <header className={styles.header}>
        <div><strong>Search and Ask</strong><p>Search local guides or ask for a cited answer.</p></div>
        <button type="button" className={styles.close} onClick={() => setIsAskOpen(false)} aria-label="Close Ask EAI Docs">Close</button>
      </header>
      <div className={styles.messages} aria-live="polite">
        {!messages.length && <p>Ask a question about EAI Docs or the Enterprise AI website. Every answer includes its sources.</p>}
        {messages.map((message) => <div key={message.id} className={message.role === "user" ? styles.userMessage : styles.assistantMessage}>
          <p>{message.content}</p>
          {message.sources?.length > 0 && <div className={styles.sources}><span>Sources</span>{message.sources.map((source) => <a key={source.url} href={source.url} target="_blank" rel="noreferrer">{source.title}</a>)}</div>}
        </div>)}
        {isLoading && <p className={styles.loading}>Finding cited sources...</p>}
        {!messages.length && query && results.length > 0 && <div className={styles.results}>
          <p className={styles.question}>Matching guides</p>
          {results.map(({ item }) => <a key={item.route} href={`${baseUrl}${item.route}`} onClick={() => setIsAskOpen(false)}>
            <span>{item.section}</span><strong>{item.title}</strong><small>{item.description}</small>
          </a>)}
        </div>}
        <div ref={messagesEndRef} />
      </div>
      <form className={styles.composer} onSubmit={(event) => { event.preventDefault(); sendQuestion(); }}>
        <label className="sr-only" htmlFor="eai-docs-ask">Ask a question</label>
        <input id="eai-docs-ask" className={styles.askInput} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Ask a question" disabled={isLoading} />
        <button type="submit" disabled={!query.trim() || isLoading}>Send</button>
      </form>
    </aside>}
  </>;
}
