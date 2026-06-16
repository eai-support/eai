import React from "react";
import Layout from "@theme/Layout";
import Link from "@docusaurus/Link";
import styles from "./index.module.css";

export default function Home() {
  return (
    <Layout
      title="EAI Documentation"
      description="Documentation for the EAI CLI, eai-gofer, the EAI App Template, examples, and business scenarios."
    >
      <main>
        <section className={styles.hero}>
          <div className={styles.heroInner}>
            <p className={styles.eyebrow}>EAI Documentation</p>
            <h1>Build, guide, and validate EAI apps from one docs site.</h1>
            <p className={styles.lead}>
              Start with the CLI, add eai-gofer for agent workflows, build with
              the EAI App Template, and browse business scenarios without
              leaving this site.
            </p>
            <div className={styles.actions}>
              <Link
                className="button button--primary button--lg"
                to="/docs/start-here"
              >
                Start Here
              </Link>
              <Link
                className="button button--secondary button--lg"
                to="/scenarios/"
              >
                Browse Scenarios
              </Link>
            </div>
          </div>
        </section>

        <section className={styles.highlights}>
          <article className={styles.panel}>
            <h2>EAI CLI</h2>
            <p>
              Install, authenticate, scaffold apps, publish Object Types, verify
              tenants, and operate platform services.
            </p>
            <Link to="/docs/eai-cli">Use the CLI</Link>
          </article>

          <article className={styles.panel}>
            <h2>eai-gofer</h2>
            <p>
              Refresh agent workflows, plan app delivery, and keep service-fit
              evidence aligned with the platform.
            </p>
            <Link to="/docs/eai-gofer">Open gofer docs</Link>
          </article>

          <article className={styles.panel}>
            <h2>App Template</h2>
            <p>
              Build Next.js apps with tenant config, Object Types, ResourceAPI,
              documents, chat, and config-driven UI.
            </p>
            <Link to="/docs/eai-app-template">Build an app</Link>
          </article>

          <article className={styles.panel}>
            <h2>Scenarios</h2>
            <p>
              Explore industry examples and business workflows before choosing
              what to build.
            </p>
            <Link to="/scenarios/">Open the scenario library</Link>
          </article>
        </section>
      </main>
    </Layout>
  );
}
