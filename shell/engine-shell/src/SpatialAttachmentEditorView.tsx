import { useEffect, useRef, useState } from 'react';
import {
  disconnectCoordinationAgent,
  evaluateSpatialAttachment,
  evaluateSpatialAttachmentSample,
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
  type SpatialAttachmentEvaluation,
  type SpatialSourceRevision,
} from './lib/sessiond';
import {
  parseSpatialAttachment,
  parseSpatialAttachmentMotionEnvelope,
  sameSpatialConnection,
  shouldCloseSpatialConnection,
  spatialActionStillCurrent,
  spatialLeaseCoversAttachment,
  spatialOperationReconciliation,
  spatialSourceRevisionsCoverAttachment,
  updateSpatialAttachmentTransform,
  type SpatialAttachmentDraft,
  type SpatialMotionEnvelopePhase,
  type SpatialVector3,
} from './spatial-attachment-authoring';
import { isSpatialAttachmentEvaluation, SpatialRestSchematic } from './SpatialRestSchematic';

const attachmentRoot = 'animation/attachments';

type Connection = {
  agentId: string;
  credential: string;
  lease: CoordinationLease;
  path: string;
};

type EvaluatedValues = {
  translation: SpatialVector3;
  rotation: SpatialVector3;
};

type AuthoredEvidence = {
  sessionId: string;
  path: string;
  revision: string;
  evaluation: SpatialAttachmentEvaluation;
  sourceRevisions: SpatialSourceRevision[];
  values: EvaluatedValues | null;
};

type CandidateEvidence = {
  sessionId: string;
  path: string;
  operationId: string;
  baseRevision: string;
  proposedRevision: string;
  evaluation: SpatialAttachmentEvaluation;
  values: EvaluatedValues;
};

type SampledEvidence = {
  sessionId: string;
  path: string;
  revision: string;
  phase: string;
  normalizedTime: number;
  sourceRevisions: SpatialSourceRevision[];
  evaluation: SpatialAttachmentEvaluation;
  values: EvaluatedValues | null;
};

type SchematicSource = 'authored' | 'candidate' | 'sample';

const EVALUATION_ERROR_LIMIT = 800;

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function boundedText(value: string, limit = EVALUATION_ERROR_LIMIT) {
  const text = value.trim();
  return text.length <= limit ? text : `${text.slice(0, limit)}...`;
}

function vectorCopy(value: SpatialVector3): SpatialVector3 {
  return [...value] as SpatialVector3;
}

function vectorEqual(left: SpatialVector3, right: SpatialVector3) {
  return left.every((value, index) => value === right[index]);
}

function evaluatedValues(parsed: SpatialAttachmentDraft): EvaluatedValues {
  return {
    translation: vectorCopy(parsed.translation),
    rotation: vectorCopy(parsed.rotationDegrees),
  };
}

