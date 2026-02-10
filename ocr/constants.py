"""
OCR constants for color detection and Tesseract configuration.

This module defines:
- HSV color ranges for detecting UI elements (badges, buttons)
- Tesseract OCR configuration strings for different field types
- Layout-related constants for platform detection

OpenCV uses H: 0-179, S: 0-255, V: 0-255 for HSV color space.
"""

from typing import Tuple

# Type alias for HSV color ranges
HSVRange = Tuple[int, int, int]


# =============================================================================
# HSV Color Ranges for UI Element Detection
# =============================================================================

# Red detection (for "Obtained" badge)
# Red wraps around in HSV space, so we need two ranges
RED_LOWER_1: HSVRange = (0, 100, 100)
RED_UPPER_1: HSVRange = (10, 255, 255)
RED_LOWER_2: HSVRange = (170, 100, 100)
RED_UPPER_2: HSVRange = (179, 255, 255)

# Orange detection (for hint badge)
ORANGE_LOWER: HSVRange = (10, 100, 100)
ORANGE_UPPER: HSVRange = (25, 255, 255)

# Green detection (for plus button - used as row anchor)
GREEN_LOWER: HSVRange = (35, 100, 100)
GREEN_UPPER: HSVRange = (85, 255, 255)

# Blue detection (for cost pill background)
BLUE_LOWER: HSVRange = (100, 100, 100)
BLUE_UPPER: HSVRange = (130, 255, 255)


# =============================================================================
# Tesseract OCR Configuration Strings
# =============================================================================

# For cost digits (single line, digits only)
# PSM 7 = Treat image as single text line
# OEM 3 = Default, based on what is available
COST_CONFIG: str = "--psm 7 --oem 3 -c tessedit_char_whitelist=0123456789"

# For skill names (block of text)
# PSM 6 = Assume uniform block of text
NAME_CONFIG: str = "--psm 6 --oem 3"

# For hint level digits (single character)
# PSM 10 = Treat image as single character
HINT_LEVEL_CONFIG: str = "--psm 10 --oem 3 -c tessedit_char_whitelist=12345"

# For skill points (single line, digits only)
SKILL_POINTS_CONFIG: str = "--psm 7 --oem 3 -c tessedit_char_whitelist=0123456789"

# PSM mode reference:
# 6 = Assume uniform block of text
# 7 = Treat image as single line
# 10 = Treat image as single character


# =============================================================================
# Layout Detection Constants
# =============================================================================

# Aspect ratio thresholds for platform detection
# Mobile (portrait): ~565x1004 -> aspect ratio ~0.56
# PC (landscape): ~2048x1152 -> aspect ratio ~1.78
MOBILE_ASPECT_RATIO_MAX: float = 0.8  # Anything below this is mobile (portrait)
PC_ASPECT_RATIO_MIN: float = 1.2  # Anything above this is PC (landscape)

# Minimum contour area for valid UI elements (as fraction of frame area)
MIN_BUTTON_AREA_RATIO: float = 0.0001  # ~0.01% of frame
MAX_BUTTON_AREA_RATIO: float = 0.01  # ~1% of frame

# Minimum number of green plus buttons to consider layout valid
MIN_PLUS_BUTTONS_FOR_LIST: int = 2

# Row height estimation (as fraction of frame height)
ESTIMATED_ROW_HEIGHT_MOBILE: float = 0.08  # ~8% of frame height
ESTIMATED_ROW_HEIGHT_PC: float = 0.06  # ~6% of frame height


# =============================================================================
# OCR Quality Thresholds
# =============================================================================

# Minimum confidence for accepting OCR results
MIN_COST_CONFIDENCE: float = 0.7
MIN_NAME_CONFIDENCE: float = 0.5
MIN_HINT_CONFIDENCE: float = 0.6

# Fuzzy matching threshold for skill names (using RapidFuzz)
SKILL_MATCH_THRESHOLD: int = 80  # 0-100 scale


# =============================================================================
# Color Detection Thresholds
# =============================================================================

# Minimum pixel ratio for badge detection (badge pixels / ROI pixels)
MIN_RED_BADGE_RATIO: float = 0.05  # 5% of ROI must be red for "obtained"
MIN_ORANGE_BADGE_RATIO: float = 0.03  # 3% of ROI must be orange for hint
MIN_GREEN_BUTTON_RATIO: float = 0.1  # 10% of button area must be green


# =============================================================================
# Image Preprocessing Constants
# =============================================================================

# Upscale factors for OCR preprocessing
COST_UPSCALE_FACTOR: int = 3
NAME_UPSCALE_FACTOR: int = 2
HINT_UPSCALE_FACTOR: int = 4

# Morphological operation kernel sizes
MORPH_KERNEL_SMALL: Tuple[int, int] = (2, 2)
MORPH_KERNEL_MEDIUM: Tuple[int, int] = (3, 3)
MORPH_KERNEL_LARGE: Tuple[int, int] = (5, 5)
