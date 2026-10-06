import { db } from '../../config/firebase';
import { NotFoundError, ConflictError, ForbiddenError, BadRequestError } from '../../lib/errors';
import { CreateAssessmentInput, UpdateAssessmentInput } from './assessments.schema';
import { getClock } from '../../lib/clock';
import { AuthOperator } from '../../middleware/auth.middleware';

export interface AssessmentDocument {
  id: string;
  slug: string;
  title: string;
  description: string;
  mode: string;
  presentationMode: string;
  status: string;
  timeLimitEnabled: boolean;
  activityTimeLimitSeconds: number | null;
  leaderboardEnabled: boolean;
  scoreVisible?: boolean;
  rankVisible?: boolean;
  blocks: any[];
  questions?: any[];
  settings: Record<string, any>;
  bannerUrl?: string | null;
  coverImage?: string | null;
  ownerId: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  participantCount: number;
  averageScore: number;
  completionRate: number;
}

export class AssessmentsService {
  private get col() {
    return db.collection('assessments');
  }

  async assertUniqueSlug(slug: string, excludeId?: string): Promise<void> {
    const snap = await this.col.where('slug', '==', slug).limit(1).get();
    if (!snap.empty && snap.docs[0].id !== excludeId) {
      throw new ConflictError(`Assessment with slug '${slug}' already exists`);
    }
  }

  private generateSlug(title: string): string {
    const base = title
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');
    const rand = Math.random().toString(36).substring(2, 6);
    return `${base || 'assessment'}-${rand}`;
  }

  private validateNoBase64Banner(bannerUrl?: string | null): void {
    if (bannerUrl && bannerUrl.startsWith('data:')) {
      throw new BadRequestError(
        'Base64 image blobs are not allowed in assessment records. Please upload image via storage service.',
        'BASE64_NOT_ALLOWED'
      );
    }
  }

  async create(input: CreateAssessmentInput, operator: AuthOperator): Promise<AssessmentDocument> {
    const slug = input.slug?.trim() || this.generateSlug(input.title);
    await this.assertUniqueSlug(slug);

    this.validateNoBase64Banner(input.bannerUrl);

    const now = getClock().nowIso();
    const docRef = input.id ? this.col.doc(input.id) : this.col.doc();

    const blocks = input.blocks || input.questions || [];

    const assessment: AssessmentDocument = {
      id: docRef.id,
      slug,
      title: input.title.trim(),
      description: input.description || '',
      mode: input.mode || 'quiz',
      presentationMode: input.presentationMode || 'formal',
      status: input.status || 'draft',
      timeLimitEnabled: Boolean(input.timeLimitEnabled),
      activityTimeLimitSeconds: input.activityTimeLimitSeconds ?? null,
      leaderboardEnabled: input.leaderboardEnabled !== false,
      scoreVisible: input.scoreVisible !== false,
      rankVisible: input.rankVisible !== false,
      blocks,
      questions: blocks,
      settings: input.settings || {},
      bannerUrl: input.bannerUrl ?? null,
      coverImage: input.coverImage ?? null,
      // Backend owns ownerId and createdBy; ignore client-provided values
      ownerId: operator.uid,
      createdBy: operator.username || operator.uid,
      createdAt: now,
      updatedAt: now,
      participantCount: 0,
      averageScore: 0,
      completionRate: 0,
    };

    await docRef.set(assessment);
    return assessment;
  }

  async list(operator: AuthOperator, limit = 50, cursor?: string): Promise<{ items: AssessmentDocument[]; nextCursor: string | null }> {
    const pageLimit = Math.min(100, Math.max(1, limit));
    let query: FirebaseFirestore.Query = this.col;

    const isAdmin =
      operator.platformRole === 'platform_owner' ||
      operator.role === 'crown' ||
      operator.role === 'owner';

    // Dashboard queries are owner-scoped for regular operators
    if (!isAdmin) {
      query = query.where('ownerId', '==', operator.uid);
    }

    query = query.orderBy('createdAt', 'desc').limit(pageLimit + 1);

    if (cursor) {
      const cursorDoc = await this.col.doc(cursor).get();
      if (cursorDoc.exists) {
        query = query.startAfter(cursorDoc);
      }
    }

    const snap = await query.get();
    const docs = snap.docs;
    const hasMore = docs.length > pageLimit;
    const finalDocs = hasMore ? docs.slice(0, pageLimit) : docs;
    const nextCursor = hasMore ? finalDocs[finalDocs.length - 1].id : null;

    const items = finalDocs.map((d) => ({
      id: d.id,
      ...d.data(),
    })) as AssessmentDocument[];

    return { items, nextCursor };
  }

  async getById(id: string, operator: AuthOperator): Promise<AssessmentDocument> {
    const doc = await this.col.doc(id).get();
    if (!doc.exists) {
      throw new NotFoundError(`Assessment with id '${id}' not found`);
    }

    const data = doc.data() as AssessmentDocument;
    const isAdmin =
      operator.platformRole === 'platform_owner' ||
      operator.role === 'crown' ||
      operator.role === 'owner';

    if (!isAdmin && data.ownerId && data.ownerId !== operator.uid) {
      throw new ForbiddenError('Forbidden: You do not own this assessment');
    }

    return { ...data, id: doc.id };
  }