export function SpatialAttachmentEditorView({
  activeSession,
  operationEventEpoch,
}: {
  activeSession: EngineSession | null;
  operationEventEpoch: number;
}) {
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
  const [authoredEvidence, setAuthoredEvidence] = useState<AuthoredEvidence | null>(null);
  const [candidateEvidence, setCandidateEvidence] = useState<CandidateEvidence | null>(null);
  const [sampledEvidence, setSampledEvidence] = useState<SampledEvidence | null>(null);
  const [schematicSource, setSchematicSource] = useState<SchematicSource>('authored');
  const [evaluationError, setEvaluationError] = useState('');
  const [evaluationBusy, setEvaluationBusy] = useState(false);
  const [sampledError, setSampledError] = useState('');
  const [sampledBusy, setSampledBusy] = useState(false);
  const [motionEnvelope, setMotionEnvelope] = useState<SpatialMotionEnvelopePhase[]>([]);
  const [envelopeError, setEnvelopeError] = useState('');
  const [selectedPhase, setSelectedPhase] = useState('');
  const [selectedNormalizedTime, setSelectedNormalizedTime] = useState(Number.NaN);
  const [sourceLayoutError, setSourceLayoutError] = useState('');
  const [status, setStatus] = useState('Select an attachment profile to begin.');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const connectionRef = useRef<Connection | null>(null);
  const selectionKeyRef = useRef('');
  const authoredEvaluationRequestRef = useRef(0);
  const sampledEvaluationRequestRef = useRef(0);
  const sourceReadRequestRef = useRef(0);
  const operationEventRequestRef = useRef(0);
  const actionRequestRef = useRef(0);
  const operationRef = useRef<EngineOperation | null>(null);
  const revisionRef = useRef('');
  const selectedSampleRef = useRef({ phase: '', time: Number.NaN });
  selectionKeyRef.current = `${activeSession?.id || ''}:${selectedPath}`;
  revisionRef.current = revision;
  selectedSampleRef.current = { phase: selectedPhase, time: selectedNormalizedTime };

  function setActiveOperation(next: EngineOperation | null) {
    operationRef.current = next;
    setOperation(next);
  }

  function clearCandidateEvidence() {
    setCandidate('');
    setCandidateEvidence(null);
    setSchematicSource((current) => current === 'candidate' ? 'authored' : current);
  }

  function clearSampledEvidence() {
    sampledEvaluationRequestRef.current += 1;
    setSampledEvidence(null);
    setSampledError('');
    setSampledBusy(false);
    setSchematicSource((current) => current === 'sample' ? 'authored' : current);
  }

  function applyMotionEnvelope(content: string) {
    try {
      const envelope = parseSpatialAttachmentMotionEnvelope(content);
      setMotionEnvelope(envelope);
      setEnvelopeError('');
      const current = selectedSampleRef.current;
      const matching = envelope.find((entry) => entry.phase === current.phase);
      if (matching && matching.normalizedTimes.includes(current.time)) {
        setSelectedPhase(matching.phase);
        setSelectedNormalizedTime(current.time);
        return;
      }
      setSelectedPhase(envelope[0]?.phase || '');
      setSelectedNormalizedTime(envelope[0]?.normalizedTimes[0] ?? Number.NaN);
    } catch (caught) {
      setMotionEnvelope([]);
      setEnvelopeError(boundedText(errorMessage(caught)));
      setSelectedPhase('');
      setSelectedNormalizedTime(Number.NaN);
    }
  }

  async function refreshAuthoredEvaluation(
    sessionId: string,
    path: string,
    baseRevision: string,
    values: EvaluatedValues | null,
    expectedSelection: string,
  ) {
    const requestId = ++authoredEvaluationRequestRef.current;
    setAuthoredEvidence(null);
    setEvaluationError('');
    setEvaluationBusy(true);
    try {
      const result = await evaluateSpatialAttachment(sessionId, path, baseRevision);
      if (authoredEvaluationRequestRef.current !== requestId || selectionKeyRef.current !== expectedSelection) return;
      if (result.path !== path || result.revision !== baseRevision) {
        throw new Error('Sessiond returned rest evaluation for a different attachment revision.');
      }
      if (
        !spatialSourceRevisionsCoverAttachment(result.sourceRevisions, path, baseRevision)
        || !isSpatialAttachmentEvaluation(result.evaluation)
        || result.evaluation.pose.kind !== 'rest'
      ) {
        throw new Error('Sessiond returned malformed or incompletely bound rest evidence.');
      }
      setAuthoredEvidence({
        sessionId,
        path,
        revision: baseRevision,
        evaluation: result.evaluation,
        sourceRevisions: result.sourceRevisions,
        values,
      });
    } catch (caught) {
      if (authoredEvaluationRequestRef.current !== requestId || selectionKeyRef.current !== expectedSelection) return;
      setEvaluationError(boundedText(errorMessage(caught)));
    } finally {
      if (authoredEvaluationRequestRef.current === requestId && selectionKeyRef.current === expectedSelection) {
        setEvaluationBusy(false);
      }
    }
  }

  async function refreshSampledEvaluation(
    sessionId: string,
    path: string,
    baseRevision: string,
    phase: string,
    clip: string,
    normalizedTime: number,
    values: EvaluatedValues | null,
    expectedSelection: string,
  ) {
    const requestId = ++sampledEvaluationRequestRef.current;
    const requestStillCurrent = () => (
      sampledEvaluationRequestRef.current === requestId
      && selectionKeyRef.current === expectedSelection
      && revisionRef.current === baseRevision
      && selectedSampleRef.current.phase === phase
      && selectedSampleRef.current.time === normalizedTime
    );
    setSchematicSource('sample');
    setSampledError('');
    setSampledBusy(true);
    try {
      const result = await evaluateSpatialAttachmentSample(
        sessionId,
        path,
        baseRevision,
        phase,
        normalizedTime,
      );
      if (!requestStillCurrent()) return;
      if (result.path !== path || result.revision !== baseRevision) {
        throw new Error('Sessiond returned sampled evidence for a different attachment revision.');
      }
      if (!spatialSourceRevisionsCoverAttachment(result.sourceRevisions, path, baseRevision)) {
        throw new Error('Sessiond returned sampled evidence without its exact authored source revisions.');
      }
      if (
        !isSpatialAttachmentEvaluation(result.evaluation)
        || result.evaluation.pose.kind !== 'clip_sample'
        || result.evaluation.pose.phase !== phase
        || result.evaluation.pose.clip !== clip
        || result.evaluation.pose.normalizedTime !== normalizedTime
      ) {
        throw new Error('Sessiond returned malformed sampled evidence or a different authored sample.');
      }
      setSampledEvidence({
        sessionId,
        path,
        revision: baseRevision,
        phase,
        normalizedTime,
        sourceRevisions: result.sourceRevisions,
        evaluation: result.evaluation,
        values,
      });
    } catch (caught) {
      if (!requestStillCurrent()) return;
      setSampledError(boundedText(errorMessage(caught)));
    } finally {
      if (requestStillCurrent()) setSampledBusy(false);
    }
  }

  async function reread(path: string, expectedSelection = `${activeSession?.id || ''}:${path}`) {
    if (!activeSession) return;
    const readGeneration = ++sourceReadRequestRef.current;
    clearSampledEvidence();
    authoredEvaluationRequestRef.current += 1;
    setAuthoredEvidence(null);
    setEvaluationError('');
    setEvaluationBusy(true);
    let next;
    try {
      next = await readFile(activeSession.id, path);
    } catch (caught) {
      if (
        sourceReadRequestRef.current === readGeneration
        && selectionKeyRef.current === expectedSelection
      ) {
        setEvaluationBusy(false);
        setEvaluationError('The attachment source could not be read for rest evaluation.');
        setMotionEnvelope([]);
        setEnvelopeError('The attachment source could not be read for sampled evaluation.');
        setSelectedPhase('');
        setSelectedNormalizedTime(Number.NaN);
      }
      throw caught;
    }
    if (
      sourceReadRequestRef.current !== readGeneration
      || selectionKeyRef.current !== expectedSelection
    ) throw new Error('Attachment source read was superseded.');
    setSource(next.content);
    setRevision(next.revision);
    applyMotionEnvelope(next.content);
    let parsed: SpatialAttachmentDraft | null = null;
    try {
      parsed = parseSpatialAttachment(next.content);
      setDraft(parsed);
      setTranslation(vectorCopy(parsed.translation));
      setRotationDegrees(vectorCopy(parsed.rotationDegrees));
      setSourceLayoutError('');
    } catch (caught) {
      setDraft(null);
      setSourceLayoutError(boundedText(errorMessage(caught)));
    }
    void refreshAuthoredEvaluation(
      activeSession.id,
      path,
      next.revision,
      parsed ? evaluatedValues(parsed) : null,
      expectedSelection,
    );
    return { file: next, parsed };
  }

  async function closeConnection(expectedConnection?: Connection | null) {
    const expectedWasCaptured = expectedConnection !== undefined;
    if (!shouldCloseSpatialConnection(connectionRef.current, expectedConnection || null, expectedWasCaptured)) return false;
    const connection = expectedWasCaptured ? expectedConnection || null : connectionRef.current;
    connectionRef.current = null;
    setLease(null);
    if (!connection) return true;
    await releaseCoordinationLease(connection.lease.id, connection.agentId, connection.credential).catch(() => undefined);
    await disconnectCoordinationAgent(connection.agentId, connection.credential).catch(() => undefined);
    return true;
  }

  async function refreshGrantedSource(grantedLease: CoordinationLease) {
    const latest = await reread(selectedPath);
    if (!latest) throw new Error('The attachment source could not be read.');
    if (!latest.parsed) {
      await closeConnection();
      throw new Error('The refreshed source layout cannot be safely edited by the constrained tuner.');
    }
    if (!spatialLeaseCoversAttachment(grantedLease.resources, latest.parsed.id)) {
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
    authoredEvaluationRequestRef.current += 1;
    sourceReadRequestRef.current += 1;
    operationEventRequestRef.current += 1;
    actionRequestRef.current += 1;
    void closeConnection();
    setSource('');
    setRevision('');
    setDraft(null);
    setLease(null);
    setActiveOperation(null);
    clearCandidateEvidence();
    clearSampledEvidence();
    setMotionEnvelope([]);
    setEnvelopeError('');
    setSelectedPhase('');
    setSelectedNormalizedTime(Number.NaN);
    setAuthoredEvidence(null);
    setEvaluationError('');
    setEvaluationBusy(Boolean(activeSession && selectedPath));
    setSourceLayoutError('');
    setError('');
    if (!activeSession || !selectedPath) {
      setEvaluationBusy(false);
      return;
    }
    setBusy(true);
    void reread(selectedPath).then((result) => {
      if (!cancelled) {
        setStatus(result?.parsed
          ? 'Profile loaded read-only. Choose Begin tuning to request its write lock.'
          : 'Profile loaded read-only. Rest evaluation remains available, but this source layout cannot be safely tuned here.');
      }
    }).catch((caught) => {
      if (!cancelled) {
        setError(errorMessage(caught));
        setStatus('The selected attachment source could not be loaded.');
        setEvaluationBusy(false);
      }
    }).finally(() => {
      if (!cancelled) setBusy(false);
    });
    return () => {
      cancelled = true;
      authoredEvaluationRequestRef.current += 1;
      sampledEvaluationRequestRef.current += 1;
      sourceReadRequestRef.current += 1;
      operationEventRequestRef.current += 1;
      operationRef.current = null;
      void closeConnection();
    };
  }, [activeSession, selectedPath]);

  useEffect(() => {
    if (operationEventEpoch <= 0 || !activeSession || !selectedPath) return;
    const currentOperation = operationRef.current;
    if (
      !currentOperation
      || currentOperation.sessionId !== activeSession.id
      || currentOperation.path !== selectedPath
    ) return;

    const requestId = ++operationEventRequestRef.current;
    const expectedSelection = selectionKeyRef.current;
    const expectedSessionId = activeSession.id;
    const expectedOperationId = currentOperation.id;
    const requestStillCurrent = () => (
      operationEventRequestRef.current === requestId
      && selectionKeyRef.current === expectedSelection
    );
    const stillCurrent = () => (
      requestStillCurrent()
      && operationRef.current?.id === expectedOperationId
    );
    const terminalStillCurrent = () => (
      requestStillCurrent()
      && (operationRef.current === null || operationRef.current.id === expectedOperationId)
    );

    void fetchOperation(expectedOperationId).then(async (authoritative) => {
      if (!stillCurrent()) return;
      if (
        authoritative.id !== expectedOperationId
        || authoritative.sessionId !== expectedSessionId
        || authoritative.path !== selectedPath
      ) {
        throw new Error('Sessiond returned a different active spatial operation.');
      }

      setActiveOperation(authoritative);
      if (authoritative.state === 'approved') {
        setStatus('Candidate approved externally, still NOT APPLIED. Apply writes the reviewed bytes.');
        return;
      }
      const reconciliation = spatialOperationReconciliation(authoritative.state);
      if (!reconciliation.refreshAuthored) return;

      actionRequestRef.current += 1;
      setBusy(true);
      const eventConnection = connectionRef.current;
      if (authoritative.state !== 'rejected') setAuthoredEvidence(null);
      if (reconciliation.clearCandidate) clearCandidateEvidence();
      if (reconciliation.clearOperation) setActiveOperation(null);
      try {
        const refreshed = await reread(selectedPath, expectedSelection);
        if (
          authoritative.state === 'conflicted'
          && eventConnection
          && sameSpatialConnection(connectionRef.current, eventConnection)
          && (!refreshed?.parsed || !spatialLeaseCoversAttachment(eventConnection.lease.resources, refreshed.parsed.id))
        ) {
          await closeConnection(eventConnection);
        }
      } catch (caught) {
        if (authoritative.state === 'conflicted') await closeConnection(eventConnection);
        throw caught;
      } finally {
        if (reconciliation.closeConnection) await closeConnection(eventConnection);
        if (terminalStillCurrent()) setBusy(false);
      }
      if (!terminalStillCurrent()) return;
      if (authoritative.state === 'conflicted') {
        setStatus('The active operation conflicted. Authored bytes were refreshed; its candidate remains visible as stale evidence for comparison.');
      } else if (authoritative.state === 'rejected') {
        setStatus('Candidate rejected externally. The authored file was not changed, and its write lock was released.');
      } else if (authoritative.state === 'applied') {
        setStatus('Candidate applied externally. Its write lock was released; Undo reacquires a fresh lock explicitly.');
      } else {
        setStatus('Operation undone externally. The previous authored bytes were restored.');
      }
    }).catch((caught) => {
      if (!terminalStillCurrent()) return;
      setError(`Could not refresh the active spatial operation: ${boundedText(errorMessage(caught))}`);
    });
  }, [operationEventEpoch, activeSession?.id, selectedPath]);

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
  const draftDiffersFrom = (values: EvaluatedValues | null) => Boolean(
    draft
    && values
    && (!vectorEqual(translation, values.translation) || !vectorEqual(rotationDegrees, values.rotation)),
  );
  const authoredIdentityStale = Boolean(
    authoredEvidence
    && (
      authoredEvidence.sessionId !== activeSession?.id
      || authoredEvidence.path !== selectedPath
      || authoredEvidence.revision !== revision
    ),
  );
  const authoredStale = authoredIdentityStale || draftDiffersFrom(authoredEvidence?.values || null);
  const candidateOperationStale = Boolean(
    candidateEvidence
    && (
      operation?.id !== candidateEvidence.operationId
      || operation?.baseRevision !== candidateEvidence.baseRevision
      || operation?.proposedRevision !== candidateEvidence.proposedRevision
      || !['previewed', 'approved'].includes(operation?.state || '')
    ),
  );
  const candidateIdentityStale = Boolean(
    candidateEvidence
    && (
      candidateEvidence.sessionId !== activeSession?.id
      || candidateEvidence.path !== selectedPath
      || candidateEvidence.baseRevision !== revision
    ),
  );
  const candidateStale = candidateOperationStale
    || candidateIdentityStale
    || draftDiffersFrom(candidateEvidence?.values || null);
  const sampledIdentityStale = Boolean(
    sampledEvidence
    && (
      sampledEvidence.sessionId !== activeSession?.id
      || sampledEvidence.path !== selectedPath
      || sampledEvidence.revision !== revision
      || sampledEvidence.phase !== selectedPhase
      || sampledEvidence.normalizedTime !== selectedNormalizedTime
      || !spatialSourceRevisionsCoverAttachment(
        sampledEvidence.sourceRevisions,
        sampledEvidence.path,
        sampledEvidence.revision,
      )
    ),
  );
  const sampledStale = sampledIdentityStale || draftDiffersFrom(sampledEvidence?.values || null);
  const showingCandidate = schematicSource === 'candidate';
  const showingSample = schematicSource === 'sample';
  const activeEvidence = showingSample
    ? sampledEvidence
    : showingCandidate
      ? candidateEvidence
      : authoredEvidence;
  const activeRevision = showingCandidate
    ? candidateEvidence?.proposedRevision || ''
    : showingSample
      ? sampledEvidence?.revision || revision
      : authoredEvidence?.revision || revision;
  const activePath = activeEvidence?.path || selectedPath;
  const schematicStale = showingSample ? sampledStale : showingCandidate ? candidateStale : authoredStale;
  const evidenceLabel = showingSample
    ? `${schematicStale ? 'STALE ' : ''}AUTHORED SAMPLE - READ ONLY`
    : showingCandidate
    ? `${schematicStale ? 'STALE ' : ''}PREVIEW CANDIDATE - NOT APPLIED`
    : 'AUTHORED REST';
  const staleReason = showingSample
    ? sampledIdentityStale
      ? 'displayed sample does not match the current revision, phase, or authored normalized time'
      : 'draft values differ from the authored revision used by this sample'
    : showingCandidate
    ? operation?.state === 'conflicted'
      ? 'operation conflicted; source or operation state changed after evaluation'
      : candidateIdentityStale
        ? 'source revision changed after candidate evaluation'
        : candidateOperationStale
          ? 'candidate no longer matches the active operation'
          : 'current input values differ from this evaluated candidate'
    : authoredIdentityStale
      ? 'displayed evidence does not match the current source revision'
      : 'draft values are not evaluated; display remains on the authored revision';
  const sampledPose = sampledEvidence?.evaluation.pose.kind === 'clip_sample'
    ? sampledEvidence.evaluation.pose
    : null;

  function setAxis(kind: 'translation' | 'rotation', index: number, value: string) {
    const parsed = value.trim() ? Number(value) : Number.NaN;
    const setter = kind === 'translation' ? setTranslation : setRotationDegrees;
    setter((current) => current.map((entry, axis) => axis === index ? parsed : entry) as SpatialVector3);
  }

  function handleSamplePhaseChange(phase: string) {
    sampledEvaluationRequestRef.current += 1;
    setSampledBusy(false);
    setSampledError('');
    const entry = motionEnvelope.find((candidatePhase) => candidatePhase.phase === phase);
    setSelectedPhase(entry?.phase || '');
    setSelectedNormalizedTime(entry?.normalizedTimes[0] ?? Number.NaN);
  }

  function handleSampleTimeChange(normalizedTime: number) {
    sampledEvaluationRequestRef.current += 1;
    setSampledBusy(false);
    setSampledError('');
    setSelectedNormalizedTime(normalizedTime);
  }

  function handleSampleEvaluation() {
    if (!activeSession || !selectedPath || !revision) return;
    const phase = motionEnvelope.find((entry) => entry.phase === selectedPhase);
    if (!phase || !phase.normalizedTimes.includes(selectedNormalizedTime)) {
      setSampledError('Choose an exact authored motion-envelope phase and normalized time.');
      return;
    }
    void refreshSampledEvaluation(
      activeSession.id,
      selectedPath,
      revision,
      phase.phase,
      phase.clip,
      selectedNormalizedTime,
      draft ? evaluatedValues(draft) : null,
      selectionKeyRef.current,
    );
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

  async function runAction(
    action: (stillCurrent: () => boolean) => Promise<void>,
    expectedSelection = selectionKeyRef.current,
  ) {
    const actionGeneration = ++actionRequestRef.current;
    const stillCurrent = () => spatialActionStillCurrent(
      actionRequestRef.current,
      actionGeneration,
      selectionKeyRef.current,
      expectedSelection,
    );
    setBusy(true);
    setError('');
    try {
      await action(stillCurrent);
    } catch (caught) {
      if (!stillCurrent()) return;
      if (caught instanceof SessiondRequestError && caught.operation) {
        setActiveOperation(caught.operation);
      } else if (caught instanceof SessiondRequestError && caught.status === 409 && operation) {
        const authoritative = await fetchOperation(operation.id).catch(() => null);
        if (!stillCurrent()) return;
        if (authoritative) setActiveOperation(authoritative);
      }
      if (caught instanceof SessiondRequestError && (caught.status === 409 || caught.conflict)) {
        if (selectedPath) await reread(selectedPath).catch(() => undefined);
        if (!stillCurrent()) return;
        setStatus('The authored source or operation changed. The old candidate remains visible for comparison; review the refreshed values and preview again.');
      }
      setError(errorMessage(caught));
    } finally {
      if (stillCurrent()) setBusy(false);
    }
  }

  async function acquireTuningLease(resources?: string[]) {
    if (!activeSession || !selectedPath || !draft) throw new Error('Select a valid attachment profile.');
    const expectedSelection = selectionKeyRef.current;
    await closeConnection();
    const latest = await reread(selectedPath, expectedSelection);
    if (!latest) throw new Error('The attachment source could not be read.');
    if (!latest.parsed) throw new Error('The refreshed source layout cannot be safely edited by the constrained tuner.');
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
    void runAction(async (stillCurrent) => {
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
      if (!stillCurrent()) return;
      if (
        result.operation.sessionId !== activeSession.id
        || result.operation.path !== selectedPath
        || result.operation.baseRevision !== revision
      ) {
        throw new Error('Sessiond returned candidate evidence for a different attachment revision.');
      }
      setCandidate(nextCandidate);
      setActiveOperation(result.operation);
      setCandidateEvidence({
        sessionId: activeSession.id,
        path: selectedPath,
        operationId: result.operation.id,
        baseRevision: result.operation.baseRevision,
        proposedRevision: result.operation.proposedRevision,
        evaluation: result.evaluation.candidate,
        values: {
          translation: vectorCopy(translation),
          rotation: vectorCopy(rotationDegrees),
        },
      });
      if (result.evaluation.baseline) {
        authoredEvaluationRequestRef.current += 1;
        setEvaluationBusy(false);
        setEvaluationError('');
        setAuthoredEvidence({
          sessionId: activeSession.id,
          path: selectedPath,
          revision: result.operation.baseRevision,
          evaluation: result.evaluation.baseline,
          sourceRevisions: [],
          values: draft ? evaluatedValues(draft) : null,
        });
      }
      setSchematicSource('candidate');
      setStatus('Candidate previewed. NOT APPLIED. Approve it to enable Apply, or reject it.');
    }, expectedSelection);
  }

  function handleTransition(action: 'approve' | 'reject' | 'apply' | 'undo') {
    const expectedSelection = selectionKeyRef.current;
    void runAction(async (stillCurrent) => {
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
      const actionConnection = connectionRef.current;
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
      if (!stillCurrent()) return;
      if (!shouldCloseSpatialConnection(connectionRef.current, actionConnection, true)) return;
      if (operationRef.current && operationRef.current.id !== operation.id) return;
      setActiveOperation(result.operation);
      if (action === 'approve') {
        setStatus('Candidate approved, still NOT APPLIED. Apply writes the reviewed bytes.');
      } else if (action === 'reject') {
        clearCandidateEvidence();
        setActiveOperation(null);
        try {
          await reread(selectedPath, expectedSelection);
        } finally {
          await closeConnection(actionConnection);
        }
        if (!stillCurrent()) return;
        setStatus('Candidate rejected. The authored file was not changed.');
      } else if (action === 'apply') {
        setAuthoredEvidence(null);
        clearCandidateEvidence();
        try {
          await reread(selectedPath, expectedSelection);
        } finally {
          await closeConnection(actionConnection);
        }
        if (!stillCurrent()) return;
        setStatus('Candidate applied. Its write lock was released; Undo reacquires a fresh lock explicitly.');
      } else {
        setAuthoredEvidence(null);
        clearCandidateEvidence();
        setActiveOperation(null);
        try {
          await reread(selectedPath, expectedSelection);
        } finally {
          await closeConnection(actionConnection);
        }
        if (!stillCurrent()) return;
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
            {sourceLayoutError ? (
              <div className="spatial-alert" role="status">
                Read-only rest and authored-sample evaluation remain available, but this source cannot be edited by the constrained tuner: {sourceLayoutError}
              </div>
            ) : null}
            {selectedPath && revision ? (
              <section className="spatial-sample-controls" aria-label="Authored motion sample">
                <div>
                  <h3>Authored motion sample</h3>
                  <p>Read-only native evidence at an exact authored phase and time. No write lock or operation is created; candidate sampling is not available in this slice.</p>
                </div>
                {motionEnvelope.length ? (
                  <div className="spatial-sample-controls__fields">
                    <label>
                      <span>Phase</span>
                      <select
                        aria-label="Authored motion phase"
                        onChange={(event) => handleSamplePhaseChange(event.target.value)}
                        value={selectedPhase}
                      >
                        {motionEnvelope.map((entry) => <option key={entry.phase} value={entry.phase}>{entry.phase} — {entry.clip}</option>)}
                      </select>
                    </label>
                    <label>
                      <span>Normalized time</span>
                      <select
                        aria-label="Authored normalized time"
                        onChange={(event) => handleSampleTimeChange(Number(event.target.value))}
                        value={Number.isFinite(selectedNormalizedTime) ? String(selectedNormalizedTime) : ''}
                      >
                        {(motionEnvelope.find((entry) => entry.phase === selectedPhase)?.normalizedTimes || []).map((time) => (
                          <option key={time} value={String(time)}>{time}</option>
                        ))}
                      </select>
                    </label>
                    <button
                      className="ghost-button"
                      disabled={sampledBusy || !revision || !selectedPhase || !Number.isFinite(selectedNormalizedTime)}
                      onClick={handleSampleEvaluation}
                      type="button"
                    >
                      {sampledBusy ? 'Evaluating sample...' : 'Evaluate authored sample'}
                    </button>
                  </div>
                ) : (
                  <p className="spatial-sample-controls__unavailable">
                    {envelopeError || 'This attachment has no authored motion-envelope samples.'}
                  </p>
                )}
                {sampledError ? <div className="spatial-alert" role="alert">{sampledError}</div> : null}
              </section>
            ) : null}
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
            ) : selectedPath && busy ? (
              <div className="spatial-empty">Loading and validating the selected attachment source...</div>
            ) : null}
          </section>

          <section className="spatial-schematic-pane" aria-label="Spatial rig schematic workbench">
            <div className="spatial-schematic-source" role="group" aria-label="Schematic evidence source">
              <button
                aria-pressed={schematicSource === 'authored'}
                disabled={!authoredEvidence && !evaluationBusy}
                onClick={() => setSchematicSource('authored')}
                type="button"
              >
                Authored rest
              </button>
              <button
                aria-pressed={showingSample}
                disabled={!sampledEvidence && !sampledBusy && !sampledError}
                onClick={() => setSchematicSource('sample')}
                type="button"
              >
                Authored sample (read-only)
              </button>
              <button
                aria-pressed={showingCandidate}
                disabled={!candidateEvidence}
                onClick={() => setSchematicSource('candidate')}
                type="button"
              >
                Candidate rest (NOT APPLIED)
              </button>
            </div>
            <SpatialRestSchematic
              busy={showingSample ? sampledBusy : evaluationBusy && !showingCandidate}
              error={showingSample ? sampledError : showingCandidate ? '' : evaluationError}
              evaluation={activeEvidence?.evaluation || null}
              evidenceLabel={evidenceLabel}
              path={activePath}
              poseKind={showingSample ? 'sampled' : 'rest'}
              revision={activeRevision}
              sampleIdentity={showingSample && sampledPose ? {
                phase: sampledPose.phase,
                clip: sampledPose.clip,
                normalizedTime: sampledPose.normalizedTime,
                sourceRevisionCount: sampledEvidence?.sourceRevisions.length || 0,
              } : undefined}
              sourceRevisions={showingSample
                ? sampledEvidence?.sourceRevisions || []
                : showingCandidate
                  ? []
                  : authoredEvidence?.sourceRevisions || []}
              stale={schematicStale}
              staleReason={staleReason}
            />
          </section>
        </div>
      )}
    </div>
  );
}
