"""Sincronizacion entre data/processed/ y un bucket de Cloudflare R2.

Reemplaza a azure_sync.py como mecanismo de storage de este repo (decision del
equipo: el procesamiento sigue en Azure App Service, pero los artefactos de
data/processed/ se guardan en R2). Mismo contrato de uso: exclusivo en
build/deploy o arranque inicial (startup.sh); nunca en runtime por peticion
HTTP del usuario final (AGENTS.md: "el backend nunca consulta GEE ni
almacenamiento externo por peticion HTTP").

Por que la descarga es solo stdlib y la subida necesita boto3
----------------------------------------------------------------
`download` corre dentro de startup.sh en Azure App Service: no queremos
agregar boto3 (ni su dependencia nativa) al contenedor de produccion solo
para leer un puñado de archivos. Por eso hace un GET plano por HTTPS contra
la URL publica del bucket (R2 soporta esto sin firmar nada si el bucket -o el
dominio personalizado- esta marcado como "Public Development URL"/dominio
publico de solo lectura).

`upload` en cambio lo corre una persona desde su maquina (nunca el backend
desplegado), asi que ahi si usamos boto3 (R2 es compatible con la API S3) con
Access Key/Secret de un token R2 "Object Read & Write". boto3 se importa de
forma diferida: si no esta instalado, `python -m src.analytics.r2_sync
download ...` sigue funcionando igual; solo falla si llamas a `upload` sin
instalarlo (`pip install boto3 --break-system-packages`).

Configuracion (variables de entorno u opciones de linea de comandos):
  R2_PUBLIC_BASE_URL   URL publica de lectura del bucket, ej.
                       https://pub-xxxxxxxx.r2.dev o un dominio propio
                       conectado al bucket. Usada por `download`.
  R2_ACCOUNT_ID        ID de cuenta de Cloudflare (para el endpoint S3 de
                       subida): https://<ACCOUNT_ID>.r2.cloudflarestorage.com
  R2_BUCKET            Nombre del bucket.
  R2_ACCESS_KEY_ID     Access Key del token R2 (Object Read & Write).
  R2_SECRET_ACCESS_KEY Secret Key del mismo token.
  R2_PREFIX            Opcional: subcarpeta dentro del bucket (ej. "processed/").

Archivos grandes subidos en partes (sin boto3, directo del dashboard web)
--------------------------------------------------------------------------
El dashboard web de R2 no deja arrastrar archivos de mas de ~300MB. Para un
artefacto grande (tipicamente activity_daily.json) alguien puede partirlo
localmente en pedazos binarios secuenciales nombrados
`<nombre_sin_extension>.part1`, `.part2`, etc. (ej. activity_daily.part1,
activity_daily.part2, ...) y subirlos uno por uno por el dashboard. `download`
intenta primero el objeto completo (activity_daily.json); si no existe (404),
busca y concatena part1, part2, ... hasta el primer 404 que falte, en ese
orden. No hace falta avisarle nada especial al backend: esto es automatico.

Uso:
  # En startup.sh (arranque del backend), solo lectura:
  python -m src.analytics.r2_sync download --target data/processed --if-missing

  # Desde tu maquina, despues de correr run_pipeline.py:
  pip install boto3 --break-system-packages
  python -m src.analytics.r2_sync upload --source data/processed
"""

from __future__ import annotations

import argparse
import mimetypes
import os
from pathlib import Path
from typing import Iterable
from urllib import error as urllib_error
from urllib import parse as urllib_parse
from urllib import request as urllib_request

DEFAULT_ARTIFACTS: tuple[str, ...] = (
    "metadata.json",
    "peru_territories.geojson",
    "activity_daily.json",
    "activity_summary.json",
    "sensor_comparison.json",
    "conditions_assessment.json",
)
OPTIONAL_ARTIFACTS: tuple[str, ...] = ("hotspots.geojson", "territories.geojson")


def _content_type_for(path: Path) -> str:
    guess, _ = mimetypes.guess_type(path.name)
    if path.suffix.lower() == ".geojson":
        return "application/geo+json"
    return guess or "application/octet-stream"


def _public_url(base_url: str, name: str, *, prefix: str) -> str:
    clean_prefix = prefix.strip("/")
    rel = f"{clean_prefix}/{name}" if clean_prefix else name
    base = base_url.rstrip("/")
    return f"{base}/{urllib_parse.quote(rel)}"


