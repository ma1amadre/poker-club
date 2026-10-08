// «Табло на связи» (миграция 023): пока табло показывает вечер, оно раз в BOARD_PING_MS отмечается
// на сервере (board_ping) — по ссылке вечера или по коду табло клуба; отметка говорит и о том,
// включён ли голос. Её читает проверка перед игрой у банкира. Ни адреса, ни устройства табло не
// передаёт. Сбой отметки — молча: табло от неё не зависит.
import { useEffect } from 'react';
import { BOARD_PING_MS, pingBoard, type BoardSource } from '../../shared/api';

export function useBoardPing(source: BoardSource, eveningId: string, voiceOn: boolean): void {
  useEffect(() => {
    // Отметка сразу (табло открыли, вечер сменился, голос включили или выключили) и дальше по таймеру.
    void pingBoard(source, voiceOn);
    const timer = window.setInterval(() => void pingBoard(source, voiceOn), BOARD_PING_MS);
    return () => window.clearInterval(timer);
  }, [source, eveningId, voiceOn]);
}
