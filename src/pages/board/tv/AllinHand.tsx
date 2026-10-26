// Рука олл-ина на табло ТВ (макет доработки v3): номер места и имя, рука словами справа, две карты,
// одна крупная цифра шансов (флапы «впотай» — видно только перекат), полоса, ауты (число флапом,
// плашки мастей), подпись следующей карты; на развязке — итог руки крупно и статус (банк плашкой,
// вылет — красным флапом). Что показать и когда — снимок HandShown (allinScript.ts); здесь — как
// это встаёт и уходит.
import type { ShowdownHand } from '@domain/types.ts';
import { useCallback, useLayoutEffect, useRef, type CSSProperties } from 'react';
import { seatNo } from '../../evening/lib';
import {
  handSlot,
  handY,
  pctTile,
  potFontSize,
  resultWidth,
  shortHandText,
  type AllinLayout,
  type HandResult,
  type OutsView,
} from './allinModel';
import type { HandShown } from './allinScript';
import { FlapText } from './FlapText';
import type { FlapRowStyle } from './flap';
import { pctText } from './flapLogic';
import { EASE } from './motion';
import { useMotion } from './motionContext';
import { SuitIcon, TvCard } from './TvCard';
import { useFontsVersion } from './useStage';
import { Vylet } from './Vylet';

/** Погасший ранг на белой плашке: читается как погасший, а не как дыра. */
const DEAD = 0.3;
const PCT_FLIP = { drum: 'auto' as const, maxVia: 2, stagger: 50, lowFirst: true };
const COUNT_FLIP = { riffle: 1 };

type HandYs = ReturnType<typeof handY>;

export interface HandColumnProps {
  index: number;
  L: AllinLayout;
  hand: ShowdownHand;
  name: string;
  seat: number | null;
  shown: HandShown;
  handsIn: boolean;
  instant: boolean;
  bustPlace: string | null;
}

