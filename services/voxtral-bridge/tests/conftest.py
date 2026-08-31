import os
import sys

# `import main` in test_main.py needs services/voxtral-bridge/ (main.py's
# directory) on sys.path. Locally this worked by accident — `python3 -m
# pytest` prepends the current working directory to sys.path, masking the
# gap. CI's plain `pytest` invocation does not, and failed with
# ModuleNotFoundError: No module named 'main'. Inserting it here via
# conftest.py (always auto-loaded by pytest, regardless of how it's
# invoked or from which directory) fixes both invocation styles.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
