'use client';

import { useCallback, useState } from 'react';
import GeneratedApp from '@/generated/app';
import type { GeneratedDemoArtifact } from '@/lib/generated-demo/contract';

interface GeneratedDemoProps {
  artifact: GeneratedDemoArtifact;
}

export function GeneratedDemo({ artifact }: GeneratedDemoProps) {
  const { appDefinition, previewFixtures, digests } = artifact;
  const [activeStepId, setActiveStepId] = useState(
    appDefinition.workflow.steps[0].id,
  );
  const [announcement, setAnnouncement] = useState('');
  const activeStep =
    appDefinition.workflow.steps.find((step) => step.id === activeStepId) ??
    appDefinition.workflow.steps[0];

  const runAction = useCallback(
    (actionId: string): string => {
      const action = previewFixtures.actions[actionId];
      const message = action
        ? `${action.message} This was a simulation; no real action occurred.`
        : 'This demo action is unavailable; no real action occurred.';
      setAnnouncement(message);
      return message;
    },
    [previewFixtures.actions],
  );

  return (
    <main
      data-eai-demo-ready='true'
      data-eai-demo-source-digest={digests.sourceBundle}
      data-eai-demo-fixture-digest={digests.previewFixtures}
      className='min-h-svh bg-slate-50 text-slate-950'
    >
      <div
        className='border-b border-amber-300 bg-amber-50 px-5 py-3 text-center text-sm font-medium text-amber-950'
        role='status'
      >
        Demo app · Sample data and simulated interactions. Changes here do not affect real records or services.
      </div>
      <header className='border-b border-slate-200 bg-white px-5 py-5'>
        <h1 className='text-2xl font-semibold'>{appDefinition.appName}</h1>
        <p className='mt-1 text-sm text-slate-600'>
          {appDefinition.businessCard.outcome}
        </p>
      </header>
      <nav
        className='flex flex-wrap gap-2 border-b border-slate-200 bg-white px-5 py-3'
        aria-label='Workflow views'
      >
        {appDefinition.workflow.steps.map((step) => (
          <button
            key={step.id}
            type='button'
            aria-current={step.id === activeStep.id ? 'page' : undefined}
            onClick={() => setActiveStepId(step.id)}
            className={`rounded-lg px-4 py-2 text-sm font-medium ${step.id === activeStep.id ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-800 hover:bg-slate-200'}`}
          >
            {step.title}
          </button>
        ))}
      </nav>
      <section className='mx-auto max-w-7xl p-5' aria-label={activeStep.title}>
        <GeneratedApp
          viewId={activeStep.viewId}
          fixtures={previewFixtures}
          runAction={runAction}
        />
      </section>
      <div aria-live='polite' className='sr-only'>
        {announcement}
      </div>
    </main>
  );
}
