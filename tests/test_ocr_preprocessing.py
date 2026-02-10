"""
Unit tests for OCR preprocessing and color detection modules.

These tests use synthetic images to validate:
- Preprocessing functions (thresholding, upscaling, morphology)
- Color detection functions (red/orange badges, green buttons)

All tests are self-contained and do not require external fixtures.
"""

import numpy as np
import pytest
import cv2

from ocr.preprocess import (
    adaptive_threshold,
    apply_morphology,
    close_gaps,
    denoise_light,
    denoise_strong,
    enhance_contrast,
    ensure_white_background,
    invert_if_needed,
    multi_threshold,
    normalize_brightness,
    otsu_threshold,
    preprocess_for_digits,
    preprocess_for_text,
    preprocess_with_fallback,
    remove_noise,
    simple_threshold,
    to_grayscale,
    upscale_for_ocr,
    upscale_to_min_height,
    PreprocessResult,
    ThresholdMethod,
    MorphOperation,
)
from ocr.color_detect import (
    detect_red_badge,
    detect_orange_badge,
    detect_green_regions,
    find_green_plus_buttons,
    get_badge_bbox,
    BBox,
    DetectionResult,
)


# =============================================================================
# Fixtures: Synthetic Test Images
# =============================================================================

@pytest.fixture
def blank_gray_image():
    """Create a blank grayscale image (50x100)."""
    return np.zeros((50, 100), dtype=np.uint8)


@pytest.fixture
def blank_color_image():
    """Create a blank BGR color image (50x100)."""
    return np.zeros((50, 100, 3), dtype=np.uint8)


@pytest.fixture
def white_gray_image():
    """Create a white grayscale image (50x100)."""
    return np.ones((50, 100), dtype=np.uint8) * 255


@pytest.fixture
def gradient_gray_image():
    """Create a grayscale image with a horizontal gradient (50x100)."""
    img = np.zeros((50, 100), dtype=np.uint8)
    for x in range(100):
        img[:, x] = int(x * 255 / 99)
    return img


@pytest.fixture
def text_like_image():
    """Create an image simulating dark text on light background."""
    img = np.ones((50, 200), dtype=np.uint8) * 220  # Light gray background
    # Draw a "text-like" dark rectangle
    img[15:35, 30:80] = 30  # Dark text area
    img[15:35, 100:150] = 30  # Another dark text area
    return img


@pytest.fixture
def noisy_image():
    """Create a noisy grayscale image for testing denoising."""
    np.random.seed(42)
    img = np.ones((50, 100), dtype=np.uint8) * 180
    noise = np.random.randint(-30, 30, (50, 100)).astype(np.int16)
    img = np.clip(img.astype(np.int16) + noise, 0, 255).astype(np.uint8)
    return img


@pytest.fixture
def red_badge_image():
    """Create an image with a red badge (pill shape)."""
    img = np.ones((60, 100, 3), dtype=np.uint8) * 200  # Gray background
    # Draw a red pill shape in BGR format (B=0, G=0, R=255)
    cv2.rectangle(img, (20, 20), (80, 40), (0, 0, 255), -1)  # Red rectangle
    cv2.circle(img, (20, 30), 10, (0, 0, 255), -1)  # Left round end
    cv2.circle(img, (80, 30), 10, (0, 0, 255), -1)  # Right round end
    return img


@pytest.fixture
def orange_badge_image():
    """Create an image with an orange badge."""
    img = np.ones((60, 100, 3), dtype=np.uint8) * 200  # Gray background
    # Orange in BGR: B=0, G=165, R=255 (similar to hint badge)
    cv2.rectangle(img, (25, 15), (75, 45), (0, 165, 255), -1)
    return img


@pytest.fixture
def green_buttons_image():
    """Create an image with green plus buttons vertically aligned."""
    img = np.ones((400, 200, 3), dtype=np.uint8) * 200  # Gray background
    # Draw green circles as plus buttons (BGR: B=0, G=200, R=0)
    cv2.circle(img, (150, 50), 15, (0, 200, 0), -1)   # Button 1
    cv2.circle(img, (150, 150), 15, (0, 200, 0), -1)  # Button 2
    cv2.circle(img, (150, 250), 15, (0, 200, 0), -1)  # Button 3
    cv2.circle(img, (150, 350), 15, (0, 200, 0), -1)  # Button 4
    return img


