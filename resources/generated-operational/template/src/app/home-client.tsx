'use client';

import dynamic from 'next/dynamic';

import { GeneratedWorkflowForm } from '@/components/generated-workflow/workflow-form';
import { GeneratedDemoHost, type DemoOperationalIdentity } from '@/components/generated-demo/demo-host';
import type { GeneratedWorkflowRuntime } from '@/lib/generated-workflow/runtime-contract';
import type { GeneratedDemoArtifact, GeneratedTrustedLayout } from '@/lib/generated-demo/contract';

const DemoPage = dynamic(() =>
  import('@enterpriseaigroup/demo').then((module) => module.DemoPage),
);

interface HomeClientProps {
  generatedDemo?: {
    appName: string;
    sourceDigest: string;
    fixtureDigest: string;
    previewFixtures: GeneratedDemoArtifact['previewFixtures'];
    workflowViews?: string[];
    workflowSteps?: Array<{ id: string; title: string; viewId: string }>;
    trustedViews?: Array<{ id: string; title: string; trustedLayout?: GeneratedTrustedLayout;
      safeUi: GeneratedDemoArtifact['appDefinition']['views'][number]['safeUi'] }>;
  };
  generatedOperational?: DemoOperationalIdentity;
  generatedWorkflow?: Pick<
    GeneratedWorkflowRuntime,
    'appKey' | 'binding' | 'snapshot' | 'branding' | 'assistantEnabled'
  >;
  runtimeError?: string;
}

export function HomeClient({
  generatedDemo,
  generatedOperational,
  generatedWorkflow,
  runtimeError,
}: HomeClientProps) {
  if (runtimeError) {
    const isGeneratedDemoError = runtimeError === 'DEMO_ARTIFACT_INVALID' || runtimeError === 'OPERATIONAL_BINDING_INVALID';
    return (
      <main className='flex min-h-svh items-center justify-center bg-slate-50 p-6'>
        <section className='max-w-lg rounded-2xl border border-red-200 bg-white p-8 text-center shadow-sm'>
          <h1 className='text-xl font-semibold text-slate-950'>
            {isGeneratedDemoError ? 'App unavailable' : 'Workflow unavailable'}
          </h1>
          <p className='mt-2 text-sm text-slate-600'>
            {isGeneratedDemoError
              ? 'The deployed app source or operational binding did not pass its integrity check.'
              : 'The deployed workflow snapshot did not pass its integrity check.'}
          </p>
        </section>
      </main>
    );
  }
  if (generatedDemo) {
    return <GeneratedDemoHost demo={generatedDemo} operational={generatedOperational} />;
  }
  if (!generatedWorkflow) {
    return <DemoPage />;
  }
  return (
    <div
      data-eai-workflow-ready='true'
      data-eai-workflow-digest={
        generatedWorkflow.binding.workflowTemplate.digest
      }
      data-eai-workflow-title={generatedWorkflow.binding.workflowTemplate.title}
    >
      <GeneratedWorkflowForm
        appKey={generatedWorkflow.appKey}
        binding={generatedWorkflow.binding}
        branding={generatedWorkflow.branding}
        assistantEnabled={generatedWorkflow.assistantEnabled}
        snapshot={generatedWorkflow.snapshot}
      />
    </div>
  );
}
