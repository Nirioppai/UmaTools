"""
Image preprocessing utilities for OCR extraction.

This module provides reusable preprocessing functions for optimizing
images before OCR extraction. Includes multiple threshold variants,
upscaling, morphological operations, and contrast enhancement.

These utilities are designed for robustness with fallback variants
when initial preprocessing produces poor results.
"""

from dataclasses import dataclass
from enum import Enum
from typing import Optional, Tuple

import cv2
import numpy as np

from .constants import (
    MORPH_KERNEL_SMALL,
    MORPH_KERNEL_MEDIUM,
    MORPH_KERNEL_LARGE,
)


class ThresholdMethod(Enum):
    """Available thresholding methods."""
    OTSU = "otsu"
    ADAPTIVE_GAUSSIAN = "adaptive_gaussian"
    ADAPTIVE_MEAN = "adaptive_mean"
    BINARY = "binary"


class MorphOperation(Enum):
    """Available morphological operations."""
    CLOSE = cv2.MORPH_CLOSE
    OPEN = cv2.MORPH_OPEN
    DILATE = cv2.MORPH_DILATE
    ERODE = cv2.MORPH_ERODE
    GRADIENT = cv2.MORPH_GRADIENT
    TOPHAT = cv2.MORPH_TOPHAT
    BLACKHAT = cv2.MORPH_BLACKHAT


@dataclass
class PreprocessResult:
    """
    Result from preprocessing pipeline.

    Attributes:
        image: Preprocessed image (grayscale or binary)
        method: Method used for preprocessing
        success: True if preprocessing produced a valid result
    """
    image: np.ndarray
    method: str
    success: bool


# =============================================================================
# Grayscale Conversion
# =============================================================================

def to_grayscale(image: np.ndarray) -> np.ndarray:
    """
    Convert image to grayscale if it's color.

    Args:
        image: Input image (BGR or grayscale)

    Returns:
        Grayscale image
    """
    if image is None or image.size == 0:
        return np.zeros((1, 1), dtype=np.uint8)

    if len(image.shape) == 2:
        return image

    return cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)


# =============================================================================
# Upscaling
# =============================================================================

def upscale_for_ocr(image: np.ndarray, factor: int = 2,
                     interpolation: int = cv2.INTER_CUBIC) -> np.ndarray:
    """
    Upscale image for better OCR accuracy.

    Larger images generally produce better OCR results, especially for
    small text or digits. Uses INTER_CUBIC interpolation by default
    which provides good quality for text.

    Args:
        image: Input image (grayscale or color)
        factor: Upscale factor (2-4 typical), must be >= 1
        interpolation: OpenCV interpolation method (default INTER_CUBIC)

    Returns:
        Upscaled image with same dtype as input

    Example:
        >>> img = np.zeros((50, 100), dtype=np.uint8)
        >>> result = upscale_for_ocr(img, factor=2)
        >>> result.shape
        (100, 200)
    """
    if image is None or image.size == 0:
        return np.zeros((1, 1), dtype=np.uint8)

    if factor <= 1:
        return image.copy()

    h, w = image.shape[:2]
    new_size = (w * factor, h * factor)
    return cv2.resize(image, new_size, interpolation=interpolation)


def upscale_to_min_height(image: np.ndarray, min_height: int = 50) -> np.ndarray:
    """
    Upscale image to meet minimum height requirement.

    Ensures image is at least min_height pixels tall for OCR.
    Only upscales if current height is below minimum.

    Args:
        image: Input image
        min_height: Minimum height in pixels

    Returns:
        Upscaled image if needed, or original if already tall enough
    """
    if image is None or image.size == 0:
        return np.zeros((min_height, 1), dtype=np.uint8)

    h = image.shape[0]

    if h >= min_height:
        return image.copy()

    factor = int(np.ceil(min_height / h))
    return upscale_for_ocr(image, factor)


# =============================================================================
# Thresholding
# =============================================================================

def adaptive_threshold(gray: np.ndarray,
                        method: str = "gaussian",
                        block_size: int = 11,
                        c: int = 2) -> np.ndarray:
    """
    Apply adaptive thresholding for text extraction.

    Adaptive thresholding calculates the threshold for each pixel based
    on the local neighborhood, making it robust to uneven lighting.

    Args:
        gray: Grayscale image
        method: "gaussian" or "mean" - how to calculate local threshold
        block_size: Size of neighborhood for threshold calculation (must be odd)
        c: Constant subtracted from mean/weighted mean

    Returns:
        Binary image with white background and black foreground

    Example:
        >>> img = np.zeros((50, 100), dtype=np.uint8)
        >>> result = adaptive_threshold(img, method="gaussian")
        >>> result.dtype
        dtype('uint8')
    """
    if gray is None or gray.size == 0:
        return np.ones((1, 1), dtype=np.uint8) * 255

    # Ensure grayscale
    if len(gray.shape) > 2:
        gray = cv2.cvtColor(gray, cv2.COLOR_BGR2GRAY)

    # Ensure block_size is odd
    if block_size % 2 == 0:
        block_size += 1

    # Choose method
    if method.lower() == "mean":
        adaptive_method = cv2.ADAPTIVE_THRESH_MEAN_C
    else:
        adaptive_method = cv2.ADAPTIVE_THRESH_GAUSSIAN_C

    return cv2.adaptiveThreshold(
        gray,
        255,
        adaptive_method,
        cv2.THRESH_BINARY,
        block_size,
        c
    )


