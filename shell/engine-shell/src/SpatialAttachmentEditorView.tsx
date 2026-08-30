import { useEffect, useRef, useState } from 'react';
import {
  disconnectCoordinationAgent,
  fetchCoordinationLease,
  fetchOperation,
  heartbeatCoordinationAgent,
  listFiles,
  previewSpatialAttachment,
  readFile,
  registerCoordinationAgent,
  releaseCoordinationLease,
  requestCoordinationLease,
  SessiondRequestError,
  engineShellActor,
  transitionOperation,
  type CoordinationLease,
  type EngineOperation,
  type EngineSession,
  type SessionFileEntry,
} from './lib/sessiond';
import {
  parseSpatialAttachment,
  updateSpatialAttachmentTransform,
  type SpatialAttachmentDraft,
  type SpatialVector3,
} from './spatial-attachment-authoring';

const attachmentRoot = 'animation/attachments';

type Connection = {
  agentId: string;
  credential: string;
  lease: CoordinationLease;
  path: string;
};

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function vectorCopy(value: SpatialVector3): SpatialVector3 {
  return [...value] as SpatialVector3;
}

export function SpatialAttachmentEditorView({ activeSession }: { activeSession: EngineSession | null }) {
  const [files, setFiles] = useState<SessionFileEntry[]>([]);
  const [selectedPath, setSelectedPath] = useState('');
  const [source, setSource] = useState('');
  const [revision, setRevision] = useState('');
  const [draft, setDraft] = useState<SpatialAttachmentDraft | null>(null);
  const [translation, setTranslation] = useState<SpatialVector3>([0, 0, 0]);
  const [rotationDegrees, setRotationDegrees] = useState<SpatialVector3>([0, 0, 0]);
  const [lease, setLease] = useState<CoordinationLease | null>(null);
  const [operation, setOperation] = useState<EngineOperation | null>(null);
  const [candidate, setCandidate] = useState('');
  const [status, setStatus] = useState('Select an attachment profile to begin.');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const connectionRef = useRef<Connection | null>(null);
  const selectionKeyRef = useRef('');
  selectionKeyRef.current = `${activeSession?.id || ''}:${selectedPath}`;

  async function reread(path: string, expectedSelection = `${activeSession?.id || ''}:${path}`) {
    if (!activeSession) return;
    const next = await readFile(activeSession.id, path);
    if (selectionKeyRef.current !== expectedSelection) throw new Error('Attachment selection changed.');
    const parsed = parseSpatialAttachment(next.content);
    setSource(next.content);
    setRevision(next.revision);
    setDraft(parsed);
    setTranslation(vectorCopy(parsed.translation));
    setRotationDegrees(vectorCopy(parsed.rotationDegrees));
    return { file: next, parsed };
  }

  async function closeConnection() {
    const connection = connectionRef.current;
    connectionRef.current = null;
    setLease(null);
    if (!connection) return;
    await releaseCoordinationLease(connection.lease.id, connection.agentId, connection.credential).catch(() => undefined);
    await disconnectCoordinationAgent(connection.agentId, connection.credential).catch(() => undefined);
  }

  async function refreshGrantedSource(grantedLease: CoordinationLease) {
    const latest = await reread(selectedPath);
    if (!latest) throw new Error('The attachment source could not be read.');
    const required = `spatial/attachment/${latest.parsed.id.toLowerCase()}`;
    if (!grantedLease.resources.includes(required)) {
      await closeConnection();
      throw new Error('The attachment id changed while its lock was queued. Begin tuning again for the refreshed profile.');
    }
    return latest;
  }

  useEffect(() => {
    let cancelled = false;
    setFiles([]);
    setSelectedPath('');
    setError('');
    if (!activeSession) {
      setStatus('Select a workspace to inspect attachment profiles.');
      return;
    }
    setStatus('Loading attachment profiles...');
    void listFiles(activeSession.id, attachmentRoot)
      .then((listing) => {
        if (cancelled) return;
        const next = listing.entries.filter((entry) => entry.kind === 'file' && entry.name.endsWith('.attachment.toml'));
        setFiles(next);
        setSelectedPath(next[0]?.path || '');
        setStatus(next.length ? 'Choose a profile to tune its primary grip.' : 'No attachment profiles were found.');
      })
      .catch((caught) => {
        if (cancelled) return;
        setError(errorMessage(caught));
        setStatus('Attachment profiles could not be loaded.');
      });
    return () => { cancelled = true; };
  }, [activeSession]);

  useEffect(() => {
    let cancelled = false;
    void closeConnection();
    setSource('');
    setRevision('');
    setDraft(null);
    setLease(null);
    setOperation(null);
    setCandidate('');
    setError('');
    if (!activeSession || !selectedPath) return;
    setBusy(true);
    void reread(selectedPath).then(() => {
      if (!cancelled) setStatus('Profile loaded read-only. Choose Begin tuning to request its write lock.');
    }).catch((caught) => {
      if (!cancelled) {
        setError(errorMessage(caught));
        setStatus('This profile uses a source layout the constrained tuner cannot safely edit.');
      }
    }).finally(() => {
      if (!cancelled) setBusy(false);
    });
    return () => {
      cancelled = true;
      void closeConnection();
    };
  }, [activeSession, selectedPath]);

  useEffect(() => {
    if (!lease || lease.status !== 'queued') return;
    let cancelled = false;
    const timer = window.setInterval(() => {
      void fetchCoordinationLease(lease.id).then(async (updated) => {
        if (cancelled) return;
        const connection = connectionRef.current;
        if (connection && connection.lease.id === updated.id) connection.lease = updated;
        setLease(updated);
        if (updated.status === 'granted') {
          window.clearInterval(timer);
          try {
            await refreshGrantedSource(updated);
            if (cancelled) return;
            setStatus('Write lock granted. Source was refreshed; editing is enabled.');
          } catch (caught) {
            if (cancelled) return;
            setError(errorMessage(caught));
            setStatus('The queued lock no longer matches the attachment source.');
          }
        } else if (updated.status !== 'queued') {
          window.clearInterval(timer);
          setStatus('Write lock was lost. Begin tuning again before editing or applying.');
        }
      }).catch((caught) => {
        if (!cancelled) setError(`Could not poll the spatial lock: ${errorMessage(caught)}`);
      });
    }, 1_000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [lease?.id, lease?.status, selectedPath]);

  useEffect(() => {
    if (!lease || !['queued', 'granted'].includes(lease.status)) return;
    let cancelled = false;
    const timer = window.setInterval(() => {
      const connection = connectionRef.current;
      if (!connection) return;
      void heartbeatCoordinationAgent(connection.agentId, connection.credential).catch((caught) => {
        if (cancelled) return;
        connection.lease = { ...connection.lease, status: 'expired' };
        setLease(connection.lease);
        setError(`Spatial lock was lost: ${errorMessage(caught)}`);
      });
    }, 10_000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [lease?.id, lease?.status]);

  const leaseGranted = lease?.status === 'granted';
  const operationLocksEditing = operation
    ? ['previewed', 'approved', 'applying', 'applied', 'undoing'].includes(operation.state)
    : false;
  const canEdit = Boolean(draft && leaseGranted && !busy && !operationLocksEditing);
  const numericValid = [...translation, ...rotationDegrees].every(Number.isFinite);

  function setAxis(kind: 'translation' | 'rotation', index: number, value: string) {
    const parsed = value.trim() ? Number(value) : Number.NaN;
    const setter = kind === 'translation' ? setTranslation : setRotationDegrees;
    setter((current) => current.map((entry, axis) => axis === index ? parsed : entry) as SpatialVector3);
  }

  async function requireCurrentConnection(expectedSelection: string) {
    const connection = connectionRef.current;
    if (!connection || connection.lease.status !== 'granted') {
      throw new Error('A granted write lock is required.');
    }
    await heartbeatCoordinationAgent(connection.agentId, connection.credential);
    if (selectionKeyRef.current !== expectedSelection) throw new Error('Attachment selection changed.');
    const currentLease = await fetchCoordinationLease(connection.lease.id);
    if (selectionKeyRef.current !== expectedSelection) throw new Error('Attachment selection changed.');
    connection.lease = currentLease;
    setLease(currentLease);
    if (currentLease.status !== 'granted') throw new Error(`The write lock is ${currentLease.status}.`);
    return connection;
  }

  async function runAction(action: () => Promise<void>, expectedSelection = selectionKeyRef.current) {
    setBusy(true);
    setError('');
    try {
      await action();
    } catch (caught) {
      if (selectionKeyRef.current !== expectedSelection) return;
      if (caught instanceof SessiondRequestError && caught.operation) {
        setOperation(caught.operation);
      } else if (caught instanceof SessiondRequestError && caught.status === 409 && operation) {
        const authoritative = await fetchOperation(operation.id).catch(() => null);
        if (selectionKeyRef.current !== expectedSelection) return;
        if (authoritative) setOperation(authoritative);
      }
      if (caught instanceof SessiondRequestError && (caught.status === 409 || caught.conflict)) {
        if (selectedPath) await reread(selectedPath).catch(() => undefined);
        if (selectionKeyRef.current !== expectedSelection) return;
        setStatus('The authored source or operation changed. The old candidate remains visible for comparison; review the refreshed values and preview again.');
      }
      setError(errorMessage(caught));
    } finally {
      if (selectionKeyRef.current === expectedSelection) setBusy(false);
    }
  }

  async function acquireTuningLease(resources?: string[]) {
    if (!activeSession || !selectedPath || !draft) throw new Error('Select a valid attachment profile.');
    const expectedSelection = selectionKeyRef.current;
    await closeConnection();
    const latest = await reread(selectedPath, expectedSelection);
    if (!latest) throw new Error('The attachment source could not be read.');
    const registration = await registerCoordinationAgent(activeSession.id);
    try {
      if (selectionKeyRef.current !== expectedSelection) throw new Error('Attachment selection changed.');
      const nextLease = await requestCoordinationLease(
        registration.agent.id,
        registration.credential,
        resources || [`spatial/attachment/${latest.parsed.id.toLowerCase()}`],
      );
      if (selectionKeyRef.current !== expectedSelection) {
        await releaseCoordinationLease(nextLease.id, registration.agent.id, registration.credential).catch(() => undefined);
        throw new Error('Attachment selection changed.');
      }
      connectionRef.current = {
        agentId: registration.agent.id,
        credential: registration.credential,
        lease: nextLease,
        path: selectedPath,
      };
      setLease(nextLease);
      if (nextLease.status === 'granted') {
        await refreshGrantedSource(nextLease);
        setStatus('Write lock granted. Edit values, then preview the candidate.');
      } else {
        setStatus(`Write lock queued${nextLease.queuePosition ? ` at position ${nextLease.queuePosition}` : ''}. Editing stays disabled until it is granted.`);
      }
      return nextLease;
    } catch (caught) {
      await disconnectCoordinationAgent(registration.agent.id, registration.credential).catch(() => undefined);
      throw caught;
    }
  }

  function beginTuning(resources?: string[]) {
    const expectedSelection = selectionKeyRef.current;
    void runAction(async () => { await acquireTuningLease(resources); }, expectedSelection);
  }

  function handlePreview() {
    const expectedSelection = selectionKeyRef.current;
    void runAction(async () => {
      if (!activeSession || !draft || !selectedPath) throw new Error('Select a valid attachment profile.');
      if (!numericValid) throw new Error('Every translation and rotation value must be a finite number.');
      const connection = await requireCurrentConnection(expectedSelection);
      const nextCandidate = updateSpatialAttachmentTransform(source, translation, rotationDegrees);
      const result = await previewSpatialAttachment({
        sessionId: activeSession.id,
        path: selectedPath,
        content: nextCandidate,
        baseRevision: revision,
        label: `Tune ${draft.id} primary grip`,
        agentId: connection.agentId,
        leaseId: connection.lease.id,
        credential: connection.credential,
      });
      if (selectionKeyRef.current !== expectedSelection) throw new Error('Attachment selection changed.');
      setCandidate(nextCandidate);
      setOperation(result.operation);
      setStatus('Candidate previewed. NOT APPLIED. Approve it to enable Apply, or reject it.');
    }, expectedSelection);
  }

  function handleTransition(action: 'approve' | 'reject' | 'apply' | 'undo') {
    const expectedSelection = selectionKeyRef.current;
    void runAction(async () => {
      if (!operation) throw new Error('No spatial operation is active.');
      if (action === 'undo' && !leaseGranted) {
        const acquired = await acquireTuningLease(operation.context?.resourceKeys);
        if (acquired.status !== 'granted') {
          setStatus('Undo requested a fresh write lock. Press Undo again after the queued lock is granted.');
          return;
        }
      }
      const coordination = action === 'apply' || action === 'undo'
        ? await requireCurrentConnection(expectedSelection)
        : null;
      const result = await transitionOperation(
        operation.id,
        action,
        {
          actor: engineShellActor,
          coordination: coordination ? {
            agentId: coordination.agentId,
            leaseId: coordination.lease.id,
            credential: coordination.credential,
          } : undefined,
        },
      );
      if (selectionKeyRef.current !== expectedSelection) throw new Error('Attachment selection changed.');
      setOperation(result.operation);
      if (action === 'approve') {
        setStatus('Candidate approved, still NOT APPLIED. Apply writes the reviewed bytes.');
      } else if (action === 'reject') {
        setCandidate('');
        setOperation(null);
        try {
          await reread(selectedPath);
        } finally {
          await closeConnection();
        }
        setStatus('Candidate rejected. The authored file was not changed.');
      } else if (action === 'apply') {
        try {
          await reread(selectedPath);
        } finally {
          await closeConnection();
        }
        setStatus('Candidate applied. Its write lock was released; Undo reacquires a fresh lock explicitly.');
      } else {
        setCandidate('');
        setOperation(null);
        try {
          await reread(selectedPath);
        } finally {
          await closeConnection();
        }
        setStatus('Operation undone. The previous authored bytes were restored.');
      }
    }, expectedSelection);
  }

  return (
    <div className="spatial-editor">
      <header className="spatial-editor__header">
        <div>
          <span className="surface-eyebrow">Assets / Spatial attachments</span>
          <h2>Primary Grip Tuner</h2>
          <p>Human adjustments and agent changes use the same source TOML, lease, preview, approval, apply, and undo path.</p>
        </div>
        <span className={`spatial-lock spatial-lock--${lease?.status || 'idle'}`}>
          Lock: {lease?.status || 'not requested'}
        </span>
      </header>

      {!activeSession ? (
        <div className="spatial-empty">Select a workspace to tune spatial attachments.</div>
      ) : (
        <div className="spatial-editor__body">
          <aside className="spatial-profile-pane" aria-label="Attachment profiles">
            <h3>Attachment profiles</h3>
            {files.length ? (
              <div className="spatial-profile-list" aria-label="Attachment profiles">
                {files.map((file) => (
                  <button
                    aria-current={selectedPath === file.path ? 'true' : undefined}
                    className={selectedPath === file.path ? 'is-active' : ''}
                    key={file.path}
                    onClick={() => setSelectedPath(file.path)}
                    type="button"
                  >
                    <strong>{file.name.replace('.attachment.toml', '')}</strong>
                    <span>{file.path}</span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="spatial-empty spatial-empty--compact">No files under {attachmentRoot}.</div>
            )}
          </aside>

          <section className="spatial-tuner" aria-label="Primary grip tuner">
            {error ? <div className="spatial-alert" role="alert">{error}</div> : null}
            <div className="spatial-status" aria-live="polite">{status}</div>
            {draft ? (
              <>
                <section className="spatial-identity" aria-label="Read-only attachment identity">
                  <div><span>Profile</span><strong>{draft.id}</strong></div>
                  <div><span>Skeleton</span><strong>{draft.skeleton}</strong></div>
                  <div><span>Socket</span><strong>{draft.socket}</strong></div>
                  <div><span>Item prefab</span><strong>{draft.itemPrefab}</strong></div>
                </section>

                <fieldset disabled={!canEdit}>
                  <legend>Primary grip translation (local meters)</legend>
                  <div className="spatial-vector">
                    {(['X', 'Y', 'Z'] as const).map((axis, index) => (
                      <label key={axis}>
                        <span>{axis}</span>
                        <input
                          aria-label={`Translation ${axis} in meters`}
                          onChange={(event) => setAxis('translation', index, event.target.value)}
                          step="0.001"
                          type="number"
                          value={Number.isFinite(translation[index]) ? translation[index] : ''}
                        />
                      </label>
                    ))}
                  </div>
                </fieldset>

                <fieldset disabled={!canEdit}>
                  <legend>Primary grip rotation (Euler degrees, written as a quaternion)</legend>
                  <div className="spatial-vector">
                    {(['X', 'Y', 'Z'] as const).map((axis, index) => (
                      <label key={axis}>
                        <span>{axis}</span>
                        <input
                          aria-label={`Rotation ${axis} in degrees`}
                          onChange={(event) => setAxis('rotation', index, event.target.value)}
                          step="0.1"
                          type="number"
                          value={Number.isFinite(rotationDegrees[index]) ? rotationDegrees[index] : ''}
                        />
                      </label>
                    ))}
                  </div>
                </fieldset>

                {!leaseGranted ? (
                  <div className="spatial-lock-help">
                    <span>Browsing is read-only. Editing and mutations stay disabled until you explicitly request this profile's write lock.</span>
                    {!lease || !['queued', 'granted'].includes(lease.status) ? (
                      <button className="ghost-button ghost-button--sm" disabled={busy || operation?.state === 'applied'} onClick={() => beginTuning()} type="button">Begin tuning</button>
                    ) : null}
                  </div>
                ) : null}

                {operation && ['previewed', 'approved', 'conflicted'].includes(operation.state) ? (
                  <section className="spatial-candidate" aria-label="Unapplied candidate">
                    <strong>NOT APPLIED</strong>
                    <span>{operation.context?.label || operation.id}</span>
                    <code>{operation.preview.summary}</code>
                    <details><summary>Candidate source</summary><pre>{candidate}</pre></details>
                  </section>
                ) : null}

                <div className="spatial-actions" aria-label="Spatial operation actions">
                  <button className="ghost-button" disabled={!canEdit || !numericValid} onClick={handlePreview} type="button">Preview</button>
                  <button className="ghost-button" disabled={busy || operation?.state !== 'previewed'} onClick={() => handleTransition('approve')} type="button">Approve</button>
                  <button className="ghost-button" disabled={busy || !operation || !['previewed', 'approved'].includes(operation.state)} onClick={() => handleTransition('reject')} type="button">Reject</button>
                  <button className="ghost-button" disabled={busy || !leaseGranted || operation?.state !== 'approved'} onClick={() => handleTransition('apply')} type="button">Apply</button>
                  <button className="ghost-button" disabled={busy || lease?.status === 'queued' || operation?.state !== 'applied'} onClick={() => handleTransition('undo')} type="button">Undo</button>
                </div>
              </>
            ) : selectedPath ? (
              <div className="spatial-empty">Loading and validating the selected attachment source...</div>
            ) : null}
          </section>
        </div>
      )}
    </div>
  );
}
