"""
Unit tests for OCR extraction functions and skill matching.

These tests validate:
- OCR field extraction (cost digits, hint badge, skill name)
- Skill name matching against database using RapidFuzz
- Normalization and parsing functions
- Edge cases and error handling

Tests use synthetic images and mock OCR where appropriate to ensure
consistent behavior without requiring Tesseract installation.
"""

import numpy as np
import pytest
import cv2
from unittest.mock import patch, MagicMock

from ocr.field_ocr import (
    OcrResult,
    HintResult,
    NameResult,
    ocr_cost_digits,
    ocr_hint_badge,
    ocr_skill_name,
    _parse_cost_digits,
    _parse_hint_level,
    _get_discount_for_level,
    _normalize_skill_name,
    _check_tesseract_available,
    _to_grayscale,
    _upscale_image,
    _apply_adaptive_threshold,
    _apply_otsu_threshold,
    _invert_if_needed,
    _preprocess_for_digits,
    _preprocess_for_text,
)
from ocr.skill_matcher import (
    SkillMatcher,
    MatchResult,
    MATCH_THRESHOLD,
    MATCH_LIMIT,
)


# =============================================================================
# Fixtures: Synthetic Test Images
# =============================================================================

@pytest.fixture
def blank_gray_roi():
    """Create a blank grayscale ROI (30x80)."""
    return np.zeros((30, 80), dtype=np.uint8)


@pytest.fixture
def blank_color_roi():
    """Create a blank BGR color ROI (30x80)."""
    return np.zeros((30, 80, 3), dtype=np.uint8)


@pytest.fixture
def white_roi():
    """Create a white ROI (30x80)."""
    return np.ones((30, 80), dtype=np.uint8) * 255


@pytest.fixture
def digit_like_roi():
    """Create a ROI with digit-like pattern (dark on light background)."""
    roi = np.ones((40, 60, 3), dtype=np.uint8) * 230  # Light background
    # Draw digit-like shapes
    cv2.rectangle(roi, (10, 10), (20, 30), (30, 30, 30), -1)  # "1"
    cv2.rectangle(roi, (30, 10), (50, 30), (30, 30, 30), -1)  # "2"
    return roi


@pytest.fixture
def orange_badge_roi():
    """Create a ROI with orange badge for hint detection."""
    roi = np.ones((40, 100, 3), dtype=np.uint8) * 200  # Gray background
    # Draw orange badge (BGR: B=0, G=165, R=255)
    cv2.rectangle(roi, (20, 10), (80, 30), (0, 165, 255), -1)
    return roi


@pytest.fixture
def no_badge_roi():
    """Create a ROI without any colored badge."""
    roi = np.ones((40, 100, 3), dtype=np.uint8) * 200  # Gray background
    return roi


@pytest.fixture
def text_like_roi():
    """Create a ROI with text-like patterns."""
    roi = np.ones((30, 150, 3), dtype=np.uint8) * 220  # Light gray
    # Simulate text
    cv2.putText(roi, "Test", (10, 22), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (30, 30, 30), 1)
    return roi


# =============================================================================
# Tests: Dataclasses
# =============================================================================

class TestOcrResult:
    """Tests for OcrResult dataclass."""

    def test_default_values(self):
        """OcrResult has correct default values."""
        result = OcrResult(value=None, confidence=0.0, raw_text="")
        assert result.value is None
        assert result.confidence == 0.0
        assert result.raw_text == ""

    def test_with_values(self):
        """OcrResult stores provided values correctly."""
        result = OcrResult(value=100, confidence=0.95, raw_text="100")
        assert result.value == 100
        assert result.confidence == 0.95
        assert result.raw_text == "100"


