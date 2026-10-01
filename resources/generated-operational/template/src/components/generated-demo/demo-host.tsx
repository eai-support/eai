'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { isOperationalRowsResponse } from '@/lib/generated-demo/operational-bridge';
import type {
  GeneratedOperationalCreateField,
  ResolvedOperationalViewBinding,
} from '@/lib/generated-demo/operational-contract';
import type { GeneratedOperationalRows } from '@/lib/generated-demo/operational-read';
import type { GeneratedDemoArtifact, GeneratedSafeUiNode, GeneratedTrustedLayout } from '@/lib/generated-demo/contract';

interface DemoIdentity {
  appName: string;
  sourceDigest: string;
  fixtureDigest: string;
  workflowViews?: string[];
  workflowSteps?: Array<{ id: string; title: string; viewId: string }>;
  trustedViews?: Array<{ id: string; title: string; trustedLayout?: GeneratedTrustedLayout;
    safeUi: GeneratedDemoArtifact['appDefinition']['views'][number]['safeUi'] }>;
  previewFixtures: GeneratedDemoArtifact['previewFixtures'];
}

export interface DemoOperationalIdentity {
  acceptedArtifactDigest: string;
  fixtureCollection: string;
  maxRows: number;
  projectedFields: string[];
  createFields?: GeneratedOperationalCreateField[];
  bindings?: Array<Pick<ResolvedOperationalViewBinding,
    'viewId' | 'viewTitle' | 'componentId' | 'fixtureCollection' | 'maxRows' | 'projectedFields'>>;
}

function TrustedCreateForm({
  fields, basePath, onCreated,
}: {
  fields: GeneratedOperationalCreateField[];
  basePath: string;
  onCreated: () => Promise<void>;
}) {
  const [draft, setDraft] = useState<Record<string, string | boolean>>({});
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');
  const attempt = useRef<{ idempotencyKey: string; data: Record<string, string | number | boolean> } | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    if (!attempt.current) {
      const data: Record<string, string | number | boolean> = {};
      for (const field of fields) {
        const value = draft[field.name];
        if (field.type === 'boolean') data[field.name] = value === true;
        else if (typeof value === 'string' && value !== '')
          data[field.name] = field.type === 'number' ? Number(value) : value;
      }
      attempt.current = { idempotencyKey: crypto.randomUUID(), data };
    }
    setPending(true);
    setMessage('');
    try {
      const response = await fetch(`${basePath}/api/eai/generated-operational/create`, {
        method: 'POST', credentials: 'same-origin', cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(attempt.current),
      });
      if (response.status === 400 || response.status === 413) {
        attempt.current = null;
        throw new Error('INVALID_INPUT');
      }
      if (response.status === 429) throw new Error('RATE_LIMITED');
      if (response.status === 403 || response.status === 409) throw new Error('NOT_AUTHORIZED');
      if (!response.ok) throw new Error('The reviewed create was not verified');
      const value: unknown = await response.json();
      if (!value || typeof value !== 'object' || !('id' in value) || typeof value.id !== 'string')
        throw new Error('The reviewed create returned no identity');
      attempt.current = null;
      setDraft({});
      setMessage(`Record ${value.id} was created and read back.`);
      try {
        await onCreated();
      } catch {
        setMessage(`Record ${value.id} was created and read back. The list could not refresh.`);
      }
    } catch (error) {
      if (error instanceof Error && error.message === 'INVALID_INPUT')
        setMessage('Check the entered values and try again.');
      else if (error instanceof Error && error.message === 'RATE_LIMITED')
        setMessage('This action is rate limited. Retry the same operation later.');
      else if (error instanceof Error && error.message === 'NOT_AUTHORIZED')
        setMessage('This action is not authorized for the current app or account.');
      else setMessage('The result is unconfirmed. Retry submits the same operation without changing its values.');
    } finally {
      setPending(false);
    }
  }

  return (
    <section className='mx-auto max-w-7xl px-5 pb-5' aria-label='Reviewed live create' data-eai-operational-create='true'>
      <h2 className='text-lg font-semibold text-slate-950'>Add a live record</h2>
      <p className='mt-1 text-sm text-slate-600'>This trusted form uses your account permissions. Actions inside the demo below remain simulated.</p>
      <form className='mt-3 flex flex-wrap items-end gap-3' onSubmit={submit}>
        {fields.map((field) => (
          <label key={field.name} className='flex min-w-40 flex-col gap-1 text-sm text-slate-800'>
            {field.name}
            {field.type === 'boolean' ? (
              <input type='checkbox' checked={draft[field.name] === true} disabled={pending || attempt.current !== null}
                onChange={(event) => setDraft((current) => ({ ...current, [field.name]: event.target.checked }))} />
            ) : (
              <input type={field.type === 'number' ? 'number' : 'text'} required={field.required}
                maxLength={field.type === 'text' ? 512 : undefined}
                value={typeof draft[field.name] === 'string' ? String(draft[field.name]) : ''}
                disabled={pending || attempt.current !== null}
                onChange={(event) => setDraft((current) => ({ ...current, [field.name]: event.target.value }))}
                className='rounded border border-slate-300 bg-white px-2 py-1' />
            )}
          </label>
        ))}
        <button type='submit' disabled={pending} className='rounded bg-slate-900 px-4 py-2 text-sm text-white disabled:opacity-50'>
          {pending ? 'Verifying…' : attempt.current ? 'Retry same operation' : 'Create record'}
        </button>
      </form>
      {message && <p className='mt-2 text-sm text-slate-700' role='status'>{message}</p>}
    </section>
  );
}

