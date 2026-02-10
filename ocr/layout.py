"""
Layout detection for Umamusume Learn screen OCR.

This module provides two-stage layout detection:
1. Platform inference: Detect mobile (portrait) vs PC (landscape) from aspect ratio
2. List bbox detection: Locate the skill list region using UI anchors

The layout information is used to determine where to look for skill rows
and how to scale ROI extraction.
"""

from dataclasses import dataclass
from typing import Literal, Optional, Tuple

import cv2
import numpy as np

from .color_detect import find_green_plus_buttons
from .constants import (
    MOBILE_ASPECT_RATIO_MAX,
    PC_ASPECT_RATIO_MIN,
    MIN_PLUS_BUTTONS_FOR_LIST,
    ESTIMATED_ROW_HEIGHT_MOBILE,
    ESTIMATED_ROW_HEIGHT_PC,
)


# Type alias for platform
Platform = Literal["mobile", "pc"]

# Type alias for bounding box (x1, y1, x2, y2)
ListBBox = Tuple[int, int, int, int]


@dataclass
class LayoutInfo:
    """
    Layout detection result containing platform and list region information.

    Attributes:
        platform: Detected platform ("mobile" or "pc")
        list_bbox: Bounding box of skill list region as (x1, y1, x2, y2), None if not found
        scale: Estimated UI scale factor relative to reference resolution
        confidence: Detection confidence (0.0-1.0)
        row_height_estimate: Estimated height of a single skill row in pixels
        plus_buttons: List of detected green plus button bounding boxes
    """
    platform: Platform
    list_bbox: Optional[ListBBox] = None
    scale: float = 1.0
    confidence: float = 0.0
    row_height_estimate: int = 0
    plus_buttons: list = None

    def __post_init__(self):
        if self.plus_buttons is None:
            self.plus_buttons = []


def detect_platform(frame: np.ndarray) -> Platform:
    """
    Detect whether the frame is from mobile (portrait) or PC (landscape) client.

    Detection is based on aspect ratio:
    - Mobile: Portrait orientation, aspect ratio < 0.8 (e.g., 565x1004 = 0.56)
    - PC: Landscape orientation, aspect ratio > 1.2 (e.g., 2048x1152 = 1.78)

    For ambiguous aspect ratios (between 0.8 and 1.2), defaults to 'pc'.

    Args:
        frame: BGR image (numpy array) from the game

    Returns:
        "mobile" for portrait/mobile layouts, "pc" for landscape/PC layouts
    """
    if frame is None or frame.size == 0:
        return "pc"  # Default to PC if no frame

    height, width = frame.shape[:2]

    if height == 0:
        return "pc"

    aspect_ratio = width / height

    if aspect_ratio < MOBILE_ASPECT_RATIO_MAX:
        return "mobile"
    elif aspect_ratio > PC_ASPECT_RATIO_MIN:
        return "pc"
    else:
        # Ambiguous aspect ratio - could be either
        # Default to PC as it's more common for desktop usage
        return "pc"


def _get_reference_resolution(platform: Platform) -> Tuple[int, int]:
    """
    Get the reference resolution for a platform.

    Args:
        platform: "mobile" or "pc"

    Returns:
        Reference (width, height) tuple
    """
    if platform == "mobile":
        return (565, 1004)  # Standard mobile portrait
    else:
        return (2048, 1152)  # Standard PC landscape


def _estimate_scale(
    frame_width: int,
    frame_height: int,
    platform: Platform
) -> float:
    """
    Estimate UI scale factor relative to reference resolution.

    Args:
        frame_width: Actual frame width
        frame_height: Actual frame height
        platform: Detected platform

    Returns:
        Scale factor (1.0 = reference resolution)
    """
    ref_width, ref_height = _get_reference_resolution(platform)

    # Use height as the primary scale reference (more consistent across devices)
    scale = frame_height / ref_height

    return scale


def _estimate_row_height(frame_height: int, platform: Platform, scale: float) -> int:
    """
    Estimate the height of a single skill row in pixels.

    Args:
        frame_height: Frame height in pixels
        platform: Detected platform
        scale: UI scale factor

    Returns:
        Estimated row height in pixels
    """
    if platform == "mobile":
        base_ratio = ESTIMATED_ROW_HEIGHT_MOBILE
    else:
        base_ratio = ESTIMATED_ROW_HEIGHT_PC

    # Row height is a fraction of frame height
    row_height = int(frame_height * base_ratio)

    return max(row_height, 20)  # Minimum 20 pixels


