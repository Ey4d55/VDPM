"""Shared fixtures."""

from __future__ import annotations

import pytest

from vdpm import reference


@pytest.fixture
def vehicle():
    return reference.VEHICLE


@pytest.fixture
def env():
    return reference.ENVIRONMENT


@pytest.fixture
def setups():
    return [reference.SETUP_A, reference.SETUP_B]