export function HandColumn({
  index,
  L,
  hand,
  name,
  seat,
  shown,
  handsIn,
  instant,
  bustPlace,
}: HandColumnProps) {
  const { motion } = useMotion();
  const slot = handSlot(L, index);
  const Y = handY(L);
  const dimRef = useRef<HTMLDivElement>(null);
  const fxRef = useRef<HTMLDivElement>(null);
  const inShown = useRef<boolean | null>(null);
  const dimShown = useRef<number | null>(null);
  const fxShown = useRef<boolean | null>(null);
  // Вход: рука поднимается со своим шагом, карты вскрываются по одной (на четверых и больше шаг
  // длиннее — одновременно движется не больше 12 слоёв).
  const enterAt = 520 + index * (L.n > 3 ? 140 : 100);
  const { dim, fxHidden } = shown;

  useLayoutEffect(() => {
    const el = dimRef.current;
    if (!el) return;
    const was = inShown.current;
    inShown.current = handsIn;
    if (!handsIn) {
      el.style.opacity = '0';
      return;
    }
    if (was === handsIn) return;
    dimShown.current = dim;
    if (was === null || instant) {
      el.style.opacity = String(dim);
      return;
    }
    motion.rise(el, 32, 420, { delay: enterAt });
  }, [handsIn, instant, dim, enterAt, motion]);

  // Проигравшие на развязке — в тень.
  useLayoutEffect(() => {
    const el = dimRef.current;
    if (!el || !handsIn || dimShown.current === dim) return;
    dimShown.current = dim;
    if (instant) el.style.opacity = String(dim);
    else motion.fade(el, dim, 500);
  }, [dim, handsIn, instant, motion]);

  // Проценты, ауты и подписи — одним слоем: проявляются на входе, уходят на развязке.
  useLayoutEffect(() => {
    const el = fxRef.current;
    if (!el) return;
    const was = fxShown.current;
    fxShown.current = fxHidden;
    const to = fxHidden ? 0 : 1;
    if (was === null || instant) {
      el.style.opacity = String(to);
      return;
    }
    if (was !== fxHidden) motion.fade(el, to, fxHidden ? 200 : 160);
  }, [fxHidden, instant, motion]);

  const resW = resultWidth(L);
  const pctSize = L.pct;
  const pctLabel = pctText(shown.pct);
  // «100» в узкой колонке — плитка мельче: цифра не заходит на карты руки.
  const tile = pctTile(L, pctLabel.length);
  const pctStyle: FlapRowStyle = {
    w: tile.w,
    h: pctSize,
    fs: tile.fs,
    wt: 800,
    ink: 'var(--ink)',
    flush: true,
    s: 0,
    gap: 0,
    dy: 0,
  };

  const noRef = useRef<HTMLSpanElement>(null);
  const nameRef = useRef<HTMLSpanElement>(null);
  const fitRow = useCallback(
    (made: HTMLElement, text: string) => fitWhoRow(noRef.current, nameRef.current, made, text, L),
    [L],
  );
  const fonts = useFontsVersion();

  const colStyle: CSSProperties = { left: slot.x, top: slot.y, width: L.colW, height: Y.bottom };
  return (
    <div className={`tv-hand${shown.lead ? ' tv-hand--lead' : ''}`} style={colStyle}>
      <div ref={dimRef} className="tv-hand__dim">
        <div className="tv-hand__rule" />
        <div className="tv-hand__who-row" style={{ top: Y.name, height: L.name }}>
          <p className="tv-hand__who">
            {seat !== null && (
              <span ref={noRef} className="tv-hand__no">
                {seatNo(seat)}
              </span>
            )}
            <span ref={nameRef} className="tv-name" style={{ fontSize: L.name }}>
              {name}
            </span>
          </p>
          <SwapText
            className="tv-hand__made"
            size={L.made}
            hidden={shown.madeHidden}
            text={shown.made}
            fit={fitRow}
            refit={`${name}|${fonts}`}
            instant={instant}
          />
        </div>
        {hand.cards.map((c, j) => (
          <TvCard
            key={c}
            code={c}
            x={j * (L.cw + L.cg)}
            y={Y.cards}
            w={L.cw}
            h={L.ch}
            open={handsIn}
            flipDelay={instant ? null : enterAt + 160 + j * 70}
          />
        ))}
        {shown.combo.map((j) => (
          <ULine key={j} x={j * (L.cw + L.cg)} y={Y.cardsB + 10} w={L.cw} instant={instant} />
        ))}
        <Bar value={shown.bar} y={Y.bar} instant={instant} />
      </div>
      <LeadLine on={shown.lead} instant={instant} />

      <div ref={fxRef} className="tv-hand__fx">
        <div className="tv-hand__pct" style={{ top: Y.cardsB - Math.round(pctSize * 0.865) }}>
          <FlapText
            text={pctLabel}
            style={pctStyle}
            ink={shown.lead ? 'var(--accent)' : 'var(--ink)'}
            flip={instant ? null : PCT_FLIP}
            label={shown.pct === null ? 'шансы считаются' : `шансы ${shown.pct} %`}
          />
          <span
            className="tv-hand__ps"
            style={{
              fontSize: Math.round(pctSize * 0.32),
              margin: `${Math.round(pctSize * 0.15)}px 0 0 ${Math.round(pctSize * 0.04)}px`,
            }}
          >
            %
          </span>
        </div>
        <OutsLine L={L} Y={Y} shown={shown} instant={instant} />
        {shown.caption && (
          <Caption
            y={Y.cap}
            size={L.cap}
            maxW={L.colW}
            caption={shown.caption}
            hidden={shown.captionHidden}
            instant={instant}
          />
        )}
      </div>

      {shown.result && shown.result.kind !== 'lose' && (
        <ResultBlock
          L={L}
          Y={Y}
          resW={resW}
          result={shown.result}
          place={bustPlace}
          instant={instant}
        />
      )}
      {shown.fin && <Fin text={shown.fin} L={L} Y={Y} result={shown.result} instant={instant} />}
    </div>
  );
}

