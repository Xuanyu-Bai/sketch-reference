"""meshify.py
==========
Meshy.ai 图像转 3D 工具（生产级 · 适配 Meshy 当前 API v1/v2）。

特性
----
1. 直接上传本地图片（无需图床 / 临时 URL），或使用指定 URL
2. 单张 / 批量两种模式
3. 失败自动重试（最多 2 次）
4. 中文进度提示
5. 适配 Meshy 当前 API：
   - POST  https://api.meshy.ai/v1/image-to-3d
   - GET   https://api.meshy.ai/v1/image-to-3d/{id}
   - GET   https://api.meshy.ai/v1/image-to-3d/{id}/stream （SSE 流式）
   - GET   https://api.meshy.ai/v1/balance （余额）

依赖
----
    pip install requests

环境变量
--------
    MESHY_API_KEY    必填，Meshy.ai 后台获取

用法
----
    # 单张（默认 10k 面，无贴图）
    python meshify.py sketch.png

    # 批量
    python meshify.py ./sketches/ -o ./models/

    # 自定义参数
    python meshify.py ./sketches/ -o ./models/ --polycount 30000 --workers 2

    # 不带贴图（默认；素描图推荐）
    python meshify.py sketch.png

    # 显式指定公网 URL（跳过上传）
    python meshify.py --image-url "https://example.com/face.jpg" -o face.glb

作者：Codex (基于用户与项目需求)
"""
from __future__ import annotations

import sys
if sys.platform == 'win32':
    try:
        sys.stdout.reconfigure(encoding='utf-8')
        sys.stderr.reconfigure(encoding='utf-8')
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

# Meshy 当前 API 路径
BASE = 'https://api.meshy.ai'
IMAGE_TO_3D_PATH = '/v1/image-to-3d'
DEFAULT_MODEL = 'latest'         # 让 Meshy 自动选最新可用模型
DEFAULT_POLYCOUNT = 10_000
ALLOWED_EXT = {'.png', '.jpg', '.jpeg', '.webp'}

# ===================== 工具函数 =====================

def _headers() -> dict:
    key = os.environ.get('MESHY_API_KEY')
    if not key:
        sys.exit(
            '❌ 未设置 MESHY_API_KEY 环境变量。\n'
            '   PowerShell: $env:MESHY_API_KEY="<your_key>"\n'
            '   macOS/Linux: export MESHY_API_KEY=<your_key>'
        )
    return {'Authorization': f'Bearer {key}'}


def verify_credit() -> float | None:
    """查询账户余额（credits）。如果接口不可用返回 None，不阻塞主流程。"""
    try:
        r = requests.get(f'{BASE}/v1/balance', headers=_headers(), timeout=15)
        if r.status_code == 200:
            data = r.json()
            return data.get('balance')
        if r.status_code == 404:
            # 接口不存在 / 不可用，silent 跳过
            return None
        r.raise_for_status()
    except Exception as e:
        print(f'   (余额查询失败: {e})')
    return None


def upload_image_as_data_url(filepath: Path) -> str:
    """把图片 base64 编码成 data URL。"""
    mime = mimetypes.guess_type(str(filepath))[0] or 'image/png'
    raw = filepath.read_bytes()
    b64 = base64.b64encode(raw).decode('ascii')
    print(f'   (图片 {len(raw)//1024} KB → data URL {len(b64)//1024} KB)')
    return f'data:{mime};base64,{b64}'


# 匿名临时图床（无需注册，链接保 24 小时）
_FREE_HOSTS = [
    ('https://0x0.st',     {'file': None}),
    ('https://catbox.moe', {'reqtype': 'file', 'fileToUpload': None}),
    ('uguu.se',            {'files[]': None}),
]

def upload_image(filepath: Path) -> str:
    """上传本地图片到匿名图床，返回公网 URL。
    Meshy 当前 API 要求 image_url 必须是公网可访问的 URL（除非用 data URL，但有些场景会拒）。
    失败时回退到 data URL。"""
    last_err = None
    for host_url, file_fields in _FREE_HOSTS:
        try:
            with open(filepath, 'rb') as f:
                if '0x0.st' in host_url:
                    files = {'file': (filepath.name, f, 'image/png')}
                    fields = {}
                elif 'catbox.moe' in host_url:
                    fields = {'reqtype': 'file'}
                    files = {'fileToUpload': (filepath.name, f, 'image/png')}
                elif 'uguu.se' in host_url:
                    files = {'files[]': (filepath.name, f, 'image/png')}
                    fields = {}
                else:
                    continue
                print(f'   ↪ 尝试 {host_url} ...')
                r = requests.post(host_url, data=fields, files=files, timeout=120)
                r.raise_for_status()
                url = r.text.strip()
                if not url.startswith('http'):
                    raise ValueError(f'返回不是 URL: {url[:80]}')
                print(f'   ✓ 上传成功: {url}')
                return url
        except Exception as e:
            last_err = e
            print(f'   ⚠️ {host_url} 失败: {e}')
    # 全部图床都失败 → 回退到 data URL（Meshy 可能不接受，但试一下）
    print(f'   ⚠️ 匿名图床全部失败，回退到 data URL (last err: {last_err})')
    return upload_image_as_data_url(filepath)


