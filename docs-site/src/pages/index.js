import React from 'react';
import Layout from '@theme/Layout';
import Link from '@docusaurus/Link';
import styles from './index.module.css';

export default function Home() {
  return (
    <Layout
      title="EAI CLI"
      description="Technical documentation and scenario library for the EAI CLI.">
      <main>
        <section className={styles.hero}>
          <div className={styles.heroInner}>
            <p className={styles.eyebrow}>EAI CLI Docs</p>
            <h1>Technical reference and scenario library in one place.</h1>
            <p className={styles.lead}>
              Explore nightly-generated CLI documentation from <code>.tech-docs</code> and browse the restored
              industry scenario library as a dedicated area of the site.
            </p>
            <div className={styles.actions}>
              <Link className="button button--primary button--lg" to="/docs/overview">
                Open Documentation
              </Link>
              <Link className="button button--secondary button--lg" to="/scenarios/">
                Browse Scenarios
              </Link>
            </div>
          </div>
        </section>

        <section className={styles.highlights}>
          <article className={styles.panel}>
            <h2>Documentation</h2>
            <p>Architecture, configuration, profiles, deployment, API reference, and generated code review notes.</p>
            <Link to="/docs/overview">Start with the overview</Link>
          </article>

          <article className={styles.panel}>
            <h2>Scenarios</h2>
            <p>13 industries and 90 detailed example workflows showing how to model vertical applications with `eai`.</p>
            <Link to="/scenarios/">Open the scenario library</Link>
          </article>

          <article className={styles.panel}>
            <h2>Registry</h2>
            <p>Self-hosted package registry assets published alongside the docs site.</p>
            <Link href="https://eai-tools.github.io/eai-cli/registry/">View the registry</Link>
          </article>
        </section>
      </main>
    </Layout>
  );
}
