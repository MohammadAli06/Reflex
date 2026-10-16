"""Exceptions raised for SDK input and transport failures."""


class ReflexError(Exception):
    """Base SDK exception."""


class ReflexConnectionError(ReflexError):
    """The Control API could not be reached."""


class ReflexTimeoutError(ReflexError):
    """The Control API did not respond before the configured timeout."""


class ReflexValidationError(ReflexError):
    """The SDK input or tool lookup was invalid."""


class ReflexExecutionError(ReflexError):
    """The Control API could not complete an execution."""
