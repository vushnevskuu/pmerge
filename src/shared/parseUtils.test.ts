import { describe, it, expect } from 'vitest';
import {
  extractDescriptionFromMergeFormat,
  normalizeMergePrompt,
  stripColorFromMaterial,
  sanitizePromptMaterialColors,
  enforceWhiteBackground,
} from './parseUtils';

describe('extractDescriptionFromMergeFormat', () => {
  it('возвращает пустую строку для null/undefined/пустой строки', () => {
    expect(extractDescriptionFromMergeFormat('')).toBe('');
    expect(extractDescriptionFromMergeFormat(null as unknown as string)).toBe('');
    expect(extractDescriptionFromMergeFormat(undefined as unknown as string)).toBe('');
  });

  it('извлекает текст после DESCRIPTION:', () => {
    const input = `DESCRIPTION: A wooden gnome with a red hat.
NEGATIVE_HINTS: blurry`;
    expect(extractDescriptionFromMergeFormat(input)).toBe(
      'A wooden gnome with a red hat.'
    );
  });

  it('извлекает до NEGATIVE_HINTS (с подчёркиванием)', () => {
    const input = `DESCRIPTION: Captain's hat made of glass.
NEGATIVE_HINTS: text`;
    expect(extractDescriptionFromMergeFormat(input)).toBe(
      "Captain's hat made of glass."
    );
  });

  it('извлекает до TRACE:', () => {
    const input = `DESCRIPTION: Smooth dark deck.
TRACE: some trace`;
    expect(extractDescriptionFromMergeFormat(input)).toBe('Smooth dark deck.');
  });

  it('возвращает весь текст если нет маркеров', () => {
    const input = 'Just plain text without markers';
    expect(extractDescriptionFromMergeFormat(input)).toBe(input);
  });

  it('возвращает пустую строку если строка начинается с NEGATIVE_HINTS', () => {
    const input = 'NEGATIVE_HINTS: something';
    expect(extractDescriptionFromMergeFormat(input)).toBe('');
  });
});

describe('normalizeMergePrompt', () => {
  it('заменяет TN на IN', () => {
    expect(normalizeMergePrompt('sitting TN the chair')).toBe('sitting IN the chair');
    expect(normalizeMergePrompt('TN the box')).toBe('IN the box');
  });

  it('исправляет captats на captain\'s', () => {
    expect(normalizeMergePrompt('captats hat')).toBe("captain's hat");
    expect(normalizeMergePrompt('captats\'s hat')).toBe("captain's hat");
  });

  it('исправляет bouing на boxing', () => {
    expect(normalizeMergePrompt('bouing gloves')).toBe('boxing gloves');
  });

  it('исправляет glace на glass', () => {
    expect(normalizeMergePrompt('glace bottle')).toBe('glass bottle');
  });

  it('исправляет grus на green', () => {
    expect(normalizeMergePrompt('grus grass')).toBe('green grass');
  });

  it('исправляет date на dark', () => {
    expect(normalizeMergePrompt('date wood')).toBe('dark wood');
  });

  it('исправляет emoner на smooth', () => {
    expect(normalizeMergePrompt('emoner surface')).toBe('smooth surface');
  });

  it('исправляет dect на deck', () => {
    expect(normalizeMergePrompt('wooden dect')).toBe('wooden deck');
  });

  it('применяет все исправления в одной строке', () => {
    const input = 'captats bouing TN glace grus date emoner dect';
    const expected = "captain's boxing IN glass green dark smooth deck";
    expect(normalizeMergePrompt(input)).toBe(expected);
  });
});

describe('stripColorFromMaterial', () => {
  it('удаляет red из Material', () => {
    expect(stripColorFromMaterial('smooth glossy red rubber surface')).toBe('smooth glossy rubber surface');
    expect(stripColorFromMaterial('red rubber monkey')).toBe('rubber monkey');
  });
  it('удаляет bright red, glossy red', () => {
    expect(stripColorFromMaterial('smooth bright red rubber')).toBe('smooth rubber');
  });
});

describe('sanitizePromptMaterialColors', () => {
  it('заменяет red rubber на rubber в промпте', () => {
    expect(sanitizePromptMaterialColors('A dog made of red rubber')).not.toContain('red rubber');
    expect(sanitizePromptMaterialColors('A dog made of smooth glossy red rubber')).toContain('smooth rubber');
  });
  it('заменяет yellow cartoon dog на cartoon dog', () => {
    expect(sanitizePromptMaterialColors('A yellow cartoon dog')).toContain('cartoon dog');
  });
});

describe('enforceWhiteBackground', () => {
  it('добавляет Plain white background если его нет', () => {
    const out = enforceWhiteBackground('A mask with dim and fiery lighting.');
    expect(out).toMatch(/\bplain white background\b/i);
  });
  it('не дублирует если уже есть white background', () => {
    const out = enforceWhiteBackground('On plain white background.');
    expect(out.match(/\bplain white background\b/gi)?.length).toBe(1);
  });
});
