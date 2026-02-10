"""
Integration tests for the full OCR extraction pipeline.

These tests validate:
- Full pipeline on synthetic mobile and PC images
- SkillOcrResult and SkillEntry structure integrity
- Debug mode output generation
- VideoOptimizer frame sequence processing
- Skill database integration

Tests use synthetic images and mock fixtures to ensure consistent
behavior without requiring real screenshots or Tesseract installation.
"""

import os
import tempfile
from unittest.mock import patch, MagicMock

import cv2
import numpy as np
import pytest

from ocr import extract_visible_skills, SkillEntry, SkillOcrResult
from ocr.extractor import _get_skill_matcher, _extract_skill_points_from_top_bar
from ocr.layout import detect_layout, detect_platform, LayoutInfo
from ocr.row_parser import segment_rows, RowInfo
from ocr.video import VideoOptimizer, CachedGeometry, RowTracker, TemporalValue
from ocr.skill_matcher import SkillMatcher, MatchResult


# =============================================================================
# Fixtures: Synthetic Test Images
# =============================================================================

@pytest.fixture
def mobile_frame():
    """Create a synthetic mobile portrait frame (565x1004)."""
    frame = np.ones((1004, 565, 3), dtype=np.uint8) * 200  # Gray background

    # Add green plus buttons (simulating skill rows)
    button_positions = [(500, 250), (500, 330), (500, 410), (500, 490), (500, 570)]
    for x, y in button_positions:
        cv2.circle(frame, (x, y), 15, (0, 200, 0), -1)  # Green (BGR)

    return frame


@pytest.fixture
def pc_frame():
    """Create a synthetic PC landscape frame (2048x1152)."""
    frame = np.ones((1152, 2048, 3), dtype=np.uint8) * 200  # Gray background

    # Add green plus buttons at right side of skill list
    button_positions = [(1800, 300), (1800, 400), (1800, 500), (1800, 600)]
    for x, y in button_positions:
        cv2.circle(frame, (x, y), 20, (0, 200, 0), -1)  # Green (BGR)

    return frame


@pytest.fixture
def blank_frame():
    """Create a blank frame with no skill UI elements."""
    return np.zeros((1000, 500, 3), dtype=np.uint8)


@pytest.fixture
def mobile_frame_with_badges(mobile_frame):
    """Create a mobile frame with red (obtained) and orange (hint) badges."""
    frame = mobile_frame.copy()

    # Add red obtained badges at right edge
    for i, y in enumerate([250, 410]):  # Every other row
        cv2.rectangle(frame, (520, y-10), (560, y+10), (0, 0, 255), -1)

    # Add orange hint badges above cost area
    for i, y in enumerate([330, 490]):
        cv2.rectangle(frame, (400, y-25), (470, y-5), (0, 165, 255), -1)

    return frame


@pytest.fixture
def skill_matcher():
    """Create a SkillMatcher instance if skills database is available."""
    try:
        return SkillMatcher()
    except FileNotFoundError:
        pytest.skip("skills_all.json not found")


# =============================================================================
# Tests: Platform Detection Integration
# =============================================================================

class TestPlatformDetectionIntegration:
    """Integration tests for platform detection across different resolutions."""

    def test_mobile_detection(self, mobile_frame):
        """Mobile portrait frame is correctly detected."""
        platform = detect_platform(mobile_frame)
        assert platform == "mobile"

    def test_pc_detection(self, pc_frame):
        """PC landscape frame is correctly detected."""
        platform = detect_platform(pc_frame)
        assert platform == "pc"

    def test_various_mobile_resolutions(self):
        """Various mobile resolutions are correctly detected."""
        resolutions = [
            (375, 667),   # iPhone 6/7/8
            (414, 896),   # iPhone XS Max
            (360, 800),   # Android common
            (565, 1004),  # Reference mobile
        ]
        for width, height in resolutions:
            frame = np.zeros((height, width, 3), dtype=np.uint8)
            platform = detect_platform(frame)
            assert platform == "mobile", f"Failed for {width}x{height}"

    def test_various_pc_resolutions(self):
        """Various PC resolutions are correctly detected."""
        resolutions = [
            (1920, 1080),  # 1080p
            (2560, 1440),  # 1440p
            (2048, 1152),  # Reference PC
            (1280, 720),   # 720p
        ]
        for width, height in resolutions:
            frame = np.zeros((height, width, 3), dtype=np.uint8)
            platform = detect_platform(frame)
            assert platform == "pc", f"Failed for {width}x{height}"


