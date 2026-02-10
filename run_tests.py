"""
Test runner script for OCR module tests.
This script adds the user site-packages to path and runs pytest.
"""
import sys
import os

# Add user site-packages to path for pytest
user_site = os.path.join(
    os.path.expanduser('~'),
    'AppData', 'Roaming', 'Python', 'Python313', 'site-packages'
)
if os.path.exists(user_site):
    sys.path.insert(0, user_site)

# Now import and run pytest
try:
    import pytest
    sys.exit(pytest.main(['tests/', '-v', '--tb=short']))
except ImportError as e:
    print(f"Error importing pytest: {e}")
    print(f"Searched in: {sys.path}")
    sys.exit(1)
