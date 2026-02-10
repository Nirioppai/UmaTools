"""
Color-based detection for UI elements in Umamusume Learn screen.

This module provides HSV color space detection for:
- Red "Obtained" badge detection
- Orange hint badge detection
- Green plus button detection (used as row anchors)

All detection functions use OpenCV's inRange with HSV color thresholds
defined in constants.py.
"""

from typing import List, Optional, Tuple

import cv2
import numpy as np

from .constants import (
    GREEN_LOWER,
    GREEN_UPPER,
    MIN_GREEN_BUTTON_RATIO,
    MIN_ORANGE_BADGE_RATIO,
    MIN_RED_BADGE_RATIO,
    ORANGE_LOWER,
    ORANGE_UPPER,
    RED_LOWER_1,
    RED_LOWER_2,
    RED_UPPER_1,
    RED_UPPER_2,
    MIN_BUTTON_AREA_RATIO,
    MAX_BUTTON_AREA_RATIO,
)


# Type alias for bounding box (x, y, w, h)
BBox = Tuple[int, int, int, int]

# Type alias for detection result (found, confidence, contour)
DetectionResult = Tuple[bool, float, Optional[np.ndarray]]


def _create_hsv_mask(
    hsv_image: np.ndarray,
    lower: Tuple[int, int, int],
    upper: Tuple[int, int, int]
) -> np.ndarray:
    """
    Create a binary mask for pixels within the given HSV range.

    Args:
        hsv_image: Image in HSV color space
        lower: Lower bound (H, S, V)
        upper: Upper bound (H, S, V)

    Returns:
        Binary mask where white pixels are within range
    """
    return cv2.inRange(hsv_image, np.array(lower), np.array(upper))


def _get_largest_contour(
    mask: np.ndarray,
    min_area: int = 0
) -> Tuple[Optional[np.ndarray], float]:
    """
    Find the largest contour in a binary mask.

    Args:
        mask: Binary mask image
        min_area: Minimum contour area to consider

    Returns:
        Tuple of (largest contour or None, contour area)
    """
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    if not contours:
        return None, 0.0

    largest = max(contours, key=cv2.contourArea)
    area = cv2.contourArea(largest)

    if area < min_area:
        return None, 0.0

    return largest, area


def _is_pill_shaped(contour: np.ndarray, aspect_ratio_range: Tuple[float, float] = (0.5, 5.0)) -> bool:
    """
    Check if a contour has a pill/badge shape.

    A pill shape is roughly rectangular with rounded ends, having:
    - Aspect ratio between the given range
    - Relatively high solidity (area / convex hull area)

    Args:
        contour: OpenCV contour
        aspect_ratio_range: Valid (min, max) aspect ratio range

    Returns:
        True if contour is pill-shaped
    """
    if contour is None or len(contour) < 5:
        return False

    # Get bounding rect
    _, _, w, h = cv2.boundingRect(contour)
    if h == 0 or w == 0:
        return False

    aspect = w / h
    min_aspect, max_aspect = aspect_ratio_range

    # Check aspect ratio
    if not (min_aspect <= aspect <= max_aspect):
        return False

    # Check solidity (how much of the bounding rect is filled)
    area = cv2.contourArea(contour)
    hull = cv2.convexHull(contour)
    hull_area = cv2.contourArea(hull)

    if hull_area == 0:
        return False

    solidity = area / hull_area

    # Pills/badges typically have high solidity (> 0.7)
    return solidity > 0.7


def detect_red_badge(roi: np.ndarray) -> DetectionResult:
    """
    Detect red "Obtained" badge in the given region of interest.

    Red detection uses two HSV ranges because red wraps around the hue spectrum:
    - Range 1: H 0-10 (red near 0)
    - Range 2: H 170-179 (red near 180)

    Args:
        roi: BGR image region to check for red badge

    Returns:
        Tuple of (found: bool, confidence: float, contour: Optional[np.ndarray])
        - found: True if red badge detected
        - confidence: 0.0-1.0 based on red pixel ratio and contour quality
        - contour: Largest red contour if found, None otherwise
    """
    if roi is None or roi.size == 0:
        return (False, 0.0, None)

    # Handle grayscale images
    if len(roi.shape) == 2:
        return (False, 0.0, None)

    # Convert to HSV
    hsv = cv2.cvtColor(roi, cv2.COLOR_BGR2HSV)

    # Create masks for both red ranges
    mask1 = _create_hsv_mask(hsv, RED_LOWER_1, RED_UPPER_1)
    mask2 = _create_hsv_mask(hsv, RED_LOWER_2, RED_UPPER_2)

    # Combine masks
    red_mask = cv2.bitwise_or(mask1, mask2)

    # Apply morphological operations to clean up noise
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
    red_mask = cv2.morphologyEx(red_mask, cv2.MORPH_OPEN, kernel)
    red_mask = cv2.morphologyEx(red_mask, cv2.MORPH_CLOSE, kernel)

    # Calculate red pixel ratio
    total_pixels = roi.shape[0] * roi.shape[1]
    red_pixels = cv2.countNonZero(red_mask)
    red_ratio = red_pixels / total_pixels if total_pixels > 0 else 0.0

    # Check if enough red pixels
    if red_ratio < MIN_RED_BADGE_RATIO:
        return (False, red_ratio, None)

    # Find largest red contour
    contour, contour_area = _get_largest_contour(red_mask)

    if contour is None:
        return (False, red_ratio, None)

    # Check if contour is pill-shaped (badge shape)
    if not _is_pill_shaped(contour):
        # Still return True if we have enough red pixels, just lower confidence
        confidence = red_ratio * 0.5
        return (True, confidence, contour)

    # Calculate confidence based on red ratio and contour quality
    # Higher red ratio and better contour shape = higher confidence
    confidence = min(1.0, red_ratio * 5.0)  # Scale up for reasonable values

    return (True, confidence, contour)


