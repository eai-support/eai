'use client';

import dynamic from 'next/dynamic';
import type { GeneratedDemoArtifact } from '@/lib/generated-demo/contract';

// Generated source must execute only after the browser enters the opaque-origin frame.
const GeneratedDemo = dynamic(
  () => import('./demo-app').then((module) => module.GeneratedDemo),
  { ssr: false },
);

export function ClientOnlyGeneratedDemo({
  artifact,
}: {
  artifact: GeneratedDemoArtifact;
}) {
  return <GeneratedDemo artifact={artifact} />;
}