def otsu_threshold(gray: np.ndarray) -> np.ndarray:
    """
    Apply Otsu's thresholding for clean text/background separation.

    Otsu's method automatically calculates an optimal threshold value
    by minimizing intra-class variance. Works best when there's a clear
    bimodal histogram (dark text on light background).

    Args:
        gray: Grayscale image

    Returns:
        Binary image
    """
    if gray is None or gray.size == 0:
        return np.ones((1, 1), dtype=np.uint8) * 255

    # Ensure grayscale
    if len(gray.shape) > 2:
        gray = cv2.cvtColor(gray, cv2.COLOR_BGR2GRAY)

    _, binary = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    return binary


def simple_threshold(gray: np.ndarray, threshold: int = 127) -> np.ndarray:
    """
    Apply simple binary thresholding.

    Args:
        gray: Grayscale image
        threshold: Threshold value (0-255)

    Returns:
        Binary image
    """
    if gray is None or gray.size == 0:
        return np.ones((1, 1), dtype=np.uint8) * 255

    # Ensure grayscale
    if len(gray.shape) > 2:
        gray = cv2.cvtColor(gray, cv2.COLOR_BGR2GRAY)

    _, binary = cv2.threshold(gray, threshold, 255, cv2.THRESH_BINARY)
    return binary


def multi_threshold(gray: np.ndarray) -> Tuple[np.ndarray, str]:
    """
    Try multiple thresholding methods and return the best result.

    Useful when the optimal threshold method is unknown. Evaluates
    results based on contrast and returns the method that produces
    the clearest separation.

    Args:
        gray: Grayscale image

    Returns:
        Tuple of (binary image, method name used)
    """
    if gray is None or gray.size == 0:
        return np.ones((1, 1), dtype=np.uint8) * 255, "empty"

    # Ensure grayscale
    if len(gray.shape) > 2:
        gray = cv2.cvtColor(gray, cv2.COLOR_BGR2GRAY)

    results = [
        (otsu_threshold(gray), "otsu"),
        (adaptive_threshold(gray, "gaussian"), "adaptive_gaussian"),
        (adaptive_threshold(gray, "mean"), "adaptive_mean"),
    ]

    # Evaluate quality based on contrast and distribution
    best_score = -1
    best_result = results[0]

    for binary, method in results:
        # Count foreground/background ratio
        total = binary.size
        white = np.sum(binary > 127)
        black = total - white

        # Best results have some mix of both (not all one color)
        ratio = min(white, black) / max(white, black) if max(white, black) > 0 else 0
        score = ratio * (1 - abs(0.3 - ratio))  # Prefer ~30% foreground

        if score > best_score:
            best_score = score
            best_result = (binary, method)

    return best_result


# =============================================================================
# Morphological Operations
# =============================================================================

def apply_morphology(binary: np.ndarray,
                      operation: str = "close",
                      kernel_size: int = 2) -> np.ndarray:
    """
    Apply morphological operation to clean up binary image.

    Common operations:
    - close: Fills small holes in foreground (good for broken text)
    - open: Removes small noise from foreground
    - dilate: Expands foreground regions
    - erode: Shrinks foreground regions

    Args:
        binary: Binary image
        operation: "close", "open", "dilate", "erode", "gradient", "tophat", "blackhat"
        kernel_size: Size of morphological kernel (2-5 typical)

    Returns:
        Processed binary image

    Example:
        >>> img = np.zeros((50, 100), dtype=np.uint8)
        >>> result = apply_morphology(img, operation="close", kernel_size=2)
        >>> result.shape
        (50, 100)
    """
    if binary is None or binary.size == 0:
        return np.ones((1, 1), dtype=np.uint8) * 255

    # Map operation name to OpenCV constant
    op_map = {
        "close": cv2.MORPH_CLOSE,
        "open": cv2.MORPH_OPEN,
        "dilate": cv2.MORPH_DILATE,
        "erode": cv2.MORPH_ERODE,
        "gradient": cv2.MORPH_GRADIENT,
        "tophat": cv2.MORPH_TOPHAT,
        "blackhat": cv2.MORPH_BLACKHAT,
    }

    op = op_map.get(operation.lower(), cv2.MORPH_CLOSE)
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (kernel_size, kernel_size))

    return cv2.morphologyEx(binary, op, kernel)