/**
 * Зазор между номером места и именем (tv-hand__who) и между именем и рукой словами; к зазору —
 * запас 2 px: ширины дробные, и имя «впритык» иначе рисуется с многоточием.
 */
const WHO_GAP = 14;
const ROW_GAP = 18;
/** Рука словами не уже этой доли колонки, когда строке тесно: длинное имя — с многоточием. */
const MADE_SHARE = 0.3;

/**
 * Строка имени: имя и рука словами. Не помещаются — рука словами короче («Старший туз», «Две
 * пары»), потом имя мельче (до 0,8), потом рука словами мельче (до 0,8); и тогда тесно — руке
 * словами не меньше MADE_SHARE колонки, имя — с многоточием.
 */
function fitWhoRow(
  no: HTMLElement | null,
  name: HTMLElement | null,
  made: HTMLElement,
  text: string,
  L: AllinLayout,
): void {
  made.style.fontSize = `${L.made}px`;
  made.style.maxWidth = '';
  made.textContent = text;
  if (name) name.style.fontSize = `${L.name}px`;
  if (!text) return;
  const lead = no ? no.offsetWidth + WHO_GAP : 0;
  const room = () => L.colW - lead - (name?.scrollWidth ?? 0) - ROW_GAP;
  if (made.scrollWidth <= room()) return;
  made.textContent = shortHandText(text);
  const shrink = (el: HTMLElement, base: number) => {
    const min = Math.round(base * 0.8);
    let px = base;
    while (made.scrollWidth > room() && px > min) {
      px -= 1;
      el.style.fontSize = `${px}px`;
    }
  };
  if (name) shrink(name, L.name);
  shrink(made, L.made);
  if (made.scrollWidth > room()) {
    made.style.maxWidth = `${Math.max(room(), Math.round(L.colW * MADE_SHARE))}px`;
  }
}

/** Рука словами: смена — гаснет и проявляется (текст — textContent, по месту — fit). */
function SwapText({
  text,
  fit,
  refit,
  className,
  size,
  hidden,
  instant,
}: {
  text: string;
  /** Поставить текст и подогнать строку имени под него. */
  fit: (el: HTMLElement, text: string) => void;
  /** Сменилось имя или догрузился шрифт — подогнать заново. */
  refit: string;
  className: string;
  size: number;
  hidden: boolean;
  instant: boolean;
}) {
  const { motion } = useMotion();
  const ref = useRef<HTMLParagraphElement>(null);
  const shownText = useRef<string | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const was = shownText.current;
    if (was === text) {
      fit(el, text);
      return;
    }
    shownText.current = text;
    if (was === null || instant) {
      fit(el, text);
      return;
    }
    if (motion.calm || !was) {
      fit(el, text);
      motion.A(el, [{ opacity: 0 }, { opacity: 1 }], 240, { keep: true });
      return;
    }
    motion.A(el, [{ opacity: 1 }, { opacity: 0 }], 120, {
      keep: true,
      done: () => {
        fit(el, text);
        motion.A(el, [{ opacity: 0 }, { opacity: 1 }], 240, { keep: true });
      },
    });
  }, [text, fit, refit, instant, motion]);
  return (
    <p
      ref={ref}
      className={className}
      style={{ fontSize: size, visibility: hidden ? 'hidden' : undefined }}
    />
  );
}

function Bar({ value, y, instant }: { value: number; y: number; instant: boolean }) {
  const { motion } = useMotion();
  const fill = useRef<HTMLElement>(null);
  const shownValue = useRef<number | null>(null);
  useLayoutEffect(() => {
    const el = fill.current;
    if (!el) return;
    const from = shownValue.current;
    shownValue.current = value;
    const to = `scaleX(${value})`;
    if (from === null || instant || motion.calm) {
      motion.cancelOn(el);
      el.style.transform = to;
      return;
    }
    if (from === value) return;
    motion.move(el, `scaleX(${from})`, to, 600, { easing: EASE.push });
  }, [value, instant, motion]);
  return (
    <div className="tv-hand__bar" style={{ top: y }}>
      <i ref={fill} />
    </div>
  );
}