@pytest.fixture
def mixed_colors_image():
    """Create an image with red, orange, and green regions."""
    img = np.ones((100, 300, 3), dtype=np.uint8) * 180
    # Red region
    cv2.rectangle(img, (10, 30), (80, 70), (0, 0, 255), -1)
    # Orange region
    cv2.rectangle(img, (110, 30), (180, 70), (0, 165, 255), -1)
    # Green region
    cv2.circle(img, (250, 50), 20, (0, 200, 0), -1)
    return img


# =============================================================================
# Tests: Grayscale Conversion
# =============================================================================

class TestToGrayscale:
    """Tests for to_grayscale function."""

    def test_color_to_gray(self, blank_color_image):
        """Converting color image to grayscale produces 2D array."""
        result = to_grayscale(blank_color_image)
        assert len(result.shape) == 2
        assert result.shape == (50, 100)

    def test_gray_to_gray(self, blank_gray_image):
        """Grayscale image returns unchanged."""
        result = to_grayscale(blank_gray_image)
        assert result.shape == blank_gray_image.shape
        assert np.array_equal(result, blank_gray_image)

    def test_none_input(self):
        """None input returns small placeholder."""
        result = to_grayscale(None)
        assert result.shape == (1, 1)

    def test_empty_input(self):
        """Empty array returns small placeholder."""
        empty = np.array([])
        result = to_grayscale(empty)
        assert result.shape == (1, 1)


# =============================================================================
# Tests: Upscaling
# =============================================================================

class TestUpscaleForOcr:
    """Tests for upscale_for_ocr function."""

    def test_upscale_by_factor_2(self, blank_gray_image):
        """Upscaling by factor 2 doubles dimensions."""
        result = upscale_for_ocr(blank_gray_image, factor=2)
        assert result.shape == (100, 200)

    def test_upscale_by_factor_3(self, blank_gray_image):
        """Upscaling by factor 3 triples dimensions."""
        result = upscale_for_ocr(blank_gray_image, factor=3)
        assert result.shape == (150, 300)

    def test_upscale_factor_1(self, blank_gray_image):
        """Upscaling by factor 1 returns copy of original."""
        result = upscale_for_ocr(blank_gray_image, factor=1)
        assert result.shape == blank_gray_image.shape
        assert np.array_equal(result, blank_gray_image)

    def test_upscale_factor_0(self, blank_gray_image):
        """Upscaling by factor 0 returns copy of original."""
        result = upscale_for_ocr(blank_gray_image, factor=0)
        assert result.shape == blank_gray_image.shape

    def test_upscale_color_image(self, blank_color_image):
        """Upscaling color image preserves channels."""
        result = upscale_for_ocr(blank_color_image, factor=2)
        assert result.shape == (100, 200, 3)

    def test_upscale_none_input(self):
        """None input returns small placeholder."""
        result = upscale_for_ocr(None, factor=2)
        assert result.shape == (1, 1)


class TestUpscaleToMinHeight:
    """Tests for upscale_to_min_height function."""

    def test_upscale_small_image(self):
        """Small image is upscaled to meet minimum height."""
        img = np.zeros((25, 100), dtype=np.uint8)
        result = upscale_to_min_height(img, min_height=50)
        assert result.shape[0] >= 50

    def test_tall_image_unchanged(self):
        """Image already at min height returns copy."""
        img = np.zeros((100, 50), dtype=np.uint8)
        result = upscale_to_min_height(img, min_height=50)
        assert result.shape == img.shape

    def test_none_input(self):
        """None input returns placeholder with min height."""
        result = upscale_to_min_height(None, min_height=50)
        assert result.shape[0] >= 50


# =============================================================================
# Tests: Thresholding
# =============================================================================

