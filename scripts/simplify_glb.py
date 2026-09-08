"""
simplify_glb.py
==============

把 GLB 文件从高模（~100 万面）简化到目标面数（默认 3 万面）。
保留视觉外观，iPad 上流畅。

Meshy 默认生成的 GLB 通常 1.9M 三角形，iPad Air 4 只能跑 30 FPS 左右。
简化到 30K 后能跑到 60 FPS，包体从 33 MB → ~1 MB。

用法：
    python simplify_glb.py models/head-sketch-natural-v1.glb
    python simplify_glb.py models/head-sketch-natural-v1.glb --target 10000
    python simplify_glb.py models/ --target 30000    # 批量

输出：在原文件名后加 -simplified.glb 后缀。
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

import numpy as np
import trimesh


def simplify_glb(in_path: Path, target_faces: int = 30000) -> Path:
    print(f'\n[LOAD] {in_path.name}  ({in_path.stat().st_size // 1024} KB)')
    print(f'   加载 GLB...')
    mesh = trimesh.load(in_path, force='mesh')

    if isinstance(mesh, trimesh.Scene):
        # GLB 通常只含一个 mesh，但稳妥起见合并
        mesh = trimesh.util.concatenate(
            [g for g in mesh.geometry.values()]
        )

    orig_faces = len(mesh.faces)
    orig_verts = len(mesh.vertices)
    print(f'   原始：{orig_verts:,} 顶点 / {orig_faces:,} 三角面')

    if orig_faces <= target_faces:
        print(f'   已是目标面数以下，跳过简化')
        return in_path

    print(f'   简化到 {target_faces:,} 面...')
    try:
        simplified = mesh.simplify_quadric_decimation(face_count=target_faces)
    except AttributeError:
        # 旧版本 API
        simplified = mesh.simplify(face_count=target_faces)

    out_path = in_path.with_name(in_path.stem + '-simplified.glb')
    simplified.export(str(out_path))

    new_faces = len(simplified.faces)
    new_verts = len(simplified.vertices)
    ratio = new_faces / orig_faces
    print(f'   简化后：{new_verts:,} 顶点 / {new_faces:,} 三角面 ({(1-ratio)*100:.1f}% 减少)')
    print(f'   [OK] 输出：{out_path.name} ({out_path.stat().st_size // 1024} KB)')
    return out_path


def main():
    ap = argparse.ArgumentParser(description='GLB 网格简化（高模 → 低模）')
    ap.add_argument('input', help='GLB 文件或目录')
    ap.add_argument('--target', type=int, default=30000,
                    help='目标面数（默认 30000）')
    ap.add_argument('--inplace', action='store_true',
                    help='直接覆盖原文件（默认输出到 -simplified.glb）')
    args = ap.parse_args()

    p = Path(args.input)
    if p.is_dir():
        files = sorted(p.glob('*.glb'))
        # 跳过已简化的文件
        files = [f for f in files if '-simplified' not in f.name]
    elif p.is_file():
        files = [p]
    else:
        sys.exit(f'[FAIL] {p} 不存在')

    if not files:
        print(f'  (没有 .glb 文件)')
        return

    print(f'[TASK] 任务：{len(files)} 个文件 → 目标 {args.target:,} 面')
    out_files = []
    for f in files:
        try:
            out = simplify_glb(f, args.target)
            out_files.append(out)
        except Exception as e:
            print(f'   [FAIL] {f.name}: {e}')
            import traceback
            traceback.print_exc()

    print(f'\n[DONE] 完成 {len(out_files)}/{len(files)}')
    for f in out_files:
        print(f'   {f}')


if __name__ == '__main__':
    main()