function LeadLine({ on, instant }: { on: boolean; instant: boolean }) {
  const { motion } = useMotion();
  const ref = useRef<HTMLDivElement>(null);
  const was = useRef<boolean | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const prev = was.current;
    was.current = on;
    if (prev === null || instant) {
      el.style.transform = on ? 'scaleX(1)' : 'scaleX(0)';
      return;
    }
    if (prev === on) return;
    if (on) motion.line(el, 420, { delay: 70 });
    else motion.move(el, 'scaleX(1)', 'scaleX(0)', 200, { easing: EASE.exit });
  }, [on, instant, motion]);
  return <div ref={ref} className="tv-hand__lead" />;
}

function ULine({ x, y, w, instant }: { x: number; y: number; w: number; instant: boolean }) {
  const { motion } = useMotion();
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (instant) el.style.transform = 'scaleX(1)';
    else motion.line(el, 320);
  }, [instant, motion]);
  return <div ref={ref} className="tv-uline" style={{ left: x, top: y, width: w }} />;
}

/** Ауты: число флапом и подпись, плашки по мастям; у лидера — «Впереди», аутов нет — строкой. */
function OutsLine({
  L,
  Y,
  shown,
  instant,
}: {
  L: AllinLayout;
  Y: HandYs;
  shown: HandShown;
  instant: boolean;
}) {
  const { motion } = useMotion();
  const ref = useRef<HTMLDivElement>(null);
  const kind = shown.outs ? 'outs' : shown.ahead ? 'ahead' : shown.noOuts ? 'none' : null;
  const kindShown = useRef<string | null | undefined>(undefined);
  useLayoutEffect(() => {
    const el = ref.current;
    const was = kindShown.current;
    kindShown.current = kind;
    if (!el || !kind || was === kind || was === undefined || instant) return;
    if (kind === 'ahead' || kind === 'none') motion.rise(el, 8, 320);
  }, [kind, instant, motion]);
  if (!kind) return null;
  const countStyle: FlapRowStyle = {
    w: Math.round(L.cnt * 0.6) + 2,
    h: L.cnt,
    fs: L.cnt,
    wt: 800,
    ink: 'var(--ink)',
    flush: true,
    s: 0,
    gap: 0,
  };
  return (
    <div
      ref={ref}
      className="tv-hand__oh"
      style={{ top: Y.oh, height: L.cnt, alignItems: kind === 'outs' ? 'flex-end' : 'center' }}
    >
      {kind === 'ahead' && (
        <span className="tv-hand__st" style={{ fontSize: L.st }}>
          Впереди
        </span>
      )}
      {kind === 'none' && (
        <span className="tv-hand__none" style={{ fontSize: L.cap }}>
          {shown.noOuts}
        </span>
      )}
      {kind === 'outs' && shown.outs && (
        <>
          <span>
            <FlapText
              text={String(shown.outsCount)}
              style={countStyle}
              flip={instant ? null : COUNT_FLIP}
            />
          </span>
          <span
            className="tv-hand__ol"
            style={{
              fontSize: L.ol,
              paddingBottom: Math.round(L.cnt * 0.135 - 4),
            }}
          >
            {shown.outs.word}
            {shown.outs.split > 0 ? ` · на делёж ${shown.outs.split}` : ''}
          </span>
          {L.inline && <Plates L={L} shown={shown} inline instant={instant} />}
        </>
      )}
      {kind === 'outs' && !L.inline && (
        <div style={{ position: 'absolute', left: 0, top: Y.plates - Y.oh, width: L.colW }}>
          <Plates L={L} shown={shown} inline={false} instant={instant} />
        </div>
      )}
    </div>
  );
}

/** Плашки мельче не бывают: дальше — нечитаемо с дивана. */
const PLATE_MIN = 14;
/** Зазор между плашками (tv-hand__plates). */
const PLATE_GAP = 10;

