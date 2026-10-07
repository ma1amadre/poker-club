#!/usr/bin/env python3
"""Генератор голоса табло: озвучивает фразы манифеста, которых ещё нет в public.voice_clips.

Вход — manifest.json от scripts/voice/manifest.mjs: [{voice, hash, text}]. Для каждой фразы, которой
нет в таблице: Silero (torch.package, CPU) 48 кГц → тишина по краям не длиннее 80 мс → выравнивание
громкости → ffmpeg (libmp3lame) MP3 моно 64 kbps → insert … on conflict do nothing. Повторный запуск
ничего не озвучивает. С --prune после озвучки без ошибок удаляет клипы, которых в манифесте нет.

Строка подключения — только из окружения (SUPABASE_DB_URL, имя меняет --db-url-env), в лог не
попадает: пароль вырезается и из текстов ошибок. Устройство и запуск — ARCHITECTURE.md poker-club,
«Голос табло».

    python generate.py manifest.json --plan        # сколько озвучить и какой моделью (key=value)
    python generate.py manifest.json --model v5_5_ru.pt --prune

Коды выхода: 0 — всё на месте; 1 — часть фраз не озвучена или база недоступна; 2 — неверный вход.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import traceback
import unicodedata
import urllib.parse
import warnings
from dataclasses import dataclass

# --- Голоса ---------------------------------------------------------------------------------------

# id голоса (часть хеша клипа, VOICE_ID домена) → модель и диктор. Хеш модели закреплён: загрузка
# torch.package исполняет код из файла, поэтому чужой файл под тем же именем не грузим.
VOICES = {
    "silero-v5_5-xenia": {
        "model_url": "https://models.silero.ai/models/tts/ru/v5_5_ru.pt",
        "model_sha256": "50081637b602126ee06cb3bc8a744d25651d2da149ee8864b9a379bfdd934437",
        "speaker": "xenia",
    },
}

SAMPLE_RATE = 48000
BITRATE = "64k"
EDGE_S = 0.08  # тишины по краям оставляем не больше (Silero даёт до ~0,3 с в конце фразы)
EDGE_DB = -45.0  # «тишина» — тише пика клипа на столько
FADE_S = 0.005  # подъём и спад на краях — без щелчка, если звук обрезан вплотную
TARGET_DBFS = -17.0  # громкость речи (RMS звучащих кусков по 20 мс), одна на все клипы
PEAK_DBFS = -1.0  # пик не выше — запас против перегруза при декодировании MP3
GATE_DB = -30.0  # кусок «звучит», если не тише самого громкого куска на столько

# Ограничения таблицы voice_clips (миграция 016) — проверяем до вставки, чтобы ошибка была понятной.
VOICE_RE = re.compile(r"^[a-z0-9][a-z0-9_.-]{0,63}$")
HASH_RE = re.compile(r"^[0-9a-f]{64}$")
TEXT_MAX = 300
AUDIO_MAX_BYTES = 262144
DURATION_MAX_MS = 30000

IN_ACTIONS = os.environ.get("GITHUB_ACTIONS") == "true"


class InputError(Exception):
    """Неверный манифест или аргументы — код выхода 2."""


class ClipError(Exception):
    """Одну фразу не озвучить — остальные продолжаем, код выхода 1."""


@dataclass(frozen=True)
class Clip:
    voice: str
    hash: str
    text: str


# --- Лог ------------------------------------------------------------------------------------------


def log(message: str) -> None:
    print(message, file=sys.stderr, flush=True)


def annotate(level: str, title: str, message: str) -> None:
    """Ошибка или предупреждение: в GitHub Actions — аннотация запуска, локально — строка лога."""
    if IN_ACTIONS:
        # Перевод строки оборвал бы аннотацию — в одну строку.
        text = " ".join(message.split()).replace("%", "%25")
        log(f"::{level} title={title}::{text}")
    else:
        log(f"{level}: {title}: {message}")


class Redactor:
    """Вырезает строку подключения и пароль из текстов ошибок (libpq их обычно не пишет — на всякий
    случай, и из трассировок тоже)."""

    def __init__(self, url: str) -> None:
        secrets = {url} if url else set()
        try:
            password = urllib.parse.urlsplit(url).password if "://" in url else None
        except ValueError:  # кривой URL — тогда его отвергнет и libpq, а строку целиком вырежем
            password = None
        if not password:
            match = re.search(r"(?:^|\s)password\s*=\s*('(?:[^'\\]|\\.)*'|\S+)", url)
            password = match.group(1).strip("'") if match else None
        if password:
            secrets |= {password, urllib.parse.unquote(password), urllib.parse.quote(password)}
        self._secrets = sorted((s for s in secrets if s), key=len, reverse=True)

    def __call__(self, text: object) -> str:
        out = str(text)
        for secret in self._secrets:
            out = out.replace(secret, "***")
        return out


# --- Манифест -------------------------------------------------------------------------------------


def clip_hash(voice: str, text: str) -> str:
    """Как clipHash домена и constraint voice_clips_hash_matches: sha256(voice + "\\n" + text)."""
    return hashlib.sha256(f"{voice}\n{text}".encode("utf-8")).hexdigest()


def text_problem(text: str) -> str | None:
    """Чем текст не подходит voice_clips (constraint voice_clips_text_normalized) или None."""
    if not 1 <= len(text) <= TEXT_MAX:
        return f"длина {len(text)}, нужно 1–{TEXT_MAX} символов"
    if text != text.strip():
        return "пробелы по краям"
    if "  " in text or re.search(r"[\t\n\r\f\v]", text):
        return "двойной пробел или перевод строки"
    if not unicodedata.is_normalized("NFC", text):
        return "не в форме NFC"
    return None


def parse_manifest(data: object) -> list[Clip]:
    """Проверенный список фраз в порядке манифеста (повторы — один раз)."""
    if not isinstance(data, list) or not data:
        raise InputError("манифест — непустой JSON-массив [{voice, hash, text}] от manifest.mjs")
    clips: list[Clip] = []
    seen: set[tuple[str, str]] = set()
    for i, item in enumerate(data, 1):
        where = f"фраза №{i}"
        if not isinstance(item, dict):
            raise InputError(f"{where}: нужен объект {{voice, hash, text}}")
        voice, digest, text = item.get("voice"), item.get("hash"), item.get("text")
        if not all(isinstance(v, str) for v in (voice, digest, text)):
            raise InputError(f"{where}: voice, hash и text — строки")
        if not VOICE_RE.match(voice):
            raise InputError(f"{where}: голос «{voice}» не по шаблону {VOICE_RE.pattern}")
        if voice not in VOICES:
            known = ", ".join(sorted(VOICES))
            raise InputError(f"{where}: голос «{voice}» генератору не известен (знает: {known})")
        problem = text_problem(text)
        if problem:
            raise InputError(f"{where} «{text[:60]}»: {problem}")
        if not HASH_RE.match(digest) or digest != clip_hash(voice, text):
            raise InputError(
                f"{where} «{text[:60]}»: hash не равен sha256(voice + '\\n' + text) — "
                "манифест не от manifest.mjs или текст изменён"
            )
        if (voice, digest) not in seen:
            seen.add((voice, digest))
            clips.append(Clip(voice, digest, text))
    return clips


def read_manifest(path: str) -> list[Clip]:
    try:
        if path == "-":
            raw = sys.stdin.buffer.read().decode("utf-8")
        else:
            with open(path, encoding="utf-8") as f:
                raw = f.read()
    except OSError as error:
        raise InputError(f"не прочитать манифест {path}: {error.strerror}") from None
    try:
        data = json.loads(raw)
    except ValueError as error:
        raise InputError(f"манифест {path} — не JSON: {error}") from None
    return parse_manifest(data)


# --- Звук -----------------------------------------------------------------------------------------


def shape_audio(samples, sample_rate: int = SAMPLE_RATE):
    """Тишина по краям ≤ EDGE_S, подъём/спад FADE_S, громкость речи TARGET_DBFS, пик ≤ PEAK_DBFS."""
    import numpy as np

    a = np.asarray(samples, dtype=np.float64).reshape(-1)
    if a.size == 0 or not np.isfinite(a).all():
        raise ClipError("синтезатор вернул пустой или битый звук")
    peak = float(np.abs(a).max())
    if peak < 1e-4:
        raise ClipError("синтезатор вернул тишину (в тексте нет ничего, что он читает?)")

    loud = np.flatnonzero(np.abs(a) > peak * 10 ** (EDGE_DB / 20))
    keep = int(EDGE_S * sample_rate)
    a = a[max(0, loud[0] - keep) : min(a.size, loud[-1] + 1 + keep)].copy()

    fade = min(int(FADE_S * sample_rate), a.size // 2)
    if fade > 0:
        ramp = 0.5 - 0.5 * np.cos(np.linspace(0.0, np.pi, fade))
        a[:fade] *= ramp
        a[-fade:] *= ramp[::-1]

    frame = int(0.02 * sample_rate)
    if a.size >= frame:
        n = a.size // frame
        rms = np.sqrt(np.mean(a[: n * frame].reshape(n, frame) ** 2, axis=1))
    else:
        rms = np.sqrt(np.mean(a**2, keepdims=True))
    active = rms[rms >= rms.max() * 10 ** (GATE_DB / 20)]
    level = float(np.sqrt(np.mean(active**2)))
    gain = min(10 ** (TARGET_DBFS / 20) / level, 10 ** (PEAK_DBFS / 20) / float(np.abs(a).max()))
    return a * gain


def to_pcm16(a) -> bytes:
    import numpy as np

    return (np.clip(a, -1.0, 1.0) * 32767.0).round().astype("<i2").tobytes()


def find_ffmpeg(explicit: str | None) -> str:
    path = explicit or os.environ.get("FFMPEG") or shutil.which("ffmpeg")
    if not path:
        raise InputError("нет ffmpeg: apt-get install ffmpeg или путь в --ffmpeg / FFMPEG")
    try:
        encoders = subprocess.run(
            [path, "-hide_banner", "-encoders"], capture_output=True, text=True, timeout=30
        ).stdout
        version = subprocess.run(
            [path, "-hide_banner", "-version"], capture_output=True, text=True, timeout=30
        ).stdout
    except OSError as error:
        raise InputError(f"ffmpeg {path} не запускается: {error}") from None
    if not re.search(r"\blibmp3lame\b", encoders):
        raise InputError(f"ffmpeg {path} собран без libmp3lame — MP3 им не закодировать")
    log(f"ffmpeg: {version.splitlines()[0] if version else path}")
    return path


def encode_mp3(pcm16: bytes, ffmpeg: str, workdir: str, sample_rate: int = SAMPLE_RATE) -> bytes:
    """PCM s16le моно → MP3 CBR моно. Файл, а не pipe: в файл ffmpeg пишет заголовок Xing/LAME
    (длительность и задержка кодера для декодера), в pipe — нет. Без тегов ID3 и метаданных."""
    out = os.path.join(workdir, "clip.mp3")
    command = [
        ffmpeg, "-hide_banner", "-nostdin", "-loglevel", "error",
        "-f", "s16le", "-ar", str(sample_rate), "-ac", "1", "-i", "pipe:0",
        "-map_metadata", "-1", "-c:a", "libmp3lame", "-b:a", BITRATE, "-ac", "1",
        "-id3v2_version", "0", "-f", "mp3", "-y", out,
    ]  # fmt: skip
    result = subprocess.run(command, input=pcm16, capture_output=True, timeout=120)
    if result.returncode != 0:
        detail = result.stderr.decode("utf-8", "replace").strip()[-500:]
        raise ClipError(f"ffmpeg завершился с кодом {result.returncode}: {detail}")
    with open(out, "rb") as f:
        data = f.read()
    if len(data) < 4 or data[0] != 0xFF or data[1] & 0xE0 != 0xE0:
        raise ClipError("ffmpeg вернул не MP3 (нет синхрослова кадра в начале)")
    return data


class Synthesizer:
    """Silero из torch.package на CPU. torch и numpy грузятся только здесь: --plan и запуск без
    новых фраз обходятся без них (workflow ставит torch, только когда есть что озвучить)."""

    def __init__(self, model_path: str, model_sha256: str, ffmpeg: str, threads: int) -> None:
        import torch

        if not os.path.isfile(model_path):
            raise InputError(f"нет файла модели {model_path}")
        digest = hashlib.sha256()
        with open(model_path, "rb") as f:
            for chunk in iter(lambda: f.read(1 << 20), b""):
                digest.update(chunk)
        if digest.hexdigest() != model_sha256:
            raise InputError(
                f"модель {model_path}: sha256 {digest.hexdigest()}, ждали {model_sha256} — "
                "не тот файл"
            )
        started = time.monotonic()
        with warnings.catch_warnings():
            # В коде модели есть SyntaxWarning (экранирование в строке) — безвреден.
            warnings.simplefilter("ignore", SyntaxWarning)
            importer = torch.package.PackageImporter(model_path)
            self.model = importer.load_pickle("tts_models", "model")
        self.model.to(torch.device("cpu"))
        # Модель при загрузке ставит один поток; синтез на нескольких заметно быстрее.
        torch.set_num_threads(max(1, threads))
        self.torch = torch
        self.ffmpeg = ffmpeg
        self.workdir = tempfile.mkdtemp(prefix="poker-club-voice-")
        log(
            f"модель загружена за {time.monotonic() - started:.1f} с, torch {torch.__version__}, "
            f"потоков {torch.get_num_threads()}"
        )

    def clip(self, clip: Clip) -> tuple[bytes, int, float]:
        """MP3, длительность в мс и секунды синтеза."""
        speaker = VOICES[clip.voice]["speaker"]
        started = time.monotonic()
        try:
            with self.torch.inference_mode():
                audio = self.model.apply_tts(
                    text=clip.text,
                    speaker=speaker,
                    sample_rate=SAMPLE_RATE,
                    put_accent=True,
                    put_yo=True,
                )
        except Exception as error:  # Silero падает на тексте без читаемых символов и т. п.
            raise ClipError(f"Silero: {type(error).__name__}: {error}") from None
        synth_s = time.monotonic() - started
        shaped = shape_audio(audio.detach().cpu().numpy())
        duration_ms = max(1, round(shaped.size / SAMPLE_RATE * 1000))
        if duration_ms > DURATION_MAX_MS:
            raise ClipError(f"длительность {duration_ms} мс больше {DURATION_MAX_MS} мс")
        data = encode_mp3(to_pcm16(shaped), self.ffmpeg, self.workdir)
        if len(data) > AUDIO_MAX_BYTES:
            raise ClipError(f"MP3 {len(data)} Б больше {AUDIO_MAX_BYTES} Б")
        return data, duration_ms, synth_s

    def close(self) -> None:
        shutil.rmtree(self.workdir, ignore_errors=True)


# --- База -----------------------------------------------------------------------------------------


def connect(url: str):
    import psycopg

    # prepare_threshold=None — без серверных prepared statements: строка может вести в пулер.
    return psycopg.connect(
        url,
        autocommit=True,
        connect_timeout=30,
        application_name="poker-club-voice",
        prepare_threshold=None,
    )


def existing_keys(conn) -> set[tuple[str, str]]:
    with conn.cursor() as cur:
        cur.execute("select voice, text_hash from public.voice_clips")
        return {(voice, digest) for voice, digest in cur.fetchall()}


def insert_clip(conn, clip: Clip, audio: bytes, duration_ms: int) -> bool:
    """True — вставлен; False — уже был (параллельный запуск успел раньше)."""
    with conn.cursor() as cur:
        cur.execute(
            "insert into public.voice_clips (voice, text_hash, text, audio, mime, duration_ms) "
            "values (%s, %s, %s, %s, 'audio/mpeg', %s) "
            "on conflict (voice, text_hash) do nothing returning 1",
            (clip.voice, clip.hash, clip.text, audio, duration_ms),
        )
        return cur.fetchone() is not None


def prune(conn, clips: list[Clip]) -> list[tuple[str, str]]:
    """Удаляет клипы любого голоса, которых нет в манифесте. Возвращает (voice, text) удалённых."""
    with conn.cursor() as cur:
        cur.execute(
            "delete from public.voice_clips c "
            "where not exists (select 1 from unnest(%s::text[], %s::text[]) as m(voice, text_hash) "
            "                  where m.voice = c.voice and m.text_hash = c.text_hash) "
            "returning c.voice, c.text",
            ([c.voice for c in clips], [c.hash for c in clips]),
        )
        return list(cur.fetchall())


# --- Запуск ---------------------------------------------------------------------------------------


def human_bytes(n: int) -> str:
    return f"{n / 1024:.0f} КБ" if n < 1024 * 1024 else f"{n / 1024 / 1024:.2f} МБ"


def write_summary(rows: list[tuple[str, str]], failed: list[tuple[Clip, str]]) -> None:
    path = os.environ.get("GITHUB_STEP_SUMMARY")
    if not path:
        return
    lines = ["### Голос табло", "", "| | |", "|---|---|", *(f"| {k} | {v} |" for k, v in rows), ""]
    if failed:
        lines += ["Не озвучены:", "", *(f"- «{c.text}» — {why}" for c, why in failed), ""]
    with open(path, "a", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")


def empty_stats() -> dict:
    return {"made": 0, "bytes": 0, "audio_ms": 0, "synth_s": 0.0, "failed": []}


def synthesize(conn, synth: Synthesizer, missing: list[Clip], redact: Redactor) -> dict:
    """Озвучивает и пишет по одной фразе (autocommit: прерванный запуск сделанного не теряет)."""
    import psycopg

    stats = empty_stats()
    for i, clip in enumerate(missing, 1):
        try:
            audio, duration_ms, synth_s = synth.clip(clip)
        except ClipError as error:
            stats["failed"].append((clip, str(error)))
            annotate("error", "Фраза не озвучена", f"«{clip.text}»: {error}")
            continue
        stats["synth_s"] += synth_s
        try:
            inserted = insert_clip(conn, clip, audio, duration_ms)
        except psycopg.Error as error:
            if conn.closed or conn.broken:
                raise
            stats["failed"].append((clip, redact(error)))
            annotate("error", "Клип не записан", f"«{clip.text}»: {redact(error)}")
            continue
        if inserted:
            stats["made"] += 1
            stats["bytes"] += len(audio)
            stats["audio_ms"] += duration_ms
        log(
            f"[{i}/{len(missing)}] {duration_ms} мс, {len(audio)} Б, синтез {synth_s:.2f} с: "
            f"{clip.text}{'' if inserted else ' (уже был)'}"
        )
    return stats


def run(args: argparse.Namespace, url: str, redact: Redactor) -> int:
    clips = read_manifest(args.manifest)
    conn = connect(url)
    try:
        have = existing_keys(conn)
        missing = [c for c in clips if (c.voice, c.hash) not in have]
        log(
            f"манифест: {len(clips)} фраз ({', '.join(sorted({c.voice for c in clips}))}); "
            f"в базе из них уже {len(clips) - len(missing)}, озвучить {len(missing)}"
        )
        if args.plan:
            # key=value — прямо в $GITHUB_OUTPUT: workflow ставит torch и качает модель, только
            # когда есть что озвучить, и берёт адрес и хеш модели отсюда, а не держит копию.
            print(f"missing={len(missing)}")
            models = {VOICES[c.voice]["model_url"] for c in missing}
            if len(models) == 1:
                model = VOICES[missing[0].voice]
                print(f"model_url={model['model_url']}")
                print(f"model_sha256={model['model_sha256']}")
                print(f"model_file={model['model_url'].rsplit('/', 1)[-1]}")
            return 0

        started = time.monotonic()
        stats = empty_stats()
        if missing:
            models = {VOICES[c.voice]["model_sha256"] for c in missing}
            if len(models) > 1:
                raise InputError("в манифесте голоса разных моделей — один запуск озвучивает одной")
            if not args.model:
                hint = VOICES[missing[0].voice]["model_url"]
                raise InputError(f"нужна модель: --model путь/к/файлу (скачать: {hint})")
            synth = Synthesizer(args.model, models.pop(), find_ffmpeg(args.ffmpeg), args.threads)
            try:
                stats = synthesize(conn, synth, missing, redact)
            finally:
                synth.close()
        elapsed = time.monotonic() - started
        failed: list[tuple[Clip, str]] = stats["failed"]

        # Чистка — только когда весь манифест в базе: тогда в таблице заведомо есть всё, что
        # может понадобиться табло, а удаляется лишь то, чего оно уже не попросит.
        pruned: list[tuple[str, str]] = []
        if args.prune and failed:
            annotate("warning", "Чистка пропущена", "не всё озвучено — старые клипы не тронуты")
        elif args.prune:
            pruned = prune(conn, clips)
            for voice, text in pruned[:30]:
                log(f"удалён устаревший клип ({voice}): {text}")
            if len(pruned) > 30:
                log(f"… и ещё {len(pruned) - 30}")

        made = stats["made"]
        rows = [
            ("Фраз в манифесте", str(len(clips))),
            ("Уже были в базе", str(len(clips) - len(missing))),
            (
                "Озвучено сейчас",
                f"{made} — {human_bytes(stats['bytes'])}, звук {stats['audio_ms'] / 1000:.1f} с, "
                f"синтез {stats['synth_s']:.1f} с, весь шаг {elapsed:.1f} с"
                if made
                else "0",
            ),
            ("Не озвучено", str(len(failed))),
            ("Удалено устаревших", str(len(pruned)) if args.prune and not failed else "—"),
        ]
        for key, value in rows:
            log(f"{key}: {value}")
        write_summary(rows, failed)
        if failed:
            annotate("error", "Голос табло", f"не озвучено фраз: {len(failed)} из {len(missing)}")
            return 1
        return 0
    finally:
        conn.close()


def main(argv: list[str] | None = None) -> int:
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(errors="backslashreplace")
        except AttributeError:
            pass
    parser = argparse.ArgumentParser(
        description="Озвучить фразы манифеста голоса табло, которых нет в public.voice_clips."
    )
    parser.add_argument("manifest", help="manifest.json от manifest.mjs («-» — stdin)")
    parser.add_argument("--model", help="файл модели Silero; нужен, если есть что озвучить")
    parser.add_argument("--ffmpeg", help="ffmpeg с libmp3lame (иначе $FFMPEG или ffmpeg из PATH)")
    parser.add_argument(
        "--db-url-env",
        default="SUPABASE_DB_URL",
        help="имя переменной окружения со строкой подключения (по умолчанию SUPABASE_DB_URL)",
    )
    parser.add_argument(
        "--plan",
        action="store_true",
        help="только план, без torch и ffmpeg: в stdout missing=N и model_url, model_sha256, "
        "model_file",
    )
    parser.add_argument(
        "--prune",
        action="store_true",
        help="после озвучки без ошибок удалить клипы, которых в манифесте нет",
    )
    parser.add_argument(
        "--threads",
        type=int,
        default=min(4, os.cpu_count() or 1),
        help="потоков torch (по умолчанию min(4, число ядер))",
    )
    args = parser.parse_args(argv)
    url = os.environ.get(args.db_url_env, "")
    redact = Redactor(url)
    try:
        if not url:
            raise InputError(f"нет строки подключения: переменная {args.db_url_env} пуста")
        return run(args, url, redact)
    except InputError as error:
        annotate("error", "Генератор голоса", str(error))
        return 2
    except Exception as error:  # база, ffmpeg, torch: текст и трассировка — без пароля
        log(redact(traceback.format_exc()).rstrip())
        annotate("error", "Генератор голоса", f"{type(error).__name__}: {redact(error)}")
        return 1


if __name__ == "__main__":
    sys.exit(main())
