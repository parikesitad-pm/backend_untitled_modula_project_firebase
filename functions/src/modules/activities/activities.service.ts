import { db } from '../../config/firebase';
import { NotFoundError, ConflictError, BadRequestError } from '../../lib/errors';
import { CreateActivityInput, UpdateActivityInput, ActivityQuery } from './activities.schema';

export interface ActivityDocument extends CreateActivityInput {
  id: string;
  status: 'draft' | 'published' | 'closed' | 'archived';
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export class ActivitiesService {
  private col = db.collection('activities');

  async assertUniqueSlug(slug: string, excludeId?: string): Promise<void> {
    const snap = await this.col.where('slug', '==', slug).limit(1).get();
    if (!snap.empty && snap.docs[0].id !== excludeId) {
      throw new ConflictError(`Activity with slug '${slug}' already exists`);
    }
  }

  async create(input: CreateActivityInput, createdBy: string): Promise<ActivityDocument> {
    await this.assertUniqueSlug(input.slug);
    const now = new Date().toISOString();
    const docRef = this.col.doc();

    const activity: ActivityDocument = {
      ...input,
      id: docRef.id,
      status: 'draft',
      createdBy,
      createdAt: now,
      updatedAt: now,
    };

    await docRef.set(activity);
    return activity;
  }

  async list(filter: ActivityQuery): Promise<ActivityDocument[]> {
    let query: FirebaseFirestore.Query = this.col;
    if (filter.status) query = query.where('status', '==', filter.status);
    if (filter.mode) query = query.where('mode', '==', filter.mode);
    if (filter.groupId) query = query.where('groupId', '==', filter.groupId);

    const snap = await query.get();
    return snap.docs.map((d) => ({ id: d.id, ...d.data() } as ActivityDocument));
  }

  async getById(id: string): Promise<ActivityDocument> {
    const doc = await this.col.doc(id).get();
    if (!doc.exists) {
      throw new NotFoundError(`Activity with id '${id}' not found`);
    }
    return { id: doc.id, ...doc.data() } as ActivityDocument;
  }

  async getBySlug(slug: string): Promise<ActivityDocument> {
    const snap = await this.col.where('slug', '==', slug).limit(1).get();
    if (snap.empty) {
      throw new NotFoundError(`Activity with slug '${slug}' not found`);
    }
    const doc = snap.docs[0];
    return { id: doc.id, ...doc.data() } as ActivityDocument;
  }

  async update(id: string, input: UpdateActivityInput): Promise<ActivityDocument> {
    const current = await this.getById(id);

    if (input.slug && input.slug !== current.slug) {
      await this.assertUniqueSlug(input.slug, id);
    }

    const opens = input.opensAt || current.opensAt;
    const closes = input.closesAt || current.closesAt;
    if (new Date(opens).getTime() >= new Date(closes).getTime()) {
      throw new BadRequestError('opensAt must be earlier than closesAt');
    }

    const updatedAt = new Date().toISOString();
    const payload = { ...input, updatedAt };

    await this.col.doc(id).update(payload);
    return this.getById(id);
  }

  async delete(id: string): Promise<void> {
    await this.getById(id);
    await this.col.doc(id).delete();
  }

  async publish(id: string): Promise<ActivityDocument> {
    await this.getById(id);
    await this.col.doc(id).update({
      status: 'published',
      updatedAt: new Date().toISOString(),
    });
    return this.getById(id);
  }

  async close(id: string): Promise<ActivityDocument> {
    await this.getById(id);
    await this.col.doc(id).update({
      status: 'closed',
      updatedAt: new Date().toISOString(),
    });
    return this.getById(id);
  }
}

export const activitiesService = new ActivitiesService();
