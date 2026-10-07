// «Твой ответ» на экране вечера: у не ответившего не выбрано ничего. Кнопки анонса и поста в день
// игры ведут сюда, и подсвеченное «Иду» у молчавшего читалось бы как уже данный ответ.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { RSVP_CHOICES, RSVP_STATUS_META } from '../../shared/api/types';
import { Segmented } from '../../vendor/materia/materia.mjs';
import { rsvpSegmentValue } from './lib';

const options = RSVP_CHOICES.map((status) => ({
  value: status,
  label: RSVP_STATUS_META[status].title,
}));

/** Подписи нажатых вариантов в разметке Segmented «Материи». */
function pressed(value: string | undefined): string[] {
  const html = renderToStaticMarkup(
    createElement(Segmented, { label: 'Твой ответ на анонс', value, options }),
  );
  return [...html.matchAll(/aria-pressed="true"[^>]*>([^<]*)</g)].map((m) => m[1] ?? '');
}

describe('rsvpSegmentValue', () => {
  it('нет ответа и пока ответы грузятся — пустая строка', () => {
    expect(rsvpSegmentValue(null)).toBe('');
    expect(rsvpSegmentValue(undefined)).toBe('');
    expect(rsvpSegmentValue(undefined, null)).toBe('');
  });

  it('сохранённый ответ; пока новый уходит на сервер — новый', () => {
    expect(rsvpSegmentValue('no')).toBe('no');
    expect(rsvpSegmentValue('no', 'yes')).toBe('yes');
    expect(rsvpSegmentValue(null, 'maybe')).toBe('maybe');
  });
});

describe('Segmented «Твой ответ»', () => {
  it('пустая строка — не нажат ни один вариант', () => {
    expect(pressed(rsvpSegmentValue(undefined))).toEqual([]);
    expect(pressed(rsvpSegmentValue(null))).toEqual([]);
  });

  it('undefined подсвечивает первый вариант — поэтому его и не передаём', () => {
    expect(pressed(undefined)).toEqual([RSVP_STATUS_META[RSVP_CHOICES[0] ?? 'yes'].title]);
  });

  it('ответ — нажат ровно он', () => {
    expect(pressed(rsvpSegmentValue('maybe'))).toEqual([RSVP_STATUS_META.maybe.title]);
  });
});