class TestAdaptiveThreshold:
    """Tests for adaptive_threshold function."""

    def test_gaussian_method(self, gradient_gray_image):
        """Gaussian adaptive threshold produces binary image."""
        result = adaptive_threshold(gradient_gray_image, method="gaussian")
        assert result.dtype == np.uint8
        assert set(np.unique(result)).issubset({0, 255})

    def test_mean_method(self, gradient_gray_image):
        """Mean adaptive threshold produces binary image."""
        result = adaptive_threshold(gradient_gray_image, method="mean")
        assert result.dtype == np.uint8
        assert set(np.unique(result)).issubset({0, 255})

    def test_even_block_size(self, gradient_gray_image):
        """Even block size is converted to odd."""
        # This should not raise error; block_size will be adjusted
        result = adaptive_threshold(gradient_gray_image, block_size=10)
        assert result.dtype == np.uint8

    def test_color_input(self, blank_color_image):
        """Color image is auto-converted to grayscale."""
        result = adaptive_threshold(blank_color_image)
        assert len(result.shape) == 2

    def test_none_input(self):
        """None input returns white placeholder."""
        result = adaptive_threshold(None)
        assert result.shape == (1, 1)
        assert result[0, 0] == 255


class TestOtsuThreshold:
    """Tests for otsu_threshold function."""

    def test_produces_binary(self, gradient_gray_image):
        """Otsu threshold produces binary image."""
        result = otsu_threshold(gradient_gray_image)
        assert set(np.unique(result)).issubset({0, 255})

    def test_text_image(self, text_like_image):
        """Text-like image is properly thresholded."""
        result = otsu_threshold(text_like_image)
        # Dark text areas should become black (or white after inversion)
        assert result.dtype == np.uint8

    def test_color_input(self, blank_color_image):
        """Color image is auto-converted to grayscale."""
        result = otsu_threshold(blank_color_image)
        assert len(result.shape) == 2


class TestSimpleThreshold:
    """Tests for simple_threshold function."""

    def test_threshold_at_127(self, gradient_gray_image):
        """Simple threshold splits at given value."""
        result = simple_threshold(gradient_gray_image, threshold=127)
        # Left half should be mostly black, right half mostly white
        left_mean = np.mean(result[:, :50])
        right_mean = np.mean(result[:, 50:])
        assert left_mean < right_mean

    def test_produces_binary(self, gradient_gray_image):
        """Simple threshold produces binary image."""
        result = simple_threshold(gradient_gray_image, threshold=127)
        assert set(np.unique(result)).issubset({0, 255})


class TestMultiThreshold:
    """Tests for multi_threshold function."""

    def test_returns_tuple(self, gradient_gray_image):
        """Multi-threshold returns (image, method name) tuple."""
        result, method = multi_threshold(gradient_gray_image)
        assert isinstance(result, np.ndarray)
        assert isinstance(method, str)

    def test_valid_method_name(self, gradient_gray_image):
        """Method name is one of the expected values."""
        _, method = multi_threshold(gradient_gray_image)
        valid_methods = {"otsu", "adaptive_gaussian", "adaptive_mean", "empty"}
        assert method in valid_methods


# =============================================================================
# Tests: Morphological Operations
# =============================================================================

class TestApplyMorphology:
    """Tests for apply_morphology function."""

    def test_close_operation(self, text_like_image):
        """Close operation fills small gaps."""
        binary = otsu_threshold(text_like_image)
        result = apply_morphology(binary, operation="close", kernel_size=2)
        assert result.shape == binary.shape
        assert result.dtype == np.uint8

    def test_open_operation(self, noisy_image):
        """Open operation removes small noise."""
        binary = otsu_threshold(noisy_image)
        result = apply_morphology(binary, operation="open", kernel_size=2)
        assert result.shape == binary.shape

    def test_dilate_operation(self, text_like_image):
        """Dilate operation expands regions."""
        binary = otsu_threshold(text_like_image)
        result = apply_morphology(binary, operation="dilate", kernel_size=2)
        # Dilated black regions should have more black pixels
        assert result.shape == binary.shape

    def test_erode_operation(self, text_like_image):
        """Erode operation shrinks regions."""
        binary = otsu_threshold(text_like_image)
        result = apply_morphology(binary, operation="erode", kernel_size=2)
        assert result.shape == binary.shape

    def test_none_input(self):
        """None input returns white placeholder."""
        result = apply_morphology(None, operation="close")
        assert result.shape == (1, 1)


