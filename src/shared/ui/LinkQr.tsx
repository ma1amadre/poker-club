// QR-код ссылки и сама ссылка текстом: табло вечера и табло клуба (TvSheet, админка «Клуб»).
import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import { Skeleton } from './materia';

/**
 * Цвета кода — токены светлого Кобальта (ink на surface): тёмный код на светлом поле читает любая
 * камера, а инвертированный QR из тёмной темы — далеко не каждая. Токены берём из CSS, а не пишем hex.
 */
function lightTokens(): { dark: string; light: string } {
  const probe = document.createElement('div');
  probe.setAttribute('data-theme', 'kobalt');
  probe.hidden = true;
  document.body.append(probe);
  const style = getComputedStyle(probe);
  const dark = style.getPropertyValue('--ink').trim();
  const light = style.getPropertyValue('--surface').trim();
  probe.remove();
  const hex = /^#[0-9a-f]{6}$/i;
  return {
    dark: hex.test(dark) ? dark : '#000000',
    light: hex.test(light) ? light : '#ffffff',
  };
}

export interface LinkQrProps {
  url: string;
  /** Подпись картинки для чтения с экрана: «QR-код ссылки на табло клуба». */
  alt: string;
}

export function LinkQr({ url, alt }: LinkQrProps) {
  const [qr, setQr] = useState<{ url: string; data: string } | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(url, {
      errorCorrectionLevel: 'M',
      margin: 2,
      width: 480,
      color: lightTokens(),
    })
      .then((data) => {
        if (!cancelled) setQr({ url, data });
      })
      .catch(() => {
        if (!cancelled) setFailed(url);
      });
    return () => {
      cancelled = true;
    };
  }, [url]);

  return (
    <div className="ui-qr">
      {qr && qr.url === url ? (
        <img className="ui-qr__image" src={qr.data} alt={alt} />
      ) : failed === url ? (
        <p className="m-small">Код не построился. Открой ссылку ниже.</p>
      ) : (
        <Skeleton width={240} height={240} />
      )}
      <p className="m-mono ui-qr__link">{url}</p>
    </div>
  );
}
