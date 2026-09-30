'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { isOperationalRowsResponse } from '@/lib/generated-demo/operational-bridge';
import type { GeneratedOperationalCreateField } from '@/lib/generated-demo/operational-contract';
import type { GeneratedOperationalRows } from '@/lib/generated-demo/operational-read';

interface DemoIdentity {
  sourceDigest: string;
  fixtureDigest: string;
}

export interface DemoOperationalIdentity {
  acceptedArtifactDigest: string;
  fixtureCollection: string;
  maxRows: number;
  projectedFields: string[];
  createFields?: GeneratedOperationalCreateField[];
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

function TrustedOperationalRows({
  rows, fields,
}: {
  rows: GeneratedOperationalRows['rows'];
  fields: string[];
}) {
  return (
    <section className='mx-auto max-w-7xl p-5' aria-label='Live read-only data' data-eai-operational-read='true'>
      <h2 className='text-lg font-semibold text-slate-950'>Live read-only data</h2>
      <p className='mt-1 text-sm text-slate-600'>This trusted view shows authorized records. The app preview below still uses sample data and simulated actions.</p>
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
    </section>
  );
}

/** Authenticated parent renders operational rows; arbitrary generated source sees samples only. */
export function GeneratedDemoHost({
  demo, operational,
}: {
  demo: DemoIdentity;
  operational?: DemoOperationalIdentity;
}) {
  const basePath = (process.env.NEXT_PUBLIC_APP_BASE_PATH ?? '').replace(/\/+$/, '');
  const [rows, setRows] = useState<GeneratedOperationalRows | null>(null);
  const [failed, setFailed] = useState(false);

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
    if (!operational) return;
    const controller = new AbortController();
    void fetch(`${basePath}/api/eai/generated-operational`, {
      method: 'GET', credentials: 'same-origin', cache: 'no-store',
      signal: controller.signal,
    }).then(async (response) => {
      if (!response.ok) throw new Error('Authorized read unavailable');
      const value: unknown = await response.json();
      if (!isOperationalRowsResponse(value, operational.acceptedArtifactDigest,
          operational.fixtureCollection, operational.maxRows, operational.projectedFields))
        throw new Error('Authorized read response invalid');
      setRows(value);
    }).catch(() => {
      if (!controller.signal.aborted) setFailed(true);
    });
    return () => controller.abort();
  }, [basePath, operational]);

  if (failed) return <main role='alert'>Live data is unavailable. No sample data was substituted.</main>;
  if (operational && !rows) return <main role='status'>Loading authorized app data…</main>;
  return (
    <main
      data-eai-demo-ready='true'
      data-eai-demo-source-digest={demo.sourceDigest}
      data-eai-demo-fixture-digest={demo.fixtureDigest}
      className='min-h-svh bg-slate-50'
    >
      {operational && rows ? <TrustedOperationalRows rows={rows.rows} fields={operational.projectedFields} /> : null}
      {operational?.createFields && rows ? <TrustedCreateForm fields={operational.createFields}
        basePath={basePath} onCreated={refreshRows} /> : null}
      <div className='border-b border-amber-300 bg-amber-50 px-5 py-3 text-center text-sm font-medium text-amber-950' role='status'>
        Demo app · Sample data and simulated interactions. Changes here do not affect real records or services.
      </div>
      <iframe
        title='Generated app demo'
        src={`${basePath}/eai-demo-frame`}
        sandbox='allow-scripts'
        referrerPolicy='no-referrer'
        className='min-h-[calc(100svh-3rem)] w-full border-0'
      />
    </main>
  );
}