class TestHintResult:
    """Tests for HintResult dataclass."""

    def test_default_values(self):
        """HintResult has correct default values."""
        result = HintResult(hint_level=None, discount_percent=None, confidence=0.0, badge_found=False)
        assert result.hint_level is None
        assert result.discount_percent is None
        assert result.confidence == 0.0
        assert result.badge_found is False

    def test_with_values(self):
        """HintResult stores provided values correctly."""
        result = HintResult(hint_level=3, discount_percent=20, confidence=0.85, badge_found=True)
        assert result.hint_level == 3
        assert result.discount_percent == 20
        assert result.confidence == 0.85
        assert result.badge_found is True


class TestNameResult:
    """Tests for NameResult dataclass."""

    def test_default_values(self):
        """NameResult with empty strings."""
        result = NameResult(raw="", normalized="", confidence=0.0)
        assert result.raw == ""
        assert result.normalized == ""
        assert result.confidence == 0.0

    def test_with_values(self):
        """NameResult stores provided values correctly."""
        result = NameResult(raw="Test Skill", normalized="test skill", confidence=0.88)
        assert result.raw == "Test Skill"
        assert result.normalized == "test skill"
        assert result.confidence == 0.88


# =============================================================================
# Tests: Cost Digit Parsing
# =============================================================================

class TestParseCostDigits:
    """Tests for _parse_cost_digits function."""

    def test_valid_single_digit(self):
        """Parse single digit cost."""
        assert _parse_cost_digits("1") == 1
        assert _parse_cost_digits("9") == 9

    def test_valid_multi_digit(self):
        """Parse multi-digit costs."""
        assert _parse_cost_digits("10") == 10
        assert _parse_cost_digits("100") == 100
        assert _parse_cost_digits("1000") == 1000
        assert _parse_cost_digits("9999") == 9999

    def test_cost_with_noise(self):
        """Parse cost with non-digit characters."""
        assert _parse_cost_digits("100pt") == 100
        assert _parse_cost_digits("Pt150") == 150
        assert _parse_cost_digits("  200 ") == 200
        assert _parse_cost_digits("1,234") == 1234  # Common formatting

    def test_invalid_zero(self):
        """Zero is not a valid cost."""
        assert _parse_cost_digits("0") is None

    def test_invalid_too_large(self):
        """Cost above 9999 is invalid."""
        assert _parse_cost_digits("10000") is None
        assert _parse_cost_digits("99999") is None

    def test_empty_string(self):
        """Empty string returns None."""
        assert _parse_cost_digits("") is None

    def test_no_digits(self):
        """String with no digits returns None."""
        assert _parse_cost_digits("abc") is None
        assert _parse_cost_digits("   ") is None

    def test_typical_ocr_outputs(self):
        """Parse typical OCR output variations."""
        assert _parse_cost_digits("180") == 180
        assert _parse_cost_digits("340\n") == 340
        assert _parse_cost_digits("pt120") == 120


# =============================================================================
# Tests: Hint Level Parsing
# =============================================================================

class TestParseHintLevel:
    """Tests for _parse_hint_level function."""

    def test_valid_levels(self):
        """Parse valid hint levels 1-5."""
        assert _parse_hint_level("1") == 1
        assert _parse_hint_level("2") == 2
        assert _parse_hint_level("3") == 3
        assert _parse_hint_level("4") == 4
        assert _parse_hint_level("5") == 5

    def test_lv_prefix(self):
        """Parse Lv-prefixed levels."""
        assert _parse_hint_level("Lv1") == 1
        assert _parse_hint_level("Lv.2") == 2
        assert _parse_hint_level("LV3") == 3

    def test_level_prefix(self):
        """Parse Level-prefixed levels."""
        assert _parse_hint_level("Level 1") == 1
        assert _parse_hint_level("level2") == 2

    def test_invalid_levels(self):
        """Invalid levels return None."""
        assert _parse_hint_level("0") is None  # 0 is not valid
        assert _parse_hint_level("6") is None  # > 5 is not valid
        assert _parse_hint_level("9") is None

    def test_empty_string(self):
        """Empty string returns None."""
        assert _parse_hint_level("") is None
        assert _parse_hint_level(None) is None

    def test_no_digits(self):
        """String with no digits returns None."""
        assert _parse_hint_level("abc") is None
        assert _parse_hint_level("Level ") is None


