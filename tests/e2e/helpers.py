"""Shared helpers for Long-Horizon's Playwright e2e tests (Chromium only).

Rules (CLAUDE.md / SPEC): Chromium only; at most one browser per test process, always closed (context manager);
launched with --autoplay-policy=document-user-activation-required so audio behaves like desktop Chrome; gestures
only through real clicks/keys. Outputs go to out/core/ (override with HF_E2E_OUT).
"""
import contextlib
import json
import os
_HF_OUT = os.environ.get('LONG_HORIZON_OUT', os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), 'out'))  # test outputs (gitignored)
import pathlib
import socket
import subprocess
import sys
import time
import urllib.request

from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT = pathlib.Path(os.environ.get('HF_E2E_OUT', _HF_OUT + '/core'))
CHROMIUM_ARGS = ['--autoplay-policy=document-user-activation-required']


@contextlib.contextmanager
def browser(headless=True):
    """One Chromium instance, always closed."""
    with sync_playwright() as p:
        b = p.chromium.launch(headless=headless, args=CHROMIUM_ARGS)
        try:
            yield b
        finally:
            b.close()


class Console:
    """Collects console errors/warnings and uncaught page errors (all frames of a page)."""

    def __init__(self, page, ignore=()):
        self.errors, self.warnings, self.page_errors = [], [], []
        self.ignore = tuple(ignore)
        page.on('console', self._on_console)
        page.on('pageerror', lambda e: self.page_errors.append(str(e)))

    def _on_console(self, msg):
        text = msg.text
        if any(s in text for s in self.ignore):
            return
        if msg.type == 'error':
            self.errors.append(text)
        elif msg.type == 'warning':
            self.warnings.append(text)

    def summary(self):
        return {'errors': self.errors, 'page_errors': self.page_errors, 'warnings': self.warnings}


class Check:
    """Soft assertions: every failure is recorded; the test reports all of them."""

    def __init__(self, name):
        self.name, self.failures, self.passed, self.details = name, [], 0, {}

    def ok(self, cond, msg):
        if cond:
            self.passed += 1
        else:
            self.failures.append(msg)
        return bool(cond)

    def eq(self, a, b, msg):
        return self.ok(a == b, f'{msg}: expected {b!r}, got {a!r}')

    def result(self):
        return {'name': self.name, 'ok': not self.failures, 'passed': self.passed,
                'failures': self.failures, 'details': self.details}


def file_url(rel):
    return (ROOT / rel).as_uri()


def free_port():
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(('127.0.0.1', 0))
        return s.getsockname()[1]


@contextlib.contextmanager
def http_server(directory=ROOT):
    """python3 -m http.server on a free local port; always terminated."""
    port = free_port()
    proc = subprocess.Popen([sys.executable, '-m', 'http.server', str(port), '--bind', '127.0.0.1',
                             '--directory', str(directory)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    base = f'http://127.0.0.1:{port}'
    try:
        deadline = time.time() + 10
        while True:
            try:
                urllib.request.urlopen(base + '/index.html', timeout=1).read(64)
                break
            except Exception:
                if time.time() > deadline:
                    raise RuntimeError('http.server did not start')
                time.sleep(0.1)
        yield base
    finally:
        proc.terminate()
        try:
            proc.wait(5)
        except subprocess.TimeoutExpired:
            proc.kill()


def write_json(name, data):
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / name).write_text(json.dumps(data, indent=2))
    return OUT / name


def close_modals(page_or_frame):
    """Close any open Long-Horizon dialog (e.g. the Chimera pop-up on launch) by pressing Escape on it."""
    for _ in range(5):
        n = page_or_frame.evaluate('() => (window.HF && HF.dom && HF.dom.openModals) ? HF.dom.openModals() : 0')
        if not n:
            return
        page_or_frame.locator('dialog.hf-modal[open]').last.press('Escape')
        page_or_frame.wait_for_timeout(50)


def run_main(run_fn):
    """Standalone entry: run one test, print and save its result, exit non-zero on failure."""
    res = run_fn()
    print(json.dumps({k: v for k, v in res.items() if k != 'details'}, indent=2))
    sys.exit(0 if res['ok'] else 1)
