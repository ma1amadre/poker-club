"""Проверки generate.py без базы и модели: python -m unittest scripts/voice/test_generate.py
(нужны numpy из requirements.txt; кодирование MP3 — если найдётся ffmpeg: $FFMPEG или PATH)."""

import os
import shutil
import subprocess
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import numpy as np  # noqa: E402

import generate as g  # noqa: E402

VOICE = "silero-v5_5-xenia"
SR = g.SAMPLE_RATE


def entry(text: str, voice: str = VOICE) -> dict:
    return {"voice": voice, "hash": g.clip_hash(voice, text), "text": text}


class HashTest(unittest.TestCase):
    def test_same_as_domain(self) -> None:
        # Значения — clipHash домена (supabase/functions/_shared/domain/voice.ts) в Node.
        self.assertEqual(
            g.clip_hash(VOICE, "Пауза."),
            "808475d9a7e8e52d9690e2812928d961f810e589cdb2aa22d78adbd2821de3b0",
        )
        self.assertEqual(
            g.clip_hash(VOICE, "Победитель вечера — В+ова!"),
            "d5c55897c6e5db279acd7afed10562d3fd166aeb25b018346c5d8f892dd78b41",
        )


class ManifestTest(unittest.TestCase):
    def test_keeps_order_and_drops_repeats(self) -> None:
        clips = g.parse_manifest([entry("Пауза."), entry("Продолжаем."), entry("Пауза.")])
        self.assertEqual([c.text for c in clips], ["Пауза.", "Продолжаем."])

    def test_rejects(self) -> None:
        bad_hash = {**entry("Пауза."), "hash": g.clip_hash(VOICE, "Пауза!")}
        cases = {
            "пустой": [],
            "не массив": {"voice": VOICE},
            "хеш не от текста": [bad_hash],
            "чужой голос": [entry("Пауза.", "silero-v5_5-baya")],
            "голос не по шаблону": [entry("Пауза.", "Xenia")],
            "двойной пробел": [entry("Нокаут!  Вылетает")],
            "пробел по краю": [entry("Пауза. ")],
            "перевод строки": [entry("Нокаут!\nВылетает")],
            "не NFC": [entry("Ёж")],
            "длинный": [entry("а" * 301)],
            "не строка": [{"voice": VOICE, "hash": "0" * 64, "text": 5}],
        }
        for name, data in cases.items():
            with self.subTest(name), self.assertRaises(g.InputError):
                g.parse_manifest(data)


class RedactTest(unittest.TestCase):
    def test_hides_password(self) -> None:
        url = "postgresql://postgres.ref:p%40ss%3Aw0rd@aws-0.pooler.supabase.com:5432/postgres"
        redact = g.Redactor(url)
        self.assertNotIn("p@ss:w0rd", redact("FATAL: password p@ss:w0rd rejected"))
        self.assertNotIn("p%40ss%3Aw0rd", redact(f"bad url {url}"))
        self.assertEqual(redact("no secrets here"), "no secrets here")

    def test_keyword_form_and_empty(self) -> None:
        self.assertEqual(g.Redactor("host=x password='s3cr et' user=u")("s3cr et"), "***")
        self.assertEqual(g.Redactor("")("text"), "text")


class ShapeTest(unittest.TestCase):
    def speech(self, lead_s: float, body_s: float, tail_s: float, amp: float) -> np.ndarray:
        t = np.arange(int(body_s * SR)) / SR
        body = amp * np.sin(2 * np.pi * 220 * t) * (0.6 + 0.4 * np.sin(2 * np.pi * 3 * t))
        noise = np.random.default_rng(1).normal(0, 1e-5, int((lead_s + tail_s) * SR))
        return np.concatenate([noise[: int(lead_s * SR)], body, noise[int(lead_s * SR) :]])

    def test_trims_edges_and_levels(self) -> None:
        a = g.shape_audio(self.speech(0.3, 1.0, 0.4, 0.2))
        self.assertLessEqual(a.size, int((1.0 + 2 * g.EDGE_S) * SR) + 2)
        self.assertGreaterEqual(a.size, int(1.0 * SR))
        self.assertLessEqual(20 * np.log10(np.abs(a).max()), g.PEAK_DBFS + 1e-6)
        self.assertEqual(a[0], 0.0)  # подъём с нуля — без щелчка
        quiet = g.shape_audio(self.speech(0.05, 1.0, 0.05, 0.02))
        loud = g.shape_audio(self.speech(0.05, 1.0, 0.05, 0.5))
        rms = lambda x: 20 * np.log10(np.sqrt(np.mean(x**2)))  # noqa: E731
        self.assertAlmostEqual(rms(quiet), rms(loud), delta=0.5)

    def test_short_edges_are_kept(self) -> None:
        a = g.shape_audio(self.speech(0.02, 0.5, 0.0, 0.3))
        self.assertEqual(a.size, int(0.52 * SR))

    def test_silence_is_an_error(self) -> None:
        with self.assertRaises(g.ClipError):
            g.shape_audio(np.zeros(SR))
        with self.assertRaises(g.ClipError):
            g.shape_audio(np.array([]))

    def test_pcm(self) -> None:
        pcm = g.to_pcm16(np.array([0.0, 1.5, -1.5, 0.5]))
        self.assertEqual(np.frombuffer(pcm, "<i2").tolist(), [0, 32767, -32767, 16384])


@unittest.skipUnless(os.environ.get("FFMPEG") or shutil.which("ffmpeg"), "нет ffmpeg")
class EncodeTest(unittest.TestCase):
    def test_mp3_mono_48k(self) -> None:
        ffmpeg = g.find_ffmpeg(None)
        t = np.arange(SR) / SR
        a = g.shape_audio(0.3 * np.sin(2 * np.pi * 440 * t))
        with tempfile.TemporaryDirectory() as tmp:
            data = g.encode_mp3(g.to_pcm16(a), ffmpeg, tmp)
            path = os.path.join(tmp, "check.mp3")
            with open(path, "wb") as f:
                f.write(data)
            probe = subprocess.run(
                [ffmpeg, "-hide_banner", "-i", path], capture_output=True, text=True
            ).stderr
        self.assertNotIn(b"ID3", data[:3])
        self.assertIn("mp3", probe)
        self.assertIn("48000 Hz, mono", probe)
        self.assertIn("64 kb/s", probe)
        # 1 с при 64 kbps ≈ 8 КБ (+ кадр Xing).
        self.assertTrue(7000 < len(data) < 10000, len(data))


if __name__ == "__main__":
    unittest.main()
