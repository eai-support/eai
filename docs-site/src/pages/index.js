import React from "react";
import Layout from "@theme/Layout";
import Link from "@docusaurus/Link";
import styles from "./index.module.css";

const journeys = [
  ["01", "Set up your computer", "Use EAI Setup to prepare a new Windows, macOS, or Ubuntu/Debian computer.", "/docs/installer-setup", "Download EAI Setup"],
  ["02", "Create an EAI app", "Use the guided or manual path to create a governed app.", "/docs/start-here", "Start building"],
  ["03", "Connect an existing app", "Use the App Template patterns for services, documents, and UI.", "/docs/eai-app-template", "View patterns"],
  ["04", "Solve a technical task", "Find commands, error guidance, and the PublicAPI reference.", "/docs/api-reference", "Open reference"],
];

export default function Home() {
  return <Layout title="EAI Documentation" description="Clear technical guidance for building governed EAI applications.">
    <main>
      <section className={styles.hero}>
        <div className={styles.heroContent}>
          <p className={styles.eyebrow}>Enterprise AI Documentation</p>
          <h1>Build governed AI applications with confidence.</h1>
          <p className={styles.lead}>Choose your goal. Get the shortest trusted path. Keep your build aligned with the EAI platform.</p>
          <div className={styles.actions}>
            <Link className={styles.primaryAction} to="/docs/start-here">Start here <span aria-hidden="true">→</span></Link>
            <Link className={styles.secondaryAction} to="/docs/error-guidance">Fix an issue</Link>
          </div>
        </div>
        <aside className={styles.releaseCard}>
          <span>Release-aligned</span><strong>CLI, Gofer, and App Template</strong>
          <p>Source-controlled docs with machine-readable guidance for people and agents.</p>
          <div><i /> Public docs <i /> No account required</div>
        </aside>
      </section>
      <section className={styles.journeySection} aria-labelledby="choose-a-path">
        <div className={styles.sectionHeading}><p className={styles.eyebrow}>Choose a path</p><h2 id="choose-a-path">What do you need to do?</h2></div>
        <div className={styles.journeys}>{journeys.map(([number, title, text, to, action]) => <Link key={number} to={to} className={styles.journey}>
          <span>{number}</span><h3>{title}</h3><p>{text}</p><strong>{action} <b aria-hidden="true">→</b></strong>
        </Link>)}</div>
      </section>
      <section className={styles.evidence}>
        <div><strong>Start fast</strong><span>EAI Setup or manual CLI setup for the first app.</span></div>
        <div><strong>Work safely</strong><span>Tenant-aware patterns and controlled API guidance.</span></div>
        <div><strong>Keep moving</strong><span>Examples, support guidance, and agent-readable assets.</span></div>
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