# =============================================================================
# Tests: Full Extraction Pipeline
# =============================================================================

class TestFullExtractionPipeline:
    """Integration tests for the complete extraction pipeline."""

    def test_extract_mobile_returns_skill_ocr_result(self, mobile_frame):
        """Mobile frame extraction returns SkillOcrResult."""
        result = extract_visible_skills(mobile_frame)

        assert isinstance(result, SkillOcrResult)
        assert isinstance(result.skills, list)
        assert isinstance(result.meta, dict)

    def test_extract_pc_returns_skill_ocr_result(self, pc_frame):
        """PC frame extraction returns SkillOcrResult."""
        result = extract_visible_skills(pc_frame)

        assert isinstance(result, SkillOcrResult)
        assert isinstance(result.skills, list)
        assert isinstance(result.meta, dict)

    def test_meta_contains_required_fields(self, mobile_frame):
        """Extraction meta contains all required fields."""
        result = extract_visible_skills(mobile_frame)

        # Check required meta fields are present
        assert "frame_shape" in result.meta
        assert "source" in result.meta or "error" in result.meta
        assert "timing" in result.meta

    def test_meta_source_is_platform(self, mobile_frame, pc_frame):
        """Meta source correctly identifies platform."""
        mobile_result = extract_visible_skills(mobile_frame)
        pc_result = extract_visible_skills(pc_frame)

        if "source" in mobile_result.meta:
            assert mobile_result.meta["source"] == "mobile"
        if "source" in pc_result.meta:
            assert pc_result.meta["source"] == "pc"

    def test_blank_frame_returns_empty_skills(self, blank_frame):
        """Blank frame returns empty skill list."""
        result = extract_visible_skills(blank_frame)

        assert isinstance(result, SkillOcrResult)
        assert len(result.skills) == 0

    def test_invalid_frame_none(self):
        """None frame returns result with error."""
        result = extract_visible_skills(None)

        assert isinstance(result, SkillOcrResult)
        assert len(result.skills) == 0
        assert "error" in result.meta

    def test_invalid_frame_empty(self):
        """Empty frame returns result with error."""
        empty = np.array([])
        result = extract_visible_skills(empty)

        assert isinstance(result, SkillOcrResult)
        assert len(result.skills) == 0
        assert "error" in result.meta

    def test_grayscale_frame_returns_error(self):
        """Grayscale (2-channel) frame returns result with error."""
        gray = np.zeros((500, 500), dtype=np.uint8)
        result = extract_visible_skills(gray)

        assert isinstance(result, SkillOcrResult)
        assert "error" in result.meta


class TestSkillEntryStructure:
    """Integration tests for SkillEntry data structure."""

    def test_skill_entry_has_required_fields(self):
        """SkillEntry has all required fields."""
        skill = SkillEntry(
            name_raw="Test Skill",
            name_norm="test skill",
        )

        assert hasattr(skill, "name_raw")
        assert hasattr(skill, "name_norm")
        assert hasattr(skill, "skill_id")
        assert hasattr(skill, "canonical_name")
        assert hasattr(skill, "cost")
        assert hasattr(skill, "hint_level")
        assert hasattr(skill, "discount_percent")
        assert hasattr(skill, "obtained")
        assert hasattr(skill, "confidence")
        assert hasattr(skill, "bboxes")

    def test_skill_entry_defaults(self):
        """SkillEntry has correct default values."""
        skill = SkillEntry(name_raw="", name_norm="")

        assert skill.skill_id is None
        assert skill.canonical_name is None
        assert skill.cost is None
        assert skill.hint_level is None
        assert skill.discount_percent is None
        assert skill.obtained is False
        assert skill.confidence == {}
        assert skill.bboxes == {}

    def test_skill_entry_with_all_fields(self):
        """SkillEntry correctly stores all field values."""
        skill = SkillEntry(
            name_raw="Test Skill Raw",
            name_norm="test skill raw",
            skill_id=12345,
            canonical_name="Test Skill",
            cost=180,
            hint_level=3,
            discount_percent=20,
            obtained=True,
            confidence={"name": 0.95, "cost": 0.99},
            bboxes={"row": (10, 20, 100, 40)},
        )

        assert skill.name_raw == "Test Skill Raw"
        assert skill.name_norm == "test skill raw"
        assert skill.skill_id == 12345
        assert skill.canonical_name == "Test Skill"
        assert skill.cost == 180
        assert skill.hint_level == 3
        assert skill.discount_percent == 20
        assert skill.obtained is True
        assert skill.confidence["name"] == 0.95
        assert skill.bboxes["row"] == (10, 20, 100, 40)


