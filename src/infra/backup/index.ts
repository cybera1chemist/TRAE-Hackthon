/**
 * 备份导入导出统一出口（T5-05）—— Agent-1
 */
export {
  BACKUP_APP,
  MAX_VOLUME_BYTES,
  validateBackupPackage,
  suggestVolumeCount,
  previewImport,
  previewRestaurants,
  type BackupPackage,
  type BackupData,
  type PhotoBlobEntry,
  type PhotoVolume,
  type ImportPreview,
  type RestaurantPreview,
  type DishConflict,
  type DishDecision,
} from './format'
export {
  exportBackup,
  stringifyBackup,
  stringifyVolume,
  parseBackupText,
  isPhotoVolume,
  blobToBase64,
  base64ToBlob,
  type ExportResult,
} from './export'
export { applyBackup, type ApplyBackupOptions, type ApplyBackupResult } from './import'