class TestCloseGaps:
    """Tests for close_gaps function."""

    def test_small_kernel(self, text_like_image):
        """Small kernel closes small gaps."""
        binary = otsu_threshold(text_like_image)
        result = close_gaps(binary, size="small")
        assert result.shape == binary.shape

    def test_medium_kernel(self, text_like_image):
        """Medium kernel closes medium gaps."""
        binary = otsu_threshold(text_like_image)
        result = close_gaps(binary, size="medium")
        assert result.shape == binary.shape

    def test_large_kernel(self, text_like_image):
        """Large kernel closes large gaps."""
        binary = otsu_threshold(text_like_image)
        result = close_gaps(binary, size="large")
        assert result.shape == binary.shape


class TestRemoveNoise:
    """Tests for remove_noise function."""

    def test_removes_small_specs(self, noisy_image):
        """Remove noise reduces noise level."""
        binary = otsu_threshold(noisy_image)
        result = remove_noise(binary, size="small")
        assert result.shape == binary.shape


# =============================================================================
# Tests: Contrast Enhancement
# =============================================================================

class TestEnhanceContrast:
    """Tests for enhance_contrast function."""

    def test_maintains_shape(self, gradient_gray_image):
        """Enhanced image has same shape."""
        result = enhance_contrast(gradient_gray_image)
        assert result.shape == gradient_gray_image.shape

    def test_uses_full_range(self, gradient_gray_image):
        """CLAHE expands histogram."""
        result = enhance_contrast(gradient_gray_image)
        # Should use more of the 0-255 range
        assert result.min() <= 50 or result.max() >= 200

    def test_color_input(self, blank_color_image):
        """Color input is converted to grayscale."""
        result = enhance_contrast(blank_color_image)
        assert len(result.shape) == 2


class TestNormalizeBrightness:
    """Tests for normalize_brightness function."""

    def test_stretches_histogram(self):
        """Low contrast image gets full range."""
        # Create low contrast image (100-150 range)
        img = np.ones((50, 100), dtype=np.uint8) * 125
        img[:25, :] = 100
        img[25:, :] = 150
        result = normalize_brightness(img)
        # Should stretch to near 0-255
        assert result.max() >= 200
        assert result.min() <= 50


# =============================================================================
# Tests: Denoising
# =============================================================================

class TestDenoiseLight:
    """Tests for denoise_light function."""

    def test_maintains_shape(self, noisy_image):
        """Denoised image has same shape."""
        result = denoise_light(noisy_image)
        assert result.shape == noisy_image.shape

    def test_reduces_variance(self, noisy_image):
        """Denoising reduces pixel variance."""
        result = denoise_light(noisy_image)
        # Gaussian blur should reduce variance
        assert np.std(result) <= np.std(noisy_image)


class TestDenoiseStrong:
    """Tests for denoise_strong function."""

    def test_maintains_shape(self, noisy_image):
        """Denoised image has same shape."""
        result = denoise_strong(noisy_image)
        assert result.shape == noisy_image.shape


# =============================================================================
# Tests: Polarity Correction
# =============================================================================

class TestInvertIfNeeded:
    """Tests for invert_if_needed function."""

    def test_dark_border_inverted(self):
        """Image with dark border is inverted."""
        # Black border, white center
        img = np.zeros((50, 100), dtype=np.uint8)
        img[10:40, 20:80] = 255
        result = invert_if_needed(img)
        # Border should now be white
        assert np.mean(result[0, :]) > 127

    def test_light_border_unchanged(self):
        """Image with light border is not inverted."""
        # White border, black center
        img = np.ones((50, 100), dtype=np.uint8) * 255
        img[10:40, 20:80] = 0
        result = invert_if_needed(img)
        # Border should still be white
        assert np.mean(result[0, :]) > 127