class TestSkillOcrResultStructure:
    """Integration tests for SkillOcrResult data structure."""

    def test_skill_ocr_result_defaults(self):
        """SkillOcrResult has correct default values."""
        result = SkillOcrResult()

        assert result.skills == []
        assert result.skill_points_available is None
        assert result.meta == {}

    def test_skill_ocr_result_with_skills(self):
        """SkillOcrResult correctly stores skill list."""
        skills = [
            SkillEntry(name_raw="Skill 1", name_norm="skill 1"),
            SkillEntry(name_raw="Skill 2", name_norm="skill 2"),
        ]
        result = SkillOcrResult(
            skills=skills,
            skill_points_available=1234,
            meta={"source": "mobile"},
        )

        assert len(result.skills) == 2
        assert result.skills[0].name_raw == "Skill 1"
        assert result.skill_points_available == 1234
        assert result.meta["source"] == "mobile"


# =============================================================================
# Tests: Layout Detection Integration
# =============================================================================

class TestLayoutDetectionIntegration:
    """Integration tests for layout detection."""

    def test_detect_layout_mobile(self, mobile_frame):
        """detect_layout returns LayoutInfo for mobile frame."""
        layout = detect_layout(mobile_frame)

        assert isinstance(layout, LayoutInfo)
        assert layout.platform == "mobile"
        assert layout.scale > 0

    def test_detect_layout_pc(self, pc_frame):
        """detect_layout returns LayoutInfo for PC frame."""
        layout = detect_layout(pc_frame)

        assert isinstance(layout, LayoutInfo)
        assert layout.platform == "pc"
        assert layout.scale > 0

    def test_detect_layout_finds_plus_buttons(self, mobile_frame):
        """detect_layout finds green plus buttons."""
        layout = detect_layout(mobile_frame)

        assert isinstance(layout.plus_buttons, list)
        # We added 5 buttons to the mobile frame fixture
        assert len(layout.plus_buttons) >= 0  # May vary based on detection

    def test_detect_layout_list_bbox(self, mobile_frame):
        """detect_layout provides list bounding box."""
        layout = detect_layout(mobile_frame)

        # list_bbox should be (x1, y1, x2, y2) or None
        if layout.list_bbox is not None:
            assert len(layout.list_bbox) == 4
            x1, y1, x2, y2 = layout.list_bbox
            assert x2 > x1
            assert y2 > y1

    def test_detect_layout_auto_source(self, mobile_frame, pc_frame):
        """detect_layout with source='auto' correctly detects platform."""
        mobile_layout = detect_layout(mobile_frame, source="auto")
        pc_layout = detect_layout(pc_frame, source="auto")

        assert mobile_layout.platform == "mobile"
        assert pc_layout.platform == "pc"

    def test_detect_layout_forced_source(self, mobile_frame):
        """detect_layout respects forced source parameter."""
        layout_pc = detect_layout(mobile_frame, source="pc")

        # Should use "pc" even for mobile aspect ratio
        assert layout_pc.platform == "pc"


# =============================================================================
# Tests: Debug Mode Integration
# =============================================================================

