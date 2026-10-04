import { db } from '../../config/firebase';
import { NotFoundError, ConflictError } from '../../lib/errors';
import { CreateQuestionInput, UpdateQuestionInput, ReorderQuestionsInput, ChoiceInput } from './questions.schema';
import { storageService } from '../storage/storage.service';
import { getClock } from '../../lib/clock';

export interface ChoiceDocument {
  id: string;
  questionId: string;
  body: string;
  position: number;
  isCorrect?: boolean;
}

export interface QuestionWithChoices {
  id: string;
  activityId: string;
  body: string;
  richText?: unknown;
  type: string;
  position: number;
  weight: number;
  speedBonusEnabled: boolean;
  speedBonusPercent: number;
  timeReferenceSeconds: number;
  imagePath?: string | null;
  imageUrl?: string | null;
  comparisonKey?: string | null;
  createdAt: string;
  updatedAt: string;
  choices: ChoiceDocument[];
}

export class QuestionsService {
  private questionsCol = db.collection('questions');
  private choicesCol = db.collection('choices');
  private attemptsCol = db.collection('attempts');

  private async saveChoices(questionId: string, choices: ChoiceInput[]): Promise<ChoiceDocument[]> {
    const batch = db.batch();
    const results: ChoiceDocument[] = [];

    choices.forEach((c, idx) => {
      const ref = c.id ? this.choicesCol.doc(c.id) : this.choicesCol.doc();
      const choiceDoc: ChoiceDocument = {
        id: ref.id,
        questionId,
        body: c.body,
        position: c.position ?? idx,
        isCorrect: c.isCorrect,
      };
      batch.set(ref, choiceDoc);
      results.push(choiceDoc);
    });

    await batch.commit();
    return results;
  }

  async create(activityId: string, input: CreateQuestionInput): Promise<QuestionWithChoices> {
    if (input.comparisonKey) {
      const existing = await this.questionsCol
        .where('activityId', '==', activityId)
        .where('comparisonKey', '==', input.comparisonKey)
        .limit(1)
        .get();
      if (!existing.empty) {
        throw new ConflictError(
          `Question with comparisonKey '${input.comparisonKey}' already exists in this activity`,
          'DUPLICATE_COMPARISON_KEY'
        );
      }
    }

    const countSnap = await this.questionsCol.where('activityId', '==', activityId).get();
    const nextPosition = input.position ?? countSnap.size;
    const now = getClock().nowIso();
    const qRef = this.questionsCol.doc();

    const qDoc = {
      id: qRef.id,
      activityId,
      body: input.body,
      richText: input.richText || [],
      type: input.type,
      position: nextPosition,
      weight: input.weight,
      speedBonusEnabled: input.speedBonusEnabled,
      speedBonusPercent: input.speedBonusPercent,
      timeReferenceSeconds: input.timeReferenceSeconds,
      imagePath: input.imagePath || null,
      comparisonKey: input.comparisonKey || null,
      createdAt: now,
      updatedAt: now,
    };

    await qRef.set(qDoc);
    const savedChoices = await this.saveChoices(qRef.id, input.choices);
    return { ...qDoc, choices: savedChoices };
  }

  async getByActivityId(activityId: string, isPublic = false): Promise<QuestionWithChoices[]> {
    const qSnap = await this.questionsCol.where('activityId', '==', activityId).get();
    const questions = qSnap.docs.map((d) => d.data() as any);
    questions.sort((a, b) => a.position - b.position);

    const results: QuestionWithChoices[] = [];
    for (const q of questions) {
      const cSnap = await this.choicesCol.where('questionId', '==', q.id).get();
      const choices = cSnap.docs.map((d) => d.data() as ChoiceDocument);
      choices.sort((a, b) => a.position - b.position);

      const sanitizedChoices = isPublic ? choices.map(({ isCorrect, ...rest }) => rest) : choices;
      let imageUrl: string | null = null;
      if (q.imagePath) {
        imageUrl = await storageService.getSignedReadUrl(q.imagePath);
      }

      results.push({ ...q, imageUrl, choices: sanitizedChoices });
    }

    return results;
  }