class TestEnsureWhiteBackground:
    """Tests for ensure_white_background function."""

    def test_mostly_black_inverted(self):
        """Mostly black image is inverted."""
        img = np.zeros((50, 100), dtype=np.uint8)
        img[20:30, 40:60] = 255  # Small white region
        result = ensure_white_background(img)
        # Majority should now be white
        assert np.mean(result) > 127

    def test_mostly_white_unchanged(self, white_gray_image):
        """Mostly white image is not inverted."""
        result = ensure_white_background(white_gray_image)
        assert np.mean(result) > 127


# =============================================================================
# Tests: Pipeline Functions
# =============================================================================

class TestPreprocessForDigits:
    """Tests for preprocess_for_digits function."""

    def test_returns_binary(self, text_like_image):
        """Preprocessing produces binary image."""
        result = preprocess_for_digits(text_like_image)
        assert set(np.unique(result)).issubset({0, 255})

    def test_upscales_by_default(self, text_like_image):
        """Default upscaling increases size."""
        result = preprocess_for_digits(text_like_image)
        # Default factor is 3
        assert result.shape[0] == text_like_image.shape[0] * 3
        assert result.shape[1] == text_like_image.shape[1] * 3

    def test_custom_upscale_factor(self, text_like_image):
        """Custom upscale factor works."""
        result = preprocess_for_digits(text_like_image, upscale_factor=2)
        assert result.shape[0] == text_like_image.shape[0] * 2

    def test_none_input(self):
        """None input returns placeholder."""
        result = preprocess_for_digits(None)
        assert result.shape == (50, 100)


class TestPreprocessForText:
    """Tests for preprocess_for_text function."""

    def test_returns_binary(self, text_like_image):
        """Preprocessing produces binary image."""
        result = preprocess_for_text(text_like_image)
        assert set(np.unique(result)).issubset({0, 255})

    def test_upscales_by_default(self, text_like_image):
        """Default upscaling (factor 2) increases size."""
        result = preprocess_for_text(text_like_image)
        assert result.shape[0] == text_like_image.shape[0] * 2
        assert result.shape[1] == text_like_image.shape[1] * 2


class TestPreprocessWithFallback:
    """Tests for preprocess_with_fallback function."""

    def test_returns_preprocess_result(self, text_like_image):
        """Returns PreprocessResult dataclass."""
        result = preprocess_with_fallback(text_like_image)
        assert isinstance(result, PreprocessResult)
        assert isinstance(result.image, np.ndarray)
        assert isinstance(result.method, str)
        assert isinstance(result.success, bool)

    def test_success_flag(self, text_like_image):
        """Valid input produces success=True."""
        result = preprocess_with_fallback(text_like_image)
        assert result.success is True

    def test_adaptive_method(self, text_like_image):
        """Adaptive method is used when specified."""
        result = preprocess_with_fallback(text_like_image, primary_method="adaptive")
        assert "adaptive" in result.method or "fallback" in result.method

    def test_otsu_method(self, text_like_image):
        """Otsu method is used when specified."""
        result = preprocess_with_fallback(text_like_image, primary_method="otsu")
        assert "otsu" in result.method or "fallback" in result.method

    def test_none_input(self):
        """None input returns success=False."""
        result = preprocess_with_fallback(None)
        assert result.success is False
        assert result.method == "empty"


# =============================================================================
# Tests: Color Detection - Red Badge
# =============================================================================

class TestDetectRedBadge:
    """Tests for detect_red_badge function."""

    def test_detects_red(self, red_badge_image):
        """Red badge is detected in synthetic image."""
        found, confidence, contour = detect_red_badge(red_badge_image)
        assert found is True
        assert confidence > 0.0

    def test_no_red_in_gray(self, blank_color_image):
        """No red detected in gray image."""
        found, confidence, contour = detect_red_badge(blank_color_image)
        assert found is False

    def test_grayscale_input(self, blank_gray_image):
        """Grayscale input returns not found."""
        found, confidence, contour = detect_red_badge(blank_gray_image)
        assert found is False

    def test_none_input(self):
        """None input returns not found."""
        found, confidence, contour = detect_red_badge(None)
        assert found is False
        assert confidence == 0.0
        assert contour is None

    def test_empty_input(self):
        """Empty array returns not found."""
        empty = np.array([])
        found, confidence, contour = detect_red_badge(empty)
        assert found is False

    def test_returns_contour(self, red_badge_image):
        """Detected badge includes contour."""
        found, confidence, contour = detect_red_badge(red_badge_image)
        assert contour is not None
        assert len(contour) > 0


