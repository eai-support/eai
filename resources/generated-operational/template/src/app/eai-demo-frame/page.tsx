import { ClientOnlyGeneratedDemo } from '@/components/generated-demo/client-only-demo';
import { projectGeneratedDemoClientView } from '@/lib/generated-demo/contract';
import { getGeneratedDemoRuntime } from '@/lib/generated-demo/runtime';

export const dynamic = 'force-dynamic';

/** Render accepted source only in the middleware-sandboxed document. */
export default function IsolatedDemoPage() {
  const runtime = getGeneratedDemoRuntime();
  if (runtime.status !== 'ready') {
    return <main role='alert'>The demo app is unavailable.</main>;
  }
  return (
    <ClientOnlyGeneratedDemo
      demo={projectGeneratedDemoClientView(runtime.artifact)}
    />
  );
}
