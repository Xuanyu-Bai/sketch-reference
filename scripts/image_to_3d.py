"""
image_to_3d.py
==============

把一张二维素描头像（png/jpg）转换为 GLB 格式的三维网格模型。
本脚本默认走 Meshy.ai REST API（与你在图二截图中看到的服务一致），
无需本地 GPU，按生成量计费。

使用方法：
    1) 在 https://app.meshy.ai 申请 API Key
    2) Windows PowerShell:
         setx MESHY_API_KEY "<your_key>"
       macOS / Linux:
         export MESHY_API_KEY="<your_key>"
    3) pip install requests pillow
    4) 把你的素描放到任意可被公网访问的 URL（也可以用 https://0x0.st
       这种临时图床），或者先上传到 GitHub / Cloudflare R2 / OSS。
    5) 运行：
         python image_to_3d.py --image-url "https://.../sketch.png" --out bust.glb

依赖：requests, pillow
"""
from __future__ import annotations

import argparse
import os
import sys
import time
from pathlib import Path

import requests

BASE_URL = "https://api.meshy.ai/openapi/v2"
DEFAULT_MODEL = "meshy-5"          # 最新 Flagship 图像转 3D 模型
DEFAULT_POLYCOUNT = 10000          # 接近图二中 10,365 的面数


def _headers() -> dict:
    api_key = os.environ.get("MESHY_API_KEY")
    if not api_key:
        sys.exit(
            "[ERROR] 未检测到环境变量 MESHY_API_KEY。\n"
            "  Windows: setx MESHY_API_KEY \"<your_key>\"\n"
            "  macOS/Linux: export MESHY_API_KEY=\"<your_key>\""
        )
    return {"Authorization": f"Bearer {api_key}"}


def submit_image_to_3d(image_url: str, polycount: int) -> str:
    """提交 Image-to-3D 任务，返回 task_id。"""
    payload = {
        "image_url": image_url,
        "model_id": DEFAULT_MODEL,
        "target_polycount": polycount,
        "topology": "triangle",
        "symmetry_mode": "auto",
        "should_remesh": True,
        "should_texture": False,   # 素描没有颜色，关掉贴图更干净
        "is_a_t_pose": False,
    }
    r = requests.post(
        f"{BASE_URL}/image-to-3d", json=payload, headers=_headers(), timeout=60,
    )
    r.raise_for_status()
    return r.json()["result"]


def poll_until_done(task_id: str, interval: int = 15, timeout: int = 900) -> dict:
    """轮询任务直到完成或失败。timeout 单位为秒。"""
    deadline = time.time() + timeout
    while time.time() < deadline:
        r = requests.get(
            f"{BASE_URL}/image-to-3d/{task_id}", headers=_headers(), timeout=30,
        )
        r.raise_for_status()
        data = r.json()
        status = data.get("status")
        progress = data.get("progress", 0)
        print(f"  [{task_id[:8]}...] status={status:<10s} progress={progress}%")
        if status == "succeeded":
            return data
        if status in {"failed", "expired", "canceled"}:
            sys.exit(f"[ERROR] 任务终止: {status}\n  {data}")
        time.sleep(interval)
    sys.exit("[ERROR] 任务超时，请提高 --timeout 或稍后重试。")


def download_glb(model_urls: dict, out_path: Path) -> Path:
    """下载生成的 GLB 文件。优先取主 glb，否则取第一个 glb_*。"""
    glb_url = model_urls.get("glb")
    if not glb_url:
        for k, v in model_urls.items():
            if k.startswith("glb") and isinstance(v, str):
                glb_url = v
                break
    if not glb_url:
        sys.exit(f"[ERROR] 找不到 GLB 下载链接: {model_urls}")

    print(f"  下载: {glb_url}")
    r = requests.get(glb_url, timeout=120, stream=True)
    r.raise_for_status()
    out_path.write_bytes(r.content)
    return out_path


def main() -> None:
    ap = argparse.ArgumentParser(description="2D 素描 -> 3D 网格 (Meshy.ai)")
    ap.add_argument("--image-url", required=True, help="素描图的公网 URL")
    ap.add_argument("--out", default="bust.glb", help="输出文件路径，默认 bust.glb")
    ap.add_argument("--polycount", type=int, default=DEFAULT_POLYCOUNT,
                    help="目标三角面数（默认 10000）")
    ap.add_argument("--interval", type=int, default=15, help="轮询间隔（秒）")
    ap.add_argument("--timeout", type=int, default=900, help="最大等待时间（秒）")
    args = ap.parse_args()

    print(f"[1/3] 提交任务: {args.image_url}")
    task_id = submit_image_to_3d(args.image_url, args.polycount)
    print(f"       task_id = {task_id}")

    print("[2/3] 等待生成 ...")
    result = poll_until_done(task_id, args.interval, args.timeout)
    model_urls = result.get("model_urls") or {}
    print(f"       完成。面数 = {result.get('stats', {}).get('total_triangles', '?')}")

    print("[3/3] 下载模型 ...")
    out = download_glb(model_urls, Path(args.out))
    print(f"[OK] 已保存: {out.resolve()}")


if __name__ == "__main__":
    main()