/**
 * Плашки по ширине колонки: lines 1 — одной строкой (кегль вниз, пока не поместится), 2 — с
 * переносом на вторую строку в своём кегле, мельче — только если и двух строк мало.
 */
function fitPlates(el: HTMLElement, base: number, lines: number, maxW: number): void {
  const kids = [...el.children] as HTMLElement[];
  const fits = () => {
    const ws = kids.map((k) => k.offsetWidth);
    if (lines <= 1) return ws.reduce((a, b) => a + b, 0) + PLATE_GAP * (ws.length - 1) <= maxW;
    let row = 1;
    let x = 0;
    for (const w of ws) {
      if (w > maxW) return false;
      const next = x === 0 ? w : x + PLATE_GAP + w;
      if (next <= maxW) x = next;
      else {
        row += 1;
        x = w;
      }
    }
    return row <= lines;
  };
  let px = base;
  el.style.fontSize = `${px}px`;
  while (px > PLATE_MIN && !fits()) {
    px -= 1;
    el.style.fontSize = `${px}px`;
  }
}

function Plates({
  L,
  shown,
  inline,
  instant,
}: {
  L: AllinLayout;
  shown: HandShown;
  inline: boolean;
  instant: boolean;
}) {
  const { motion } = useMotion();
  const ref = useRef<HTMLDivElement>(null);
  const dimShown = useRef<boolean | null>(null);
  const { platesDim } = shown;
  const fonts = useFontsVersion();
  const plates = shown.outs?.plates ?? [];
  const sig = plates.map((p) => `${p.suit}${p.ranks.map((r) => r.code).join('')}`).join('|');
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    // В строке числа аутов (двое) плашкам остаётся колонка за числом и подписью.
    const maxW = inline ? L.colW - el.offsetLeft : L.colW;
    fitPlates(el, L.chip, L.plateLines, maxW);
  }, [sig, L, inline, fonts]);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const was = dimShown.current;
    dimShown.current = platesDim;
    if (was === null || instant) {
      el.style.opacity = platesDim ? String(DEAD) : '1';
      return;
    }
    if (was !== platesDim) motion.fade(el, platesDim ? DEAD : 1, 200);
  }, [platesDim, instant, motion]);
  return (
    <div
      ref={ref}
      className={`tv-hand__plates${inline ? ' tv-hand__plates--inline' : ''}`}
      style={{
        fontSize: L.chip,
        flexWrap: L.plateLines > 1 ? 'wrap' : 'nowrap',
        ...(inline ? null : { position: 'static' }),
      }}
    >
      {plates.map((plate, k) => (
        <Plate key={plate.suit} plate={plate} k={k} L={L} shown={shown} instant={instant} />
      ))}
    </div>
  );
}

function Plate({
  plate,
  k,
  L,
  shown,
  instant,
}: {
  plate: NonNullable<OutsView>['plates'][number];
  k: number;
  L: AllinLayout;
  shown: HandShown;
  instant: boolean;
}) {
  const { motion } = useMotion();
  const ref = useRef<HTMLDivElement>(null);
  const appeared = useRef(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || appeared.current) return;
    appeared.current = true;
    if (instant) return;
    el.style.opacity = '0';
    if (motion.calm)
      motion.A(el, [{ opacity: 0 }, { opacity: 1 }], 200, { delay: 120 + k * 60, keep: true });
    else
      motion.A(
        el,
        [
          { opacity: 0, transform: 'translateY(8px)' },
          { opacity: 1, transform: 'translateY(0px)' },
        ],
        240,
        { delay: 120 + k * 60, easing: EASE.quiet, keep: true },
      );
  }, [instant, k, motion]);
  const red = plate.suit === 'h' || plate.suit === 'd';
  // Размеры — в em от кегля ряда плашек (Plates подгоняет его по ширине колонки).
  const ph = L.ph / L.chip;
  return (
    <div
      ref={ref}
      className={`tv-plate${red ? ' tv-plate--red' : ''}`}
      style={{ height: `${ph.toFixed(3)}em` }}
    >
      <SuitIcon suit={plate.suit} size={Math.round(L.chip * 0.86)} className="tv-plate__suit" />
      {plate.ranks.map((r) => (
        <Rank
          key={r.code}
          rank={r.rank}
          ph={ph}
          dead={r.dead || (shown.dimRanks && shown.hit !== r.code)}
          hit={shown.hit === r.code}
          instant={instant}
        />
      ))}
    </div>
  );
}