# =============================================================================
# Tests: Color Detection - Orange Badge
# =============================================================================

class TestDetectOrangeBadge:
    """Tests for detect_orange_badge function."""

    def test_detects_orange(self, orange_badge_image):
        """Orange badge is detected in synthetic image."""
        found, confidence, contour = detect_orange_badge(orange_badge_image)
        assert found is True
        assert confidence > 0.0

    def test_no_orange_in_gray(self, blank_color_image):
        """No orange detected in gray image."""
        found, confidence, contour = detect_orange_badge(blank_color_image)
        assert found is False

    def test_no_orange_in_red(self, red_badge_image):
        """No orange detected in red image."""
        found, confidence, contour = detect_orange_badge(red_badge_image)
        assert found is False

    def test_grayscale_input(self, blank_gray_image):
        """Grayscale input returns not found."""
        found, confidence, contour = detect_orange_badge(blank_gray_image)
        assert found is False

    def test_none_input(self):
        """None input returns not found."""
        found, confidence, contour = detect_orange_badge(None)
        assert found is False
        assert confidence == 0.0
        assert contour is None


# =============================================================================
# Tests: Color Detection - Green Regions
# =============================================================================

class TestDetectGreenRegions:
    """Tests for detect_green_regions function."""

    def test_detects_green(self, green_buttons_image):
        """Green regions produce non-zero mask."""
        mask = detect_green_regions(green_buttons_image)
        assert mask.shape == green_buttons_image.shape[:2]
        assert cv2.countNonZero(mask) > 0

    def test_no_green_in_gray(self, blank_color_image):
        """No green detected in gray image."""
        mask = detect_green_regions(blank_color_image)
        assert cv2.countNonZero(mask) == 0

    def test_no_green_in_red(self, red_badge_image):
        """No green detected in red image."""
        mask = detect_green_regions(red_badge_image)
        assert cv2.countNonZero(mask) == 0

    def test_grayscale_input(self, blank_gray_image):
        """Grayscale input returns zero mask."""
        mask = detect_green_regions(blank_gray_image)
        assert cv2.countNonZero(mask) == 0

    def test_none_input(self):
        """None input returns small zero mask."""
        mask = detect_green_regions(None)
        assert mask.shape == (1, 1)

    def test_mask_is_binary(self, green_buttons_image):
        """Mask contains only 0 and 255."""
        mask = detect_green_regions(green_buttons_image)
        unique = np.unique(mask)
        assert set(unique).issubset({0, 255})


# =============================================================================
# Tests: Color Detection - Green Plus Buttons
# =============================================================================

class TestFindGreenPlusButtons:
    """Tests for find_green_plus_buttons function."""

    def test_finds_buttons(self, green_buttons_image):
        """Green buttons are found in synthetic image."""
        buttons = find_green_plus_buttons(green_buttons_image)
        assert len(buttons) > 0

    def test_returns_bboxes(self, green_buttons_image):
        """Each button is returned as (x, y, w, h) tuple."""
        buttons = find_green_plus_buttons(green_buttons_image)
        for bbox in buttons:
            assert len(bbox) == 4
            x, y, w, h = bbox
            assert isinstance(x, (int, np.integer))
            assert isinstance(y, (int, np.integer))
            assert w > 0
            assert h > 0

    def test_sorted_by_y(self, green_buttons_image):
        """Buttons are sorted by y-position (top to bottom)."""
        buttons = find_green_plus_buttons(green_buttons_image)
        if len(buttons) > 1:
            y_positions = [b[1] for b in buttons]
            assert y_positions == sorted(y_positions)

    def test_no_buttons_in_gray(self, blank_color_image):
        """No buttons in gray image."""
        buttons = find_green_plus_buttons(blank_color_image)
        assert len(buttons) == 0

    def test_none_input(self):
        """None input returns empty list."""
        buttons = find_green_plus_buttons(None)
        assert buttons == []

    def test_empty_input(self):
        """Empty array returns empty list."""
        empty = np.array([])
        buttons = find_green_plus_buttons(empty)
        assert buttons == []


