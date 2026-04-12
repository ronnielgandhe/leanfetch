import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const pdf = require('pdf-parse');
import mammoth from 'mammoth';

/**
 * Extract plain text from a base64-encoded document.
 * Supports: PDF, DOCX. Falls back to decoding as UTF-8 text.
 */
export async function extractText(base64Content, filename) {
  const ext = filename.toLowerCase().split('.').pop();
  const buffer = Buffer.from(base64Content, 'base64');

  if (ext === 'pdf') {
    const data = await pdf(buffer);
    return data.text;
  }

  if (ext === 'docx' || ext === 'doc') {
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
  }

  // Plain text fallback (.txt, .md, .markdown, etc.)
  return buffer.toString('utf-8');
}
