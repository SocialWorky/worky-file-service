// file-worker.js
import sharp from 'sharp';
import ffmpeg from 'fluent-ffmpeg';
import { path as ffmpegPath } from '@ffmpeg-installer/ffmpeg';
import fs from 'fs';
import path from 'path';

ffmpeg.setFfmpegPath(ffmpegPath);

process.on('message', async ({ filePath, fileType }) => {
  try {
    if (fileType === 'image') {
      await optimizeImage(filePath);
    } else if (fileType === 'video') {
      await optimizeVideo(filePath);
    }
    process.send({ success: true });
  } catch (error) {
    process.send({ success: false, error: error.message });
  }
});

async function optimizeImage(filePath) {
  const directory = path.dirname(filePath);
  const ext = path.extname(filePath);
  const basename = path.basename(filePath, ext);

  const compressedPath = path.join(directory, `compressed|${basename}${ext}`);
  const thumbnailPath = path.join(directory, `thumbnail|${basename}${ext}`);

  await sharp(filePath).resize({ width: 800 }).toFile(compressedPath);
  await sharp(filePath).resize({ width: 200 }).toFile(thumbnailPath);
}

function optimizeVideo(filePath) {
  const directory = path.dirname(filePath);
  const ext = path.extname(filePath);
  const basename = path.basename(filePath, ext);
  const optimizedPath = path.join(directory, `worky|${basename}.mp4`);

  return new Promise((resolve, reject) => {
    ffmpeg(filePath)
      .outputOptions([
        '-c:v libx264',
        '-crf 23',
        '-preset fast',
        '-vf "scale=-2:720"',
        '-pix_fmt yuv420p',
      ])
      .output(optimizedPath)
      .on('end', () => {
        fs.unlinkSync(filePath);
        resolve();
      })
      .on('error', reject)
      .run();
  });
}
