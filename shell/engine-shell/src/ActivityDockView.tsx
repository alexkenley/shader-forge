import type { EngineOperation, EngineOperationEvent, EngineSession } from './lib/sessiond';

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
        <p className="activity-caveat">Exact proposed content is not exposed in Activity.</p>
      </section>
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
