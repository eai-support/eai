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

type SafeUiIdentity = { componentId?: string };

export type GeneratedSafeUiNode = SafeUiIdentity & (
  | { kind: 'stack'; direction: 'row' | 'column'; gap: 'sm' | 'md' | 'lg'; children: GeneratedSafeUiNode[] }
  | { kind: 'heading'; level: 1 | 2 | 3; text: string }
  | { kind: 'text'; text: string }
  | { kind: 'stat'; label: string; value:
      { kind: 'literal'; text: string } |
      { kind: 'fixture'; collection: string; field: string; rowIndex: number } }
  | { kind: 'table'; fixtureCollection: string; columns: Array<{ field: string; label: string }> }
  | { kind: 'button'; label: string; actionId: string }
  | { kind: 'input'; id: string; label: string; inputType: 'text' | 'number' }
  | { kind: 'view-link'; label: string; targetViewId: string }
);

export interface GeneratedSafeUi {
  version: 'eai.safe_ui.v1';
  root: GeneratedSafeUiNode;
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
      safeUi: GeneratedSafeUi;
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