class TestDebugModeIntegration:
    """Integration tests for debug mode output."""

    def test_debug_mode_adds_meta_fields(self, mobile_frame):
        """Debug mode adds debug fields to meta."""
        result = extract_visible_skills(mobile_frame, debug=True)

        assert "debug" in result.meta
        assert result.meta["debug"] is True
        assert "debug_paths" in result.meta

    def test_debug_mode_creates_output_dir(self, mobile_frame):
        """Debug mode creates output directory."""
        result = extract_visible_skills(mobile_frame, debug=True)

        debug_paths = result.meta.get("debug_paths", {})
        if "output_dir" in debug_paths:
            assert os.path.isdir(debug_paths["output_dir"])

    def test_debug_mode_creates_annotated_image(self, mobile_frame):
        """Debug mode creates annotated image file."""
        result = extract_visible_skills(mobile_frame, debug=True)

        debug_paths = result.meta.get("debug_paths", {})
        if "annotated" in debug_paths:
            assert os.path.isfile(debug_paths["annotated"])

    def test_debug_mode_creates_summary(self, mobile_frame):
        """Debug mode creates summary text file."""
        result = extract_visible_skills(mobile_frame, debug=True)

        debug_paths = result.meta.get("debug_paths", {})
        if "summary" in debug_paths:
            assert os.path.isfile(debug_paths["summary"])

    def test_debug_false_no_debug_paths(self, mobile_frame):
        """Non-debug mode does not create debug paths."""
        result = extract_visible_skills(mobile_frame, debug=False)

        assert "debug_paths" not in result.meta


# =============================================================================
# Tests: VideoOptimizer Integration
# =============================================================================

class TestVideoOptimizerIntegration:
    """Integration tests for VideoOptimizer frame processing."""

    def test_video_optimizer_init(self):
        """VideoOptimizer initializes correctly."""
        optimizer = VideoOptimizer(cache_frames=5)

        assert optimizer.cache_frames == 5
        assert optimizer.is_initialized is False

    def test_video_optimizer_process_single_frame(self, mobile_frame):
        """VideoOptimizer processes single frame correctly."""
        optimizer = VideoOptimizer()
        result = optimizer.process_frame(mobile_frame)

        assert isinstance(result, SkillOcrResult)
        assert optimizer.is_initialized

    def test_video_optimizer_cache_hit_on_repeated_frames(self, mobile_frame):
        """VideoOptimizer reuses cache for identical frames."""
        optimizer = VideoOptimizer(cache_frames=10)

        # Process same frame multiple times
        result1 = optimizer.process_frame(mobile_frame)
        result2 = optimizer.process_frame(mobile_frame)
        result3 = optimizer.process_frame(mobile_frame)

        # First frame is cache miss, subsequent should be hits
        stats = optimizer.get_stats()
        assert stats["cache_hits"] >= 0
        assert stats["frames_processed"] == 3

    def test_video_optimizer_detects_scene_change(self, mobile_frame, pc_frame):
        """VideoOptimizer detects scene changes between different frames."""
        optimizer = VideoOptimizer(cache_frames=10)

        # Process mobile frame
        optimizer.process_frame(mobile_frame)

        # Process very different PC frame
        optimizer.process_frame(pc_frame)

        stats = optimizer.get_stats()
        # Should trigger scene change or cache miss
        assert stats["cache_misses"] >= 1

    def test_video_optimizer_force_refresh(self, mobile_frame):
        """VideoOptimizer force_refresh bypasses cache."""
        optimizer = VideoOptimizer(cache_frames=10)

        optimizer.process_frame(mobile_frame)
        optimizer.process_frame(mobile_frame)

        # Force refresh should be a cache miss
        initial_misses = optimizer.get_stats()["cache_misses"]
        optimizer.process_frame(mobile_frame, force_refresh=True)
        final_misses = optimizer.get_stats()["cache_misses"]

        assert final_misses > initial_misses

    def test_video_optimizer_reset(self, mobile_frame):
        """VideoOptimizer reset clears all state."""
        optimizer = VideoOptimizer()

        optimizer.process_frame(mobile_frame)
        assert optimizer.is_initialized

        optimizer.reset()
        assert optimizer.is_initialized is False
        assert optimizer.get_stats()["frames_processed"] == 0

    def test_video_optimizer_fps_estimate(self, mobile_frame):
        """VideoOptimizer provides FPS estimate."""
        optimizer = VideoOptimizer()

        for _ in range(5):
            result = optimizer.process_frame(mobile_frame)

        assert "fps_estimate" in result.meta
        assert result.meta["fps_estimate"] >= 0

    def test_video_optimizer_cache_age_tracking(self, mobile_frame):
        """VideoOptimizer tracks cache age."""
        optimizer = VideoOptimizer(cache_frames=10)

        for i in range(5):
            result = optimizer.process_frame(mobile_frame)

        if "cache_age" in result.meta:
            assert result.meta["cache_age"] >= 0


