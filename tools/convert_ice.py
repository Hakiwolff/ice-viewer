import json
import re
import sys
import zipfile
from pathlib import Path

import numpy as np
import trimesh
from skimage.measure import marching_cubes


def find_member(zf, suffix: str):
    for name in zf.namelist():
        if name.endswith(suffix):
            return name
    raise FileNotFoundError(f"zip 里没找到 {suffix}")


def load_model_data(zf):
    member = find_member(zf, "Assets/Scripts/Ice/ModelData.json")
    return json.loads(zf.read(member).decode("utf-8"))


def load_paint_asset(zf):
    member = find_member(zf, "Assets/Textures/PaintTex.asset")
    text = zf.read(member).decode("utf-8", errors="replace")

    width = int(re.search(r"m_Width:\s*(\d+)", text).group(1))
    height = int(re.search(r"m_Height:\s*(\d+)", text).group(1))
    depth = int(re.search(r"m_Depth:\s*(\d+)", text).group(1))
    hex_data = re.search(r"_typelessdata:\s*([0-9a-fA-F]+)", text).group(1)

    raw = bytes.fromhex(hex_data)
    arr = np.frombuffer(raw, dtype=np.uint8)

    expected = width * height * depth * 4
    if arr.size != expected:
        raise ValueError(f"PaintTex 数据长度不对，期望 {expected}，实际 {arr.size}")

    # 变成 (Z, Y, X, 4)
    arr = arr.reshape((depth, height, width, 4))
    return arr


def rebuild_density_field(model_data):
    chunk_count_x = model_data["chunkCountX"]
    chunk_count_y = model_data["chunkCountY"]
    chunk_count_z = model_data["chunkCountZ"]
    grid_count = model_data["gridCount"]

    cells_x = chunk_count_x * grid_count
    cells_y = chunk_count_y * grid_count
    cells_z = chunk_count_z * grid_count

    points_x = cells_x + 1
    points_y = cells_y + 1
    points_z = cells_z + 1

    # 存成 (Z, Y, X)
    field = np.zeros((points_z, points_y, points_x), dtype=np.float32)

    local_len = grid_count + 3  # 13
    expected_len = local_len ** 3

    for chunk in model_data["chunks"]:
        cx = chunk["coordX"]
        cy = chunk["coordY"]
        cz = chunk["coordZ"]
        density = chunk["density"]

        if len(density) != expected_len:
            raise ValueError(
                f"chunk ({cx},{cy},{cz}) density 长度不对，期望 {expected_len}，实际 {len(density)}"
            )

        data = np.array(density, dtype=np.float32).reshape((local_len, local_len, local_len))

        for lx in range(local_len):
            for ly in range(local_len):
                for lz in range(local_len):
                    gx = cx * grid_count + (lx - 1)
                    gy = cy * grid_count + (ly - 1)
                    gz = cz * grid_count + (lz - 1)

                    if 0 <= gx < points_x and 0 <= gy < points_y and 0 <= gz < points_z:
                        field[gz, gy, gx] = data[lx, ly, lz]

    return field, (points_x, points_y, points_z)


def build_surface_mesh(field):
    verts_zyx, faces, normals_zyx, _ = marching_cubes(
        field,
        level=0.0,
        spacing=(1.0, 1.0, 1.0)
    )

    verts_xyz = verts_zyx[:, [2, 1, 0]]
    normals_xyz = normals_zyx[:, [2, 1, 0]]

    mesh = trimesh.Trimesh(
        vertices=verts_xyz,
        faces=faces,
        vertex_normals=normals_xyz,
        process=False
    )
    return mesh


def build_paint_points(paint_arr, center_xyz, stride=1, max_points=30000):
    depth, height, width, _ = paint_arr.shape

    positions = []
    colors = []

    for z in range(0, depth, stride):
        for y in range(0, height, stride):
            for x in range(0, width, stride):
                r, g, b, a = paint_arr[z, y, x]

                if r == 0 or a == 0:
                    continue

                dist_n = float(g) / 255.0

                alpha = max(0.12, 1.0 - dist_n)
                red = 1.0
                green = 0.15 + 0.15 * (1.0 - dist_n)
                blue = 0.08 + 0.08 * (1.0 - dist_n)

                px = float(x - center_xyz[0])
                py = float(y - center_xyz[1])
                pz = float(z - center_xyz[2])

                positions.append([px, py, pz])
                colors.append([
                    float(red),
                    float(green),
                    float(blue),
                    float(alpha)
                ])

    if len(positions) > max_points:
        idx = np.linspace(0, len(positions) - 1, max_points).astype(int)
        positions = [positions[i] for i in idx]
        colors = [colors[i] for i in idx]

    return positions, colors


def build_paint_volume(paint_arr):
    depth, height, width, _ = paint_arr.shape
    volume = np.zeros((depth, height, width), dtype=np.uint8)

    for z in range(depth):
        for y in range(height):
            for x in range(width):
                r, g, b, a = paint_arr[z, y, x]

                if a == 0:
                    continue

                core = 1.0 - (float(g) / 255.0)
                alpha = float(a) / 255.0

                v = int(max(0, min(255, (0.25 * alpha + 0.75 * core) * 255)))
                volume[z, y, x] = v

    return volume


def main():
    if len(sys.argv) < 2:
        print("用法: python3 tools/convert_ice.py /你的/zip/文件路径.zip")
        sys.exit(1)

    zip_path = Path(sys.argv[1]).expanduser().resolve()
    out_dir = Path("public/generated")
    out_dir.mkdir(parents=True, exist_ok=True)

    with zipfile.ZipFile(zip_path, "r") as zf:
        model_data = load_model_data(zf)
        paint_arr = load_paint_asset(zf)

    field, (points_x, points_y, points_z) = rebuild_density_field(model_data)
    mesh = build_surface_mesh(field)

    center_xyz = np.array(
        [points_x / 2.0, points_y / 2.0, points_z / 2.0],
        dtype=np.float32
    )

    mesh.vertices -= center_xyz

    mesh_path = out_dir / "ice_surface.ply"
    mesh.export(mesh_path)

    positions, colors = build_paint_points(
        paint_arr,
        center_xyz=center_xyz,
        stride=1,
        max_points=30000
    )

    paint_volume = build_paint_volume(paint_arr)

    with open(out_dir / "paint_points.json", "w", encoding="utf-8") as f:
        json.dump(
            {
                "positions": positions,
                "colors": colors
            },
            f,
            ensure_ascii=False
        )

    with open(out_dir / "paint_volume.bin", "wb") as f:
        f.write(paint_volume.tobytes())

    with open(out_dir / "scene_meta.json", "w", encoding="utf-8") as f:
        json.dump(
            {
                "pointsX": points_x,
                "pointsY": points_y,
                "pointsZ": points_z,
                "paintWidth": int(paint_arr.shape[2]),
                "paintHeight": int(paint_arr.shape[1]),
                "paintDepth": int(paint_arr.shape[0])
            },
            f,
            ensure_ascii=False,
            indent=2
        )

    print("转换完成：")
    print(f"  {mesh_path}")
    print(f"  {out_dir / 'paint_points.json'}")
    print(f"  {out_dir / 'paint_volume.bin'}")
    print(f"  {out_dir / 'scene_meta.json'}")


if __name__ == "__main__":
    main()