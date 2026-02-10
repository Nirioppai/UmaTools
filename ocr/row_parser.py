"""
Row segmentation for Umamusume Learn screen OCR.

This module provides row segmentation functionality to identify individual
skill rows within the skill list region. Each row is segmented into sub-ROIs
for specific field extraction (name, cost, hint badge, obtained badge).

Row detection uses green plus buttons as primary anchors, as they appear
at a consistent position on the right side of each skill row.
"""

from dataclasses import dataclass, field
from typing import List, Optional, Tuple

import numpy as np

from .constants import (
    ESTIMATED_ROW_HEIGHT_MOBILE,
    ESTIMATED_ROW_HEIGHT_PC,
)


# Type aliases
BBox = Tuple[int, int, int, int]  # (x, y, w, h)
ROI = Tuple[int, int, int, int]  # (x, y, w, h) - same as BBox but semantically different


@dataclass
class RowInfo:
    """
    Information about a single skill row in the list.

    Each row contains a skill entry with various fields (name, cost, badges)
    that need to be extracted via OCR or color detection. This class provides
    the bounding boxes for each field's region of interest (ROI).

    Attributes:
        bbox: Full row bounding box as (x, y, w, h)
        plus_button_bbox: Green plus button bounding box, used as anchor
        name_roi: ROI for skill name text (top-left portion of row)
        cost_roi: ROI for cost digits (blue pill, left of plus button)
        hint_roi: ROI for hint badge (above/right of cost, if present)
        obtained_roi: ROI for obtained badge (right edge of row)
        visibility: Percentage of row visible (0.0-1.0), used to filter partials
        row_index: Index of this row in the list (0-based)
    """
    bbox: BBox
    plus_button_bbox: Optional[BBox] = None
    name_roi: Optional[ROI] = None
    cost_roi: Optional[ROI] = None
    hint_roi: Optional[ROI] = None
    obtained_roi: Optional[ROI] = None
    visibility: float = 1.0
    row_index: int = 0


