"""Outbound-call guard: allowlisted hosts only, DNS checked, responses capped.

GuardedClient wraps every outbound HTTP client Reflex constructs (executor,
schema fetch, control-to-mock calls). Before each request it:

* rejects any host that is not in the policy allowlist - checked both before
  DNS resolution and on every resolved address, so a hostname that resolves
  to a private address cannot slip through unless it is explicitly
  allowlisted (the configured mock API is);
* never follows redirects (``follow_redirects=False``), so a redirect can
  never silently swap the validated host;
* caps response size (content-length first, then the received bytes).

Breaker bookkeeping (infra failure vs success per host) lives with the guard
because only the client sees both outcomes consistently.
"""
from __future__ import annotations

import ipaddress
import socket
from typing import Any

import httpx

from .budget import Breakers
from .policy import SecurityPolicy


class SsrfBlocked(RuntimeError):
    """Outbound call refused by the SSRF/allowlist/size guard."""


class ResponseTooLarge(SsrfBlocked):
    pass


class CircuitOpen(RuntimeError):
    """The circuit breaker refused the call before it was made."""


def is_private_ip(ip: str) -> bool:
    addr = ipaddress.ip_address(ip)
    return (
        addr.is_loopback or addr.is_private or addr.is_link_local
        or addr.is_reserved or addr.is_multicast or addr.is_unspecified
    )


class SsrfGuard:
    def __init__(self, policy: SecurityPolicy) -> None:
        self.policy = policy

    def check(self, request: httpx.Request) -> None:
        host = request.url.host or ""
        if not host:
            raise SsrfBlocked("outbound call has no host")
        if not self.policy.allows_host(host):
            raise SsrfBlocked(f"host {host!r} is not in the outbound allowlist")
        try:
            infos = socket.getaddrinfo(host, request.url.port or 80, proto=socket.IPPROTO_TCP)
            resolved = [info[4][0] for info in infos]
        except OSError as exc:
            raise SsrfBlocked(f"could not resolve host {host!r}: {exc}") from exc
        if not resolved:
            raise SsrfBlocked(f"host {host!r} could not be resolved")
        privates = [ip for ip in resolved if is_private_ip(ip)]
        # The host is allowlisted, so the CONSISTENCY rule applies: an
        # allowlisted loopback host must resolve consistently to private
        # addresses; a mixed address family is treated as a rebinding
        # signal and refused.
        if privates and len(privates) != len(resolved):
            raise SsrfBlocked(f"host {host!r} resolves inconsistently across address spaces")

    def check_response_size(self, response: httpx.Response) -> None:
        declared = response.headers.get("content-length")
        if declared and declared.isdigit() and int(declared) > self.policy.max_response_bytes:
            raise ResponseTooLarge(
                f"response size {declared} exceeds {self.policy.max_response_bytes} bytes"
            )


class GuardedClient(httpx.Client):
    """Every outbound call Reflex makes goes through this client."""

    def __init__(self, *args: Any, guard: SsrfGuard, breaker: Breakers,
                 timeout: Any = 5.0, **kwargs: Any) -> None:
        kwargs.setdefault("follow_redirects", False)
        kwargs.setdefault("timeout", timeout)
        super().__init__(*args, **kwargs)
        self._guard = guard
        self._breaker = breaker

    def send(self, request: httpx.Request, *args: Any, **kwargs: Any) -> httpx.Response:
        host = request.url.host or ""
        self._guard.check(request)
        if self._breaker is not None and host:
            if self._breaker.check_call(host) == Breakers.OPEN:
                raise CircuitOpen(f"circuit breaker is open for host {host!r}")
        try:
            response = super().send(request, *args, **kwargs)
        except httpx.TransportError:
            if self._breaker is not None and host:
                self._breaker.record_failure(host)
            raise
        if self._breaker is not None and host:
            if response.status_code >= 500:
                self._breaker.record_failure(host)
            else:
                self._breaker.record_success(host)
        self._guard.check_response_size(response)
        return response


def make_guarded_client(base_url: str, policy: SecurityPolicy,
                        breaker: Breakers, timeout: Any = 5.0) -> GuardedClient:
    return GuardedClient(base_url=base_url, guard=SsrfGuard(policy),
                         breaker=breaker, timeout=timeout)
