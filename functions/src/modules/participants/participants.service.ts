import { db } from '../../config/firebase';
import { NotFoundError } from '../../lib/errors';
import { ParticipantInput, normalizeParticipantCode } from './participants.schema';
import { getClock } from '../../lib/clock';

export interface ParticipantDocument {
  id: string;
  activityId: string;
  name: string;
  participantCode: string;
  email?: string | null;
  division?: string | null;
  customFields?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export class ParticipantsService {
  private col = db.collection('participants');

  async findOrCreate(activityId: string, input: ParticipantInput): Promise<ParticipantDocument> {
    const code = normalizeParticipantCode(input.participantCode);
    const snap = await this.col
      .where('activityId', '==', activityId)
      .where('participantCode', '==', code)
      .limit(1)
      .get();

    const now = getClock().nowIso();

    if (!snap.empty) {
      const doc = snap.docs[0];
      const payload = {
        name: input.name,
        email: input.email || null,
        division: input.division || null,
        customFields: input.customFields || {},
        updatedAt: now,
      };
      await doc.ref.update(payload);
      return { id: doc.id, activityId, ...payload, createdAt: doc.data().createdAt, participantCode: code } as ParticipantDocument;
    }

    const docRef = this.col.doc();
    const docData: ParticipantDocument = {
      id: docRef.id,
      activityId,
      name: input.name,
      participantCode: code,
      email: input.email || null,
      division: input.division || null,
      customFields: input.customFields || {},
      createdAt: now,
      updatedAt: now,
    };

    await docRef.set(docData);
    return docData;
  }

  async getByActivityId(activityId: string): Promise<ParticipantDocument[]> {
    const snap = await this.col.where('activityId', '==', activityId).get();
    return snap.docs.map((d) => ({ id: d.id, ...d.data() } as ParticipantDocument));
  }

  async listByActivityId(
    activityId: string,
    limit = 50,
    cursor?: string
  ): Promise<{ items: ParticipantDocument[]; meta: { limit: number; nextCursor: string | null } }> {
    const pageLimit = Math.min(200, Math.max(1, limit));
    let query = this.col
      .where('activityId', '==', activityId)
      .orderBy('createdAt', 'asc')
      .limit(pageLimit + 1);

    if (cursor) {
      const cursorDoc = await this.col.doc(cursor).get();
      if (cursorDoc.exists) {
        query = query.startAfter(cursorDoc);
      }
    }

    const snap = await query.get();
    const hasMore = snap.docs.length > pageLimit;
    const docs = hasMore ? snap.docs.slice(0, pageLimit) : snap.docs;
    const nextCursor = hasMore ? docs[docs.length - 1].id : null;

    const items = docs.map((d) => ({ id: d.id, ...d.data() } as ParticipantDocument));
    return { items, meta: { limit: pageLimit, nextCursor } };
  }

  async getById(id: string): Promise<ParticipantDocument> {
    const doc = await this.col.doc(id).get();
    if (!doc.exists) {
      throw new NotFoundError(`Participant with id '${id}' not found`);
    }
    return { id: doc.id, ...doc.data() } as ParticipantDocument;
  }
}

export const participantsService = new ParticipantsService();