  async getById(id: string, isPublic = false): Promise<QuestionWithChoices> {
    const doc = await this.questionsCol.doc(id).get();
    if (!doc.exists) throw new NotFoundError(`Question with id '${id}' not found`);
    const q = doc.data() as any;

    const cSnap = await this.choicesCol.where('questionId', '==', id).get();
    const choices = cSnap.docs.map((d) => d.data() as ChoiceDocument);
    choices.sort((a, b) => a.position - b.position);

    const sanitizedChoices = isPublic ? choices.map(({ isCorrect, ...rest }) => rest) : choices;
    let imageUrl: string | null = null;
    if (q.imagePath) {
      imageUrl = await storageService.getSignedReadUrl(q.imagePath);
    }

    return { ...q, imageUrl, choices: sanitizedChoices };
  }

  private async assertCanModifyQuestion(activityId: string, input: UpdateQuestionInput): Promise<void> {
    const attemptsSnap = await this.attemptsCol.where('activityId', '==', activityId).limit(1).get();
    if (attemptsSnap.empty) return;

    const isScoringFieldPresent =
      input.weight !== undefined ||
      input.choices !== undefined ||
      input.speedBonusEnabled !== undefined ||
      input.speedBonusPercent !== undefined ||
      input.timeReferenceSeconds !== undefined;

    if (isScoringFieldPresent) {
      throw new ConflictError(
        'Question scoring-affecting fields are locked because attempts exist for this activity',
        'QUESTION_LOCKED'
      );
    }
  }

  async update(id: string, input: UpdateQuestionInput): Promise<QuestionWithChoices> {
    const current = await this.getById(id);
    await this.assertCanModifyQuestion(current.activityId, input);

    if (input.comparisonKey && input.comparisonKey !== current.comparisonKey) {
      const existing = await this.questionsCol
        .where('activityId', '==', current.activityId)
        .where('comparisonKey', '==', input.comparisonKey)
        .limit(1)
        .get();
      if (!existing.empty && existing.docs[0].id !== id) {
        throw new ConflictError(
          `Question with comparisonKey '${input.comparisonKey}' already exists in this activity`,
          'DUPLICATE_COMPARISON_KEY'
        );
      }
    }

    const now = getClock().nowIso();
    const { choices, ...qData } = input;
    await this.questionsCol.doc(id).update({ ...qData, updatedAt: now });

    if (choices && choices.length > 0) {
      const oldChoices = await this.choicesCol.where('questionId', '==', id).get();
      const batch = db.batch();
      oldChoices.docs.forEach((doc) => batch.delete(doc.ref));
      await batch.commit();
      await this.saveChoices(id, choices);
    }

    return this.getById(id);
  }

  async delete(id: string): Promise<void> {
    const current = await this.getById(id);
    const attemptsSnap = await this.attemptsCol.where('activityId', '==', current.activityId).limit(1).get();
    if (!attemptsSnap.empty) {
      throw new ConflictError('Cannot delete question because attempts exist for this activity', 'QUESTION_LOCKED');
    }

    const choicesSnap = await this.choicesCol.where('questionId', '==', id).get();
    const batch = db.batch();
    choicesSnap.docs.forEach((d) => batch.delete(d.ref));
    batch.delete(this.questionsCol.doc(id));
    await batch.commit();
  }

  async reorder(input: ReorderQuestionsInput): Promise<void> {
    const batch = db.batch();
    const now = getClock().nowIso();
    input.items.forEach((item) => {
      const ref = this.questionsCol.doc(item.id);
      batch.update(ref, { position: item.position, updatedAt: now });
    });
    await batch.commit();
  }
}

export const questionsService = new QuestionsService();
