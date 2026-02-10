"""
Main extractor module for Umamusume skill OCR extraction.

This module provides the primary API for extracting skill information from
Umamusume Learn screen screenshots and video frames. It orchestrates all
OCR sub-modules to produce structured skill data.

Usage:
    from ocr.extractor import extract_visible_skills
    import cv2

    # Load image (BGR format)
    frame = cv2.imread("screenshot.png")

    # Extract skills
    result = extract_visible_skills(frame)

    for skill in result.skills:
        print(f"{skill.canonical_name or skill.name_raw}: {skill.cost} pts")

    print(f"Platform: {result.meta['source']}")
"""

import time
from typing import Optional

import numpy as np

from .color_detect import detect_red_badge
from .field_ocr import ocr_cost_digits, ocr_hint_badge, ocr_skill_name
from .layout import detect_layout
from .row_parser import get_roi_crop, segment_rows
from .skill_matcher import SkillMatcher
from .types import SkillEntry, SkillOcrResult


# Singleton skill matcher instance for efficiency
_skill_matcher: Optional[SkillMatcher] = None


def _get_skill_matcher() -> SkillMatcher:
    """
    Get or create the singleton SkillMatcher instance.

    Returns:
        SkillMatcher instance
    """
    global _skill_matcher
    if _skill_matcher is None:
        _skill_matcher = SkillMatcher()
    return _skill_matcher


def _extract_skill_from_row(
    frame: np.ndarray,
    row,
    matcher: SkillMatcher,
) -> SkillEntry:
    """
    Extract skill information from a single row.

    Args:
        frame: BGR image (full frame)
        row: RowInfo object with sub-ROI locations
        matcher: SkillMatcher for name matching

    Returns:
        SkillEntry with all extracted fields
    """
    # Initialize default values
    name_raw = ""
    name_norm = ""
    skill_id = None
    canonical_name = None
    cost = None
    hint_level = None
    discount_percent = None
    obtained = False
    confidence = {}
    bboxes = {}

    # Store row bbox
    if row.bbox:
        bboxes["row"] = row.bbox

    # Extract cost from cost_roi
    if row.cost_roi:
        cost_crop = get_roi_crop(frame, row.cost_roi)
        if cost_crop is not None and cost_crop.size > 0:
            cost_result = ocr_cost_digits(cost_crop)
            cost = cost_result.value
            confidence["cost"] = cost_result.confidence
            bboxes["cost"] = row.cost_roi

    # Detect obtained badge from obtained_roi
    if row.obtained_roi:
        obtained_crop = get_roi_crop(frame, row.obtained_roi)
        if obtained_crop is not None and obtained_crop.size > 0:
            found, red_conf, _ = detect_red_badge(obtained_crop)
            obtained = found
            confidence["obtained"] = red_conf
            bboxes["obtained"] = row.obtained_roi

    # Extract hint badge from hint_roi
    if row.hint_roi:
        hint_crop = get_roi_crop(frame, row.hint_roi)
        if hint_crop is not None and hint_crop.size > 0:
            hint_result = ocr_hint_badge(hint_crop)
            if hint_result.badge_found:
                hint_level = hint_result.hint_level
                discount_percent = hint_result.discount_percent
                confidence["hint"] = hint_result.confidence
                bboxes["hint"] = row.hint_roi

    # Extract skill name from name_roi
    if row.name_roi:
        name_crop = get_roi_crop(frame, row.name_roi)
        if name_crop is not None and name_crop.size > 0:
            name_result = ocr_skill_name(name_crop)
            name_raw = name_result.raw
            name_norm = name_result.normalized
            confidence["name"] = name_result.confidence
            bboxes["name"] = row.name_roi

            # Match skill name to database
            if name_norm:
                match_result = matcher.match(name_norm)
                if match_result.skill_id:
                    skill_id = match_result.skill_id
                    canonical_name = match_result.canonical_name
                    confidence["match"] = match_result.score / 100.0

    return SkillEntry(
        name_raw=name_raw,
        name_norm=name_norm,
        skill_id=skill_id,
        canonical_name=canonical_name,
        cost=cost,
        hint_level=hint_level,
        discount_percent=discount_percent,
        obtained=obtained,
        confidence=confidence,
        bboxes=bboxes,
    )


def extract_visible_skills(
    frame: np.ndarray,
    source: str = "auto",
    debug: bool = False,
) -> SkillOcrResult:
    """
    Extract visible skill information from a Learn screen frame.

    This is the main entry point for the OCR extraction pipeline. It:
    1. Detects layout (platform, list bbox, scale)
    2. Segments the list into individual skill rows
    3. Extracts each field (cost, name, hints, obtained) per row
    4. Matches skill names against the database

    Args:
        frame: BGR image (numpy array) from the game. Must be 3-channel color.
               Can be any resolution - the extractor is resolution-independent.
        source: Layout source hint - "auto", "mobile", or "pc".
                "auto" detects based on aspect ratio.
        debug: If True, generates annotated debug output.
               (Debug mode will be fully implemented in a later subtask)

    Returns:
        SkillOcrResult containing:
        - skills: List of SkillEntry objects for each detected skill row
        - skill_points_available: Not yet implemented (returns None)
        - meta: Dict with source, scale, list_bbox, timing, frame_shape, etc.
    """
    start_time = time.time()

    # Initialize result with defaults
    result = SkillOcrResult(
        skills=[],
        skill_points_available=None,
        meta={},
    )

    # Validate input frame
    if frame is None or frame.size == 0:
        result.meta["error"] = "Invalid frame: None or empty"
        result.meta["timing"] = time.time() - start_time
        return result

    if len(frame.shape) != 3:
        result.meta["error"] = "Invalid frame: expected 3-channel color image"
        result.meta["timing"] = time.time() - start_time
        return result

    height, width, channels = frame.shape
    result.meta["frame_shape"] = (height, width, channels)

    # Detect layout
    layout = detect_layout(frame, source)

    if layout is None:
        result.meta["error"] = "Layout detection failed"
        result.meta["timing"] = time.time() - start_time
        return result

    result.meta["source"] = layout.platform
    result.meta["scale"] = layout.scale
    result.meta["list_bbox"] = layout.list_bbox
    result.meta["layout_confidence"] = layout.confidence
    result.meta["row_height_estimate"] = layout.row_height_estimate
    result.meta["plus_buttons_count"] = len(layout.plus_buttons)

    # If no list bbox found, we can't segment rows
    if layout.list_bbox is None:
        result.meta["warning"] = "No skill list detected"
        result.meta["timing"] = time.time() - start_time
        return result

    # Segment rows
    rows = segment_rows(
        frame,
        layout.list_bbox,
        layout.plus_buttons,
        platform=layout.platform,
    )

    result.meta["rows_detected"] = len(rows)

    if not rows:
        result.meta["warning"] = "No skill rows detected"
        result.meta["timing"] = time.time() - start_time
        return result

    # Get skill matcher
    matcher = _get_skill_matcher()

    # Extract skills from each row
    skills = []
    for row in rows:
        skill_entry = _extract_skill_from_row(frame, row, matcher)
        skills.append(skill_entry)

    result.skills = skills

    # Calculate timing
    end_time = time.time()
    result.meta["timing"] = end_time - start_time

    # Debug mode placeholder - will be implemented in subtask-9-3
    if debug:
        result.meta["debug"] = True
        # Debug visualization will be added later

    return result