def close_gaps(binary: np.ndarray, size: str = "small") -> np.ndarray:
    """
    Close small gaps in text characters.

    Uses morphological close operation with predefined kernel sizes.

    Args:
        binary: Binary image
        size: "small" (2x2), "medium" (3x3), or "large" (5x5)

    Returns:
        Binary image with gaps filled
    """
    size_map = {
        "small": MORPH_KERNEL_SMALL,
        "medium": MORPH_KERNEL_MEDIUM,
        "large": MORPH_KERNEL_LARGE,
    }

    kernel_size = size_map.get(size.lower(), MORPH_KERNEL_SMALL)
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, kernel_size)

    return cv2.morphologyEx(binary, cv2.MORPH_CLOSE, kernel)


def remove_noise(binary: np.ndarray, size: str = "small") -> np.ndarray:
    """
    Remove small noise spots from binary image.

    Uses morphological open operation with predefined kernel sizes.

    Args:
        binary: Binary image
        size: "small" (2x2), "medium" (3x3), or "large" (5x5)

    Returns:
        Binary image with noise removed
    """
    size_map = {
        "small": MORPH_KERNEL_SMALL,
        "medium": MORPH_KERNEL_MEDIUM,
        "large": MORPH_KERNEL_LARGE,
    }

    kernel_size = size_map.get(size.lower(), MORPH_KERNEL_SMALL)
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, kernel_size)

    return cv2.morphologyEx(binary, cv2.MORPH_OPEN, kernel)


# =============================================================================
# Contrast Enhancement
# =============================================================================

def enhance_contrast(gray: np.ndarray, clip_limit: float = 2.0,
                      tile_grid_size: Tuple[int, int] = (8, 8)) -> np.ndarray:
    """
    Enhance contrast using CLAHE (Contrast Limited Adaptive Histogram Equalization).

    CLAHE improves local contrast while limiting noise amplification.
    Particularly useful for images with uneven lighting.

    Args:
        gray: Grayscale image
        clip_limit: Threshold for contrast limiting (higher = more contrast)
        tile_grid_size: Size of grid for histogram equalization

    Returns:
        Contrast-enhanced grayscale image
    """
    if gray is None or gray.size == 0:
        return np.zeros((1, 1), dtype=np.uint8)

    # Ensure grayscale
    if len(gray.shape) > 2:
        gray = cv2.cvtColor(gray, cv2.COLOR_BGR2GRAY)

    clahe = cv2.createCLAHE(clipLimit=clip_limit, tileGridSize=tile_grid_size)
    return clahe.apply(gray)


def normalize_brightness(gray: np.ndarray) -> np.ndarray:
    """
    Normalize brightness to use full 0-255 range.

    Stretches the histogram to improve contrast for images
    that don't use the full dynamic range.

    Args:
        gray: Grayscale image

    Returns:
        Normalized grayscale image
    """
    if gray is None or gray.size == 0:
        return np.zeros((1, 1), dtype=np.uint8)

    # Ensure grayscale
    if len(gray.shape) > 2:
        gray = cv2.cvtColor(gray, cv2.COLOR_BGR2GRAY)

    return cv2.normalize(gray, None, 0, 255, cv2.NORM_MINMAX)


# =============================================================================
# Denoising
# =============================================================================

def denoise_light(gray: np.ndarray) -> np.ndarray:
    """
    Apply light denoising using Gaussian blur.

    Good for OCR as it smooths minor noise without losing text edges.

    Args:
        gray: Grayscale image

    Returns:
        Denoised grayscale image
    """
    if gray is None or gray.size == 0:
        return np.zeros((1, 1), dtype=np.uint8)

    return cv2.GaussianBlur(gray, (3, 3), 0)


def denoise_strong(gray: np.ndarray) -> np.ndarray:
    """
    Apply stronger denoising using bilateral filter.

    Preserves edges while removing noise. More aggressive than Gaussian.

    Args:
        gray: Grayscale image

    Returns:
        Denoised grayscale image
    """
    if gray is None or gray.size == 0:
        return np.zeros((1, 1), dtype=np.uint8)

    return cv2.bilateralFilter(gray, 9, 75, 75)


# =============================================================================
# Polarity Correction
# =============================================================================

