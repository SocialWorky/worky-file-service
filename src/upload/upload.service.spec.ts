import { BadRequestException } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';

// --- Sharp mock -----------------------------------------------------------
// Each clone() call returns a chainable instance. toFile resolves immediately,
// toBuffer resolves with a 32×32 RGBA buffer (4096 bytes of value 128).
const BLUR_BUFFER = Buffer.alloc(32 * 32 * 4, 128);

const buildClone = () => ({
  resize: jest.fn().mockReturnThis(),
  jpeg: jest.fn().mockReturnThis(),
  webp: jest.fn().mockReturnThis(),
  raw: jest.fn().mockReturnThis(),
  ensureAlpha: jest.fn().mockReturnThis(),
  toFile: jest.fn().mockResolvedValue({ width: 200, height: 150, size: 10000 }),
  toBuffer: jest.fn().mockResolvedValue(BLUR_BUFFER),
  stats: jest.fn().mockResolvedValue({ channels: [{ mean: 50 }] }),
});

const mockSharpBase = {
  rotate: jest.fn().mockReturnThis(),
  metadata: jest.fn().mockResolvedValue({ width: 1920, height: 1080 }),
  clone: jest.fn(() => buildClone()),
  stats: jest.fn().mockResolvedValue({ channels: [{ mean: 50 }] }),
};

const mockSharpFn = jest.fn(() => mockSharpBase);

jest.mock('sharp', () => mockSharpFn);

// --- BlurHash mock --------------------------------------------------------
const MOCK_BLUR_HASH = 'LKO2:N%2Tw=w]~RBVZRi};RPxuwH';
jest.mock('blurhash', () => ({ encode: jest.fn().mockReturnValue(MOCK_BLUR_HASH) }));

// --- FFmpeg / FFmpeg installer mocks -------------------------------------
jest.mock('fluent-ffmpeg', () => {
  const m: any = jest.fn(() => ({ outputOptions: jest.fn().mockReturnThis(), output: jest.fn().mockReturnThis(), on: jest.fn().mockReturnThis(), run: jest.fn() }));
  m.setFfmpegPath = jest.fn();
  return m;
});
jest.mock('@ffmpeg-installer/ffmpeg', () => ({ path: '/usr/bin/ffmpeg' }));
jest.mock('child_process', () => ({ execFile: jest.fn() }));

// --- Imports after mocks --------------------------------------------------
import { UploadService } from './upload.service';
import { StorageService } from '../storage/storage.service';
import { DedupService } from '../dedup/dedup.service';
import { encode as encodeBlurHash } from 'blurhash';

// ---------------------------------------------------------------------------

const makeStorageService = (): jest.Mocked<StorageService> =>
  ({
    uploadFile: jest.fn().mockResolvedValue({ objectName: 'dest/file.jpg' }),
    deleteFile: jest.fn().mockResolvedValue(undefined),
    getPresignedUrl: jest.fn().mockResolvedValue('http://minio/presigned'),
  } as any);

const makeDedupService = (): jest.Mocked<DedupService> =>
  ({
    computeHash: jest.fn().mockResolvedValue('abc123hash'),
    getCached: jest.fn().mockResolvedValue(null),
    setCached: jest.fn().mockResolvedValue(undefined),
  } as any);

// ---------------------------------------------------------------------------

