import { getAccessToken } from '@enterpriseaigroup/core/server';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { HomeClient } from './home-client';
import {
  getRoutingRedirectUrl,
  resolvePublicApiBaseUrl,
  RoutingResolutionError,
} from '@/lib/platform/session-resolve';
import { getGeneratedWorkflowRuntime } from '@/lib/generated-workflow/runtime';
import { getGeneratedDemoRuntime } from '@/lib/generated-demo/runtime';
import { getGeneratedOperationalRuntime } from '@/lib/generated-demo/operational-runtime';

const SERVER_TENANT_ID =
  process.env.NEXT_PUBLIC_EAI_TENANT_ID ||
  process.env.EAI_TENANT_ID ||
  process.env.TENANT_DEFAULT_ID;
const PRODUCT_SLUG =
  process.env.EAI_PRODUCT_SLUG ||
  process.env.NEXT_PUBLIC_APP_NAME ||
  'eai-app-template';

async function redirectToResolvedAppHost(): Promise<void> {
  const accessToken = await getAccessToken();
  if (!accessToken) {
    return;
  }

  const allHeaders = await headers();
  const currentAppHost =
    allHeaders.get('x-forwarded-host') || allHeaders.get('host');

  try {
    const { routing } = await resolvePublicApiBaseUrl({
      accessToken,
      fallbackBaseUrl: process.env.BASE_URL_PUBLIC_API,
      product: PRODUCT_SLUG,
      currentAppHost,
      requestedTenantId: SERVER_TENANT_ID,
    });

    const redirectUrl = getRoutingRedirectUrl(routing);
    if (redirectUrl) {
      redirect(redirectUrl);
    }
  } catch (error) {
    if (error instanceof RoutingResolutionError) {
      return;
    }
    throw error;
  }
}

/** Renders immutable generated workflows while retaining the generic template fallback. */
export default async function Home() {
  const generatedDemo = getGeneratedDemoRuntime();
  if (generatedDemo.status === 'ready') {
    const operational = getGeneratedOperationalRuntime();
    if (operational.status === 'invalid') {
      return <HomeClient runtimeError='OPERATIONAL_BINDING_INVALID' />;
    }
    return (
      <HomeClient
        generatedDemo={{
          sourceDigest: generatedDemo.artifact.digests.sourceBundle,
          fixtureDigest: generatedDemo.artifact.digests.previewFixtures,
          workflowViews: generatedDemo.artifact.appDefinition.workflow.steps.map((step) => step.viewId),
          workflowSteps: generatedDemo.artifact.appDefinition.workflow.steps,
          trustedViews: generatedDemo.artifact.appDefinition.views.map(({ id, title, trustedLayout }) => ({
            id, title, trustedLayout,
          })),
        }}
        generatedOperational={operational.status === 'ready' ? {
          acceptedArtifactDigest: operational.config.acceptedArtifactDigest,
          fixtureCollection: operational.config.readBindings[0].fixtureCollection,
          maxRows: operational.config.readBindings[0].maxRows,
          projectedFields: operational.projectedFields,
          bindings: operational.config.schemaVersion === 'eai.generated_app_operational.v3'
            ? operational.bindings.map(({ viewId, viewTitle, componentId, fixtureCollection,
              maxRows, projectedFields }) => ({ viewId, viewTitle, componentId,
              fixtureCollection, maxRows, projectedFields })) : undefined,
          createFields: operational.config.schemaVersion === 'eai.generated_app_operational.v2'
            ? operational.createFields : undefined,
        } : undefined}
      />
    );
  }
  if (generatedDemo.status === 'invalid') {
    return <HomeClient runtimeError='DEMO_ARTIFACT_INVALID' />;
  }
  const generatedWorkflow = getGeneratedWorkflowRuntime();
  if (generatedWorkflow.status === 'ready') {
    const { appKey, binding, branding, snapshot, assistantEnabled } =
      generatedWorkflow.runtime;
    return (
      <HomeClient
        generatedWorkflow={{
          appKey,
          binding,
          branding,
          snapshot,
          assistantEnabled,
        }}
      />
    );
  }
  await redirectToResolvedAppHost();
  return (
    <HomeClient
      runtimeError={
        generatedWorkflow.status === 'invalid'
          ? 'WORKFLOW_SNAPSHOT_INVALID'
          : undefined
      }
    />
  );
}