function displayCell(value: string | number | boolean | null): string {
  return value === null ? '—' : String(value);
}

function TrustedTable({ rows, fields }: {
  rows: GeneratedOperationalRows['rows'];
  fields: string[];
}) {
  return (
    <>
      {rows.length === 0 ? (
        <p className='mt-4 rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-600'>No records are available.</p>
      ) : (
        <div className='mt-4 overflow-x-auto rounded-lg border border-slate-200 bg-white'>
          <table className='min-w-full divide-y divide-slate-200 text-left text-sm'>
            <thead className='bg-slate-50'>
              <tr>
                {['id', ...fields].map((field) => <th key={field} scope='col' className='px-4 py-3 font-medium text-slate-700'>{field}</th>)}
              </tr>
            </thead>
            <tbody className='divide-y divide-slate-100'>
              {rows.map((row) => (
                <tr key={row.id}>
                  <th scope='row' className='px-4 py-3 font-medium text-slate-900'>{row.id}</th>
                  {fields.map((field) => <td key={field} className='px-4 py-3 text-slate-700'>{displayCell(row[field])}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function TrustedOperationalRows({
  rows, fields, viewTitle, componentId,
}: {
  rows: GeneratedOperationalRows['rows'];
  fields: string[];
  viewTitle?: string;
  componentId?: string;
}) {
  return <section className='mx-auto max-w-7xl p-5' aria-label='Live read-only data' data-eai-operational-read='true'
    data-eai-operational-slot={componentId}>
    <h2 className='text-lg font-semibold text-slate-950'>Live read-only data{viewTitle ? ` · ${viewTitle}` : ''}</h2>
    <p className='mt-1 text-sm text-slate-600'>This trusted view shows authorized records for the selected app view. The generated UI below still uses sample data and simulated actions.</p>
    <TrustedTable rows={rows} fields={fields} />
  </section>;
}

const gridColumns = { 1: 'grid-cols-1', 2: 'grid-cols-1 md:grid-cols-2', 3: 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3' };
const gridSpans = { 1: '', 2: 'md:col-span-2', 3: 'md:col-span-2 lg:col-span-3' };

const safeGaps = { sm: 'gap-2', md: 'gap-4', lg: 'gap-6' };

function SafeUiNodeView({ node, fixtures, onAction, onView }:
  { node: GeneratedSafeUiNode; fixtures: GeneratedDemoArtifact['previewFixtures'];
    onAction: (actionId: string) => void; onView: (viewId: string) => void }) {
  const marker = { 'data-eai-safe-component': node.componentId };
  switch (node.kind) {
    case 'stack':
      return <div {...marker} className={`@container flex ${node.direction === 'row' ? 'flex-col @md:flex-row' : 'flex-col'} ${safeGaps[node.gap]}`}>
        {node.children.map((child, index) => <SafeUiNodeView key={index} node={child}
          fixtures={fixtures} onAction={onAction} onView={onView} />)}
      </div>;
    case 'heading':
      if (node.level === 1) return <h1 {...marker} className='text-3xl font-semibold text-slate-950'>{node.text}</h1>;
      if (node.level === 2) return <h2 {...marker} className='text-2xl font-semibold text-slate-950'>{node.text}</h2>;
      return <h3 {...marker} className='text-xl font-semibold text-slate-950'>{node.text}</h3>;
    case 'text':
      return <p {...marker} className='whitespace-pre-wrap text-sm text-slate-700'>{node.text}</p>;
    case 'stat': {
      let value: string | number | boolean | null | undefined;
      if (node.value.kind === 'literal') value = node.value.text;
      else {
        const row = fixtures.collections[node.value.collection]?.[node.value.rowIndex];
        const cell = row?.[node.value.field];
        if (cell === null || ['string', 'number', 'boolean'].includes(typeof cell))
          value = cell as string | number | boolean | null;
      }
      return <section {...marker} className='min-w-36 rounded-xl border border-slate-200 bg-white p-4'>
        <h3 className='text-xs font-medium uppercase tracking-wide text-slate-600'>{node.label}</h3>
        <p className='mt-2 text-2xl font-semibold text-slate-950'>{value === undefined ? '—' : displayCell(value)}</p>
      </section>;
    }
    case 'table':
      return <div {...marker} className='overflow-x-auto rounded-xl border border-slate-200 bg-white'>
        <table className='min-w-full divide-y divide-slate-200 text-left text-sm'>
          <thead className='bg-slate-50'><tr>{node.columns.map((column) =>
            <th key={column.field} scope='col' className='px-4 py-3 font-medium text-slate-700'>{column.label}</th>)}</tr></thead>
          <tbody className='divide-y divide-slate-100'>
            {fixtures.collections[node.fixtureCollection]?.slice(0, 50).map((row, index) =>
              <tr key={index}>{node.columns.map((column) => {
                const cell = row[column.field];
                return <td key={column.field} className='px-4 py-3 text-slate-700'>
                  {cell === null || ['string', 'number', 'boolean'].includes(typeof cell)
                    ? displayCell(cell as string | number | boolean | null) : '—'}</td>;
              })}</tr>)}
          </tbody>
        </table>
      </div>;
    case 'button':
      return <button {...marker} type='button' onClick={() => onAction(node.actionId)}
        className='rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white'>{node.label}</button>;
    case 'input':
      return <label {...marker} className='flex max-w-sm flex-col gap-1 text-sm text-slate-800'>
        {node.label}<input type={node.inputType} maxLength={node.inputType === 'text' ? 200 : undefined}
          className='rounded-lg border border-slate-300 bg-white px-3 py-2' /></label>;
    case 'view-link':
      return <button {...marker} type='button' onClick={() => onView(node.targetViewId)}
        className='rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm text-slate-900'>{node.label}</button>;
  }
}

/** Authenticated parent renders operational rows; arbitrary generated source sees samples only. */
export function GeneratedDemoHost({
  demo, operational,
}: {
  demo: DemoIdentity;
  operational?: DemoOperationalIdentity;
}) {
  const basePath = (process.env.NEXT_PUBLIC_APP_BASE_PATH ?? '').replace(/\/+$/, '');
  const [activeViewId, setActiveViewId] = useState(demo.workflowViews?.[0] ?? '');
  const [surface, setSurface] = useState<'live' | 'sample'>(operational?.bindings ? 'live' : 'sample');
  const [announcement, setAnnouncement] = useState('');
  const [rows, setRows] = useState<GeneratedOperationalRows | null>(null);
  const [rowsForViewId, setRowsForViewId] = useState('');
  const [failed, setFailed] = useState(false);
  const [failedForViewId, setFailedForViewId] = useState('');
  const selectedBinding = operational?.bindings?.find((binding) => binding.viewId === activeViewId);
  const selectedView = demo.trustedViews?.find((view) => view.id === activeViewId);
  const trustedOperational = Boolean(operational?.bindings);

  const runSampleAction = (actionId: string) => {
    const action = demo.previewFixtures.actions[actionId];
    setAnnouncement(action ? `${action.message} This was a simulation; no real action occurred.` :
      'This demo action is unavailable; no real action occurred.');
  };

  async function refreshRows(): Promise<void> {
    if (!operational) return;
    const response = await fetch(`${basePath}/api/eai/generated-operational`, {
      method: 'GET', credentials: 'same-origin', cache: 'no-store',
    });
    if (!response.ok) throw new Error('Authorized read unavailable');
    const value: unknown = await response.json();
    if (!isOperationalRowsResponse(value, operational.acceptedArtifactDigest,
        operational.fixtureCollection, operational.maxRows, operational.projectedFields))
      throw new Error('Authorized read response invalid');
    setRows(value);
  }

  useEffect(() => {
    if (!operational || (operational.bindings && (surface !== 'live' || !selectedBinding))) {
      return;
    }
    const controller = new AbortController();
    const binding = selectedBinding ?? operational;
    const requestedViewId = selectedBinding?.viewId ?? '';
    const query = selectedBinding ? `?viewId=${encodeURIComponent(selectedBinding.viewId)}` : '';
    void fetch(`${basePath}/api/eai/generated-operational${query}`, {
      method: 'GET', credentials: 'same-origin', cache: 'no-store',
      signal: controller.signal,
    }).then(async (response) => {
      if (!response.ok) throw new Error('Authorized read unavailable');
      const value: unknown = await response.json();
      if (!isOperationalRowsResponse(value, operational.acceptedArtifactDigest,
          binding.fixtureCollection, binding.maxRows, binding.projectedFields))
        throw new Error('Authorized read response invalid');
      if (!controller.signal.aborted) {
        setRows(value);
        setRowsForViewId(requestedViewId);
        setFailed(false);
      }
    }).catch(() => {
      if (!controller.signal.aborted) {
        setFailed(true);
        setFailedForViewId(requestedViewId);
      }
    });
    return () => controller.abort();
  }, [basePath, operational, selectedBinding, surface]);

  if (failed && !operational?.bindings) return <main role='alert'>Live data is unavailable. No sample data was substituted.</main>;
  if (operational && !operational.bindings && !rows) return <main role='status'>Loading authorized app data…</main>;
  const liveRows = selectedBinding
    ? rowsForViewId === selectedBinding.viewId &&
      rows?.fixtureCollection === selectedBinding.fixtureCollection ? rows : null
    : operational?.bindings ? null : rows;
  const selectedFailed = selectedBinding && failed && failedForViewId === selectedBinding.viewId;
  const showTrustedView = trustedOperational && surface === 'live';
  return (
    <main
      data-eai-demo-ready='true'
      data-eai-demo-source-digest={demo.sourceDigest}
      data-eai-demo-fixture-digest={demo.fixtureDigest}
      className='min-h-svh bg-slate-50'
    >
      {trustedOperational ? <nav aria-label='App modes' className='mx-auto flex max-w-7xl gap-2 px-5 pt-5'>
        <button type='button' aria-pressed={surface === 'live'} onClick={() => setSurface('live')}
          className='rounded border border-slate-300 bg-white px-4 py-2 text-sm'>Live app</button>
        <button type='button' aria-pressed={surface === 'sample'} onClick={() => setSurface('sample')}
          className='rounded border border-slate-300 bg-white px-4 py-2 text-sm'>Sample preview</button>
      </nav> : null}
      {showTrustedView ? <>
        <nav aria-label='Workflow steps' className='mx-auto flex max-w-7xl flex-wrap gap-2 px-5 pt-5'>
          {demo.workflowSteps?.map((step) => <button type='button' key={step.id}
            aria-current={step.viewId === activeViewId ? 'page' : undefined}
            onClick={() => setActiveViewId(step.viewId)}
            className='rounded border border-slate-300 bg-white px-4 py-2 text-sm'>{step.title}</button>)}
        </nav>
        <section className='mx-auto max-w-7xl px-5 py-6' aria-label='Live app view'>
          <h1 className='text-2xl font-semibold text-slate-950'>{selectedView?.title ?? 'App view'}</h1>
          <p className='mt-1 text-sm text-slate-600'>Authorized data is shown only in reviewed components. Other interactions remain simulated.</p>
          {selectedView?.trustedLayout ? <div className={`mt-5 grid gap-4 ${gridColumns[selectedView.trustedLayout.columns]}`}>
            {selectedView.trustedLayout.slots.map((slot) => {
              const boundHere = selectedBinding?.componentId === slot.componentId && slot.kind === 'read-table';
              return <section key={slot.componentId} data-eai-operational-slot={slot.componentId}
                data-eai-operational-read={boundHere ? 'true' : undefined}
                className={`rounded-xl border border-slate-200 bg-white p-5 ${gridSpans[slot.columnSpan ?? 1]}`}>
                <h2 className='text-lg font-semibold text-slate-950'>{slot.title}</h2>
                {slot.kind === 'static-copy' ? <p className='mt-2 whitespace-pre-wrap text-sm text-slate-700'>{slot.text}</p> :
                  boundHere && selectedFailed ? <p role='alert' className='mt-2 text-sm text-red-700'>Live data is unavailable. No sample data was substituted.</p> :
                  boundHere && liveRows ? <TrustedTable rows={liveRows.rows} fields={selectedBinding.projectedFields} /> :
                  boundHere ? <p role='status' className='mt-2 text-sm text-slate-600'>Loading authorized data…</p> :
                  <p className='mt-2 text-sm text-slate-600'>Live data is not connected for this component.</p>}
              </section>;
            })}
          </div> : <p role='alert' className='mt-5'>This view has no reviewed live layout.</p>}
        </section>
      </> : null}
      {!trustedOperational && selectedFailed ? <section role='alert' className='mx-auto max-w-7xl p-5'>
        Live data for {selectedBinding.viewTitle} is unavailable. No sample data was substituted in the live view.
      </section> : null}
      {!trustedOperational && selectedBinding && !selectedFailed && !liveRows ? <section role='status' className='mx-auto max-w-7xl p-5'>
        Loading authorized data for {selectedBinding.viewTitle}…
      </section> : null}
      {!trustedOperational && operational && liveRows ? <TrustedOperationalRows rows={liveRows.rows}
        fields={selectedBinding?.projectedFields ?? operational.projectedFields}
        viewTitle={selectedBinding?.viewTitle} componentId={selectedBinding?.componentId} /> : null}
      {operational?.createFields && liveRows && !operational.bindings ? <TrustedCreateForm fields={operational.createFields}
        basePath={basePath} onCreated={refreshRows} /> : null}
      {!showTrustedView ? <><div className='border-b border-amber-300 bg-amber-50 px-5 py-3 text-center text-sm font-medium text-amber-950' role='status'>
        Demo app · Sample data and simulated interactions. Changes here do not affect real records or services.
      </div>
      <section className='mx-auto max-w-7xl p-5' aria-label='Safe app preview'>
        <header className='mb-5'><h1 className='text-2xl font-semibold text-slate-950'>{demo.appName}</h1></header>
        <nav aria-label='Workflow views' className='mb-5 flex flex-wrap gap-2'>
          {demo.workflowSteps?.map((step) => <button key={step.id} type='button'
            aria-current={step.viewId === activeViewId ? 'page' : undefined}
            onClick={() => setActiveViewId(step.viewId)}
            className='rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm'>{step.title}</button>)}
        </nav>
        {selectedView?.safeUi ? <SafeUiNodeView node={selectedView.safeUi.root}
          fixtures={demo.previewFixtures} onAction={runSampleAction} onView={setActiveViewId} /> :
          <p role='alert'>The reviewed app preview is unavailable.</p>}
        <p role='status' className='mt-5 text-sm text-slate-700'>{announcement}</p>
      </section>
      </> : null}
    </main>
  );
}