describe('UploadService', () => {
  let service: UploadService;
  let storageService: jest.Mocked<StorageService>;
  let dedupService: jest.Mocked<DedupService>;

  const FAKE_DIR = '/tmp/uploads/publications';
  const FAKE_FILE: Express.Multer.File = {
    fieldname: 'files',
    originalname: 'photo.jpg',
    encoding: '7bit',
    mimetype: 'image/jpeg',
    size: 204800,
    destination: FAKE_DIR,
    filename: 'user1-2026-01-01T00-00-00-abc.jpg',
    path: path.join(FAKE_DIR, 'user1-2026-01-01T00-00-00-abc.jpg'),
    buffer: Buffer.alloc(0),
    stream: null as any,
  };

  beforeEach(() => {
    jest.clearAllMocks();

    storageService = makeStorageService();
    dedupService = makeDedupService();
    service = new UploadService(storageService, dedupService);

    // Default: original file exists so uploadToStorage can try it
    jest.spyOn(fs, 'existsSync').mockReturnValue(true);
    jest.spyOn(fs, 'unlinkSync').mockReturnValue(undefined);
    jest.spyOn(fs.promises, 'unlink').mockResolvedValue(undefined);
  });

  // --- optimizeImage (accessed via processFile) -------------------------

  describe('optimizeImage', () => {
    it('generates 8 variant filenames and a blurHash string', async () => {
      const result = await (service as any).optimizeImage(FAKE_FILE.path);

      expect(result).toMatchObject({
        thumbnail: expect.stringMatching(/^thumbnail-.+\.jpg$/),
        thumbnailWebp: expect.stringMatching(/^thumbnail-.+\.webp$/),
        preview: expect.stringMatching(/^preview-.+\.jpg$/),
        previewWebp: expect.stringMatching(/^preview-.+\.webp$/),
        compressed: expect.stringMatching(/^compressed-.+\.jpg$/),
        compressedWebp: expect.stringMatching(/^compressed-.+\.webp$/),
        full: expect.stringMatching(/^full-.+\.jpg$/),
        fullWebp: expect.stringMatching(/^full-.+\.webp$/),
        blurHash: MOCK_BLUR_HASH,
      });
    });

    it('calls 8 toFile pipelines and 1 toBuffer pipeline', async () => {
      await (service as any).optimizeImage(FAKE_FILE.path);

      // Sharp called twice: once for metadata(), once for the processing pipeline
      expect(mockSharpFn).toHaveBeenCalledTimes(2);

      // 9 clone() calls: 8 for file output + 1 for BlurHash buffer
      expect(mockSharpBase.clone).toHaveBeenCalledTimes(9);
    });

    it('calls BlurHash encode with 32×32 RGBA buffer and components 4×3', async () => {
      await (service as any).optimizeImage(FAKE_FILE.path);

      expect(encodeBlurHash).toHaveBeenCalledWith(
        expect.any(Uint8ClampedArray),
        32,
        32,
        4,
        3,
      );
    });

    it('does not call withMetadata() — EXIF stripping is the Sharp default', async () => {
      await (service as any).optimizeImage(FAKE_FILE.path);

      // Verify withMetadata is never called on any Sharp instance or clone
      const sharpInstance = mockSharpFn.mock.results[0]?.value;
      expect(sharpInstance?.withMetadata).toBeUndefined();
    });

    it('rejects images exceeding 100 megapixels', async () => {
      mockSharpBase.metadata.mockResolvedValueOnce({ width: 15000, height: 10000 }); // 150MP

      await expect((service as any).optimizeImage(FAKE_FILE.path)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('accepts images exactly at the 100MP limit', async () => {
      mockSharpBase.metadata.mockResolvedValueOnce({ width: 10000, height: 10000 }); // exactly 100MP

      await expect((service as any).optimizeImage(FAKE_FILE.path)).resolves.toBeDefined();
    });
  });

  // --- processFile deduplication ----------------------------------------

  describe('processFile — deduplication', () => {
    it('returns cached result with deduplicated:true on cache hit', async () => {
      const cachedResult = {
        url: 'publications/compressed-abc.jpg',
        urlCompressed: 'publications/compressed-abc.jpg',
        urlThumbnail: 'publications/thumbnail-abc.jpg',
        originalname: 'photo.jpg',
        filename: 'abc.jpg',
      };
      dedupService.getCached.mockResolvedValueOnce(cachedResult);
      jest.spyOn(fs.promises, 'unlink').mockResolvedValue(undefined);

      const result = await service.processFile(FAKE_FILE, 'user1', 'publications');

      expect(result.deduplicated).toBe(true);
      expect(result.url).toBe(cachedResult.url);
      // StorageService must NOT be called — no re-upload
      expect(storageService.uploadFile).not.toHaveBeenCalled();
    });

    it('computes SHA-256 hash before any processing', async () => {
      // Cache miss → proceeds with processing
      dedupService.getCached.mockResolvedValueOnce(null);

      await service.processFile(FAKE_FILE, 'user1', 'publications');

      expect(dedupService.computeHash).toHaveBeenCalledWith(FAKE_FILE.path);
      // computeHash must be called before uploadFile
      const computeOrder = dedupService.computeHash.mock.invocationCallOrder[0];
      const uploadOrder = storageService.uploadFile.mock.invocationCallOrder[0];
      expect(computeOrder).toBeLessThan(uploadOrder);
    });

    it('calls setCached after successful processing', async () => {
      dedupService.getCached.mockResolvedValueOnce(null);

      await service.processFile(FAKE_FILE, 'user1', 'publications');

      expect(dedupService.setCached).toHaveBeenCalledWith(
        'abc123hash',
        'publications',
        expect.objectContaining({ deduplicated: false }),
      );
    });

    it('does NOT call setCached when processing throws', async () => {
      dedupService.getCached.mockResolvedValueOnce(null);
      // Force optimizeFile to fail by making Sharp metadata throw
      mockSharpBase.metadata.mockRejectedValueOnce(new Error('Sharp error'));

      await expect(
        service.processFile(FAKE_FILE, 'user1', 'publications'),
      ).rejects.toThrow('Sharp error');

      expect(dedupService.setCached).not.toHaveBeenCalled();
    });

    it('returns deduplicated:false on first successful upload', async () => {
      dedupService.getCached.mockResolvedValueOnce(null);

      const result = await service.processFile(FAKE_FILE, 'user1', 'publications');

      expect(result.deduplicated).toBe(false);
    });
  });

  // --- processFile response shape ---------------------------------------

  describe('processFile — response shape', () => {
    beforeEach(() => {
      dedupService.getCached.mockResolvedValue(null);
    });

    it('preserves all original fields for backward compatibility', async () => {
      const result = await service.processFile(FAKE_FILE, 'user1', 'publications');

      expect(result).toMatchObject({
        originalname: FAKE_FILE.originalname,
        filename: FAKE_FILE.filename,
      });
      // Primary URL fallback chain must resolve
      expect(result.url).toBeDefined();
    });

    it('includes blurHash in result', async () => {
      const result = await service.processFile(FAKE_FILE, 'user1', 'publications');
      expect(result.blurHash).toBe(MOCK_BLUR_HASH);
    });

    it('includes urlThumbnailWebP and urlCompressedWebP in result', async () => {
      const result = await service.processFile(FAKE_FILE, 'user1', 'publications');
      expect(result.urlThumbnailWebP).toBeDefined();
      expect(result.urlCompressedWebP).toBeDefined();
    });

    it('includes urlPreview and urlFull in result', async () => {
      const result = await service.processFile(FAKE_FILE, 'user1', 'publications');
      expect(result.urlPreview).toBeDefined();
      expect(result.urlFull).toBeDefined();
    });
  });
});
