import { db } from '../../config/firebase';
import { getClock } from '../../lib/clock';
import { NotFoundError, ForbiddenError, UnprocessableEntityError } from '../../lib/errors';
import { AuthOperator } from '../../middleware/auth.middleware';
import {
  ConfirmAssetInput,
  ConfirmAssetResponse,
  MAX_ASSET_SIZE_BYTES,
  StoredAsset,
  UploadIntentInput,
  UploadIntentResponse,
} from './assets.schema';
import { getAssetStorageProvider } from './providers';

export class AssetsService {
  private activitiesCol = db.collection('activities');
  private questionsCol = db.collection('questions');

  private async assertOperatorCanAccess(
    operator: AuthOperator,
    activityId: string,
    questionId: string
  ): Promise<{ activityData: any; questionData: any; questionRef: FirebaseFirestore.DocumentReference }> {
    const activityDoc = await this.activitiesCol.doc(activityId).get();
    if (!activityDoc.exists) {
      throw new NotFoundError(`Activity '${activityId}' not found`, 'ACTIVITY_NOT_FOUND');
    }
    const activityData = activityDoc.data() as any;

    if (operator.role === 'operator' && activityData.createdBy && activityData.createdBy !== operator.uid) {
      throw new ForbiddenError('Forbidden: Not authorized to modify this activity', 'UNAUTHORIZED_ACTIVITY');
    }

    const questionRef = this.questionsCol.doc(questionId);
    const questionDoc = await questionRef.get();
    if (!questionDoc.exists) {
      throw new NotFoundError(`Question '${questionId}' not found`, 'QUESTION_NOT_FOUND');
    }
    const questionData = questionDoc.data() as any;

    if (questionData.activityId !== activityId) {
      throw new ForbiddenError(
        `Question '${questionId}' does not belong to activity '${activityId}'`,
        'QUESTION_ACTIVITY_MISMATCH'
      );
    }

    return { activityData, questionData, questionRef };
  }

  async createUploadIntent(operator: AuthOperator, input: UploadIntentInput): Promise<UploadIntentResponse> {
    await this.assertOperatorCanAccess(operator, input.activityId, input.questionId);

    const provider = getAssetStorageProvider();
    const intent = await provider.createSignedUploadIntent({
      activityId: input.activityId,
      questionId: input.questionId,
      fileName: input.fileName,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
      width: input.width,
      height: input.height,
    });

    return intent;
  }

  async confirmAsset(operator: AuthOperator, input: ConfirmAssetInput): Promise<ConfirmAssetResponse> {
    const { questionData, questionRef } = await this.assertOperatorCanAccess(
      operator,
      input.activityId,
      input.questionId
    );

    const provider = getAssetStorageProvider();

    let verifiedAsset: StoredAsset;
    try {
      verifiedAsset = await provider.verifyAsset(input.publicId);
    } catch (_err) {
      throw new UnprocessableEntityError(
        `Cloudinary asset '${input.publicId}' not found or verification failed`,
        'ASSET_NOT_FOUND'
      );
    }

    // 1. Validate format
    const format = (verifiedAsset.format || '').toLowerCase();
    if (!['jpg', 'jpeg', 'png', 'webp'].includes(format)) {
      throw new UnprocessableEntityError(`Unsupported asset format: '${format}'`, 'INVALID_ASSET_FORMAT');
    }

    // 2. Validate bytes <= policy limit
    if (verifiedAsset.bytes > MAX_ASSET_SIZE_BYTES) {
      throw new UnprocessableEntityError(
        `Asset size (${verifiedAsset.bytes} bytes) exceeds limit of ${MAX_ASSET_SIZE_BYTES} bytes`,
        'ASSET_OVERSIZE'
      );
    }

    // 3. Validate ownership/path/context
    const expectedSubpath = `activities/${input.activityId}/questions/${input.questionId}`;
    if (!verifiedAsset.assetFolder || !verifiedAsset.assetFolder.includes(expectedSubpath)) {
      throw new UnprocessableEntityError(
        `Asset folder '${verifiedAsset.assetFolder || ''}' does not match expected activity and question context`,
        'INVALID_ASSET_CONTEXT'
      );
    }

    // 4. Idempotency check: if question already has this asset confirmed, return immediately
    const currentAsset = questionData.asset as StoredAsset | undefined;
    if (currentAsset && currentAsset.publicId === verifiedAsset.publicId) {
      const deliveryUrl = provider.buildDeliveryUrl(currentAsset);
      return {
        success: true,
        asset: currentAsset,
        deliveryUrl,
      };
    }

    // 5. Build delivery URL and persist sanitized asset metadata
    const deliveryUrl = provider.buildDeliveryUrl(verifiedAsset);
    const now = getClock().nowIso();

    await questionRef.update({
      asset: verifiedAsset,
      imageUrl: deliveryUrl,
      updatedAt: now,
    });

    // 6. Delete old asset if replaced
    if (currentAsset && currentAsset.publicId && currentAsset.publicId !== verifiedAsset.publicId) {
      try {
        await provider.deleteAsset(currentAsset.publicId);
      } catch (err) {
        // Safe logging, does not abort confirmation
        console.warn('Failed to delete replaced Cloudinary asset:', err);
      }
    }

    return {
      success: true,
      asset: verifiedAsset,
      deliveryUrl,
    };
  }
}

export const assetsService = new AssetsService();
