"""
Field-specific OCR functions for extracting skill information from Umamusume screenshots.

This module provides OCR extraction for individual fields:
- Cost digits (1-9999) from cost pill region
- Hint badge level and discount percentage
- Skill name text with normalization

Each function includes appropriate preprocessing and confidence scoring.
"""

from dataclasses import dataclass
from typing import Optional, Tuple

import cv2
import numpy as np

try:
    import pytesseract
except ImportError:
    pytesseract = None

from .constants import (
    COST_CONFIG,
    COST_UPSCALE_FACTOR,
    HINT_LEVEL_CONFIG,
    HINT_UPSCALE_FACTOR,
    MIN_COST_CONFIDENCE,
    MIN_HINT_CONFIDENCE,
    MIN_NAME_CONFIDENCE,
    NAME_CONFIG,
    NAME_UPSCALE_FACTOR,
)
from .color_detect import detect_orange_badge


@dataclass
class OcrResult:
    """
    Result from OCR extraction of a single field.

    Attributes:
        value: Extracted value (int for digits, str for text), None if failed
        confidence: OCR confidence score (0.0-1.0)
        raw_text: Raw OCR output before parsing
    """
    value: Optional[int]
    confidence: float
    raw_text: str


@dataclass
class HintResult:
    """
    Result from hint badge OCR extraction.

    Attributes:
        hint_level: Hint level 1-5, None if no badge or OCR failed
        discount_percent: Discount percentage (10/20/30), None if unknown
        confidence: Detection confidence (0.0-1.0)
        badge_found: True if orange badge was detected
    """
    hint_level: Optional[int]
    discount_percent: Optional[int]
    confidence: float
    badge_found: bool


@dataclass
class NameResult:
    """
    Result from skill name OCR extraction.

    Attributes:
        raw: Raw OCR output text
        normalized: Normalized name (lowercase, trimmed, whitespace collapsed)
        confidence: OCR confidence score (0.0-1.0)
    """
    raw: str
    normalized: str
    confidence: float


def _check_tesseract_available() -> bool:
    """Check if pytesseract is available and configured."""
    if pytesseract is None:
        return False
    try:
        pytesseract.get_tesseract_version()
        return True
    except Exception:
        return False


def _to_grayscale(image: np.ndarray) -> np.ndarray:
    """
    Convert image to grayscale if it's color.

    Args:
        image: Input image (BGR or grayscale)

    Returns:
        Grayscale image
    """
    if len(image.shape) == 2:
        return image
    return cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)


def _upscale_image(image: np.ndarray, factor: int = 2) -> np.ndarray:
    """
    Upscale image for better OCR accuracy.

    Args:
        image: Input image
        factor: Upscale factor (2-4 typical)

    Returns:
        Upscaled image
    """
    if factor <= 1:
        return image

    h, w = image.shape[:2]
    new_size = (w * factor, h * factor)
    return cv2.resize(image, new_size, interpolation=cv2.INTER_CUBIC)


def _apply_adaptive_threshold(gray: np.ndarray) -> np.ndarray:
    """
    Apply adaptive thresholding for text extraction.

    Uses Gaussian adaptive method which works well for varying lighting.

    Args:
        gray: Grayscale image

    Returns:
        Binary image
    """
    return cv2.adaptiveThreshold(
        gray,
        255,
        cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY,
        11,  # Block size
        2    # C constant
    )


def _apply_otsu_threshold(gray: np.ndarray) -> np.ndarray:
    """
    Apply Otsu's thresholding for clean text/background separation.

    Works well when there's a clear bimodal histogram (dark text on light background).

    Args:
        gray: Grayscale image

    Returns:
        Binary image
    """
    _, binary = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    return binary


def _apply_morphology(binary: np.ndarray, operation: int = cv2.MORPH_CLOSE, kernel_size: int = 2) -> np.ndarray:
    """
    Apply morphological operation to clean up binary image.

    Args:
        binary: Binary image
        operation: cv2.MORPH_CLOSE, cv2.MORPH_OPEN, etc.
        kernel_size: Size of morphological kernel

    Returns:
        Processed binary image
    """
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (kernel_size, kernel_size))
    return cv2.morphologyEx(binary, operation, kernel)


def _invert_if_needed(binary: np.ndarray) -> np.ndarray:
    """
    Invert binary image if text appears white on black.

    Tesseract works best with black text on white background.
    Check the border pixels to determine polarity.

    Args:
        binary: Binary image

    Returns:
        Binary image with correct polarity for OCR
    """
    h, w = binary.shape[:2]

    # Sample border pixels
    border_mean = np.mean([
        np.mean(binary[0, :]),           # Top row
        np.mean(binary[h-1, :]),         # Bottom row
        np.mean(binary[:, 0]),           # Left column
        np.mean(binary[:, w-1])          # Right column
    ])

    # If border is mostly black (< 128), background is black, invert
    if border_mean < 128:
        return cv2.bitwise_not(binary)

    return binary