def _download_bytes(url: str, timeout_sec: int) -> bytes:
    # Cloudflare (delante del dominio publico *.r2.dev) suele devolver 403
    # Forbidden a clientes con el User-Agent por defecto de urllib
    # ("Python-urllib/3.x"), aunque el objeto sea publico y la misma URL
    # funcione bien desde un navegador normal. Un User-Agent de navegador
    # evita ese bloqueo sin cambiar nada en el lado de R2.
    req = urllib_request.Request(
        url,
        method="GET",
        headers={
            "User-Agent": (
                "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
                "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
            )
        },
    )
    with urllib_request.urlopen(req, timeout=timeout_sec) as resp:
        return resp.read()


def _download_parts_concat(base_url: str, prefix: str, name: str, timeout_sec: int) -> bytes | None:
    """Reconstruye `name` a partir de partes `<nombre_sin_ext>.partN` subidas a mano.

    Caso de uso: el dashboard web de R2 no acepta arrastrar archivos de mas de
    ~300MB, asi que para snapshots grandes (ej. activity_daily.json con varios
    años de ventana FIRMS) alguien del equipo los divide localmente en pedazos
    (activity_daily.part1, activity_daily.part2, ...) y los sube uno por uno.
    Esta funcion intenta part1, part2, ... hasta el primer 404 y concatena los
    bytes en el mismo orden; si no encuentra ni siquiera part1, devuelve None
    (no hay partes, el llamador decide si eso es un error).
    """
    stem = Path(name).stem
    chunks: list[bytes] = []
    i = 1
    while True:
        part_name = f"{stem}.part{i}"
        url = _public_url(base_url, part_name, prefix=prefix)
        try:
            chunks.append(_download_bytes(url, timeout_sec))
        except urllib_error.HTTPError as exc:
            if exc.code == 404:
                break
            raise
        i += 1
    if not chunks:
        return None
    return b"".join(chunks)


def download_processed_snapshot(
    target_dir: Path,
    *,
    base_url: str | None = None,
    prefix: str | None = None,
    only_if_missing: bool = False,
    artifacts: Iterable[str] = DEFAULT_ARTIFACTS,
    optional_artifacts: Iterable[str] = OPTIONAL_ARTIFACTS,
    timeout_sec: int = 30,
    always_refresh: Iterable[str] = (),
) -> list[Path]:
    """Descarga los artefactos procesados desde R2 (URL publica, sin firmar).

    `always_refresh`: nombres que se vuelven a bajar aunque ya existan
    localmente con `only_if_missing` (tipicamente `metadata.json`: describe al
    snapshot y debe venir junto con el, no quedarse la copia vieja del repo).
    Si fallan y ya hay una copia local, se conserva la local con un aviso en
    vez de abortar el arranque.
    """
    required_list = list(artifacts)
    optional_list = list(optional_artifacts)
    refresh_set = set(always_refresh)

    if only_if_missing and not refresh_set and all(
        (target_dir / name).is_file() and (target_dir / name).stat().st_size > 0 for name in required_list
    ):
        return []

    resolved = (base_url or os.getenv("R2_PUBLIC_BASE_URL") or "").strip()
    if not resolved:
        raise ValueError("Falta R2_PUBLIC_BASE_URL (URL publica de lectura del bucket de R2).")

    eff_prefix = os.getenv("R2_PREFIX", "") if prefix is None else prefix
    target_dir.mkdir(parents=True, exist_ok=True)
    downloaded: list[Path] = []

    for name in required_list + optional_list:
        dest = target_dir / name
        has_local = dest.is_file() and dest.stat().st_size > 0
        if only_if_missing and has_local and name not in refresh_set:
            continue
        url = _public_url(resolved, name, prefix=eff_prefix)
        try:
            data = _download_bytes(url, timeout_sec)
        except (urllib_error.URLError, TimeoutError) as exc:
            is_404 = isinstance(exc, urllib_error.HTTPError) and exc.code == 404
            if not is_404:
                if name in refresh_set and has_local:
                    print(f"[r2_sync] AVISO: no se pudo refrescar {name} ({exc}); se usa la copia local")
                    continue
                raise
            # El archivo completo no esta como objeto unico; puede estar
            # dividido en partes (ver _download_parts_concat) porque no cupo en
            # una subida directa por el dashboard web de R2.
            parts_data = _download_parts_concat(resolved, eff_prefix, name, timeout_sec)
            if parts_data is not None:
                data = parts_data
            elif name in optional_list:
                continue
            elif name in refresh_set and has_local:
                print(f"[r2_sync] AVISO: {name} no esta en R2; se usa la copia local")
                continue
            else:
                raise
        tmp_path = dest.with_suffix(dest.suffix + ".tmp")
        tmp_path.write_bytes(data)
        tmp_path.replace(dest)
        downloaded.append(dest)

    return downloaded


