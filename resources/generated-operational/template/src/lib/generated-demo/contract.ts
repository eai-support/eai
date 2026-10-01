import { demoArtifactDigest } from './runtime-contract';

export type DemoJson =
  string | number | boolean | null | DemoJson[] | { [key: string]: DemoJson };

export interface GeneratedTrustedLayout {
  columns: 1 | 2 | 3;
  slots: Array<{
    componentId: string;
    kind: 'read-table' | 'static-copy';
    title: string;
    columnSpan?: 1 | 2 | 3;
    text?: string;
  }>;
}

export interface GeneratedDemoArtifact {
  schemaVersion: 'eai.generated_app_artifact.v2';
  appDefinition: {
    schemaVersion: 'eai.generated_app_definition.v2';
    appKey: string;
    appName: string;
    businessCard: {
      description: string;
      goal: string;
      audience: string;
      outcome: string;
      valueHypothesis?: string;
      successMeasure?: string;
      recommendedFirstSlice?: string;
      assumptions?: string[];
    };
    workflow: { steps: Array<{ id: string; title: string; viewId: string }> };
    views: Array<{
      id: string;
      title: string;
      componentIds: string[];
      dataBindings?: Array<{
        componentId: string;
        fixtureCollection: string;
        objectTypeSlug: string;
      }>;
      trustedLayout?: GeneratedTrustedLayout;
    }>;
    entryPath: 'src/generated/app.tsx';
  };
  sourceBundle: {
    schemaVersion: 'eai.generated_app_source.v1';
    files: Array<{ path: string; content: string }>;
  };
  previewFixtures: {
    schemaVersion: 'eai.generated_app_fixtures.v1';
    collections: Record<string, Array<Record<string, DemoJson>>>;
    actions: Record<
      string,
      { effect: 'session-local' | 'none'; message: string }
    >;
  };
  objectTypeDefinitions: Array<Record<string, DemoJson>>;
  digests: {
    appDefinition: `sha256:${string}`;
    sourceBundle: `sha256:${string}`;
    previewFixtures: `sha256:${string}`;
    objectTypeDefinitions: `sha256:${string}`;
  };
}

export interface GeneratedDemoAppProps {
  viewId: string;
  fixtures: GeneratedDemoArtifact['previewFixtures'];
  runAction: (actionId: string) => string;
}

/** Frame-bound props exclude the accepted source, business card and Object Type proposal. */
export interface GeneratedDemoClientView {
  appName: string;
  workflowSteps: GeneratedDemoArtifact['appDefinition']['workflow']['steps'];
  acceptedArtifactDigest: `sha256:${string}`;
  previewFixtures: GeneratedDemoArtifact['previewFixtures'];
  sourceDigest: GeneratedDemoArtifact['digests']['sourceBundle'];
  fixtureDigest: GeneratedDemoArtifact['digests']['previewFixtures'];
}

/** SECURITY: Serialize only the displayed title, workflow links and intended sample fixtures. */
export function projectGeneratedDemoClientView(
  artifact: GeneratedDemoArtifact,
): GeneratedDemoClientView {
  return {
    appName: artifact.appDefinition.appName,
    workflowSteps: artifact.appDefinition.workflow.steps,
    acceptedArtifactDigest: demoArtifactDigest(artifact),
    previewFixtures: artifact.previewFixtures,
    sourceDigest: artifact.digests.sourceBundle,
    fixtureDigest: artifact.digests.previewFixtures,
  };
}
