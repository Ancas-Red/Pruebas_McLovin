"""Sincronización ligera (solo stdlib) entre data/processed/ y Azure Blob Storage vía URL/SAS.

Uso exclusivo en build/deploy o arranque inicial (startup.sh); nunca en runtime por petición HTTP.
"""

from __future__ import annotations

import argparse
from pathlib import Path
import os
from typing import Iterable
from urllib import error as urllib_error
from urllib import parse as urllib_parse
from urllib import request as urllib_request

DEFAULT_ARTIFACTS: tuple[str, ...] = (
    "metadata.json",
    "territories.geojson",
    "activity_daily.json",
    "activity_summary.json",
    "sensor_comparison.json",
    "conditions_assessment.json",
)
OPTIONAL_ARTIFACTS: tuple[str, ...] = ("hotspots.geojson",)


def resolve_blob_base_url(
    base_url: str | None = None,
    *,
    account: str | None = None,
    container: str | None = None,
    sas_token: str | None = None,
) -> str | None:
    """Resuelve la URL base del contenedor Azure Blob desde argumentos o variables de entorno."""
    url = (base_url or os.getenv("AZURE_BLOB_SAS_BASE_URL") or "").strip()
    token = (sas_token or os.getenv("AZURE_STORAGE_SAS_TOKEN") or "").strip().lstrip("?")
    if not url:
        acct = (account or os.getenv("AZURE_STORAGE_ACCOUNT") or "").strip()
        cont = (container or os.getenv("AZURE_STORAGE_CONTAINER") or "").strip().strip("/")
        if not acct or not cont:
            return None
        url = f"https://{acct}.blob.core.windows.net/{cont}"

    parts = urllib_parse.urlsplit(url)
    if token and not parts.query:
        parts = parts._replace(query=token)
    return urllib_parse.urlunsplit(parts)


def build_blob_url(base_url: str, blob_name: str, *, prefix: str = "") -> str:
    """Construye la URL final de un blob preservando los parámetros SAS de consulta."""
    parts = urllib_parse.urlsplit(base_url.strip())
    is_local_http = parts.scheme == "http" and parts.hostname in {"127.0.0.1", "localhost"}
    if parts.scheme != "https" and not is_local_http:
        raise ValueError(f"Esquema de URL no permitido para Azure Blob: {parts.scheme!r}")

    clean_prefix = prefix.strip("/")
    clean_name = blob_name.lstrip("/")
    rel = f"{clean_prefix}/{clean_name}" if clean_prefix else clean_name
    base_path = parts.path.rstrip("/")
    new_path = f"{base_path}/{rel}" if base_path else f"/{rel}"
    return urllib_parse.urlunsplit((parts.scheme, parts.netloc, new_path, parts.query, ""))


def _content_type_for(path: Path) -> str:
    suffix = path.suffix.lower()
    if suffix == ".geojson":
        return "application/geo+json"
    if suffix == ".json":
        return "application/json"
    if suffix == ".csv":
        return "text/csv; charset=utf-8"
    return "application/octet-stream"


def download_processed_snapshot(
    target_dir: Path,
    *,
    base_url: str | None = None,
    prefix: str | None = None,
    only_if_missing: bool = False,
    artifacts: Iterable[str] = DEFAULT_ARTIFACTS,
    optional_artifacts: Iterable[str] = OPTIONAL_ARTIFACTS,
    timeout_sec: int = 30,
) -> list[Path]:
    """Descarga los artefactos procesados hacia target_dir si están configurados (o faltan)."""
    required_list = list(artifacts)
    optional_list = list(optional_artifacts)

    if only_if_missing and all((target_dir / name).is_file() and (target_dir / name).stat().st_size > 0 for name in required_list):
        return []

    resolved = resolve_blob_base_url(base_url)
    if not resolved:
        raise ValueError("Falta AZURE_BLOB_SAS_BASE_URL o AZURE_STORAGE_ACCOUNT + AZURE_STORAGE_CONTAINER.")

    eff_prefix = os.getenv("AZURE_BLOB_PREFIX", "") if prefix is None else prefix
    target_dir.mkdir(parents=True, exist_ok=True)
    downloaded: list[Path] = []

    for name in required_list + optional_list:
        dest = target_dir / name
        if only_if_missing and dest.is_file() and dest.stat().st_size > 0:
            continue
        blob_url = build_blob_url(resolved, name, prefix=eff_prefix)
        req = urllib_request.Request(blob_url, method="GET")
        try:
            with urllib_request.urlopen(req, timeout=timeout_sec) as resp:
                data = resp.read()
        except urllib_error.HTTPError as exc:
            if exc.code == 404 and name in optional_list:
                continue
            raise
        tmp_path = dest.with_suffix(dest.suffix + ".tmp")
        tmp_path.write_bytes(data)
        tmp_path.replace(dest)
        downloaded.append(dest)

    return downloaded


def upload_directory_blobs(
    source_dir: Path,
    *,
    base_url: str | None = None,
    prefix: str | None = None,
    pattern: str = "*",
    timeout_sec: int = 60,
) -> list[str]:
    """Sube archivos locales hacia Azure Blob Storage mediante PUT BlockBlob con SAS."""
    resolved = resolve_blob_base_url(base_url)
    if not resolved:
        raise ValueError("Falta AZURE_BLOB_SAS_BASE_URL o AZURE_STORAGE_ACCOUNT + AZURE_STORAGE_CONTAINER.")

    eff_prefix = os.getenv("AZURE_BLOB_PREFIX", "") if prefix is None else prefix
    uploaded: list[str] = []
    for path in sorted(source_dir.glob(pattern)):
        if not path.is_file():
            continue
        blob_url = build_blob_url(resolved, path.name, prefix=eff_prefix)
        data = path.read_bytes()
        req = urllib_request.Request(
            blob_url,
            data=data,
            method="PUT",
            headers={
                "x-ms-blob-type": "BlockBlob",
                "Content-Type": _content_type_for(path),
                "Content-Length": str(len(data)),
            },
        )
        with urllib_request.urlopen(req, timeout=timeout_sec):
            uploaded.append(path.name)
    return uploaded


def main() -> None:
    parser = argparse.ArgumentParser(description="McHanaq Azure Blob Storage Sync (stdlib)")
    sub = parser.add_subparsers(dest="command", required=True)

    p_down = sub.add_parser("download", help="Descargar snapshot de data/processed/ desde Azure Blob")
    p_down.add_argument("--target", type=Path, default=Path("data/processed"))
    p_down.add_argument("--prefix", type=str, default=None)
    p_down.add_argument("--if-missing", action="store_true")

    p_up = sub.add_parser("upload", help="Subir artefactos locales hacia Azure Blob")
    p_up.add_argument("--source", type=Path, default=Path("data/processed"))
    p_up.add_argument("--prefix", type=str, default=None)
    p_up.add_argument("--pattern", type=str, default="*.json*")

    args = parser.parse_args()
    if args.command == "download":
        if args.if_missing and not resolve_blob_base_url():
            print("Azure Blob no configurado; usando artefactos locales en", args.target)
            return
        files = download_processed_snapshot(
            args.target,
            prefix=args.prefix,
            only_if_missing=args.if_missing,
        )
        print(f"OK azure_sync download: {len(files)} archivos -> {args.target}")
    elif args.command == "upload":
        names = upload_directory_blobs(
            args.source,
            prefix=args.prefix,
            pattern=args.pattern,
        )
        print(f"OK azure_sync upload: {len(names)} archivos desde {args.source}")


if __name__ == "__main__":
    main()
