import React from "react";
import Layout from "@theme/Layout";
import Link from "@docusaurus/Link";
import styles from "./index.module.css";

const journeys = [
  ["01", "Set up this computer", "Recommended. Use EAI Setup to prepare a Windows, macOS, or Ubuntu/Debian computer and create your first app.", "/docs/installer-setup", "Use EAI Setup"],
  ["02", "Connect an existing project", "Add EAI patterns to a project you already have.", "/docs/eai-app-template", "Connect a project"],
  ["03", "Manual or managed setup", "Use the CLI for CI, managed devices, proxies, or a controlled installation.", "/docs/manual-and-managed-setup", "View manual setup"],
];

export default function Home() {
  return <Layout title="EAI Documentation" description="Clear technical guidance for building governed EAI applications.">
    <main>
      <section className={styles.hero}>
        <div className={styles.heroContent}>
          <p className={styles.eyebrow}>Enterprise AI Documentation</p>
          <h1>Start an EAI project without the setup maze.</h1>
          <p className={styles.lead}>Most people should use EAI Setup. Choose a different path only if you already have a project or need a managed installation.</p>
          <div className={styles.actions}>
            <Link className={styles.primaryAction} to="/docs/installer-setup">Set up this computer <span aria-hidden="true">→</span></Link>
            <Link className={styles.secondaryAction} to="/docs/start-here">Choose another path</Link>
          </div>
        </div>
        <aside className={styles.releaseCard}>
          <span>Recommended route</span><strong>Download, sign in, and name your project.</strong>
          <p>EAI Setup prepares the supported tools and guides the remaining choices.</p>
          <div><i /> Windows <i /> macOS <i /> Ubuntu/Debian</div>
        </aside>
      </section>
      <section className={styles.journeySection} aria-labelledby="choose-a-path">
        <div className={styles.sectionHeading}><p className={styles.eyebrow}>Choose a path</p><h2 id="choose-a-path">What do you need to do?</h2></div>
        <div className={styles.journeys}>{journeys.map(([number, title, text, to, action]) => <Link key={number} to={to} className={styles.journey}>
          <span>{number}</span><h3>{title}</h3><p>{text}</p><strong>{action} <b aria-hidden="true">→</b></strong>
        </Link>)}</div>
      </section>
      <section className={styles.evidence}>
        <div><strong>About 10 minutes</strong><span>For a standard desktop setup and first project.</span></div>
        <div><strong>Your approval stays in control</strong><span>You approve system prompts and browser sign-in.</span></div>
        <div><strong>Detailed guidance remains available</strong><span>Use manual setup only when it fits your environment.</span></div>
      </section>
      <section className={styles.resources}>
        <div><p className={styles.eyebrow}>Go deeper</p><h2>Use the right reference for the work.</h2></div>
        <div className={styles.resourceLinks}>
          <Link to="/docs/eai-cli">EAI CLI <span>Install, authenticate, and operate platform services.</span></Link>
          <Link to="/docs/eai-gofer">eai-gofer <span>Plan, implement, and validate with coding agents.</span></Link>
          <Link to="/docs/examples">Examples <span>Start from practical application patterns.</span></Link>
          <Link to="/scenarios/">Scenarios <span>Explore business workflows by industry.</span></Link>
        </div>
      </section>
    </main>
  </Layout>;
}