  async update(id: string, input: UpdateAssessmentInput, operator: AuthOperator): Promise<AssessmentDocument> {
    const current = await this.getById(id, operator);

    if (input.slug && input.slug !== current.slug) {
      await this.assertUniqueSlug(input.slug, id);
    }

    this.validateNoBase64Banner(input.bannerUrl);

    const now = getClock().nowIso();
    const updates: Record<string, any> = {
      updatedAt: now,
    };

    if (input.title !== undefined) updates.title = input.title.trim();
    if (input.description !== undefined) updates.description = input.description;
    if (input.slug !== undefined) updates.slug = input.slug.trim();
    if (input.mode !== undefined) updates.mode = input.mode;
    if (input.presentationMode !== undefined) updates.presentationMode = input.presentationMode;
    if (input.status !== undefined) updates.status = input.status;
    if (input.timeLimitEnabled !== undefined) updates.timeLimitEnabled = input.timeLimitEnabled;
    if (input.activityTimeLimitSeconds !== undefined) updates.activityTimeLimitSeconds = input.activityTimeLimitSeconds;
    if (input.leaderboardEnabled !== undefined) updates.leaderboardEnabled = input.leaderboardEnabled;
    if (input.scoreVisible !== undefined) updates.scoreVisible = input.scoreVisible;
    if (input.rankVisible !== undefined) updates.rankVisible = input.rankVisible;
    if (input.bannerUrl !== undefined) updates.bannerUrl = input.bannerUrl;
    if (input.coverImage !== undefined) updates.coverImage = input.coverImage;

    if (input.settings !== undefined) {
      updates.settings = { ...current.settings, ...input.settings };
    }

    const newBlocks = input.blocks || input.questions;
    if (newBlocks !== undefined) {
      updates.blocks = newBlocks;
      updates.questions = newBlocks;
    }

    // Never allow updating ownerId, createdBy, or createdAt
    delete updates.ownerId;
    delete updates.createdBy;
    delete updates.createdAt;

    await this.col.doc(id).update(updates);

    return {
      ...current,
      ...updates,
    };
  }

  async delete(id: string, operator: AuthOperator): Promise<void> {
    await this.getById(id, operator); // Validates existence and ownership
    await this.col.doc(id).delete();
  }

  /**
   * Public participant assessment endpoint: Strips all answer keys, isCorrect flags,
   * internal scoring rules, owner/operator metadata, and private settings.
   */
  async getBySlugPublic(slug: string): Promise<Record<string, any>> {
    const snap = await this.col.where('slug', '==', slug).limit(1).get();
    if (snap.empty) {
      throw new NotFoundError(`Assessment with slug '${slug}' not found`);
    }

    const doc = snap.docs[0];
    const data = doc.data() as AssessmentDocument;

    // Sanitize question blocks: Strip isCorrect and internal scoring details
    const rawBlocks = data.blocks || data.questions || [];
    const publicBlocks = rawBlocks.map((block: any) => {
      const sanitizedChoices = (block.choices || block.options || []).map((c: any) => ({
        id: c.id,
        body: c.body,
        order: c.order,
      }));

      return {
        id: block.id,
        type: block.type,
        title: block.title || '',
        body: block.body || '',
        description: block.description || '',
        choices: sanitizedChoices,
        options: sanitizedChoices,
        timeLimitSeconds: block.timeLimitSeconds ?? null,
        allowMultiple: block.allowMultiple,
        order: block.order,
        category: block.category,
        imageUrl: block.imageUrl || null,
        points: block.points, // Points per question are public so participants know worth
      };
    });

    // Strip private settings (e.g. requireAuth, internal flags)
    const publicSettings = {
      showLeaderboard: data.settings?.showLeaderboard ?? data.leaderboardEnabled ?? true,
      showScore: data.settings?.showScore ?? data.scoreVisible ?? true,
      showTimer: data.settings?.showTimer ?? data.timeLimitEnabled ?? true,
      soundEnabled: data.settings?.soundEnabled ?? true,
      allowBackNavigation: data.settings?.allowBackNavigation ?? true,
      themeStyle: data.settings?.themeStyle,
    };

    return {
      id: doc.id,
      slug: data.slug,
      title: data.title,
      description: data.description,
      mode: data.mode,
      presentationMode: data.presentationMode,
      status: data.status,
      timeLimitEnabled: data.timeLimitEnabled,
      activityTimeLimitSeconds: data.activityTimeLimitSeconds,
      leaderboardEnabled: data.leaderboardEnabled,
      scoreVisible: data.scoreVisible,
      rankVisible: data.rankVisible,
      blocks: publicBlocks,
      questions: publicBlocks,
      settings: publicSettings,
      bannerUrl: data.bannerUrl || null,
      coverImage: data.coverImage || null,
      participantCount: data.participantCount || 0,
      // Omit ownerId, createdBy, averageScore, completionRate
    };
  }
}

export const assessmentsService = new AssessmentsService();
