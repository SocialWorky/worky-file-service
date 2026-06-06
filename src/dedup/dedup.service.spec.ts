import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as crypto from 'crypto';
import { DedupService } from './dedup.service';

// ---------------------------------------------------------------------------
// Redis mock — ioredis is injected via 'REDIS_CLIENT' token
// ---------------------------------------------------------------------------
const mockRedis = {
  get: jest.fn(),
  set: jest.fn().mockResolvedValue('OK'),
};

function buildService(): DedupService {
  return new (DedupService as any)(mockRedis);
}

// ---------------------------------------------------------------------------

describe('DedupService', () => {
  let service: DedupService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = buildService();
  });

  // --- computeHash --------------------------------------------------------

  describe('computeHash', () => {
    it('returns a 64-character lowercase hex SHA-256 string', async () => {
      const tmpFile = path.join(os.tmpdir(), `dedup-test-${Date.now()}.bin`);
      fs.writeFileSync(tmpFile, 'hello world');

      const hash = await service.computeHash(tmpFile);

      expect(hash).toMatch(/^[a-f0-9]{64}$/);
      fs.unlinkSync(tmpFile);
    });

    it('returns the same hash for identical file content', async () => {
      const content = 'consistent content for hashing';
      const tmpA = path.join(os.tmpdir(), `dedup-a-${Date.now()}.bin`);
      const tmpB = path.join(os.tmpdir(), `dedup-b-${Date.now()}.bin`);
      fs.writeFileSync(tmpA, content);
      fs.writeFileSync(tmpB, content);

      const hashA = await service.computeHash(tmpA);
      const hashB = await service.computeHash(tmpB);

      expect(hashA).toBe(hashB);
      fs.unlinkSync(tmpA);
      fs.unlinkSync(tmpB);
    });

    it('returns different hashes for different content', async () => {
      const tmpA = path.join(os.tmpdir(), `dedup-diff-a-${Date.now()}.bin`);
      const tmpB = path.join(os.tmpdir(), `dedup-diff-b-${Date.now()}.bin`);
      fs.writeFileSync(tmpA, 'content A');
      fs.writeFileSync(tmpB, 'content B');

      const hashA = await service.computeHash(tmpA);
      const hashB = await service.computeHash(tmpB);

      expect(hashA).not.toBe(hashB);
      fs.unlinkSync(tmpA);
      fs.unlinkSync(tmpB);
    });

    it('returns the known SHA-256 value for a known input', async () => {
      const tmpFile = path.join(os.tmpdir(), `dedup-known-${Date.now()}.bin`);
      const content = 'test';
      fs.writeFileSync(tmpFile, content);

      // SHA-256 of the string "test"
      const expected = crypto.createHash('sha256').update('test').digest('hex');
      const result = await service.computeHash(tmpFile);

      expect(result).toBe(expected);
      fs.unlinkSync(tmpFile);
    });
  });

  // --- getCached ----------------------------------------------------------

  describe('getCached', () => {
    it('returns null on Redis cache miss', async () => {
      mockRedis.get.mockResolvedValueOnce(null);

      const result = await service.getCached('deadbeef', 'publications');

      expect(result).toBeNull();
      expect(mockRedis.get).toHaveBeenCalledWith('dedup:deadbeef:publications');
    });

    it('returns the parsed object on cache hit', async () => {
      const cached = { url: 'publications/file.jpg', blurHash: 'abc123' };
      mockRedis.get.mockResolvedValueOnce(JSON.stringify(cached));

      const result = await service.getCached('deadbeef', 'publications');

      expect(result).toEqual(cached);
    });

    it('returns null when cached value is invalid JSON', async () => {
      mockRedis.get.mockResolvedValueOnce('not-valid-json{{{');

      const result = await service.getCached('deadbeef', 'publications');

      expect(result).toBeNull();
    });

    it('includes hash and destination in the Redis key', async () => {
      mockRedis.get.mockResolvedValueOnce(null);

      await service.getCached('myhash', 'messages');

      expect(mockRedis.get).toHaveBeenCalledWith('dedup:myhash:messages');
    });
  });

  // --- setCached ----------------------------------------------------------

  describe('setCached', () => {
    it('calls Redis SET with the correct key format', async () => {
      await service.setCached('myhash', 'publications', { url: 'x' });

      expect(mockRedis.set).toHaveBeenCalledWith(
        'dedup:myhash:publications',
        expect.any(String),
        'EX',
        expect.any(Number),
      );
    });

    it('sets a TTL of 30 days (2592000 seconds)', async () => {
      await service.setCached('myhash', 'publications', { url: 'x' });

      const [, , , ttl] = mockRedis.set.mock.calls[0];
      expect(ttl).toBe(2_592_000);
    });

    it('serializes the result as JSON', async () => {
      const payload = { url: 'publications/file.jpg', blurHash: 'hash123' };
      await service.setCached('myhash', 'publications', payload);

      const [, serialized] = mockRedis.set.mock.calls[0];
      expect(JSON.parse(serialized)).toEqual(payload);
    });

    it('keys are destination-scoped — same hash, different destinations store independently', async () => {
      const payload = { url: 'file.jpg' };
      await service.setCached('samehash', 'publications', payload);
      await service.setCached('samehash', 'messages', payload);

      expect(mockRedis.set).toHaveBeenNthCalledWith(1, 'dedup:samehash:publications', expect.any(String), 'EX', 2_592_000);
      expect(mockRedis.set).toHaveBeenNthCalledWith(2, 'dedup:samehash:messages', expect.any(String), 'EX', 2_592_000);
    });
  });
});