function Rank({
  rank,
  ph,
  dead,
  hit,
  instant,
}: {
  rank: string;
  /** Высота плашки, em. */
  ph: number;
  dead: boolean;
  hit: boolean;
  instant: boolean;
}) {
  const { motion } = useMotion();
  const ref = useRef<HTMLSpanElement>(null);
  const line = useRef<HTMLElement>(null);
  const deadShown = useRef<boolean | null>(null);
  const hitShown = useRef(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const was = deadShown.current;
    deadShown.current = dead;
    if (was === null || instant) {
      el.style.opacity = dead ? String(DEAD) : '1';
      return;
    }
    if (was !== dead) motion.fade(el, dead ? DEAD : 1, 420);
  }, [dead, instant, motion]);
  useLayoutEffect(() => {
    const el = line.current;
    if (!el || !hit || hitShown.current) return;
    hitShown.current = true;
    if (instant || motion.calm) el.style.transform = 'scaleX(1)';
    else
      motion.A(el, [{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }], 300, {
        easing: EASE.move,
        keep: true,
      });
  }, [hit, instant, motion]);
  return (
    <span ref={ref} className="tv-plate__r">
      {rank}
      <i
        ref={line}
        className="tv-plate__hit"
        style={{ top: `calc(${(ph / 2 + 0.5).toFixed(3)}em + 8px)` }}
      />
    </span>
  );
}

/** Кегль вниз от size до min, пока текст не уже maxW. */
function fitFont(el: HTMLElement, size: number, maxW: number, min: number): void {
  let px = size;
  el.style.fontSize = `${px}px`;
  while (el.scrollWidth > maxW && px > min) {
    px -= 1;
    el.style.fontSize = `${px}px`;
  }
}

/** Подпись следующей карты (флоп): «догонит на тёрне 19 %» / «устоит на тёрне 29 из 43». */
function Caption({
  y,
  size,
  maxW,
  caption,
  hidden,
  instant,
}: {
  y: number;
  size: number;
  maxW: number;
  caption: [string, string];
  hidden: boolean;
  instant: boolean;
}) {
  const { motion } = useMotion();
  const ref = useRef<HTMLParagraphElement>(null);
  const hiddenShown = useRef<boolean | null>(null);
  const [label, value] = caption;
  const fonts = useFontsVersion();
  useLayoutEffect(() => {
    const el = ref.current;
    if (el) fitFont(el, size, maxW, 14);
  }, [label, value, size, maxW, fonts]);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const was = hiddenShown.current;
    hiddenShown.current = hidden;
    if (was === null) {
      if (instant || hidden) el.style.opacity = hidden ? '0' : '1';
      else motion.rise(el, 6, 320);
      return;
    }
    if (was !== hidden) motion.fade(el, hidden ? 0 : 1, 220);
  }, [hidden, instant, motion]);
  return (
    <p ref={ref} className="tv-hand__cap" style={{ top: y, fontSize: size }}>
      {label}
      <b>
        {value.endsWith(' %') ? (
          <>
            {value.slice(0, -2)}
            <i className="tv-gs" />%
          </>
        ) : (
          value
        )}
      </b>
    </p>
  );
}

/**
 * Итог по банку и вылет — одной системой статусов: подпись моно прописными (приглушённо), банк —
 * плашкой (лучшая рука — заливкой, делёж — контуром), вылет — красным флапом и местом.
 */