def find_list_bbox(
    frame: np.ndarray,
    platform: Platform
) -> Optional[Tuple[ListBBox, float, list]]:
    """
    Find the bounding box of the skill list region using green plus buttons.

    The skill list is identified by detecting the green plus buttons at the
    right side of each skill row. The list bbox is derived from button positions.

    Args:
        frame: BGR image (numpy array)
        platform: Detected platform ("mobile" or "pc")

    Returns:
        Tuple of (list_bbox, confidence, plus_buttons) if found, None otherwise
        - list_bbox: (x1, y1, x2, y2) bounding the skill list area
        - confidence: Detection confidence (0.0-1.0)
        - plus_buttons: List of button bboxes [(x, y, w, h), ...]
    """
    if frame is None or frame.size == 0:
        return None

    height, width = frame.shape[:2]

    # Find green plus buttons
    buttons = find_green_plus_buttons(frame)

    if len(buttons) < MIN_PLUS_BUTTONS_FOR_LIST:
        # Not enough buttons to determine list region
        # Return a default estimate based on platform
        return _estimate_default_list_bbox(width, height, platform, buttons)

    # Extract button positions
    button_xs = [b[0] + b[2] // 2 for b in buttons]  # Center x
    button_ys = [b[1] + b[3] // 2 for b in buttons]  # Center y

    # Buttons should be vertically aligned (at right side of list)
    # Use median x to handle outliers
    button_x_median = int(np.median(button_xs))

    # List region estimation:
    # - Right edge: slightly past the buttons
    # - Left edge: buttons are typically at ~90% of list width
    # - Top: slightly above first button
    # - Bottom: slightly below last button

    button_width_avg = int(np.mean([b[2] for b in buttons]))

    # Estimate list width based on button position
    # Buttons are typically at the right ~10% of the list area
    if platform == "mobile":
        list_width_estimate = int(button_x_median / 0.85)
        x1 = max(0, int(button_x_median - list_width_estimate * 0.9))
    else:
        list_width_estimate = int(button_x_median / 0.90)
        x1 = max(0, int(button_x_median - list_width_estimate * 0.85))

    x2 = min(width, button_x_median + button_width_avg + 10)

    # Estimate row height from button spacing
    if len(buttons) >= 2:
        button_y_sorted = sorted(button_ys)
        spacings = [button_y_sorted[i+1] - button_y_sorted[i]
                    for i in range(len(button_y_sorted) - 1)]
        row_height_estimate = int(np.median(spacings)) if spacings else 80
    else:
        row_height_estimate = 80

    # Add padding above first and below last button
    padding = row_height_estimate // 2
    y1 = max(0, min(button_ys) - padding)
    y2 = min(height, max(button_ys) + padding)

    list_bbox = (x1, y1, x2, y2)

    # Confidence based on number of buttons found
    # More buttons = higher confidence
    confidence = min(1.0, len(buttons) / 5.0)

    return (list_bbox, confidence, buttons)


def _estimate_default_list_bbox(
    width: int,
    height: int,
    platform: Platform,
    buttons: list
) -> Optional[Tuple[ListBBox, float, list]]:
    """
    Estimate a default list bounding box when not enough buttons are found.

    Uses typical layout positions for each platform.

    Args:
        width: Frame width
        height: Frame height
        platform: Detected platform
        buttons: Any buttons that were found

    Returns:
        Tuple of (list_bbox, confidence, buttons) or None
    """
    if platform == "mobile":
        # Mobile: List typically takes center-bottom portion
        x1 = int(width * 0.05)
        x2 = int(width * 0.95)
        y1 = int(height * 0.35)
        y2 = int(height * 0.85)
    else:
        # PC: List typically in center-right area
        x1 = int(width * 0.15)
        x2 = int(width * 0.85)
        y1 = int(height * 0.25)
        y2 = int(height * 0.80)

    list_bbox = (x1, y1, x2, y2)

    # Low confidence since we're guessing
    confidence = 0.2 if buttons else 0.1

    return (list_bbox, confidence, buttons)


def detect_layout(
    frame: np.ndarray,
    source: str = "auto"
) -> Optional[LayoutInfo]:
    """
    Detect layout information from a game frame.

    This is the main entry point for layout detection, combining:
    1. Platform detection (mobile vs PC)
    2. List bounding box detection
    3. Scale estimation
    4. Row height estimation

    Args:
        frame: BGR image (numpy array) from the game
        source: Layout source hint - "auto", "mobile", or "pc"
                If "auto", platform is detected automatically.
                Otherwise, uses the specified platform.

    Returns:
        LayoutInfo dataclass with all layout information, None if frame is invalid
    """
    if frame is None or frame.size == 0:
        return None

    height, width = frame.shape[:2]

    if height == 0 or width == 0:
        return None

    # Determine platform
    if source == "auto":
        platform = detect_platform(frame)
    elif source in ("mobile", "pc"):
        platform = source
    else:
        platform = detect_platform(frame)

    # Calculate scale
    scale = _estimate_scale(width, height, platform)

    # Find list bounding box
    list_result = find_list_bbox(frame, platform)

    if list_result:
        list_bbox, confidence, buttons = list_result
    else:
        list_bbox = None
        confidence = 0.0
        buttons = []

    # Estimate row height
    row_height = _estimate_row_height(height, platform, scale)

    return LayoutInfo(
        platform=platform,
        list_bbox=list_bbox,
        scale=scale,
        confidence=confidence,
        row_height_estimate=row_height,
        plus_buttons=buttons,
    )
