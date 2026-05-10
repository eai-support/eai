import React from 'react';
import Layout from '@theme/Layout';
import Link from '@docusaurus/Link';

export default function Home() {
  return (
    <Layout
      title="EAI CLI"
      description="Nightly-generated technical documentation for EAI CLI sourced from .tech-docs.">
      <main style={{padding: '4rem 1.5rem', textAlign: 'center'}}>
        <h1>EAI CLI</h1>
        <p>Nightly-generated technical documentation sourced from <code>.tech-docs</code>.</p>
        <p>
          <Link className="button button--primary button--lg" to="/docs/overview">
            Open Technical Overview
          </Link>
        </p>
      </main>
    </Layout>
  );
}