def detect_orange_badge(roi: np.ndarray) -> DetectionResult:
    """
    Detect orange hint badge in the given region of interest.

    Orange badges indicate hint level (Lv1-5) with associated discounts.

    Args:
        roi: BGR image region to check for orange badge

    Returns:
        Tuple of (found: bool, confidence: float, contour: Optional[np.ndarray])
        - found: True if orange badge detected
        - confidence: 0.0-1.0 based on orange pixel ratio and contour quality
        - contour: Largest orange contour if found, None otherwise
    """
    if roi is None or roi.size == 0:
        return (False, 0.0, None)

    # Handle grayscale images
    if len(roi.shape) == 2:
        return (False, 0.0, None)

    # Convert to HSV
    hsv = cv2.cvtColor(roi, cv2.COLOR_BGR2HSV)

    # Create orange mask
    orange_mask = _create_hsv_mask(hsv, ORANGE_LOWER, ORANGE_UPPER)

    # Apply morphological operations to clean up noise
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
    orange_mask = cv2.morphologyEx(orange_mask, cv2.MORPH_OPEN, kernel)
    orange_mask = cv2.morphologyEx(orange_mask, cv2.MORPH_CLOSE, kernel)

    # Calculate orange pixel ratio
    total_pixels = roi.shape[0] * roi.shape[1]
    orange_pixels = cv2.countNonZero(orange_mask)
    orange_ratio = orange_pixels / total_pixels if total_pixels > 0 else 0.0

    # Check if enough orange pixels
    if orange_ratio < MIN_ORANGE_BADGE_RATIO:
        return (False, orange_ratio, None)

    # Find largest orange contour
    contour, contour_area = _get_largest_contour(orange_mask)

    if contour is None:
        return (False, orange_ratio, None)

    # Check if contour is pill-shaped
    if not _is_pill_shaped(contour):
        confidence = orange_ratio * 0.5
        return (True, confidence, contour)

    # Calculate confidence
    confidence = min(1.0, orange_ratio * 5.0)

    return (True, confidence, contour)


def detect_green_regions(frame: np.ndarray) -> np.ndarray:
    """
    Create a binary mask of green regions in the frame.

    This is used for detecting green plus buttons which serve as row anchors.

    Args:
        frame: BGR image (full frame or ROI)

    Returns:
        Binary mask where white pixels are green regions
    """
    if frame is None or frame.size == 0:
        return np.zeros((1, 1), dtype=np.uint8)

    # Handle grayscale images
    if len(frame.shape) == 2:
        return np.zeros(frame.shape, dtype=np.uint8)

    # Convert to HSV
    hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)

    # Create green mask
    green_mask = _create_hsv_mask(hsv, GREEN_LOWER, GREEN_UPPER)

    # Apply morphological operations
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
    green_mask = cv2.morphologyEx(green_mask, cv2.MORPH_OPEN, kernel)
    green_mask = cv2.morphologyEx(green_mask, cv2.MORPH_CLOSE, kernel)

    return green_mask


def find_green_plus_buttons(frame: np.ndarray) -> List[BBox]:
    """
    Find green plus button locations in the frame.

    Plus buttons are primary row anchors for skill list detection.
    They appear at the right side of each skill row.

    Args:
        frame: BGR image (full frame)

    Returns:
        List of bounding boxes (x, y, w, h) sorted by y-position (top to bottom)
    """
    if frame is None or frame.size == 0:
        return []

    # Get green mask
    green_mask = detect_green_regions(frame)

    # Calculate area thresholds based on frame size
    frame_area = frame.shape[0] * frame.shape[1]
    min_area = int(frame_area * MIN_BUTTON_AREA_RATIO)
    max_area = int(frame_area * MAX_BUTTON_AREA_RATIO)

    # Find contours
    contours, _ = cv2.findContours(green_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    buttons = []
    for contour in contours:
        area = cv2.contourArea(contour)

        # Filter by area
        if area < min_area or area > max_area:
            continue

        # Get bounding rect
        x, y, w, h = cv2.boundingRect(contour)

        # Check if roughly square/circular (plus buttons are usually circular)
        aspect = w / h if h > 0 else 0
        if not (0.5 <= aspect <= 2.0):
            continue

        # Check green ratio within bounding box
        roi_mask = green_mask[y:y+h, x:x+w]
        green_pixels = cv2.countNonZero(roi_mask)
        total_pixels = w * h
        green_ratio = green_pixels / total_pixels if total_pixels > 0 else 0

        if green_ratio < MIN_GREEN_BUTTON_RATIO:
            continue

        buttons.append((x, y, w, h))

    # Sort by y-position (top to bottom)
    buttons.sort(key=lambda b: b[1])

    return buttons


def get_badge_bbox(contour: np.ndarray) -> Optional[BBox]:
    """
    Get the bounding box of a badge contour.

    Args:
        contour: OpenCV contour from badge detection

    Returns:
        Bounding box (x, y, w, h) or None if contour is invalid
    """
    if contour is None or len(contour) == 0:
        return None

    return cv2.boundingRect(contour)