function ResultBlock({
  L,
  Y,
  resW,
  result,
  place,
  instant,
}: {
  L: AllinLayout;
  Y: HandYs;
  resW: number;
  result: HandResult;
  place: string | null;
  instant: boolean;
}) {
  const { motion } = useMotion();
  const ref = useRef<HTMLDivElement>(null);
  const capRef = useRef<HTMLDivElement>(null);
  const { kind, note } = result;
  const noteRef = useRef<HTMLDivElement>(null);
  const potRef = useRef<HTMLDivElement>(null);
  const fonts = useFontsVersion();
  // Плашка банка не заходит на карты руки: кегль по ширине (оценка моно), потом — по замеру.
  useLayoutEffect(() => {
    const el = potRef.current;
    if (!el || !result.pot || L.stackRes) return;
    fitFont(el, potFontSize(result.pot, L.st, resW), resW, Math.round(L.st * 0.7));
  }, [result.pot, L.st, L.stackRes, resW, fonts]);
  const noteShown = useRef<string | undefined | null>(null);
  // «Удвоение» приходит ответом банкира, когда банк уже на экране: подпись встаёт сама, банк стоит.
  useLayoutEffect(() => {
    const was = noteShown.current;
    noteShown.current = note;
    const el = noteRef.current;
    if (!el || instant || was === null || was === note) return;
    motion.rise(el, 8, 320);
  }, [note, instant, motion]);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || instant) return;
    if (kind === 'out') {
      const cap = capRef.current;
      if (cap) {
        cap.style.opacity = '0';
        motion.A(cap, [{ opacity: 0 }, { opacity: 1 }], 240, { delay: 420, keep: true });
      }
      return;
    }
    motion.rise(el, 10, 360);
  }, [kind, instant, motion]);
  const style: CSSProperties & Record<'--st', string> = L.stackRes
    ? { top: Y.oh, '--st': `${L.st}px` }
    : { bottom: Y.bottom - Y.cardsB, maxWidth: resW, '--st': `${L.st}px` };
  return (
    <div
      ref={ref}
      className={`tv-hand__res${L.stackRes ? ' tv-hand__res--row' : ''}`}
      style={style}
    >
      {kind === 'out' ? (
        <>
          <div ref={capRef} className="tv-hand__res-cap">
            {place ?? 'вне игры'}
          </div>
          <div>
            <Vylet />
          </div>
        </>
      ) : kind === 'stay' ? (
        <div className="tv-hand__res-cap">остаётся в игре</div>
      ) : (
        <>
          {note && (
            <div ref={noteRef} className="tv-hand__res-cap">
              {note}
            </div>
          )}
          <div
            ref={potRef}
            className={`tv-hand__pot${kind === 'split' ? ' tv-hand__pot--split' : ''}`}
          >
            {result.pot}
          </div>
        </>
      )}
    </div>
  );
}

/** Итог руки на развязке — крупно, на месте аутов (нижняя треть не пустеет). */
function Fin({
  text,
  L,
  Y,
  result,
  instant,
}: {
  text: string;
  L: AllinLayout;
  Y: HandYs;
  result: HandResult | null;
  instant: boolean;
}) {
  const { motion } = useMotion();
  const ref = useRef<HTMLParagraphElement>(null);
  const appeared = useRef(false);
  const { fin, colW } = L;
  const fonts = useFontsVersion();
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    fitFont(el, fin, colW, 20);
    if (appeared.current) return;
    appeared.current = true;
    if (!instant) motion.rise(el, 10, 380);
  }, [text, fin, colW, instant, motion, fonts]);
  const color =
    result?.kind === 'win' || result?.kind === 'split'
      ? 'var(--ink)'
      : result?.kind === 'out'
        ? 'var(--neutral-8)'
        : 'var(--ink-muted)';
  return (
    <p
      ref={ref}
      className="tv-hand__fin tv-name"
      style={{ top: L.stackRes ? Y.plates + 20 : Y.oh + 6, fontSize: L.fin, color }}
    >
      {text}
    </p>
  );
}
