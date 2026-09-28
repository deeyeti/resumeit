/**
 * parser.js - Resume file parser
 * Extracts text from PDF and DOCX files using pdf.js and mammoth.js (loaded via CDN).
 * Runs entirely client-side - no server upload.
 */

import { getModel } from './llm.js';

/**
 * Extract text from a PDF file using pdf.js
 */
export async function parsePDF(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = async (e) => {
      try {
        const typedArray = new Uint8Array(e.target.result);

        // pdf.js must be loaded via CDN in index.html
        if (typeof window.pdfjsLib === 'undefined') {
          throw new Error('PDF.js library not loaded.');
        }

        const pdf = await window.pdfjsLib.getDocument({ data: typedArray }).promise;
        let fullText = '';

        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i);
          const textContent = await page.getTextContent();
          const pageText = textContent.items.map(item => item.str).join(' ');
          fullText += pageText + '\n';
        }

        resolve(fullText.trim());
      } catch (err) {
        reject(new Error('Failed to parse PDF: ' + err.message));
      }
    };

    reader.onerror = () => reject(new Error('Failed to read file.'));
    reader.readAsArrayBuffer(file);
  });
}

/**
 * Extract text from a DOCX file using mammoth.js
 */
export async function parseDOCX(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = async (e) => {
      try {
        if (typeof window.mammoth === 'undefined') {
          throw new Error('Mammoth.js library not loaded.');
        }

        const result = await window.mammoth.extractRawText({
          arrayBuffer: e.target.result
        });

        resolve(result.value.trim());
      } catch (err) {
        reject(new Error('Failed to parse DOCX: ' + err.message));
      }
    };

    reader.onerror = () => reject(new Error('Failed to read file.'));
    reader.readAsArrayBuffer(file);
  });
}

/**
 * Parse resume file (auto-detects type)
 */
export async function parseResume(file) {
  const name = file.name.toLowerCase();

  if (name.endsWith('.pdf')) {
    return parsePDF(file);
  } else if (name.endsWith('.docx')) {
    return parseDOCX(file);
  } else if (name.endsWith('.txt')) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target.result);
      reader.onerror = () => reject(new Error('Failed to read text file.'));
      reader.readAsText(file);
    });
  } else {
    throw new Error('Unsupported file type. Please upload PDF, DOCX, or TXT.');
  }
}

/**
 * Convert raw resume text into structured Memory Vault entries using Gemini.
 * Returns an array of vault entry objects ready to be saved.
 */
export async function extractVaultEntriesFromText(apiKey, resumeText) {
  const { generateResume: callGemini } = await import('./llm.js');

  const prompt = `Extract structured experience and project data from this resume text. 
Return ONLY a valid JSON array of objects:
[
  {
    "title": "Job Title or Project Name",
    "context": "Company Name or Project Context",
    "dateRange": "Start – End or Year",
    "type": "experience|project|education",
    "techStack": ["tech1", "tech2"],
    "bulletPoints": ["impact metric 1", "impact metric 2"]
  }
]

Resume Text:
${resumeText.substring(0, 8000)}`;

  // Use raw Gemini call
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${getModel()}:generateContent?key=${apiKey}`;
  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.2, maxOutputTokens: 3000, responseMimeType: 'application/json' },
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) throw new Error('Failed to parse resume with Gemini.');

  const data = await response.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Empty Gemini response.');

  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    const match = text.match(/\[[\s\S]*\]/);
    if (match) return JSON.parse(match[0]);
    return [];
  }
}