# =============================================================================
# Tests: Discount Calculation
# =============================================================================

class TestGetDiscountForLevel:
    """Tests for _get_discount_for_level function."""

    def test_level_1_discount(self):
        """Level 1 gives 10% discount."""
        assert _get_discount_for_level(1) == 10

    def test_level_2_discount(self):
        """Level 2 gives 10% discount."""
        assert _get_discount_for_level(2) == 10

    def test_level_3_discount(self):
        """Level 3 gives 20% discount."""
        assert _get_discount_for_level(3) == 20

    def test_level_4_discount(self):
        """Level 4 gives 30% discount."""
        assert _get_discount_for_level(4) == 30

    def test_level_5_discount(self):
        """Level 5 gives 30% discount."""
        assert _get_discount_for_level(5) == 30

    def test_invalid_level(self):
        """Invalid levels return None."""
        assert _get_discount_for_level(0) is None
        assert _get_discount_for_level(6) is None
        assert _get_discount_for_level(-1) is None


# =============================================================================
# Tests: Skill Name Normalization
# =============================================================================

class TestNormalizeSkillName:
    """Tests for _normalize_skill_name function."""

    def test_lowercase(self):
        """Converts to lowercase."""
        assert _normalize_skill_name("TEST SKILL") == "test skill"
        assert _normalize_skill_name("CamelCase") == "camelcase"

    def test_trim_whitespace(self):
        """Trims leading/trailing whitespace."""
        assert _normalize_skill_name("  test  ") == "test"
        assert _normalize_skill_name("\ntest\n") == "test"

    def test_collapse_whitespace(self):
        """Collapses multiple whitespace."""
        assert _normalize_skill_name("test   skill") == "test skill"
        assert _normalize_skill_name("a  b  c") == "a b c"

    def test_ocr_confusion_fixes(self):
        """Fixes common OCR character confusions."""
        assert "|" not in _normalize_skill_name("sk|ll")  # | -> i
        assert "\n" not in _normalize_skill_name("test\nskill")

    def test_empty_string(self):
        """Empty string returns empty."""
        assert _normalize_skill_name("") == ""
        assert _normalize_skill_name(None) == ""

    def test_already_normalized(self):
        """Already normalized string unchanged."""
        assert _normalize_skill_name("test skill") == "test skill"


# =============================================================================
# Tests: Image Preprocessing Helpers
# =============================================================================

class TestToGrayscale:
    """Tests for _to_grayscale helper function."""

    def test_color_to_gray(self, blank_color_roi):
        """Color image converts to grayscale."""
        result = _to_grayscale(blank_color_roi)
        assert len(result.shape) == 2

    def test_gray_stays_gray(self, blank_gray_roi):
        """Grayscale image stays grayscale."""
        result = _to_grayscale(blank_gray_roi)
        assert len(result.shape) == 2


class TestUpscaleImage:
    """Tests for _upscale_image helper function."""

    def test_upscale_factor_2(self, blank_gray_roi):
        """Upscale by factor 2 doubles dimensions."""
        result = _upscale_image(blank_gray_roi, factor=2)
        assert result.shape == (60, 160)

    def test_upscale_factor_3(self, blank_gray_roi):
        """Upscale by factor 3 triples dimensions."""
        result = _upscale_image(blank_gray_roi, factor=3)
        assert result.shape == (90, 240)

    def test_upscale_factor_1(self, blank_gray_roi):
        """Upscale by factor 1 returns original."""
        result = _upscale_image(blank_gray_roi, factor=1)
        assert result.shape == blank_gray_roi.shape

    def test_upscale_factor_0(self, blank_gray_roi):
        """Upscale by factor 0 returns original."""
        result = _upscale_image(blank_gray_roi, factor=0)
        assert result.shape == blank_gray_roi.shape


