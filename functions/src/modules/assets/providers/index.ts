import { AssetStorageProvider } from './asset-storage-provider';
import { CloudinaryAssetStorageProvider } from './cloudinary.provider';

export * from './asset-storage-provider';
export * from './cloudinary.provider';

let activeProvider: AssetStorageProvider | null = null;

export function getAssetStorageProvider(): AssetStorageProvider {
  if (!activeProvider) {
    activeProvider = new CloudinaryAssetStorageProvider();
  }
  return activeProvider;
}

export function setAssetStorageProvider(provider: AssetStorageProvider | null): void {
  activeProvider = provider;
}