def upload_directory_blobs(
    source_dir: Path,
    *,
    account_id: str | None = None,
    bucket: str | None = None,
    access_key: str | None = None,
    secret_key: str | None = None,
    prefix: str | None = None,
    pattern: str = "*.json*",
) -> list[str]:
    """Sube los artefactos locales a R2 via la API S3 (requiere boto3)."""
    try:
        import boto3  # type: ignore[import-not-found]
    except ImportError as exc:
        raise ImportError(
            "upload necesita boto3: pip install boto3 --break-system-packages "
            "(solo para tu maquina; el backend desplegado no lo necesita, solo usa 'download')."
        ) from exc

    acct = (account_id or os.getenv("R2_ACCOUNT_ID") or "").strip()
    bkt = (bucket or os.getenv("R2_BUCKET") or "").strip()
    key_id = (access_key or os.getenv("R2_ACCESS_KEY_ID") or "").strip()
    secret = (secret_key or os.getenv("R2_SECRET_ACCESS_KEY") or "").strip()
    if not (acct and bkt and key_id and secret):
        raise ValueError(
            "Faltan credenciales de R2: define R2_ACCOUNT_ID, R2_BUCKET, "
            "R2_ACCESS_KEY_ID y R2_SECRET_ACCESS_KEY (token 'Object Read & Write' de Cloudflare R2)."
        )

    eff_prefix = os.getenv("R2_PREFIX", "") if prefix is None else prefix
    clean_prefix = eff_prefix.strip("/")

    client = boto3.client(
        "s3",
        endpoint_url=f"https://{acct}.r2.cloudflarestorage.com",
        aws_access_key_id=key_id,
        aws_secret_access_key=secret,
        region_name="auto",
    )

    uploaded: list[str] = []
    for path in sorted(source_dir.glob(pattern)):
        if not path.is_file():
            continue
        key = f"{clean_prefix}/{path.name}" if clean_prefix else path.name
        client.upload_file(
            str(path),
            bkt,
            key,
            ExtraArgs={"ContentType": _content_type_for(path)},
        )
        uploaded.append(key)
    return uploaded


def main() -> None:
    parser = argparse.ArgumentParser(description="McHanaq Cloudflare R2 Sync")
    sub = parser.add_subparsers(dest="command", required=True)

    p_down = sub.add_parser("download", help="Descargar snapshot de data/processed/ desde R2 (URL publica)")
    p_down.add_argument("--target", type=Path, default=Path("data/processed"))
    p_down.add_argument("--prefix", type=str, default=None)
    p_down.add_argument("--if-missing", action="store_true")
    p_down.add_argument(
        "--refresh",
        action="append",
        default=[],
        help="Archivo que se vuelve a bajar aunque exista (repetible), p. ej. --refresh metadata.json",
    )

    p_up = sub.add_parser("upload", help="Subir artefactos locales a R2 (requiere boto3 + credenciales)")
    p_up.add_argument("--source", type=Path, default=Path("data/processed"))
    p_up.add_argument("--prefix", type=str, default=None)
    p_up.add_argument("--pattern", type=str, default="*.json*")

    args = parser.parse_args()
    if args.command == "download":
        if args.if_missing and not (os.getenv("R2_PUBLIC_BASE_URL") or "").strip():
            print("R2 no configurado (falta R2_PUBLIC_BASE_URL); usando artefactos locales en", args.target)
            return
        files = download_processed_snapshot(
            args.target,
            prefix=args.prefix,
            only_if_missing=args.if_missing,
            always_refresh=args.refresh,
        )
        print(f"OK r2_sync download: {len(files)} archivos -> {args.target}")
    elif args.command == "upload":
        names = upload_directory_blobs(args.source, prefix=args.prefix, pattern=args.pattern)
        print(f"OK r2_sync upload: {len(names)} archivos desde {args.source} -> R2")
        for n in names:
            print(f"  - {n}")


if __name__ == "__main__":
    main()