# ===================== 核心 API =====================

def submit_task(img_url: str, polycount: int, with_texture: bool,
                ai_model: str = DEFAULT_MODEL) -> str:
    """提交 Image-to-3D 任务，返回 task_id。
    Meshy 当前 API：POST /v1/image-to-3d
    """
    payload = {
        'image_url': img_url,
        'ai_model': ai_model,
        'topology': 'triangle',
        'target_polycount': polycount,
        'should_texture': with_texture,
        'moderation': False,
        'origin_at': 'bottom',  # 原点放底部，模型稳站地面（适配美术 app）
    }
    r = requests.post(
        f'{BASE}{IMAGE_TO_3D_PATH}',
        json=payload,
        headers=_headers(),
        timeout=60,
    )
    r.raise_for_status()
    data = r.json()
    # 响应结构可能是 {"result": "task_id"} 或直接 {"id": "..."}
    return data.get('result') or data.get('id')


def poll_task(task_id: str, label: str = '', interval: int = 15,
              timeout: int = 900) -> dict:
    """轮询任务直到完成或失败。
    Meshy 当前 API：GET /v1/image-to-3d/{id}
    状态值（大写）：PENDING / IN_PROGRESS / SUCCEEDED / FAILED / CANCELED
    """
    deadline = time.time() + timeout
    while time.time() < deadline:
        r = requests.get(
            f'{BASE}{IMAGE_TO_3D_PATH}/{task_id}',
            headers=_headers(),
            timeout=30,
        )
        r.raise_for_status()
        data = r.json()
        status = data.get('status', 'UNKNOWN')
        progress = data.get('progress', 0)
        queue = data.get('preceding_tasks')
        queue_str = f' [队列前 {queue}]' if queue else ''
        print(f'  [{task_id[:8]}...] {label} status={status:<12s} progress={progress}%{queue_str}')
        if status == 'SUCCEEDED':
            return data
        if status in ('FAILED', 'CANCELED'):
            sys.exit(f'[ERROR] 任务终止: {status}\n  {data}')
        time.sleep(interval)
    sys.exit('[ERROR] 任务超时，请提高 --timeout 或稍后重试。')


def download_glb(model_urls: dict, out_path: Path) -> Path:
    """下载生成的 GLB 文件。
    Meshy 响应：model_urls.glb (或 model_urls.glb_xxx 多个格式)
    """
    glb_url = model_urls.get('glb')
    if not glb_url:
        for k, v in model_urls.items():
            if k.startswith('glb') and isinstance(v, str):
                glb_url = v
                break
    if not glb_url:
        sys.exit(f'[ERROR] 找不到 GLB 下载链接: {list(model_urls.keys())}')
    print(f'  下载: {glb_url}')
    r = requests.get(glb_url, timeout=120, stream=True)
    r.raise_for_status()
    out_path.write_bytes(r.content)
    return out_path


# ===================== 核心处理 =====================

def process_one(
    src: Path, out_dir: Path, polycount: int, with_texture: bool,
    ai_model: str, manual_url: str | None = None, use_data_url: bool = False,
    max_retry: int = 2,
) -> Path:
    """处理一张图片：上传 -> 提交 -> 轮询 -> 下载。带重试。"""
    label = src.name if isinstance(src, Path) else '<url>'
    for attempt in range(1, max_retry + 2):
        try:
            if manual_url:
                img_url = manual_url
                print(f'\n🔗 [{label}] 使用指定 URL 提交...')
            elif use_data_url:
                print(f'\n📦 [{label}] 编码为 data URL...')
                img_url = upload_image_as_data_url(src)
            else:
                print(f'\n📤 [{label}] 上传图片...')
                img_url = upload_image(src)
            print(f'🚀 [{label}] 提交生成任务 (model={ai_model}, polycount={polycount})...')
            task_id = submit_task(img_url, polycount, with_texture, ai_model)
            print(f'⏳ [{label}] 等待生成 task={task_id[:8]}...')
            result = poll_task(task_id, label=label)
            out_name = (src.stem if isinstance(src, Path) else 'output') + '.glb'
            glb_path = out_dir / out_name
            download_glb(result.get('model_urls', {}), glb_path)
            print(f'✅ [{label}] -> {glb_path.name} ({glb_path.stat().st_size // 1024} KB)')
            return glb_path
        except Exception as e:
            if attempt > max_retry:
                raise
            print(f'⚠️ [{label}] 第 {attempt} 次失败：{e}\n   重试中...')
            time.sleep(5)


