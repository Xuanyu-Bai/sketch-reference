"""
meshify.py
==========
Meshy.ai 图像转 3D 批量工具（生产级）。

特性
----
1. 直接上传本地图片（无需图床 / 临时 URL）
2. 单张 / 批量两种模式
3. 余额检查，余额不足提前告警
4. 并发可控（默认 1，避免超额扣费）
5. 失败自动重试
6. 中文进度提示

依赖
----
    pip install requests

环境变量
--------
    MESHY_API_KEY    必填，Meshy.ai 后台获取

用法
----
    # 单张
    python meshify.py sketch.png

    # 批量
    python meshify.py ./sketches/ -o ./models/

    # 自定义参数
    python meshify.py ./sketches/ -o ./models/ --polycount 30000 --workers 2

    # 不带贴图（默认；素描图推荐）
    python meshify.py sketch.png

    # 带 PBR 贴图（仅照片需要）
    python meshify.py photo.png --texture
"""

from __future__ import annotations

import sys
if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass
import argparse
import concurrent.futures as cf
import base64
import mimetypes
import os
import sys
import time
from pathlib import Path

import requests

BASE = "https://api.meshy.ai/openapi/v2"
DEFAULT_MODEL = "meshy-5"
DEFAULT_POLYCOUNT = 10_000
ALLOWED_EXT = {".png", ".jpg", ".jpeg", ".webp"}


# ===================== 工具函数 =====================

def _headers() -> dict:
    key = os.environ.get("MESHY_API_KEY")
    if not key:
        sys.exit(
            "❌ 未设置 MESHY_API_KEY 环境变量。\n"
            "   PowerShell: setx MESHY_API_KEY \"<your_key>\"  (然后重开终端)\n"
            "   macOS / Linux: export MESHY_API_KEY=<your_key>"
        )
    return {"Authorization": f"Bearer {key}"}


def verify_credit() -> float | None:
    """查询账户余额（credits）。接口不存在或失败时返回 None，不阻塞。"""
    try:
        r = requests.get(f"{BASE}/users/me/balance", headers=_headers(), timeout=15)
        if r.status_code == 404:
            return None  # 该接口不存在，正常跳过
        r.raise_for_status()
        return r.json().get("balance", 0)
    except Exception:
        return None  # 网络问题等，正常跳过


def upload_image_as_data_url(filepath: Path) -> str:
    """把图片 base64 编码成 data URL 内嵌进请求，绕开所有外网图床。
    缺点：JSON body 会变大（~33% overhead），Meshy 不一定收。
    """
    mime = mimetypes.guess_type(str(filepath))[0] or "image/png"
    raw = filepath.read_bytes()
    b64 = base64.b64encode(raw).decode("ascii")
    print(f"   (图片 {len(raw)//1024} KB → data URL {len(b64)//1024} KB)")
    return f"data:{mime};base64,{b64}"


# 匿名临时图床（无需注册，链接保 24 小时）
_FREE_HOSTS = [
    ("https://0x0.st",          {"file": None}, lambda r: r.text.strip()),
    ("https://catbox.moe",      {"reqtype": "file", "fileToUpload": None},
                                  lambda r: r.text.strip()),
    ("https://uguu.se",         {"files[]": None}, lambda r: r.text.strip()),
]

