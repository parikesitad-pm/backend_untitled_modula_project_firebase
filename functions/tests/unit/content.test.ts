import { describe, it, expect } from 'vitest';
import {
  CreateQuestionSchema,
  extractPlainText,
  RichTextNode,
} from '../../src/modules/questions/questions.schema';

describe('Content and Question Text Validation', () => {
  it('extracts plain text from richText nodes', () => {
    const nodes: RichTextNode[] = [
      { type: 'text', content: 'Hello ' },
      { type: 'bold', content: 'World' },
      { type: 'link', content: ' click here', url: 'https://example.com' },
    ];
    const text = extractPlainText('fallback', nodes);
    expect(text).toBe('Hello World click here');
  });

  it('rejects links with javascript: protocol in richText', () => {
    const payload = {
      body: 'Question with unsafe link',
      richText: [
        {
          type: 'link',
          content: 'click me',
          url: 'javascript:alert(1)',
        },
      ],
      choices: [
        { body: 'Choice 1', isCorrect: true },
        { body: 'Choice 2', isCorrect: false },
      ],
    };

    const parsed = CreateQuestionSchema.safeParse(payload);
    expect(parsed.success).toBe(false);
  });

  it('accepts links with http and https protocol', () => {
    const payload = {
      body: 'Question with safe link',
      richText: [
        {
          type: 'link',
          content: 'docs',
          url: 'https://developer.mozilla.org',
        },
      ],
      choices: [
        { body: 'Choice 1', isCorrect: true },
        { body: 'Choice 2', isCorrect: false },
      ],
    };

    const parsed = CreateQuestionSchema.safeParse(payload);
    expect(parsed.success).toBe(true);
  });

  it('enforces 255-character limit on extracted plain text rather than serialized JSON', () => {
    // RichText serialized JSON will easily exceed 255 chars due to markup,
    // but the extracted plain text is under 255 chars
    const nodes: RichTextNode[] = [
      { type: 'bold', content: 'Part 1: Important concept. ' },
      { type: 'italic', content: 'Part 2: Some details. ' },
      { type: 'code_block', content: 'const x = 10;' },
      { type: 'link', content: ' Reference guide.', url: 'https://example.com/very/long/url/path/to/documentation/page' },
    ];

    const plainText = extractPlainText('', nodes);
    expect(plainText.length).toBeLessThanOrEqual(255);

    const serializedJson = JSON.stringify(nodes);
    expect(serializedJson.length).toBeGreaterThan(255);

    const result = CreateQuestionSchema.safeParse({
      body: 'placeholder',
      richText: nodes,
      choices: [
        { body: 'A', isCorrect: true },
        { body: 'B', isCorrect: false },
      ],
    });

    expect(result.success).toBe(true);
  });

  it('rejects when extracted plain text exceeds 255 characters', () => {
    const nodes: RichTextNode[] = [
      { type: 'text', content: 'X'.repeat(256) },
    ];

    const result = CreateQuestionSchema.safeParse({
      body: 'placeholder',
      richText: nodes,
      choices: [
        { body: 'A', isCorrect: true },
        { body: 'B', isCorrect: false },
      ],
    });

    expect(result.success).toBe(false);
  });
});
