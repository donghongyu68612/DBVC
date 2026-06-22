import argparse
import json
import os
import sys
import time
import traceback


def main():
    parser = argparse.ArgumentParser(description="Bridge for local Index-TTS inference")
    parser.add_argument("--index-root", required=True)
    parser.add_argument("--prompt", required=True)
    parser.add_argument("--text", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--mode", default="normal", choices=["normal", "fast"])
    parser.add_argument("--max-text-tokens-per-sentence", type=int, default=120)
    parser.add_argument("--sentences-bucket-max-size", type=int, default=4)
    parser.add_argument("--do-sample", default="true")
    parser.add_argument("--top-p", type=float, default=0.8)
    parser.add_argument("--top-k", type=int, default=30)
    parser.add_argument("--temperature", type=float, default=1.0)
    parser.add_argument("--length-penalty", type=float, default=0.0)
    parser.add_argument("--num-beams", type=int, default=3)
    parser.add_argument("--repetition-penalty", type=float, default=10.0)
    parser.add_argument("--max-mel-tokens", type=int, default=600)
    args = parser.parse_args()

    index_root = os.path.abspath(args.index_root)
    os.chdir(index_root)
    sys.path.insert(0, index_root)
    sys.path.insert(0, os.path.join(index_root, "indextts"))

    model_dir = os.path.join(index_root, "checkpoints")
    cfg_path = os.path.join(model_dir, "config.yaml")

    from indextts.infer import IndexTTS

    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    tts = IndexTTS(model_dir=model_dir, cfg_path=cfg_path)

    kwargs = {
        "do_sample": str(args.do_sample).lower() in ["1", "true", "yes", "y"],
        "top_p": float(args.top_p),
        "top_k": int(args.top_k) if int(args.top_k) > 0 else None,
        "temperature": float(args.temperature),
        "length_penalty": float(args.length_penalty),
        "num_beams": int(args.num_beams),
        "repetition_penalty": float(args.repetition_penalty),
        "max_mel_tokens": int(args.max_mel_tokens),
    }

    started = time.time()
    if args.mode == "fast":
        generated = tts.infer_fast(
            args.prompt,
            args.text,
            args.out,
            verbose=False,
            max_text_tokens_per_sentence=int(args.max_text_tokens_per_sentence),
            sentences_bucket_max_size=int(args.sentences_bucket_max_size),
            **kwargs,
        )
    else:
        generated = tts.infer(
            args.prompt,
            args.text,
            args.out,
            verbose=False,
            max_text_tokens_per_sentence=int(args.max_text_tokens_per_sentence),
            **kwargs,
        )

    print(json.dumps({
        "ok": True,
        "output": os.path.abspath(generated or args.out),
        "elapsedSeconds": round(time.time() - started, 3),
    }, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(json.dumps({
            "ok": False,
            "error": str(exc),
            "traceback": traceback.format_exc(),
        }, ensure_ascii=False))
        sys.exit(1)