def _calculate_row_height_from_buttons(plus_buttons: List[BBox]) -> Optional[int]:
    """
    Calculate row height from vertical spacing between consecutive plus buttons.

    Args:
        plus_buttons: List of plus button bboxes (x, y, w, h) sorted by y-position

    Returns:
        Median row height in pixels, or None if not enough buttons
    """
    if len(plus_buttons) < 2:
        return None

    # Extract y-centers of buttons
    button_y_centers = [b[1] + b[3] // 2 for b in plus_buttons]

    # Calculate vertical spacings between consecutive buttons
    spacings = [
        button_y_centers[i + 1] - button_y_centers[i]
        for i in range(len(button_y_centers) - 1)
    ]

    # Filter out outliers (spacings that are too small or too large)
    if not spacings:
        return None

    median_spacing = int(np.median(spacings))

    # Sanity check: row height should be reasonable
    if median_spacing < 20 or median_spacing > 500:
        return None

    return median_spacing


def _estimate_default_row_height(frame_height: int, platform: str) -> int:
    """
    Estimate row height when buttons are insufficient for calculation.

    Args:
        frame_height: Height of the frame in pixels
        platform: "mobile" or "pc"

    Returns:
        Estimated row height in pixels
    """
    if platform == "mobile":
        ratio = ESTIMATED_ROW_HEIGHT_MOBILE
    else:
        ratio = ESTIMATED_ROW_HEIGHT_PC

    row_height = int(frame_height * ratio)
    return max(row_height, 40)  # Minimum 40 pixels


def _calculate_sub_rois(
    row_bbox: BBox,
    plus_button: Optional[BBox],
    row_height: int
) -> Tuple[ROI, ROI, ROI, ROI]:
    """
    Calculate sub-ROIs for each field within a row.

    Layout structure (left to right):
    | Name (large) | Description | Hint Badge | Cost | Plus Button |

    The plus button serves as the right anchor point.

    Args:
        row_bbox: Full row bounding box (x, y, w, h)
        plus_button: Plus button bbox if available
        row_height: Row height in pixels

    Returns:
        Tuple of (name_roi, cost_roi, hint_roi, obtained_roi)
    """
    x, y, w, h = row_bbox

    if plus_button:
        btn_x, btn_y, btn_w, btn_h = plus_button
        # Plus button center as reference
        btn_center_x = btn_x + btn_w // 2
        btn_center_y = btn_y + btn_h // 2
    else:
        # Fallback: assume plus button is at right edge
        btn_center_x = x + int(w * 0.92)
        btn_center_y = y + h // 2
        btn_w = int(w * 0.05)
        btn_h = btn_w

    # Cost ROI: Blue pill left of plus button
    # Typically spans about 15% of row width
    cost_width = int(w * 0.15)
    cost_height = int(h * 0.35)
    cost_x = btn_center_x - btn_w - cost_width - int(w * 0.02)
    cost_y = y + (h - cost_height) // 2  # Vertically centered
    cost_roi = (max(x, cost_x), max(y, cost_y), cost_width, cost_height)

    # Hint ROI: Above and overlapping with cost area
    # Hint badges appear in the upper portion of the row
    hint_width = int(w * 0.25)
    hint_height = int(h * 0.4)
    hint_x = cost_x - int(w * 0.05)
    hint_y = y + int(h * 0.05)
    hint_roi = (max(x, hint_x), max(y, hint_y), hint_width, hint_height)

    # Obtained ROI: Right edge of row (after plus button)
    # Red "Obtained" badge appears at the far right
    obtained_width = int(w * 0.12)
    obtained_height = int(h * 0.5)
    obtained_x = btn_center_x + btn_w // 2 + int(w * 0.02)
    obtained_y = y + (h - obtained_height) // 2
    obtained_roi = (min(obtained_x, x + w - obtained_width), max(y, obtained_y), obtained_width, obtained_height)

    # Name ROI: Left portion of row (skill name text)
    # Takes up about 50% of row width from the left
    name_width = int(w * 0.50)
    name_height = int(h * 0.45)
    name_x = x + int(w * 0.02)  # Small left margin
    name_y = y + int(h * 0.05)  # Top portion for name
    name_roi = (name_x, name_y, name_width, name_height)

    return (name_roi, cost_roi, hint_roi, obtained_roi)


def _calculate_visibility(
    row_bbox: BBox,
    list_bbox: Tuple[int, int, int, int],
    row_height: int
) -> float:
    """
    Calculate what percentage of the row is visible within the list bbox.

    Args:
        row_bbox: Row bounding box (x, y, w, h)
        list_bbox: List area bounding box (x1, y1, x2, y2)
        row_height: Expected row height

    Returns:
        Visibility as fraction (0.0-1.0)
    """
    _, row_y, _, row_h = row_bbox
    _, list_y1, _, list_y2 = list_bbox

    row_y2 = row_y + row_h

    # Calculate visible portion
    visible_y1 = max(row_y, list_y1)
    visible_y2 = min(row_y2, list_y2)

    visible_height = max(0, visible_y2 - visible_y1)
    visibility = visible_height / row_h if row_h > 0 else 0.0

    return visibility


def segment_rows(
    frame: np.ndarray,
    list_bbox: Tuple[int, int, int, int],
    plus_buttons: List[BBox],
    platform: str = "auto",
    min_visibility: float = 0.5
) -> List[RowInfo]:
    """
    Segment the skill list into individual rows with sub-ROIs for each field.

    Uses green plus buttons as row anchors to determine row boundaries.
    Each button corresponds to one row, with the row vertically centered
    on the button position.

    Args:
        frame: BGR image (numpy array) from the game
        list_bbox: Bounding box of skill list region as (x1, y1, x2, y2)
        plus_buttons: List of green plus button bboxes (x, y, w, h) sorted by y
        platform: "mobile", "pc", or "auto" for automatic detection
        min_visibility: Minimum visibility (0.0-1.0) to include row

    Returns:
        List of RowInfo objects for each valid row, sorted top to bottom
    """
    if frame is None or frame.size == 0:
        return []

    if list_bbox is None:
        return []

    height, width = frame.shape[:2]
    list_x1, list_y1, list_x2, list_y2 = list_bbox

    # Determine platform if auto
    if platform == "auto":
        aspect_ratio = width / height if height > 0 else 1.0
        platform = "mobile" if aspect_ratio < 0.8 else "pc"

    # Calculate row height
    row_height = _calculate_row_height_from_buttons(plus_buttons)
    if row_height is None:
        row_height = _estimate_default_row_height(height, platform)

    rows = []

    if not plus_buttons:
        # No buttons found - cannot segment rows reliably
        return []

    # Create one row per plus button
    for idx, button in enumerate(plus_buttons):
        btn_x, btn_y, btn_w, btn_h = button
        btn_center_y = btn_y + btn_h // 2

        # Row is centered on button's y-position
        row_y = btn_center_y - row_height // 2
        row_x = list_x1
        row_w = list_x2 - list_x1
        row_h = row_height

        # Clip row to list bounds
        row_y = max(list_y1, row_y)
        row_h = min(row_y + row_height, list_y2) - row_y

        if row_h <= 0:
            continue

        row_bbox = (row_x, row_y, row_w, row_h)

        # Calculate visibility
        visibility = _calculate_visibility(row_bbox, list_bbox, row_height)

        # Skip rows with low visibility
        if visibility < min_visibility:
            continue

        # Calculate sub-ROIs for each field
        name_roi, cost_roi, hint_roi, obtained_roi = _calculate_sub_rois(
            row_bbox, button, row_height
        )

        # Create RowInfo
        row_info = RowInfo(
            bbox=row_bbox,
            plus_button_bbox=button,
            name_roi=name_roi,
            cost_roi=cost_roi,
            hint_roi=hint_roi,
            obtained_roi=obtained_roi,
            visibility=visibility,
            row_index=idx,
        )

        rows.append(row_info)

    return rows


def get_row_crop(frame: np.ndarray, bbox: BBox) -> Optional[np.ndarray]:
    """
    Extract a cropped region from the frame.

    Args:
        frame: BGR image (numpy array)
        bbox: Bounding box as (x, y, w, h)

    Returns:
        Cropped image region, or None if invalid
    """
    if frame is None or frame.size == 0:
        return None

    x, y, w, h = bbox

    # Validate bounds
    if w <= 0 or h <= 0:
        return None

    height, width = frame.shape[:2]

    # Clip to frame bounds
    x1 = max(0, x)
    y1 = max(0, y)
    x2 = min(width, x + w)
    y2 = min(height, y + h)

    if x2 <= x1 or y2 <= y1:
        return None

    return frame[y1:y2, x1:x2].copy()


def get_roi_crop(frame: np.ndarray, roi: ROI) -> Optional[np.ndarray]:
    """
    Extract a ROI (region of interest) from the frame.

    Alias for get_row_crop with different semantic meaning.

    Args:
        frame: BGR image (numpy array)
        roi: Region of interest as (x, y, w, h)

    Returns:
        Cropped image region, or None if invalid
    """
    return get_row_crop(frame, roi)
