"""Ed25519 provenance for the mock's ``/openapi.json``.

The mock signs the canonical JSON of the document it serves; the control API
pins the public key and verifies the signature before diffing or patching.

This is a prototype-level trust model: pinning one key proves the document came
from whoever holds that key, nothing more. It is stronger than a shared HMAC
key, which any holder could forge.
"""
from __future__ import annotations

import hashlib
import threading
from dataclasses import dataclass
from typing import Any

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ed25519

from ..audit.canonical import canonical_json

SIGNATURE_HEADER = "X-Schema-Signature"


@dataclass(frozen=True)
class SignatureStatus:
    ok: bool
    fingerprint: str
    error: str | None = None


def fingerprint(public_key_hex: str) -> str:
    """Short, stable identifier for a public key (first 16 hex chars of sha256)."""
    return hashlib.sha256(bytes.fromhex(public_key_hex)).hexdigest()[:16]


class SchemaSigner:
    """Holds the signing key for one mock process."""

    def __init__(self, private_key_hex: str | None = None) -> None:
        self._lock = threading.RLock()
        if private_key_hex:
            self._private = ed25519.Ed25519PrivateKey.from_private_bytes(
                bytes.fromhex(private_key_hex))
        else:
            self._private = ed25519.Ed25519PrivateKey.generate()
        self._public_hex = self._private.public_key().public_bytes(
            encoding=serialization.Encoding.Raw,
            format=serialization.PublicFormat.Raw,
        ).hex()

    @property
    def public_key_hex(self) -> str:
        with self._lock:
            return self._public_hex

    @property
    def fingerprint(self) -> str:
        return fingerprint(self.public_key_hex)

    def sign(self, document: dict[str, Any]) -> str:
        payload = canonical_json(document).encode("utf-8")
        with self._lock:
            return self._private.sign(payload).hex()


def verify_signature(public_key_hex: str, document: dict[str, Any],
                     signature_hex: str) -> SignatureStatus:
    """Verify ``signature_hex`` over the canonical JSON of ``document``."""
    if not signature_hex:
        return SignatureStatus(False, fingerprint(public_key_hex) if public_key_hex else "",
                               "missing signature")
    if not public_key_hex:
        return SignatureStatus(False, "", "no pinned public key")
    try:
        public = ed25519.Ed25519PublicKey.from_public_bytes(
            bytes.fromhex(public_key_hex))
        public.verify(bytes.fromhex(signature_hex),
                      canonical_json(document).encode("utf-8"))
    except (InvalidSignature, ValueError) as exc:
        return SignatureStatus(False, fingerprint(public_key_hex), f"invalid signature: {exc}")
    return SignatureStatus(True, fingerprint(public_key_hex))