class TestThresholding:
    """Tests for thresholding helper functions."""

    def test_adaptive_threshold_produces_binary(self, blank_gray_roi):
        """Adaptive threshold produces binary image."""
        result = _apply_adaptive_threshold(blank_gray_roi)
        unique = np.unique(result)
        assert set(unique).issubset({0, 255})

    def test_otsu_threshold_produces_binary(self, blank_gray_roi):
        """Otsu threshold produces binary image."""
        result = _apply_otsu_threshold(blank_gray_roi)
        unique = np.unique(result)
        assert set(unique).issubset({0, 255})


class TestInvertIfNeeded:
    """Tests for _invert_if_needed helper function."""

    def test_dark_border_inverted(self):
        """Dark border image is inverted."""
        # Black border, white center
        img = np.zeros((50, 100), dtype=np.uint8)
        img[10:40, 20:80] = 255
        result = _invert_if_needed(img)
        # Border should now be white
        border_mean = np.mean([
            np.mean(result[0, :]),
            np.mean(result[-1, :]),
            np.mean(result[:, 0]),
            np.mean(result[:, -1])
        ])
        assert border_mean > 127

    def test_light_border_unchanged(self):
        """Light border image is not inverted."""
        # White border, black center
        img = np.ones((50, 100), dtype=np.uint8) * 255
        img[10:40, 20:80] = 0
        result = _invert_if_needed(img)
        # Border should still be white
        border_mean = np.mean([
            np.mean(result[0, :]),
            np.mean(result[-1, :]),
            np.mean(result[:, 0]),
            np.mean(result[:, -1])
        ])
        assert border_mean > 127


class TestPreprocessForDigits:
    """Tests for _preprocess_for_digits function."""

    def test_produces_binary(self, digit_like_roi):
        """Preprocessing produces binary image."""
        result = _preprocess_for_digits(digit_like_roi)
        unique = np.unique(result)
        assert set(unique).issubset({0, 255})

    def test_upscales_image(self, digit_like_roi):
        """Preprocessing upscales the image."""
        result = _preprocess_for_digits(digit_like_roi, upscale_factor=2)
        assert result.shape[0] == digit_like_roi.shape[0] * 2
        assert result.shape[1] == digit_like_roi.shape[1] * 2

    def test_none_input(self):
        """None input returns white placeholder."""
        result = _preprocess_for_digits(None)
        assert result.shape == (50, 100)

    def test_empty_input(self):
        """Empty array returns white placeholder."""
        empty = np.array([])
        result = _preprocess_for_digits(empty)
        assert result.shape == (50, 100)


class TestPreprocessForText:
    """Tests for _preprocess_for_text function."""

    def test_produces_binary(self, text_like_roi):
        """Preprocessing produces binary image."""
        result = _preprocess_for_text(text_like_roi)
        unique = np.unique(result)
        assert set(unique).issubset({0, 255})

    def test_upscales_image(self, text_like_roi):
        """Preprocessing upscales the image."""
        result = _preprocess_for_text(text_like_roi, upscale_factor=2)
        assert result.shape[0] == text_like_roi.shape[0] * 2

    def test_none_input(self):
        """None input returns white placeholder."""
        result = _preprocess_for_text(None)
        assert result.shape == (30, 200)


# =============================================================================
# Tests: OCR Cost Digits
# =============================================================================

class TestOcrCostDigits:
    """Tests for ocr_cost_digits function."""

    def test_none_input(self):
        """None input returns empty result."""
        result = ocr_cost_digits(None)
        assert isinstance(result, OcrResult)
        assert result.value is None
        assert result.confidence == 0.0
        assert result.raw_text == ""

    def test_empty_input(self):
        """Empty array returns empty result."""
        empty = np.array([])
        result = ocr_cost_digits(empty)
        assert result.value is None
        assert result.confidence == 0.0

    def test_returns_ocr_result(self, digit_like_roi):
        """Returns OcrResult dataclass."""
        result = ocr_cost_digits(digit_like_roi)
        assert isinstance(result, OcrResult)
        assert hasattr(result, 'value')
        assert hasattr(result, 'confidence')
        assert hasattr(result, 'raw_text')

    def test_blank_roi(self, blank_color_roi):
        """Blank ROI returns None value."""
        result = ocr_cost_digits(blank_color_roi)
        # No digits in blank image
        assert result.value is None or result.confidence < 0.5


