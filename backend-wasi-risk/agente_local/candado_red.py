"""Candado de red: dentro de este proceso de Python solo se permiten conexiones a la propia maquina.

Bloquea las conexiones salientes y la resolucion de nombres externos, y las cuenta.
Alcance honesto: cubre las librerias de Python de este proceso. No cubre codigo nativo que abra
sockets por su cuenta ni otros programas. La prueba que cubre toda la maquina es la desconexion fisica.
"""

import socket
from typing import List

_LOCALES = {"localhost", "127.0.0.1", "::1", "0.0.0.0", "::", ""}

intentos_bloqueados: List[str] = []
_activo = False


class ConexionExternaBloqueada(OSError):
    pass


def _es_local(host) -> bool:
    if host is None:
        return True
    h = host.decode() if isinstance(host, bytes) else str(host)
    h = h.lower()
    return h in _LOCALES or h.startswith("127.")


def _bloquear(destino) -> None:
    intentos_bloqueados.append(str(destino))
    raise ConexionExternaBloqueada(f"Candado de red: conexion externa bloqueada ({destino})")


def activar() -> None:
    global _activo
    if _activo:
        return
    conectar, conectar_ex, resolver = socket.socket.connect, socket.socket.connect_ex, socket.getaddrinfo

    def connect(self, direccion):
        if isinstance(direccion, tuple) and not _es_local(direccion[0]):
            _bloquear(direccion[0])
        return conectar(self, direccion)

    def connect_ex(self, direccion):
        if isinstance(direccion, tuple) and not _es_local(direccion[0]):
            _bloquear(direccion[0])
        return conectar_ex(self, direccion)

    def getaddrinfo(host, *args, **kwargs):
        if not _es_local(host):
            _bloquear(host)
        return resolver(host, *args, **kwargs)

    socket.socket.connect = connect
    socket.socket.connect_ex = connect_ex
    socket.getaddrinfo = getaddrinfo
    _activo = True


def activo() -> bool:
    return _activo
