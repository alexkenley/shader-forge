import { useEffect, useState } from 'react';
import {
  fetchOperationDiff,
  SessiondRequestError,
  type EngineOperation,
  type EngineOperationDiff,
  type EngineOperationEvent,
  type EngineSession,
} from './lib/sessiond';

const reviewStates = new Set(['previewed', 'approved']);
const inProgressStates = new Set(['applying', 'undoing']);

function formatTime(value: string) {
  const timestamp = new Date(value);
  return Number.isNaN(timestamp.getTime()) ? value : timestamp.toLocaleString();
}

function operationLabel(operation: EngineOperation) {
  return operation.context?.label || operation.preview.summary;
}

function actorLabel(actor: EngineOperation['actor'] | EngineOperationEvent['actor']) {
  return actor ? `${actor.name} · ${actor.kind}/${actor.id}` : 'system recovery';
}

function diffUnavailableMessage(reason: EngineOperationDiff['reason']) {
  if (reason === 'binary') {
    return 'Exact text changes are unavailable because this operation contains binary-like data.';
  }
  if (reason === 'too_large') {
    return 'Exact text changes exceed the bounded Activity diff limit. The summary remains available.';
  }
  return 'Exact text changes are unavailable for this operation. The summary remains available.';
}

function OperationChanges({ operation }: { operation: EngineOperation }) {
  const [diff, setDiff] = useState<EngineOperationDiff | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let current = true;
    setDiff(null);
    setError('');
    setLoading(true);
    void fetchOperationDiff(operation.id)
      .then((nextDiff) => {
        if (!current) return;
        if (
          nextDiff.operationId !== operation.id
          || nextDiff.path !== operation.path
          || nextDiff.beforeRevision !== operation.baseRevision
          || nextDiff.afterRevision !== operation.proposedRevision
        ) {
          setError('Operation changes no longer match the selected authoritative operation. Refresh Activity.');
          return;
        }
        setDiff(nextDiff);
      })
      .catch((requestError: unknown) => {
        if (!current) return;
        if (requestError instanceof SessiondRequestError && requestError.status === 404) {
          setError('This operation is no longer available. Refresh Activity.');
        } else if (requestError instanceof SessiondRequestError && requestError.status === 409) {
          setError('This operation changed while its changes were loading. Refresh Activity.');
        } else {
          setError(requestError instanceof Error ? requestError.message : 'Could not load operation changes.');
        }
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [operation.baseRevision, operation.id, operation.path, operation.proposedRevision]);

  return (
    <section aria-label="Exact operation changes" className="activity-changes">
      <h4>Changes</h4>
      {loading ? <p aria-live="polite">Loading exact changes...</p> : null}
      {error ? <p className="activity-changes__error" role="alert">{error}</p> : null}
      {!loading && !error && diff?.status === 'summary_only' ? (
        <p className="activity-changes__notice">{diffUnavailableMessage(diff.reason)}</p>
      ) : null}
      {!loading && !error && diff?.status === 'available' && diff.hunks.length === 0 ? (
        <p>No text changes.</p>
      ) : null}
      {!loading && !error && diff?.status === 'available' ? (
        <div className="activity-diff" role="region" aria-label={`Exact changes for ${diff.path}`} tabIndex={0}>
          {diff.hunks.map((hunk, hunkIndex) => (
            <table className="activity-diff__hunk" key={`${hunk.oldStart}-${hunk.newStart}-${hunkIndex}`}>
              <caption>
                {`Hunk ${hunkIndex + 1}: -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines}`}
              </caption>
              <thead>
                <tr><th scope="col">Before</th><th scope="col">After</th><th scope="col">Change</th></tr>
              </thead>
              <tbody>
                {hunk.lines.map((line, lineIndex) => (
                  <tr className={`activity-diff__line activity-diff__line--${line.type}`} key={`${line.oldLine}-${line.newLine}-${lineIndex}`}>
                    <td>{line.oldLine ?? ''}</td>
                    <td>{line.newLine ?? ''}</td>
                    <td>
                      <span className="activity-diff__marker" aria-label={line.type}>
                        {line.type === 'added' ? '+' : line.type === 'removed' ? '-' : ' '}
                      </span>
                      <code>{line.text}</code>
                      <span className="activity-diff__ending" aria-label={`line ending ${line.ending}`}>
                        {line.ending === 'none' ? 'EOF' : line.ending.toUpperCase()}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ))}
          {diff.truncated ? (
            <p className="activity-changes__notice">Diff output is truncated at the bounded Activity display limit.</p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function OperationRow({
  operation,
  selected,
  onSelect,
}: {
  operation: EngineOperation;
  selected: boolean;
  onSelect: (operationId: string) => void;
}) {
  return (
    <button
      aria-current={selected ? 'true' : undefined}
      className={`activity-row${selected ? ' is-selected' : ''}`}
      onClick={() => onSelect(operation.id)}
      type="button"
    >
      <strong>{operationLabel(operation)}</strong>
      <span>{actorLabel(operation.actor)}</span>
      <span className="activity-identifier">{operation.path}</span>
      <span className={`activity-state activity-state--${operation.state}`}>{operation.state}</span>
      <span>+{operation.preview.addedLines} / -{operation.preview.removedLines}</span>
      <time dateTime={operation.updatedAt}>{formatTime(operation.updatedAt)}</time>
    </button>
  );
}

function OperationGroup({
  title,
  operations,
  selectedOperationId,
  onSelect,
}: {
  title: string;
  operations: EngineOperation[];
  selectedOperationId: string;
  onSelect: (operationId: string) => void;
}) {
  return (
    <section className="activity-group">
      <header><h3>{title}</h3><span>{operations.length}</span></header>
      {operations.length ? (
        <ul>
          {operations.map((operation) => (
            <li key={operation.id}>
              <OperationRow
                onSelect={onSelect}
                operation={operation}
                selected={selectedOperationId === operation.id}
              />
            </li>
          ))}
        </ul>
      ) : <p>None.</p>}
    </section>
  );
}

function OperationDetail({
  operation,
  pendingAction,
  onApprove,
  onReject,
}: {
  operation: EngineOperation;
  pendingAction: '' | 'approve' | 'reject';
  onApprove: () => void;
  onReject: () => void;
}) {
  const canApprove = operation.state === 'previewed';
  const canReject = operation.state === 'previewed' || operation.state === 'approved';

  return (
    <article aria-label="Selected operation" className="activity-detail">
      <header>
        <h3>{operationLabel(operation)}</h3>
        <p className="activity-identifier">{operation.path}</p>
      </header>
      <dl>
        <div><dt>State</dt><dd>{operation.state}</dd></div>
        <div><dt>Actor provenance</dt><dd>{actorLabel(operation.actor)}</dd></div>
        <div><dt>Operation</dt><dd className="activity-identifier">{operation.id}</dd></div>
        <div><dt>Spatial subject</dt><dd className="activity-identifier">{operation.context?.subjectId || 'none'}</dd></div>
        <div><dt>Resources</dt><dd className="activity-identifier">{operation.context?.resourceKeys.join(', ') || 'none'}</dd></div>
        <div><dt>Base revision</dt><dd className="activity-identifier">{operation.baseRevision}</dd></div>
        <div><dt>Proposed revision</dt><dd className="activity-identifier">{operation.proposedRevision}</dd></div>
        <div><dt>Applied revision</dt><dd className="activity-identifier">{operation.appliedRevision || 'none'}</dd></div>
        <div><dt>Result revision</dt><dd className="activity-identifier">{operation.resultingRevision || 'none'}</dd></div>
        <div><dt>Trust effect</dt><dd>{operation.codeTrustEffect.status}{operation.codeTrustEffect.phase ? ` · ${operation.codeTrustEffect.phase}` : ''}</dd></div>
      </dl>
      <section aria-label="Preview summary" className="activity-preview">
        <h4>Preview summary</h4>
        <p>{operation.preview.summary}</p>
        <p>{operation.preview.beforeLineCount} lines before · {operation.preview.afterLineCount} after</p>
        <p>{operation.preview.created ? 'Creates a new file.' : 'Changes an existing file.'}</p>
      </section>
      <OperationChanges operation={operation} />
      <section aria-label="Lifecycle events" className="activity-lifecycle">
        <h4>Lifecycle</h4>
        <ol>
          {operation.events.map((event, index) => (
            <li key={`${event.type}-${event.at}-${index}`}>
              <strong>{event.type}</strong>
              <span>{actorLabel(event.actor)}</span>
              <time dateTime={event.at}>{formatTime(event.at)}</time>
              {event.conflict ? (
                <span className="activity-identifier">
                  {event.conflict.code} · {event.conflict.path}
                  {event.conflict.expectedRevision ? ` · expected ${event.conflict.expectedRevision}` : ''}
                  {event.conflict.actualRevision ? ` · actual ${event.conflict.actualRevision}` : ''}
                </span>
              ) : null}
            </li>
          ))}
        </ol>
      </section>
      {canApprove || canReject ? (
        <div aria-label="Review actions" className="activity-actions">
          {canApprove ? (
            <button className="ghost-button ghost-button--sm" disabled={pendingAction !== ''} onClick={onApprove} type="button">
              {pendingAction === 'approve' ? 'Approving...' : 'Approve'}
            </button>
          ) : null}
          {canReject ? (
            <button className="ghost-button ghost-button--sm" disabled={pendingAction !== ''} onClick={onReject} type="button">
              {pendingAction === 'reject' ? 'Rejecting...' : 'Reject'}
            </button>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

export function ActivityDockView({
  activeSession,
  operations,
  selectedOperation,
  selectedOperationId,
  loading,
  error,
  status,
  pendingAction,
  onRefresh,
  onSelect,
  onApprove,
  onReject,
}: {
  activeSession: EngineSession | null;
  operations: EngineOperation[];
  selectedOperation: EngineOperation | null;
  selectedOperationId: string;
  loading: boolean;
  error: string;
  status: string;
  pendingAction: '' | 'approve' | 'reject';
  onRefresh: () => void;
  onSelect: (operationId: string) => void;
  onApprove: () => void;
  onReject: () => void;
}) {
  const review = operations.filter((operation) => reviewStates.has(operation.state));
  const inProgress = operations.filter((operation) => inProgressStates.has(operation.state));
  const history = operations.filter((operation) => !reviewStates.has(operation.state) && !inProgressStates.has(operation.state));

  return (
    <section aria-label="Activity" className="activity-dock">
      <header className="activity-dock__chrome">
        <div><span className="surface-eyebrow">Current workspace</span><h2>Activity</h2></div>
        <button className="ghost-button ghost-button--sm" disabled={!activeSession || loading || pendingAction !== ''} onClick={onRefresh} type="button">
          {loading ? 'Refreshing...' : 'Refresh'}
        </button>
      </header>
      <p aria-live="polite" className="activity-dock__status">{status}</p>
      {error ? <p className="activity-dock__error" role="alert">{error}</p> : null}
      {!activeSession ? (
        <div className="activity-empty">Select a workspace to review activity.</div>
      ) : loading && operations.length === 0 ? (
        <div className="activity-empty">Loading operations...</div>
      ) : operations.length === 0 ? (
        <div className="activity-empty">No operations for this workspace.</div>
      ) : (
        <div className="activity-dock__layout">
          <div aria-label="Operation history" className="activity-dock__list">
            <OperationGroup onSelect={onSelect} operations={review} selectedOperationId={selectedOperationId} title="Needs review" />
            <OperationGroup onSelect={onSelect} operations={inProgress} selectedOperationId={selectedOperationId} title="In progress" />
            <OperationGroup onSelect={onSelect} operations={history} selectedOperationId={selectedOperationId} title="History" />
          </div>
          <div className="activity-dock__detail">
            {selectedOperation ? (
              <OperationDetail onApprove={onApprove} onReject={onReject} operation={selectedOperation} pendingAction={pendingAction} />
            ) : <div className="activity-empty">Select an operation to inspect its public preview summary.</div>}
          </div>
        </div>
      )}
    </section>
  );
}
