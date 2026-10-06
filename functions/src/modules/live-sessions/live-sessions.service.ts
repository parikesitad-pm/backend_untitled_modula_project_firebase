import { db } from '../../config/firebase';
import { NotFoundError, BadRequestError } from '../../lib/errors';
import { activitiesService } from '../activities/activities.service';
import { AuthOperator } from '../../middleware/auth.middleware';
import { getClock } from '../../lib/clock';
import {
  CreateLiveSessionInput,
  JoinLiveSessionInput,
  LiveParticipantHeartbeatInput,
  LiveSessionStatus,
  LiveParticipantStatus,
} from './live-sessions.schema';

export interface LiveSessionDocument {
  id: string;
  activityId: string;
  assessmentId: string;
  workspaceId: string;
  pin: string;
  status: LiveSessionStatus;
  createdBy: string;
  createdAt: string;
  startedAt: string | null;
  endedAt: string | null;
  currentQuestionIndex: number;
  timeLimitEnabled: boolean;
  activityTimeLimitSeconds: number | null;
  expiresAt: string | null;
  updatedAt: string;
}

export interface LiveParticipantDocument {
  id: string;
  displayName: string;
  participantCode?: string;
  joinedAt: string;
  status: LiveParticipantStatus;
  attemptId: string | null;
  lastSeenAt: string;
}

export class LiveSessionsService {
  private col = db.collection('liveSessions');

  private getParticipantsCol(liveSessionId: string) {
    return this.col.doc(liveSessionId).collection('participants');
  }

  async create(input: CreateLiveSessionInput, operator: AuthOperator): Promise<LiveSessionDocument> {
    const activity = await activitiesService.getById(input.activityId);

    const timeLimitEnabled = !!activity.settings?.timeLimitEnabled;
    const activityTimeLimitSeconds =
      activity.settings?.activityTimeLimitSeconds ?? (activity.settings?.timeLimitSeconds ?? null);

    const now = getClock().nowIso();
    const docRef = this.col.doc();
    const pin = Math.floor(100000 + Math.random() * 900000).toString();

    const session: LiveSessionDocument = {
      id: docRef.id,
      activityId: activity.id,
      assessmentId: activity.id,
      workspaceId: activity.workspaceId || 'internal',
      pin,
      status: 'lobby',
      createdBy: operator.uid,
      createdAt: now,
      startedAt: null,
      endedAt: null,
      currentQuestionIndex: 0,
      timeLimitEnabled,
      activityTimeLimitSeconds,
      expiresAt: null,
      updatedAt: now,
    };

    await docRef.set(session);
    return session;
  }

  async getById(id: string): Promise<LiveSessionDocument> {
    const doc = await this.col.doc(id).get();
    if (!doc.exists) {
      throw new NotFoundError(`Live session '${id}' not found`);
    }
    return doc.data() as LiveSessionDocument;
  }

  async getByPin(pin: string): Promise<LiveSessionDocument> {
    const snap = await this.col.where('pin', '==', pin).where('status', '!=', 'completed').limit(1).get();
    if (snap.empty) {
      throw new NotFoundError(`Active live session with PIN '${pin}' not found`);
    }
    return snap.docs[0].data() as LiveSessionDocument;
  }

  async start(id: string, operator?: AuthOperator): Promise<LiveSessionDocument> {
    const sessionRef = this.col.doc(id);
    const nowIso = getClock().nowIso();
    const nowMs = new Date(nowIso).getTime();

    let updatedSession: LiveSessionDocument | null = null;

    await db.runTransaction(async (t) => {
      const doc = await t.get(sessionRef);
      if (!doc.exists) {
        throw new NotFoundError(`Live session '${id}' not found`);
      }
      const data = doc.data() as LiveSessionDocument;

      if (data.status === 'completed') {
        throw new BadRequestError('Cannot start an already completed live session', 'SESSION_COMPLETED');
      }

      let expiresAt: string | null = null;
      if (data.timeLimitEnabled && data.activityTimeLimitSeconds && data.activityTimeLimitSeconds > 0) {
        expiresAt = new Date(nowMs + data.activityTimeLimitSeconds * 1000).toISOString();
      }

      const updates = {
        status: 'live' as const,
        startedAt: nowIso,
        expiresAt,
        currentQuestionIndex: 0,
        updatedAt: nowIso,
      };

      t.update(sessionRef, updates);
      updatedSession = { ...data, ...updates };
    });

    return updatedSession!;
  }

  async setQuestionIndex(id: string, questionIndex: number, _operator?: AuthOperator): Promise<LiveSessionDocument> {
    const session = await this.getById(id);
    if (session.status !== 'live') {
      throw new BadRequestError('Session must be live to change question index', 'SESSION_NOT_LIVE');
    }

    const updatedAt = getClock().nowIso();
    await this.col.doc(id).update({
      currentQuestionIndex: questionIndex,
      updatedAt,
    });

    return { ...session, currentQuestionIndex: questionIndex, updatedAt };
  }

  async nextQuestion(id: string, operator?: AuthOperator): Promise<LiveSessionDocument> {
    const session = await this.getById(id);
    return this.setQuestionIndex(id, session.currentQuestionIndex + 1, operator);
  }

  async end(id: string, _operator?: AuthOperator): Promise<LiveSessionDocument> {
    const session = await this.getById(id);
    const nowIso = getClock().nowIso();

    await this.col.doc(id).update({
      status: 'completed',
      endedAt: nowIso,
      updatedAt: nowIso,
    });

    return { ...session, status: 'completed', endedAt: nowIso, updatedAt: nowIso };
  }

  async joinParticipant(id: string, input: JoinLiveSessionInput): Promise<LiveParticipantDocument> {
    const session = await this.getById(id);
    if (session.status === 'completed') {
      throw new BadRequestError('Cannot join a completed live session', 'SESSION_COMPLETED');
    }

    const participantsCol = this.getParticipantsCol(id);
    const nowIso = getClock().nowIso();
    const participantId = input.participantId || participantsCol.doc().id;

    const participantData: LiveParticipantDocument = {
      id: participantId,
      displayName: input.displayName,
      participantCode: input.participantCode || '',
      joinedAt: nowIso,
      status: session.status === 'lobby' ? 'joined' : 'active',
      attemptId: null,
      lastSeenAt: nowIso,
    };

    await participantsCol.doc(participantId).set(participantData, { merge: true });
    return participantData;
  }

  async heartbeatParticipant(
    id: string,
    input: LiveParticipantHeartbeatInput
  ): Promise<{ acknowledged: boolean }> {
    const docRef = this.getParticipantsCol(id).doc(input.participantId);
    const nowIso = getClock().nowIso();

    await docRef.update({
      status: input.status || 'active',
      lastSeenAt: nowIso,
    });

    return { acknowledged: true };
  }

  async listParticipants(id: string): Promise<LiveParticipantDocument[]> {
    const snap = await this.getParticipantsCol(id).orderBy('joinedAt', 'asc').get();
    return snap.docs.map((d) => d.data() as LiveParticipantDocument);
  }
}

export const liveSessionsService = new LiveSessionsService();