def _run_tesseract(image: np.ndarray, config: str) -> Tuple[str, float]:
    """
    Run Tesseract OCR on an image.

    Args:
        image: Preprocessed image (grayscale or binary)
        config: Tesseract configuration string

    Returns:
        Tuple of (extracted text, confidence score 0.0-1.0)
    """
    if not _check_tesseract_available():
        return ("", 0.0)

    try:
        # Get OCR result with confidence data
        data = pytesseract.image_to_data(image, config=config, output_type=pytesseract.Output.DICT)

        # Extract text and calculate average confidence
        texts = []
        confidences = []

        for i, text in enumerate(data['text']):
            conf = data['conf'][i]
            text = text.strip()

            # Skip empty results and low confidence (-1 means no text)
            if text and conf >= 0:
                texts.append(text)
                confidences.append(conf)

        combined_text = ' '.join(texts)
        avg_confidence = sum(confidences) / len(confidences) / 100.0 if confidences else 0.0

        return (combined_text, avg_confidence)

    except Exception:
        # Fallback to simple OCR without confidence
        try:
            text = pytesseract.image_to_string(image, config=config).strip()
            return (text, 0.5 if text else 0.0)
        except Exception:
            return ("", 0.0)


def _preprocess_for_digits(roi: np.ndarray, upscale_factor: int = 3) -> np.ndarray:
    """
    Preprocess ROI for digit OCR.

    Pipeline:
    1. Convert to grayscale
    2. Upscale for better OCR
    3. Apply adaptive threshold
    4. Morphological close to fill gaps
    5. Invert if needed

    Args:
        roi: BGR or grayscale image region
        upscale_factor: Upscale factor for OCR

    Returns:
        Preprocessed binary image
    """
    if roi is None or roi.size == 0:
        return np.ones((50, 100), dtype=np.uint8) * 255

    # Convert to grayscale
    gray = _to_grayscale(roi)

    # Upscale
    upscaled = _upscale_image(gray, upscale_factor)

    # Apply threshold
    binary = _apply_adaptive_threshold(upscaled)

    # Apply morphological close to fill small gaps in digits
    binary = _apply_morphology(binary, cv2.MORPH_CLOSE, 2)

    # Ensure black text on white background
    binary = _invert_if_needed(binary)

    return binary


def _preprocess_for_text(roi: np.ndarray, upscale_factor: int = 2) -> np.ndarray:
    """
    Preprocess ROI for text OCR (skill names).

    Uses milder preprocessing to preserve text details.

    Args:
        roi: BGR or grayscale image region
        upscale_factor: Upscale factor for OCR

    Returns:
        Preprocessed image for OCR
    """
    if roi is None or roi.size == 0:
        return np.ones((30, 200), dtype=np.uint8) * 255

    # Convert to grayscale
    gray = _to_grayscale(roi)

    # Light denoise
    gray = cv2.GaussianBlur(gray, (3, 3), 0)

    # Upscale
    upscaled = _upscale_image(gray, upscale_factor)

    # Apply Otsu threshold (usually cleaner for text)
    binary = _apply_otsu_threshold(upscaled)

    # Ensure black text on white background
    binary = _invert_if_needed(binary)

    return binary


def _parse_cost_digits(text: str) -> Optional[int]:
    """
    Parse cost value from OCR text.

    Args:
        text: Raw OCR output

    Returns:
        Parsed integer cost (1-9999), or None if invalid
    """
    # Remove any non-digit characters
    digits = ''.join(c for c in text if c.isdigit())

    if not digits:
        return None

    try:
        value = int(digits)
        # Valid cost range is 1-9999
        if 1 <= value <= 9999:
            return value
        return None
    except ValueError:
        return None


def _normalize_skill_name(text: str) -> str:
    """
    Normalize skill name text for matching.

    - Convert to lowercase
    - Trim whitespace
    - Collapse multiple spaces
    - Fix common OCR confusions

    Args:
        text: Raw OCR text

    Returns:
        Normalized text
    """
    if not text:
        return ""

    # Lowercase
    text = text.lower()

    # Trim
    text = text.strip()

    # Collapse whitespace
    text = ' '.join(text.split())

    # Fix common OCR confusions
    replacements = {
        '|': 'i',    # | often confused with I/l
        '0': 'o',    # Only in non-digit context
        '1': 'l',    # Only in non-digit context
        '\n': ' ',   # Newlines to spaces
    }

    for old, new in replacements.items():
        text = text.replace(old, new)

    return text