def invert_if_needed(binary: np.ndarray) -> np.ndarray:
    """
    Invert binary image if text appears white on black background.

    Tesseract works best with black text on white background.
    This function checks border pixels to determine polarity.

    Args:
        binary: Binary image

    Returns:
        Binary image with correct polarity for OCR
    """
    if binary is None or binary.size == 0:
        return np.ones((1, 1), dtype=np.uint8) * 255

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


def ensure_white_background(binary: np.ndarray) -> np.ndarray:
    """
    Ensure image has white background (majority should be white).

    Differs from invert_if_needed by checking overall image content
    rather than just borders.

    Args:
        binary: Binary image

    Returns:
        Binary image with white background
    """
    if binary is None or binary.size == 0:
        return np.ones((1, 1), dtype=np.uint8) * 255

    # Calculate ratio of white pixels
    white_ratio = np.mean(binary > 127)

    # If less than half is white, invert
    if white_ratio < 0.5:
        return cv2.bitwise_not(binary)

    return binary


# =============================================================================
# Pipeline Functions
# =============================================================================

def preprocess_for_digits(roi: np.ndarray, upscale_factor: int = 3) -> np.ndarray:
    """
    Preprocess ROI for digit OCR.

    Optimized pipeline for extracting numeric text:
    1. Convert to grayscale
    2. Upscale for better OCR
    3. Apply adaptive threshold
    4. Morphological close to fill gaps
    5. Invert if needed

    Args:
        roi: BGR or grayscale image region
        upscale_factor: Upscale factor for OCR (default 3)

    Returns:
        Preprocessed binary image ready for OCR
    """
    if roi is None or roi.size == 0:
        return np.ones((50, 100), dtype=np.uint8) * 255

    # Convert to grayscale
    gray = to_grayscale(roi)

    # Upscale
    upscaled = upscale_for_ocr(gray, upscale_factor)

    # Apply threshold
    binary = adaptive_threshold(upscaled)

    # Apply morphological close to fill small gaps in digits
    binary = apply_morphology(binary, "close", 2)

    # Ensure black text on white background
    binary = invert_if_needed(binary)

    return binary


def preprocess_for_text(roi: np.ndarray, upscale_factor: int = 2) -> np.ndarray:
    """
    Preprocess ROI for text OCR (skill names).

    Uses milder preprocessing to preserve text details:
    1. Convert to grayscale
    2. Light denoise
    3. Upscale
    4. Otsu threshold
    5. Invert if needed

    Args:
        roi: BGR or grayscale image region
        upscale_factor: Upscale factor for OCR (default 2)

    Returns:
        Preprocessed binary image ready for OCR
    """
    if roi is None or roi.size == 0:
        return np.ones((30, 200), dtype=np.uint8) * 255

    # Convert to grayscale
    gray = to_grayscale(roi)

    # Light denoise
    gray = denoise_light(gray)

    # Upscale
    upscaled = upscale_for_ocr(gray, upscale_factor)

    # Apply Otsu threshold (usually cleaner for text)
    binary = otsu_threshold(upscaled)

    # Ensure black text on white background
    binary = invert_if_needed(binary)

    return binary


def preprocess_with_fallback(roi: np.ndarray,
                              primary_method: str = "adaptive",
                              upscale_factor: int = 2) -> PreprocessResult:
    """
    Preprocess with fallback to alternative methods if primary fails.

    Tries primary method first, then falls back to alternatives if
    the result appears to be poor quality.

    Args:
        roi: BGR or grayscale image region
        primary_method: "adaptive", "otsu", or "both"
        upscale_factor: Upscale factor for OCR

    Returns:
        PreprocessResult with best preprocessing result
    """
    if roi is None or roi.size == 0:
        return PreprocessResult(
            image=np.ones((50, 100), dtype=np.uint8) * 255,
            method="empty",
            success=False
        )

    # Convert and upscale
    gray = to_grayscale(roi)
    upscaled = upscale_for_ocr(gray, upscale_factor)

    # Try primary method
    if primary_method == "adaptive":
        binary = adaptive_threshold(upscaled)
        method = "adaptive"
    elif primary_method == "otsu":
        binary = otsu_threshold(upscaled)
        method = "otsu"
    else:
        binary, method = multi_threshold(upscaled)

    # Evaluate quality
    binary = invert_if_needed(binary)

    # Check if result looks reasonable
    white_ratio = np.mean(binary > 127)

    # If too much or too little white, try alternative
    if white_ratio < 0.3 or white_ratio > 0.95:
        # Try the other method
        if method in ["adaptive", "adaptive_gaussian", "adaptive_mean"]:
            binary = otsu_threshold(upscaled)
            method = "otsu_fallback"
        else:
            binary = adaptive_threshold(upscaled)
            method = "adaptive_fallback"

        binary = invert_if_needed(binary)

    return PreprocessResult(
        image=binary,
        method=method,
        success=True
    )
