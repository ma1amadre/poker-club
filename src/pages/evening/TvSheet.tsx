// «Вывести на ТВ»: QR и ссылка на публичное табло вечера (/board/:token). Табло открывается без
// входа на любом экране — ноутбуке у телевизора, планшете, телефоне.
import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import { boardUrl } from '../../shared/lib';
import { openLink } from '../../shared/telegram';
import { Button, Sheet, Skeleton, useToast } from '../../shared/ui';

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

export interface TvSheetProps {
  open: boolean;
  onClose: () => void;
  boardToken: string;
}

export function TvSheet({ open, onClose, boardToken }: TvSheetProps) {
  return open ? <TvSheetInner onClose={onClose} boardToken={boardToken} /> : null;
}

function TvSheetInner({ onClose, boardToken }: Omit<TvSheetProps, 'open'>) {
  const url = boardUrl(boardToken);
  const toast = useToast();
  const [qr, setQr] = useState<{ url: string; data: string } | null>(null);
  const [failed, setFailed] = useState(false);

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
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [url]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      toast.show('Ссылка на табло скопирована', { tone: 'positive' });
    } catch {
      toast.show('Ссылку не скопировать из этого окна', {
        tone: 'caution',
        detail: 'Выделите её в поле выше и скопируйте вручную.',
      });
    }
  };

  return (
    <Sheet
      open
      onClose={onClose}
      title="Табло на ТВ"
      description="Наведите камеру телефона или ноутбука у телевизора на код. Табло открывается без входа и обновляется само."
      actions={
        <div className="ev-sheet-actions">
          <Button variant="primary" block icon="copy" onClick={() => void copy()}>
            Скопировать ссылку
          </Button>
          <Button variant="ghost" block icon="external-link" onClick={() => openLink(url)}>
            Открыть табло здесь
          </Button>
        </div>
      }
    >
      <div className="ev-qr">
        {qr && qr.url === url ? (
          <img className="ev-qr__image" src={qr.data} alt="QR-код ссылки на табло вечера" />
        ) : failed ? (
          <p className="m-small">Код не построился. Откройте табло по ссылке ниже.</p>
        ) : (
          <Skeleton width={240} height={240} />
        )}
        <p className="m-mono ev-qr__link">{url}</p>
      </div>
    </Sheet>
  );
}
