'use client';

import dynamic from 'next/dynamic';
import type { GeneratedDemoClientView } from '@/lib/generated-demo/contract';

// Generated source must execute only after the browser enters the opaque-origin frame.
const GeneratedDemo = dynamic(
  () => import('./demo-app').then((module) => module.GeneratedDemo),
  { ssr: false },
);

export function ClientOnlyGeneratedDemo({
  demo,
}: {
  demo: GeneratedDemoClientView;
}) {
  return <GeneratedDemo demo={demo} />;
}