# =============================================================================
# Tests: OCR Hint Badge
# =============================================================================

class TestOcrHintBadge:
    """Tests for ocr_hint_badge function."""

    def test_none_input(self):
        """None input returns empty result."""
        result = ocr_hint_badge(None)
        assert isinstance(result, HintResult)
        assert result.hint_level is None
        assert result.badge_found is False

    def test_empty_input(self):
        """Empty array returns empty result."""
        empty = np.array([])
        result = ocr_hint_badge(empty)
        assert result.hint_level is None
        assert result.badge_found is False

    def test_returns_hint_result(self, orange_badge_roi):
        """Returns HintResult dataclass."""
        result = ocr_hint_badge(orange_badge_roi)
        assert isinstance(result, HintResult)
        assert hasattr(result, 'hint_level')
        assert hasattr(result, 'discount_percent')
        assert hasattr(result, 'confidence')
        assert hasattr(result, 'badge_found')

    def test_orange_badge_detected(self, orange_badge_roi):
        """Orange badge is detected."""
        result = ocr_hint_badge(orange_badge_roi)
        assert result.badge_found is True

    def test_no_badge_not_detected(self, no_badge_roi):
        """No badge means badge_found is False."""
        result = ocr_hint_badge(no_badge_roi)
        assert result.badge_found is False
        assert result.hint_level is None


# =============================================================================
# Tests: OCR Skill Name
# =============================================================================

class TestOcrSkillName:
    """Tests for ocr_skill_name function."""

    def test_none_input(self):
        """None input returns empty result."""
        result = ocr_skill_name(None)
        assert isinstance(result, NameResult)
        assert result.raw == ""
        assert result.normalized == ""
        assert result.confidence == 0.0

    def test_empty_input(self):
        """Empty array returns empty result."""
        empty = np.array([])
        result = ocr_skill_name(empty)
        assert result.raw == ""
        assert result.normalized == ""

    def test_returns_name_result(self, text_like_roi):
        """Returns NameResult dataclass."""
        result = ocr_skill_name(text_like_roi)
        assert isinstance(result, NameResult)
        assert hasattr(result, 'raw')
        assert hasattr(result, 'normalized')
        assert hasattr(result, 'confidence')

    def test_normalized_is_lowercase(self, text_like_roi):
        """Normalized name is lowercase."""
        result = ocr_skill_name(text_like_roi)
        assert result.normalized == result.normalized.lower()


# =============================================================================
# Tests: MatchResult Dataclass
# =============================================================================

class TestMatchResult:
    """Tests for MatchResult dataclass."""

    def test_default_values(self):
        """MatchResult has correct default values."""
        result = MatchResult()
        assert result.skill_id is None
        assert result.canonical_name is None
        assert result.score == 0.0
        assert result.matched_field is None
        assert result.all_matches == []

    def test_with_values(self):
        """MatchResult stores provided values."""
        result = MatchResult(
            skill_id=12345,
            canonical_name="Test Skill",
            score=95.5,
            matched_field="enname",
            all_matches=[("Test Skill", 95.5, 12345)]
        )
        assert result.skill_id == 12345
        assert result.canonical_name == "Test Skill"
        assert result.score == 95.5
        assert result.matched_field == "enname"
        assert len(result.all_matches) == 1


# =============================================================================
# Tests: SkillMatcher
# =============================================================================