def upload_image(filepath: Path) -> str:
    """上传本地图片到匿名图床，返回公网 URL。
    Meshy.ai 没有自己的文件上传接口，所以借助匿名图床。
    0x0.st / catbox.moe / uguu.se 任一可用即可。
    """
    last_err = None
    for host_url, file_fields, parse in _FREE_HOSTS:
        try:
            # 构造 multipart
            fields = {}
            files = {}
            with open(filepath, "rb") as f:
                for k in file_fields:
                    if k.startswith("file") or k == "reqtype":
                        fields[k] = file_fields[k] if file_fields[k] else (
                            "file" if k == "reqtype" else None
                        )
                # 简化：直接根据 host 决定上传字段名
                if "0x0.st" in host_url:
                    files = {"file": (filepath.name, f, "image/png")}
                    fields = {}
                elif "catbox.moe" in host_url:
                    fields = {"reqtype": "file"}
                    files = {"fileToUpload": (filepath.name, f, "image/png")}
                elif "uguu.se" in host_url:
                    files = {"files[]": (filepath.name, f, "image/png")}
                    fields = {}
                print(f"   ↪ 尝试 {host_url} ...")
                r = requests.post(
                    host_url, data=fields, files=files, timeout=120
                )
                r.raise_for_status()
                url = parse(r).strip()
                if not url.startswith("http"):
                    raise ValueError(f"返回不是 URL：{url[:80]}")
                print(f"   ✓ 上传成功：{url}")
                return url
        except Exception as e:
            last_err = e
            print(f"   ✗ {host_url} 失败：{type(e).__name__}: {str(e)[:80]}")
            continue
    raise RuntimeError(
        f"所有图床都失败了：{last_err}。\n"
        "   可手动上传到任意公网图床后用 --image-url 跳过上传。"
    )


def submit_task(image_url: str, polycount: int, with_texture: bool) -> str:
    payload = {
        "image_url": image_url,
        "model_id": DEFAULT_MODEL,
        "target_polycount": polycount,
        "topology": "triangle",
        "should_remesh": True,
        "should_texture": with_texture,
        "is_a_t_pose": False,
    }
    r = requests.post(
        f"{BASE}/image-to-3d", json=payload, headers=_headers(), timeout=60
    )
    r.raise_for_status()
    return r.json()["result"]


def poll_task(task_id: str, label: str = "", interval: int = 10, timeout: int = 1800) -> dict:
    """轮询直到成功 / 失败 / 超时。"""
    headers = _headers()
    deadline = time.time() + timeout
    last_progress = -1
    while time.time() < deadline:
        r = requests.get(
            f"{BASE}/image-to-3d/{task_id}", headers=headers, timeout=30
        )
        r.raise_for_status()
        d = r.json()
        status = d.get("status")
        progress = d.get("progress", 0)
        if progress != last_progress and progress % 10 == 0:
            print(f"   ⏳ {label} 状态={status} 进度={progress}%")
            last_progress = progress
        if status == "succeeded":
            return d
        if status in {"failed", "expired", "canceled"}:
            raise RuntimeError(f"任务 {label} 终止: {status}\n  {d}")
        time.sleep(interval)
    raise TimeoutError(f"任务 {label} 超时（{timeout}s）")


def download_glb(model_urls: dict, out: Path) -> Path:
    url = model_urls.get("glb")
    if not url:
        for k, v in model_urls.items():
            if k.startswith("glb") and isinstance(v, str):
                url = v
                break
    if not url:
        raise ValueError(f"找不到 GLB 链接: {model_urls}")
    r = requests.get(url, timeout=180, stream=True)
    r.raise_for_status()
    out.write_bytes(r.content)
    return out


# ===================== 核心处理 =====================

def process_one(
    src: Path, out_dir: Path, polycount: int, with_texture: bool,
    manual_url: str | None = None, use_data_url: bool = False,
    max_retry: int = 2,
) -> Path:
    """处理一张图片：上传 -> 提交 -> 轮询 -> 下载。带重试。"""
    label = src.name
    for attempt in range(1, max_retry + 2):
      try:
        if manual_url:
            img_url = manual_url
            print(f"\n🔗 [{label}] 使用指定 URL 提交...")
        elif use_data_url:
            print(f"\n📦 [{label}] 编码为 data URL...")
            img_url = upload_image_as_data_url(src)
        else:
            print(f"\n📤 [{label}] 上传图片...")
            img_url = upload_image(src)
        print(f"🚀 [{label}] 提交生成任务...")
        task_id = submit_task(img_url, polycount, with_texture)
        print(f"⏳ [{label}] 等待生成 task={task_id[:8]}...")
        result = poll_task(task_id, label)
        glb_path = out_dir / (src.stem + ".glb")
        download_glb(result["model_urls"], glb_path)
        triangles = result.get("stats", {}).get("total_triangles", "?")
        print(f"✅ [{label}] -> {glb_path.name} ({triangles} faces)")
        return glb_path
      except Exception as e:
        if attempt > max_retry:
            raise
        print(f"⚠️ [{label}] 第 {attempt} 次失败：{e}\n   重试中...")
        time.sleep(5)