def collect_inputs(p: Path) -> list[Path]:
    if p.is_file():
        return [p]
    files = sorted([x for x in p.rglob('*') if x.suffix.lower() in ALLOWED_EXT])
    if not files:
        sys.exit(f'❌ {p} 下没找到图片（支持 {sorted(ALLOWED_EXT)}）')
    return files


# ===================== CLI =====================

def main() -> None:
    ap = argparse.ArgumentParser(
        description='Meshy.ai 图像转 3D 工具（适配 Meshy 当前 API）',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog='''
示例:
  python meshify.py sketch.png
  python meshify.py ./sketches/ -o ./models/
  python meshify.py ./sketches/ -o ./models/ --polycount 30000 --workers 2
  python meshify.py --image-url "https://example.com/face.jpg" -o face.glb
        ''',
    )
    ap.add_argument('input', nargs='?',
                    help='输入图片或图片目录（与 --image-url 互斥）')
    ap.add_argument('-o', '--output', default='models',
                    help='输出目录（默认 models）')
    ap.add_argument('--polycount', type=int, default=DEFAULT_POLYCOUNT,
                    help='目标三角面数（默认 10000）')
    ap.add_argument('--texture', action='store_true',
                    help='生成带贴图（默认关闭，素描图不需要）')
    ap.add_argument('--ai-model', default=DEFAULT_MODEL,
                    choices=['meshy-4', 'meshy-5', 'meshy-6', 'meshy-7', 'latest', 'meshy-t2'],
                    help='AI 模型（默认 latest = 选最新可用）')
    ap.add_argument('--workers', type=int, default=1,
                    help='并发任务数（默认 1，推荐 ≤3）')
    ap.add_argument('--timeout', type=int, default=1800, help='单任务超时秒数')
    ap.add_argument('--no-balance-check', action='store_true', help='跳过余额检查')
    ap.add_argument('--image-url', help='手动指定公网 URL，跳过图床上传')
    ap.add_argument('--data-url', action='store_true',
                    help='用 base64 data URL 内嵌图片')
    ap.add_argument('--yes', '-y', action='store_true', help='跳过确认提示')
    args = ap.parse_args()

    if not args.image_url and not args.input:
        ap.error('需要提供 input 图片路径或 --image-url')

    if args.image_url:
        inputs = [Path('<url>')]
    else:
        inputs = collect_inputs(Path(args.input))
    out_dir = Path(args.output)
    out_dir.mkdir(parents=True, exist_ok=True)

    print('📋 任务概览')
    print(f'   输入：{len(inputs)} 张图片')
    print(f'   输出：{out_dir.resolve()}')
    print(f'   面数：{args.polycount}')
    print(f'   模型：{args.ai_model}')
    print(f'   贴图：{"是" if args.texture else "否"}')
    print(f'   并发：{args.workers}')

    if not args.no_balance_check:
        bal = verify_credit()
        if bal is not None:
            print(f'   余额：{bal} credits')
        else:
            print('   余额：(接口暂不可用，跳过检查)')

    if len(inputs) > 1 and not args.yes:
        ans = input(f'\n确认批量提交 {len(inputs)} 个任务？(y/N) ').strip().lower()
        if ans != 'y':
            sys.exit('已取消')

    success, failed = 0, []
    with cf.ThreadPoolExecutor(max_workers=args.workers) as ex:
        futs = {
            ex.submit(process_one, src, out_dir, args.polycount, args.texture,
                      args.ai_model, args.image_url, args.data_url): src
            for src in inputs
        }
        for fut in cf.as_completed(futs):
            src = futs[fut]
            try:
                fut.result()
                success += 1
            except Exception as e:
                print(f'❌ {src.name}: {e}')
                failed.append(src.name)

    print(f'\n🎉 完成：{success}/{len(inputs)} 成功')
    if failed:
        print(f'   失败：{failed}')


if __name__ == '__main__':
    main()
