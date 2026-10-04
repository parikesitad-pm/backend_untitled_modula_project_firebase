import { db } from '../../config/firebase';
import { NotFoundError } from '../../lib/errors';
import { ParticipantInput } from './participants.schema';

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
    const snap = await this.col
      .where('activityId', '==', activityId)
      .where('participantCode', '==', input.participantCode)
      .limit(1)
      .get();

    const now = new Date().toISOString();

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
      return { id: doc.id, activityId, ...payload, createdAt: doc.data().createdAt, participantCode: input.participantCode } as ParticipantDocument;
    }

    const docRef = this.col.doc();
    const docData: ParticipantDocument = {
      id: docRef.id,
      activityId,
      name: input.name,
      participantCode: input.participantCode,
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

  async getById(id: string): Promise<ParticipantDocument> {
    const doc = await this.col.doc(id).get();
    if (!doc.exists) {
      throw new NotFoundError(`Participant with id '${id}' not found`);
    }
    return { id: doc.id, ...doc.data() } as ParticipantDocument;
  }
}

export const participantsService = new ParticipantsService();