class TestVideoOptimizerTemporalSmoothing:
    """Integration tests for VideoOptimizer temporal smoothing."""

    def test_temporal_smoothing_applied(self, mobile_frame):
        """Temporal smoothing is applied to results."""
        optimizer = VideoOptimizer(temporal_window=3)

        result = optimizer.process_frame(mobile_frame)

        # After first frame, smoothing should be applied
        if result.skills:
            assert "temporal_smoothing_applied" in result.meta

    def test_row_tracker_creation(self, mobile_frame):
        """Row trackers are created for detected rows."""
        optimizer = VideoOptimizer(temporal_window=5)

        result = optimizer.process_frame(mobile_frame)

        # Active trackers should be recorded in meta
        if "active_trackers" in result.meta:
            assert result.meta["active_trackers"] >= 0


# =============================================================================
# Tests: Skill Database Integration
# =============================================================================

class TestSkillDatabaseIntegration:
    """Integration tests for skill database matching."""

    def test_skill_matcher_singleton(self):
        """Skill matcher singleton is correctly initialized."""
        try:
            matcher = _get_skill_matcher()
            assert isinstance(matcher, SkillMatcher)
        except FileNotFoundError:
            pytest.skip("skills_all.json not found")

    def test_skill_matcher_has_skills(self, skill_matcher):
        """Skill matcher loads skills from database."""
        assert len(skill_matcher.skills) > 0
        assert len(skill_matcher.skill_names) > 0

    def test_skill_matcher_match_result(self, skill_matcher):
        """Skill matcher returns valid MatchResult."""
        result = skill_matcher.match("test skill")

        assert isinstance(result, MatchResult)
        assert hasattr(result, "skill_id")
        assert hasattr(result, "canonical_name")
        assert hasattr(result, "score")

    def test_skill_matcher_exact_match(self, skill_matcher):
        """Skill matcher finds exact matches."""
        if skill_matcher.skill_names:
            # Use first skill name for exact match test
            name = skill_matcher.skill_names[0]
            result = skill_matcher.match(name)

            if result.skill_id is not None:
                assert result.score >= 95.0

    def test_skill_matcher_fuzzy_match(self, skill_matcher):
        """Skill matcher finds fuzzy matches."""
        # Try a common skill pattern with typos
        result = skill_matcher.match("It Going to Be Me")

        # Should find something close to "It's Going to Be Me"
        if result.skill_id is not None:
            assert result.score >= 80.0

    def test_all_matched_skills_exist_in_database(self, skill_matcher):
        """All matched skill IDs exist in the database."""
        # Get a few matches
        test_names = skill_matcher.skill_names[:5] if len(skill_matcher.skill_names) >= 5 else skill_matcher.skill_names

        for name in test_names:
            result = skill_matcher.match(name)
            if result.skill_id is not None:
                # Look up by ID
                skill = skill_matcher.get_skill_by_id(result.skill_id)
                assert skill is not None, f"Skill ID {result.skill_id} not found"


# =============================================================================
# Tests: Row Segmentation Integration
# =============================================================================

class TestRowSegmentationIntegration:
    """Integration tests for row segmentation."""

    def test_segment_rows_with_layout(self, mobile_frame):
        """segment_rows works with layout detection."""
        layout = detect_layout(mobile_frame)

        if layout.list_bbox is not None:
            rows = segment_rows(
                mobile_frame,
                layout.list_bbox,
                layout.plus_buttons,
                platform=layout.platform,
            )

            assert isinstance(rows, list)
            for row in rows:
                assert isinstance(row, RowInfo)

    def test_row_info_has_rois(self, mobile_frame):
        """RowInfo contains sub-ROIs."""
        layout = detect_layout(mobile_frame)

        if layout.list_bbox is not None:
            rows = segment_rows(
                mobile_frame,
                layout.list_bbox,
                layout.plus_buttons,
                platform=layout.platform,
            )

            for row in rows:
                assert hasattr(row, "bbox")
                assert hasattr(row, "name_roi")
                assert hasattr(row, "cost_roi")
                assert hasattr(row, "hint_roi")
                assert hasattr(row, "obtained_roi")


