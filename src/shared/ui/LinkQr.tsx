// QR-код ссылки и сама ссылка текстом: табло вечера и табло клуба (TvSheet, админка «Клуб»).
import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import { Skeleton } from './materia';

/**
 * Цвета кода — игральная карта «Терминала» (card-ink на card-face): тёмный код на светлом поле
 * читает любая камера, а инвертированный QR из тёмной темы — далеко не каждая. Токены берём из CSS
 * (проба с data-theme='terminal' — так же и в витринах других регистров), а не пишем hex.
 */
function lightTokens(): { dark: string; light: string } {
  const probe = document.createElement('div');
  probe.setAttribute('data-theme', 'terminal');
  probe.hidden = true;
  document.body.append(probe);
  const style = getComputedStyle(probe);
  const dark = style.getPropertyValue('--card-ink').trim();
  const light = style.getPropertyValue('--card-face').trim();
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
