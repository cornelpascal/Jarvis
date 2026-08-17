"""Local-only microphone wake-word sidecar for JARVIS.

Optional runtime dependencies: openwakeword, sounddevice, numpy.
The process emits bounded JSON lines and never opens a network connection.
"""

import argparse
import json
import queue
import signal
import sys

import numpy as np
import sounddevice as sd
from openwakeword.model import Model


def emit(value: dict) -> None:
    print(json.dumps(value, separators=(",", ":")), flush=True)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--threshold", type=float, required=True)
    parser.add_argument("--phrase", choices=["hey jarvis"], required=True)
    args = parser.parse_args()

    frames: queue.Queue[np.ndarray] = queue.Queue(maxsize=8)
    running = True

    def stop(_signum, _frame) -> None:
        nonlocal running
        running = False

    def audio_callback(indata, _frame_count, _time, status) -> None:
        if status:
            emit({"type": "warning", "message": "microphone stream warning"})
        try:
            frames.put_nowait(indata.copy().reshape(-1))
        except queue.Full:
            pass

    signal.signal(signal.SIGINT, stop)
    signal.signal(signal.SIGTERM, stop)
    model = Model(wakeword_models=["hey_jarvis"], inference_framework="onnx")
    emit({"type": "ready"})
    with sd.InputStream(
        samplerate=16000,
        channels=1,
        dtype="int16",
        blocksize=1280,
        callback=audio_callback,
    ):
        while running:
            try:
                frame = frames.get(timeout=0.25)
            except queue.Empty:
                continue
            predictions = model.predict(frame)
            score = max((float(value) for value in predictions.values()), default=0.0)
            if score >= args.threshold:
                emit({"type": "detected", "phrase": args.phrase, "score": score})
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        emit({"type": "error", "message": type(error).__name__})
        raise SystemExit(1)