class TestSkillMatcher:
    """Tests for SkillMatcher class."""

    @pytest.fixture
    def matcher(self):
        """Create a SkillMatcher instance."""
        try:
            return SkillMatcher()
        except FileNotFoundError:
            pytest.skip("skills_all.json not found")

    def test_initialization(self, matcher):
        """SkillMatcher initializes correctly."""
        assert len(matcher.skill_names) > 0
        assert len(matcher.skills) > 0

    def test_skill_names_populated(self, matcher):
        """skill_names list is populated."""
        assert isinstance(matcher.skill_names, list)
        assert all(isinstance(name, str) for name in matcher.skill_names)

    def test_skills_populated(self, matcher):
        """skills list is populated."""
        assert isinstance(matcher.skills, list)
        assert all(isinstance(skill, dict) for skill in matcher.skills)


class TestSkillMatcherMatch:
    """Tests for SkillMatcher.match method."""

    @pytest.fixture
    def matcher(self):
        """Create a SkillMatcher instance."""
        try:
            return SkillMatcher()
        except FileNotFoundError:
            pytest.skip("skills_all.json not found")

    def test_empty_input(self, matcher):
        """Empty string returns empty result."""
        result = matcher.match("")
        assert result.skill_id is None
        assert result.score == 0.0

    def test_whitespace_input(self, matcher):
        """Whitespace-only string returns empty result."""
        result = matcher.match("   ")
        assert result.skill_id is None

    def test_returns_match_result(self, matcher):
        """Returns MatchResult dataclass."""
        result = matcher.match("some skill")
        assert isinstance(result, MatchResult)

    def test_exact_match(self, matcher):
        """Exact name match returns high score."""
        # Get first skill name
        if matcher.skill_names:
            first_name = matcher.skill_names[0]
            result = matcher.match(first_name)
            assert result.skill_id is not None
            assert result.score >= 95.0  # Exact match should be very high
            assert result.canonical_name == first_name

    def test_fuzzy_match(self, matcher):
        """Fuzzy match finds similar names."""
        # Use a known skill pattern
        result = matcher.match("It Going to Be Me")  # Missing "s" in "It's"
        if result.skill_id:
            assert result.score >= MATCH_THRESHOLD
            assert "It" in result.canonical_name or "Me" in result.canonical_name

    def test_custom_threshold(self, matcher):
        """Custom threshold is respected."""
        # Very high threshold - less likely to match
        result = matcher.match("random xyz", threshold=99)
        if result.score < 99:
            assert result.skill_id is None

    def test_all_matches_populated(self, matcher):
        """all_matches contains candidate list."""
        if matcher.skill_names:
            result = matcher.match(matcher.skill_names[0])
            assert isinstance(result.all_matches, list)


class TestSkillMatcherBatch:
    """Tests for SkillMatcher.match_batch method."""

    @pytest.fixture
    def matcher(self):
        """Create a SkillMatcher instance."""
        try:
            return SkillMatcher()
        except FileNotFoundError:
            pytest.skip("skills_all.json not found")

    def test_empty_list(self, matcher):
        """Empty list returns empty results."""
        results = matcher.match_batch([])
        assert results == []

    def test_single_item(self, matcher):
        """Single item returns single result."""
        results = matcher.match_batch(["test"])
        assert len(results) == 1
        assert isinstance(results[0], MatchResult)

    def test_multiple_items(self, matcher):
        """Multiple items return multiple results."""
        results = matcher.match_batch(["test1", "test2", "test3"])
        assert len(results) == 3
        assert all(isinstance(r, MatchResult) for r in results)