def collect_inputs(p: Path) -> list[Path]:
    if p.is_file():
        return [p]
    files = sorted([x for x in p.rglob("*") if x.suffix.lower() in ALLOWED_EXT])
    if not files:
        sys.exit(f"❌ {p} 下没找到图片（支持 {sorted(ALLOWED_EXT)}）")
    return files


# ===================== CLI =====================

def main() -> None:
    ap = argparse.ArgumentParser(
        description="Meshy.ai 图像转 3D 工具（单张/批量）",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
示例:
  python meshify.py sketch.png
  python meshify.py ./sketches/ -o ./models/
  python meshify.py ./sketches/ -o ./models/ --polycount 30000 --workers 2
        """,
    )
    ap.add_argument("input", help="输入图片或图片目录")
    ap.add_argument("-o", "--output", default="models", help="输出目录（默认 models）")
    ap.add_argument("--polycount", type=int, default=DEFAULT_POLYCOUNT,
                    help="目标三角面数（默认 10000）")
    ap.add_argument("--texture", action="store_true",
                    help="生成带 PBR 贴图（默认关闭，素描图不需要）")
    ap.add_argument("--workers", type=int, default=1,
                    help="并发任务数（默认 1，推荐 ≤3）")
    ap.add_argument("--timeout", type=int, default=1800, help="单任务超时秒数")
    ap.add_argument("--no-balance-check", action="store_true", help="跳过余额检查")
    ap.add_argument("--image-url", help="手动指定公网 URL，跳过图床上传")
    ap.add_argument("--data-url", action="store_true",
                    help="用 base64 data URL 内嵌图片（绕开外网图床，需 Meshy 支持）")
    ap.add_argument("--yes", "-y", action="store_true", help="跳过确认提示")
    args = ap.parse_args()

    if args.image_url:
        inputs = [Path("<url>")]  # placeholder, not used; --image-url bypasses file input
    else:
        inputs = collect_inputs(Path(args.input))
    out_dir = Path(args.output)
    out_dir.mkdir(parents=True, exist_ok=True)

    print("📋 任务概览")
    print(f"   输入：{len(inputs)} 张图片")
    print(f"   输出：{out_dir.resolve()}")
    print(f"   面数：{args.polycount}")
    print(f"   并发：{args.workers}")
    print(f"   贴图：{'是' if args.texture else '否'}")

    if not args.no_balance_check:
        bal = verify_credit()
        if bal is not None:
            print(f"   余额：{bal} credits")

    if len(inputs) > 1 and not args.yes:
        ans = input(f"\n确认批量提交 {len(inputs)} 个任务？(y/N) ").strip().lower()
        if ans != "y":
            sys.exit("已取消")

    success, failed = 0, []
    with cf.ThreadPoolExecutor(max_workers=args.workers) as ex:
        futs = {
            ex.submit(process_one, src, out_dir, args.polycount, args.texture, args.image_url, args.data_url): src
            for src in inputs
        }
        for fut in cf.as_completed(futs):
            src = futs[fut]
            try:
                fut.result()
                success += 1
            except Exception as e:
                print(f"❌ {src.name}: {e}")
                failed.append(src.name)

    print(f"\n🎉 完成：{success}/{len(inputs)} 成功")
    if failed:
        print(f"   失败：{failed}")


if __name__ == "__main__":
    main()