def ocr_cost_digits(roi: np.ndarray) -> OcrResult:
    """
    Extract cost digits (1-9999) from cost pill region.

    Uses digit-only whitelist for Tesseract and multiple preprocessing
    variants for robustness.

    Args:
        roi: BGR or grayscale image of cost pill region

    Returns:
        OcrResult with value (int 1-9999 or None), confidence, and raw_text
    """
    if roi is None or roi.size == 0:
        return OcrResult(value=None, confidence=0.0, raw_text="")

    # Preprocess for digit OCR
    preprocessed = _preprocess_for_digits(roi, COST_UPSCALE_FACTOR)

    # Run OCR
    raw_text, confidence = _run_tesseract(preprocessed, COST_CONFIG)

    # Parse digits
    value = _parse_cost_digits(raw_text)

    # If first attempt failed, try alternative preprocessing
    if value is None and confidence < MIN_COST_CONFIDENCE:
        # Try Otsu threshold instead
        gray = _to_grayscale(roi)
        upscaled = _upscale_image(gray, COST_UPSCALE_FACTOR)
        binary = _apply_otsu_threshold(upscaled)
        binary = _invert_if_needed(binary)

        alt_text, alt_conf = _run_tesseract(binary, COST_CONFIG)
        alt_value = _parse_cost_digits(alt_text)

        if alt_value is not None:
            return OcrResult(value=alt_value, confidence=alt_conf, raw_text=alt_text)

    return OcrResult(value=value, confidence=confidence, raw_text=raw_text)


def _parse_hint_level(text: str) -> Optional[int]:
    """
    Parse hint level from OCR text.

    Expected formats:
    - "Lv1", "Lv2", etc.
    - Just "1", "2", etc.
    - "Level 1", etc.

    Args:
        text: Raw OCR output

    Returns:
        Hint level 1-5, or None if not found
    """
    if not text:
        return None

    # Look for digits
    for char in text:
        if char.isdigit():
            level = int(char)
            if 1 <= level <= 5:
                return level

    return None


def _get_discount_for_level(level: int) -> Optional[int]:
    """
    Get discount percentage for a hint level.

    Standard discount rates:
    - Lv1-2: 10%
    - Lv3: 20%
    - Lv4-5: 30%

    Args:
        level: Hint level 1-5

    Returns:
        Discount percentage (10, 20, or 30)
    """
    if level in (1, 2):
        return 10
    elif level == 3:
        return 20
    elif level in (4, 5):
        return 30
    return None


def ocr_hint_badge(roi: np.ndarray) -> HintResult:
    """
    Extract hint level and discount from hint badge region.

    First detects orange badge presence, then OCRs the level digit.
    Discount is derived from the level using standard rates.

    Args:
        roi: BGR image of potential hint badge region

    Returns:
        HintResult with hint_level, discount_percent, confidence, badge_found
    """
    if roi is None or roi.size == 0:
        return HintResult(hint_level=None, discount_percent=None, confidence=0.0, badge_found=False)

    # First check for orange badge
    found, badge_conf, contour = detect_orange_badge(roi)

    if not found:
        return HintResult(hint_level=None, discount_percent=None, confidence=0.0, badge_found=False)

    # Preprocess for hint level digit OCR
    preprocessed = _preprocess_for_digits(roi, HINT_UPSCALE_FACTOR)

    # Try OCR with hint level config
    raw_text, confidence = _run_tesseract(preprocessed, HINT_LEVEL_CONFIG)

    # Parse level
    level = _parse_hint_level(raw_text)

    # If no level found with strict config, try broader approach
    if level is None:
        raw_text, confidence = _run_tesseract(preprocessed, COST_CONFIG)
        level = _parse_hint_level(raw_text)

    # Get discount based on level
    discount = _get_discount_for_level(level) if level else None

    # Adjust confidence based on whether we found a valid level
    final_conf = min(badge_conf, confidence) if level else badge_conf * 0.5

    return HintResult(
        hint_level=level,
        discount_percent=discount,
        confidence=final_conf,
        badge_found=True
    )


def ocr_skill_name(roi: np.ndarray) -> NameResult:
    """
    Extract skill name text from name region.

    Uses text-optimized preprocessing and returns both raw and normalized text.

    Args:
        roi: BGR or grayscale image of skill name region

    Returns:
        NameResult with raw text, normalized text, and confidence
    """
    if roi is None or roi.size == 0:
        return NameResult(raw="", normalized="", confidence=0.0)

    # Preprocess for text OCR
    preprocessed = _preprocess_for_text(roi, NAME_UPSCALE_FACTOR)

    # Run OCR
    raw_text, confidence = _run_tesseract(preprocessed, NAME_CONFIG)

    # Normalize
    normalized = _normalize_skill_name(raw_text)

    # If first attempt has low confidence, try alternative preprocessing
    if confidence < MIN_NAME_CONFIDENCE and raw_text:
        gray = _to_grayscale(roi)
        upscaled = _upscale_image(gray, NAME_UPSCALE_FACTOR + 1)
        binary = _apply_adaptive_threshold(upscaled)
        binary = _invert_if_needed(binary)

        alt_text, alt_conf = _run_tesseract(binary, NAME_CONFIG)

        if alt_conf > confidence:
            raw_text = alt_text
            normalized = _normalize_skill_name(alt_text)
            confidence = alt_conf

    return NameResult(raw=raw_text, normalized=normalized, confidence=confidence)