class TestSkillMatcherLookup:
    """Tests for SkillMatcher lookup methods."""

    @pytest.fixture
    def matcher(self):
        """Create a SkillMatcher instance."""
        try:
            return SkillMatcher()
        except FileNotFoundError:
            pytest.skip("skills_all.json not found")

    def test_get_skill_by_id_found(self, matcher):
        """get_skill_by_id returns skill when found."""
        # Get a known skill ID
        if matcher.skills:
            first_skill = matcher.skills[0]
            skill_id = first_skill.get("id")
            if skill_id:
                result = matcher.get_skill_by_id(skill_id)
                assert result is not None
                assert result.get("id") == skill_id

    def test_get_skill_by_id_not_found(self, matcher):
        """get_skill_by_id returns None when not found."""
        result = matcher.get_skill_by_id(99999999)  # Non-existent ID
        assert result is None

    def test_get_skill_by_name_found(self, matcher):
        """get_skill_by_name returns skill when found."""
        if matcher.skill_names:
            first_name = matcher.skill_names[0]
            result = matcher.get_skill_by_name(first_name)
            assert result is not None

    def test_get_skill_by_name_not_found(self, matcher):
        """get_skill_by_name returns None when not found."""
        result = matcher.get_skill_by_name("nonexistent skill xyz 123")
        assert result is None


# =============================================================================
# Tests: Edge Cases
# =============================================================================

class TestEdgeCases:
    """Tests for edge cases and boundary conditions."""

    def test_very_small_roi(self):
        """Very small ROI handled gracefully."""
        tiny = np.zeros((5, 5, 3), dtype=np.uint8)
        result = ocr_cost_digits(tiny)
        assert isinstance(result, OcrResult)

    def test_single_pixel_roi(self):
        """Single pixel ROI handled gracefully."""
        pixel = np.zeros((1, 1, 3), dtype=np.uint8)
        result = ocr_skill_name(pixel)
        assert isinstance(result, NameResult)

    def test_grayscale_roi(self, blank_gray_roi):
        """Grayscale ROI works (not just BGR)."""
        result = ocr_cost_digits(blank_gray_roi)
        assert isinstance(result, OcrResult)

    def test_high_resolution_roi(self):
        """High resolution ROI handled."""
        large = np.ones((500, 1000, 3), dtype=np.uint8) * 200
        result = ocr_cost_digits(large)
        assert isinstance(result, OcrResult)


class TestTesseractAvailability:
    """Tests for Tesseract availability checking."""

    def test_check_tesseract_returns_bool(self):
        """_check_tesseract_available returns boolean."""
        result = _check_tesseract_available()
        assert isinstance(result, bool)


# =============================================================================
# Tests: Integration
# =============================================================================

class TestOcrIntegration:
    """Integration tests for OCR functions working together."""

    def test_cost_then_name(self, digit_like_roi, text_like_roi):
        """Can extract cost and name from different ROIs."""
        cost_result = ocr_cost_digits(digit_like_roi)
        name_result = ocr_skill_name(text_like_roi)

        assert isinstance(cost_result, OcrResult)
        assert isinstance(name_result, NameResult)

    def test_hint_detection_flow(self, orange_badge_roi, no_badge_roi):
        """Hint detection correctly distinguishes badges."""
        with_badge = ocr_hint_badge(orange_badge_roi)
        without_badge = ocr_hint_badge(no_badge_roi)

        assert with_badge.badge_found is True
        assert without_badge.badge_found is False


class TestSkillMatcherIntegration:
    """Integration tests for skill matching."""

    @pytest.fixture
    def matcher(self):
        """Create a SkillMatcher instance."""
        try:
            return SkillMatcher()
        except FileNotFoundError:
            pytest.skip("skills_all.json not found")

    def test_match_then_lookup(self, matcher):
        """Can match then look up skill details."""
        if matcher.skill_names:
            # Match a skill
            match_result = matcher.match(matcher.skill_names[0])
            if match_result.skill_id:
                # Look it up
                skill = matcher.get_skill_by_id(match_result.skill_id)
                assert skill is not None

    def test_normalize_then_match(self, matcher):
        """Normalized names can be matched."""
        if matcher.skill_names:
            # Normalize a skill name
            original = matcher.skill_names[0]
            normalized = _normalize_skill_name(original)

            # Match the normalized version
            result = matcher.match(normalized)
            # Should still find a match (fuzzy matching handles case)
            assert result.score > 50  # At least partial match


# =============================================================================
# Run Tests
# =============================================================================

if __name__ == "__main__":
    pytest.main([__file__, "-v"])