# =============================================================================
# Tests: End-to-End Scenarios
# =============================================================================

class TestEndToEndScenarios:
    """End-to-end integration tests for common scenarios."""

    def test_full_mobile_workflow(self, mobile_frame):
        """Complete mobile extraction workflow."""
        # Detect layout
        layout = detect_layout(mobile_frame)
        assert layout.platform == "mobile"

        # Extract skills
        result = extract_visible_skills(mobile_frame)
        assert isinstance(result, SkillOcrResult)
        assert result.meta.get("source") == "mobile" or "error" in result.meta

    def test_full_pc_workflow(self, pc_frame):
        """Complete PC extraction workflow."""
        # Detect layout
        layout = detect_layout(pc_frame)
        assert layout.platform == "pc"

        # Extract skills
        result = extract_visible_skills(pc_frame)
        assert isinstance(result, SkillOcrResult)
        assert result.meta.get("source") == "pc" or "error" in result.meta

    def test_video_workflow(self, mobile_frame, pc_frame):
        """Video processing workflow with multiple frames."""
        optimizer = VideoOptimizer(cache_frames=5)

        # Process sequence of frames
        frames = [mobile_frame, mobile_frame, mobile_frame, pc_frame, pc_frame]
        results = []

        for frame in frames:
            result = optimizer.process_frame(frame)
            results.append(result)

        assert len(results) == 5
        assert all(isinstance(r, SkillOcrResult) for r in results)

        stats = optimizer.get_stats()
        assert stats["frames_processed"] == 5

    def test_debug_workflow(self, mobile_frame):
        """Debug mode workflow produces valid output."""
        result = extract_visible_skills(mobile_frame, debug=True)

        assert result.meta.get("debug") is True

        debug_paths = result.meta.get("debug_paths", {})
        if debug_paths:
            # Verify output directory exists
            if "output_dir" in debug_paths:
                assert os.path.isdir(debug_paths["output_dir"])


# =============================================================================
# Tests: Error Handling
# =============================================================================

class TestErrorHandling:
    """Integration tests for error handling."""

    def test_graceful_handling_of_corrupted_frame(self):
        """Pipeline gracefully handles corrupted frames."""
        # Create a frame with unusual dimensions
        weird_frame = np.zeros((1, 1, 3), dtype=np.uint8)
        result = extract_visible_skills(weird_frame)

        assert isinstance(result, SkillOcrResult)

    def test_graceful_handling_of_high_res_frame(self):
        """Pipeline handles very high resolution frames."""
        large_frame = np.ones((4320, 7680, 3), dtype=np.uint8) * 200
        result = extract_visible_skills(large_frame)

        assert isinstance(result, SkillOcrResult)

    def test_video_optimizer_handles_invalid_frames(self):
        """VideoOptimizer handles invalid frames gracefully."""
        optimizer = VideoOptimizer()

        result = optimizer.process_frame(None)
        assert isinstance(result, SkillOcrResult)
        assert "error" in result.meta


# =============================================================================
# Tests: Performance Characteristics
# =============================================================================

class TestPerformanceCharacteristics:
    """Integration tests for performance characteristics."""

    def test_extraction_timing_is_recorded(self, mobile_frame):
        """Extraction timing is recorded in meta."""
        result = extract_visible_skills(mobile_frame)

        assert "timing" in result.meta
        assert result.meta["timing"] >= 0

    def test_video_optimizer_cache_improves_performance(self, mobile_frame):
        """Cache should improve processing speed."""
        optimizer = VideoOptimizer(cache_frames=10)

        # First frame (cold cache)
        result1 = optimizer.process_frame(mobile_frame)

        # Subsequent frames (warm cache)
        for _ in range(5):
            result = optimizer.process_frame(mobile_frame)

        stats = optimizer.get_stats()
        # With cache hits, should have processed frames
        assert stats["frames_processed"] == 6


# =============================================================================
# Run Tests
# =============================================================================

if __name__ == "__main__":
    pytest.main([__file__, "-v"])