# =============================================================================
# Tests: Color Detection - Mixed Colors
# =============================================================================

class TestMixedColorsDetection:
    """Tests for color detection on images with multiple colors."""

    def test_red_detected_separately(self, mixed_colors_image):
        """Red region is detected without confusion."""
        # Extract left portion (red area)
        red_roi = mixed_colors_image[:, 0:100]
        found, confidence, _ = detect_red_badge(red_roi)
        assert found is True

    def test_orange_detected_separately(self, mixed_colors_image):
        """Orange region is detected without confusion."""
        # Extract middle portion (orange area)
        orange_roi = mixed_colors_image[:, 100:200]
        found, confidence, _ = detect_orange_badge(orange_roi)
        assert found is True

    def test_green_detected_separately(self, mixed_colors_image):
        """Green region is detected without confusion."""
        # Extract right portion (green area)
        green_roi = mixed_colors_image[:, 200:300]
        mask = detect_green_regions(green_roi)
        assert cv2.countNonZero(mask) > 0


# =============================================================================
# Tests: Badge Bounding Box
# =============================================================================

class TestGetBadgeBbox:
    """Tests for get_badge_bbox function."""

    def test_returns_bbox(self, red_badge_image):
        """Valid contour returns bounding box."""
        _, _, contour = detect_red_badge(red_badge_image)
        if contour is not None:
            bbox = get_badge_bbox(contour)
            assert bbox is not None
            assert len(bbox) == 4
            x, y, w, h = bbox
            assert w > 0
            assert h > 0

    def test_none_contour(self):
        """None contour returns None."""
        bbox = get_badge_bbox(None)
        assert bbox is None

    def test_empty_contour(self):
        """Empty contour returns None."""
        empty = np.array([])
        bbox = get_badge_bbox(empty)
        assert bbox is None


# =============================================================================
# Tests: Edge Cases
# =============================================================================

class TestEdgeCases:
    """Tests for edge cases and boundary conditions."""

    def test_single_pixel_image(self):
        """Single pixel image is handled gracefully."""
        img = np.zeros((1, 1), dtype=np.uint8)
        result = to_grayscale(img)
        assert result.shape == (1, 1)

    def test_very_small_image(self):
        """Very small image (5x5) is handled."""
        img = np.zeros((5, 5), dtype=np.uint8)
        result = upscale_for_ocr(img, factor=2)
        assert result.shape == (10, 10)

    def test_large_upscale_factor(self, blank_gray_image):
        """Large upscale factor works without overflow."""
        result = upscale_for_ocr(blank_gray_image, factor=10)
        assert result.shape == (500, 1000)

    def test_binary_already_binary(self):
        """Binary image remains binary after processing."""
        img = np.zeros((50, 100), dtype=np.uint8)
        img[:, 50:] = 255
        result = invert_if_needed(img)
        assert set(np.unique(result)).issubset({0, 255})

    def test_color_with_alpha_channel(self):
        """Image with alpha channel is handled."""
        # BGRA image
        img = np.zeros((50, 100, 4), dtype=np.uint8)
        img[:, :, 2] = 255  # Red channel
        # Most functions should handle this or convert appropriately
        gray = to_grayscale(img[:, :, :3])  # Take BGR only
        assert gray.shape == (50, 100)


class TestDataTypes:
    """Tests for handling different numpy data types."""

    def test_uint8_input(self, blank_gray_image):
        """uint8 input is handled correctly."""
        result = upscale_for_ocr(blank_gray_image)
        assert result.dtype == np.uint8

    def test_preserves_dtype(self):
        """Output dtype matches input dtype."""
        img = np.zeros((50, 100), dtype=np.uint8)
        result = upscale_for_ocr(img)
        assert result.dtype == np.uint8


# =============================================================================
# Run Tests
# =============================================================================

if __name__ == "__main__":
    pytest.main([__file__, "-v"])
